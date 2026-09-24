"""Readable, bounded audit transcripts outside BaseAgent model working memory."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator

from .contracts import StrictModel


class AuditLogEntry(StrictModel):
    schema_version: str = "agent-audit-log-v1"
    sequence: int = Field(ge=1)
    event_type: str = Field(min_length=1)
    occurred_at_utc: str
    run_id: str = Field(min_length=1)
    task_id: str | None = None
    iteration: int | None = Field(default=None, ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)
    previous_hash: str | None = None
    integrity_hash: str = ""

    @field_validator("payload")
    @classmethod
    def safe_payload(cls, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_hidden_reasoning(payload)
        return payload


class AuditTranscriptStore:
    """Append-only JSONL audit records plus a rendered review transcript.

    It stores only bounded, redacted public inputs/outputs and result handles. It is
    intentionally external to ProjectState and never feeds raw history into ModelContext.
    """

    def __init__(self, root: Path, *, max_payload_chars: int = 8_192) -> None:
        if max_payload_chars < 256:
            raise ValueError("max_payload_chars must be at least 256.")
        self._root = root.resolve() / ".agent-audit-logs"
        self._root.mkdir(parents=True, exist_ok=True)
        self._max_payload_chars = max_payload_chars
        self._lock = threading.RLock()

    def append(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        task_id: str | None = None,
        iteration: int | None = None,
    ) -> AuditLogEntry:
        with self._lock:
            path = self._jsonl_path(run_id)
            previous, sequence = self._tail(path)
            prepared = AuditLogEntry(
                sequence=sequence + 1,
                event_type=event_type,
                occurred_at_utc=datetime.now(UTC).isoformat(),
                run_id=run_id,
                task_id=task_id,
                iteration=iteration,
                payload=_bound_and_redact(payload, self._max_payload_chars),
                previous_hash=previous,
            )
            complete = prepared.model_copy(
                update={"integrity_hash": _hash(prepared.model_dump(mode="json"))}
            )
            with path.open("a", encoding="utf-8") as handle:
                handle.write(complete.model_dump_json())
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            return complete

    def list_entries(
        self,
        run_id: str,
        *,
        limit: int = 1_000,
        through_sequence: int | None = None,
    ) -> list[AuditLogEntry]:
        if limit < 1 or limit > 10_000:
            raise ValueError("Audit-log page size must be between 1 and 10000.")
        path = self._jsonl_path(run_id)
        if not path.exists():
            return []
        entries = [
            AuditLogEntry.model_validate_json(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        if through_sequence is not None:
            entries = [entry for entry in entries if entry.sequence <= through_sequence]
        return entries[:limit]

    def snapshot_sequence(self, run_id: str) -> int:
        """Return the local append sequence used as a verification boundary."""

        with self._lock:
            _previous, sequence = self._tail(self._jsonl_path(run_id))
        return sequence

    def iter_entries(
        self, run_id: str, *, through_sequence: int | None = None
    ) -> Iterator[AuditLogEntry]:
        """Stream one complete transcript sequence through a fixed boundary."""

        boundary = self.snapshot_sequence(run_id) if through_sequence is None else through_sequence
        path = self._jsonl_path(run_id)
        if not path.exists():
            return
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    entry = AuditLogEntry.model_validate_json(line)
                    if entry.sequence > boundary:
                        return
                    yield entry

    def entry_count(self, run_id: str, *, through_sequence: int | None = None) -> int:
        """Return the complete persisted transcript length for an audit run."""

        return sum(1 for _ in self.iter_entries(run_id, through_sequence=through_sequence))

    def verify(self, run_id: str) -> bool:
        boundary = self.snapshot_sequence(run_id)
        return self._verify_entries(self.iter_entries(run_id, through_sequence=boundary))

    @staticmethod
    def _verify_entries(entries: Iterator[AuditLogEntry]) -> bool:
        previous: str | None = None
        for entry in entries:
            expected = _hash(
                entry.model_copy(update={"integrity_hash": ""}).model_dump(mode="json")
            )
            if entry.previous_hash != previous or entry.integrity_hash != expected:
                return False
            previous = entry.integrity_hash
        return True

    def render_markdown(self, run_id: str) -> Path:
        boundary = self.snapshot_sequence(run_id)
        entries = self.list_entries(run_id, through_sequence=boundary)
        entry_count = self.entry_count(run_id, through_sequence=boundary)
        integrity_valid = self._verify_entries(self.iter_entries(run_id, through_sequence=boundary))
        path = self._root / f"{_safe_name(run_id)}.transcript.md"
        lines = [
            f"# Agent audit transcript: `{run_id}`",
            "",
            f"Integrity chain valid: `{integrity_valid}`",
            f"Verified transcript entries: `{entry_count}`",
            f"Verified through sequence: `{boundary}`",
            f"Rendered entries: `{len(entries)}`",
            "",
        ]
        for entry in entries:
            lines.extend(
                [
                    f"## {entry.sequence}. {entry.event_type}",
                    "",
                    f"- Time: `{entry.occurred_at_utc}`",
                    f"- Iteration: `{entry.iteration}`",
                    f"- Integrity hash: `{entry.integrity_hash}`",
                    "",
                    "```json",
                    json.dumps(entry.payload, indent=2, sort_keys=True),
                    "```",
                    "",
                ]
            )
        _atomic_write(path, "\n".join(lines))
        return path

    def _tail(self, path: Path) -> tuple[str | None, int]:
        if not path.exists() or not path.stat().st_size:
            return None, 0
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            end = handle.tell()
            seek = max(0, end - 65_536)
            handle.seek(seek)
            lines = handle.read().decode("utf-8").splitlines()
        tail = AuditLogEntry.model_validate_json(lines[-1])
        return tail.integrity_hash, tail.sequence

    def _jsonl_path(self, run_id: str) -> Path:
        return self._root / f"{_safe_name(run_id)}.jsonl"


def _bound_and_redact(value: Any, max_chars: int) -> dict[str, Any]:
    redacted = _redact(value)
    encoded = _canonical_json(redacted)
    if len(encoded) <= max_chars:
        if isinstance(redacted, dict):
            return redacted
        return {"value": redacted}
    return {
        "truncated": True,
        "content_hash": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "original_chars": len(encoded),
        "preview": encoded[:max_chars],
    }


def _redact(value: Any) -> Any:
    secret = re.compile(
        r"(authorization|api[_-]?key|password|secret|token|cookie|credential|private[_-]?key)",
        re.IGNORECASE,
    )
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if secret.search(str(key)) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _reject_hidden_reasoning(value: Any) -> None:
    forbidden = {"chain_of_thought", "hidden_reasoning", "reasoning_trace", "scratchpad"}
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in forbidden:
                raise ValueError("Audit logs must not persist hidden model reasoning.")
            _reject_hidden_reasoning(item)
    elif isinstance(value, list):
        for item in value:
            _reject_hidden_reasoning(item)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _safe_name(value: str) -> str:
    return "".join(
        character if character.isalnum() or character in "-_." else "_" for character in value
    )


def _atomic_write(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)
