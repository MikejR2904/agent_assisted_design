"""Content-addressed artifacts under a declared run root."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from pydantic import Field

from .contracts import StrictModel


class ArtifactRecord(StrictModel):
    artifact_id: str = Field(min_length=1)
    relative_path: str = Field(min_length=1)
    sha256: str = Field(min_length=1)
    size_bytes: int = Field(ge=0)
    kind: str = Field(min_length=1)
    manifest: dict[str, Any] = Field(default_factory=dict)


class ArtifactStore:
    """Persist artifacts only below one root and register immutable manifests."""

    def __init__(self, run_root: Path) -> None:
        self._root = run_root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._manifest_root = self._root / ".agent-artifacts"
        self._manifest_root.mkdir(exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def write_text(
        self,
        relative_path: str,
        content: str,
        *,
        kind: str = "draft",
        manifest: dict[str, Any] | None = None,
    ) -> ArtifactRecord:
        target = self._resolve_relative(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        encoded = content.encode("utf-8")
        self._atomic_write_bytes(target, encoded)
        return self._register(target, relative_path, encoded, kind, manifest or {})

    def register_existing(
        self,
        relative_path: str,
        *,
        kind: str,
        manifest: dict[str, Any] | None = None,
    ) -> ArtifactRecord:
        target = self._resolve_relative(relative_path)
        if not target.is_file():
            raise ValueError(f'Declared artifact "{relative_path}" does not exist.')
        content = target.read_bytes()
        return self._register(target, relative_path, content, kind, manifest or {})

    def read_text(self, artifact_id: str) -> str:
        record = self.get(artifact_id)
        if record is None:
            raise ValueError(f'Artifact "{artifact_id}" is unknown.')
        target = self._resolve_relative(record.relative_path)
        content = target.read_bytes()
        actual = hashlib.sha256(content).hexdigest()
        if actual != record.sha256:
            raise ValueError(
                f'Artifact "{artifact_id}" content hash no longer matches its manifest.'
            )
        return content.decode("utf-8")

    def get(self, artifact_id: str) -> ArtifactRecord | None:
        path = self._manifest_root / f"{artifact_id}.json"
        if not path.is_file():
            return None
        return ArtifactRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def diff(self, base_artifact_id: str, draft_artifact_id: str) -> dict[str, Any]:
        import difflib

        base = self.read_text(base_artifact_id).splitlines(keepends=True)
        draft = self.read_text(draft_artifact_id).splitlines(keepends=True)
        return {
            "base_artifact_id": base_artifact_id,
            "draft_artifact_id": draft_artifact_id,
            "unified_diff": "".join(
                difflib.unified_diff(
                    base, draft, fromfile=base_artifact_id, tofile=draft_artifact_id
                )
            ),
        }

    def _register(
        self,
        target: Path,
        relative_path: str,
        content: bytes,
        kind: str,
        manifest: dict[str, Any],
    ) -> ArtifactRecord:
        digest = hashlib.sha256(content).hexdigest()
        record = ArtifactRecord(
            artifact_id=f"sha256:{digest}",
            relative_path=relative_path,
            sha256=digest,
            size_bytes=len(content),
            kind=kind,
            manifest=manifest,
        )
        self._atomic_write_bytes(
            self._manifest_root / f"{record.artifact_id}.json",
            record.model_dump_json(indent=2).encode("utf-8"),
        )
        return record

    def _resolve_relative(self, relative_path: str) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute() or not relative_path.strip():
            raise ValueError("Artifact paths must be non-empty and relative to the run root.")
        target = (self._root / candidate).resolve()
        try:
            target.relative_to(self._root)
        except ValueError as error:
            raise ValueError("Artifact path escapes the configured run root.") from error
        return target

    @staticmethod
    def _atomic_write_bytes(target: Path, content: bytes) -> None:
        temporary = target.with_name(f".{target.name}.tmp")
        temporary.write_bytes(content)
        os.replace(temporary, target)
