"""Durable, privacy-conscious telemetry ledger for agent-harness evidence.

The store deliberately records structured outcomes, timings, authority, evidence links,
and hashes. It rejects hidden-reasoning fields and keeps raw logs as external artifacts.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from time import monotonic_ns
from typing import Any

from pydantic import Field, field_validator

from .contracts import StrictModel


class TelemetryAuthority(StrEnum):
    DETERMINISTIC = "deterministic"
    MODEL_MEDIATED = "model-mediated"
    HUMAN = "human"
    TOOL = "tool"
    SYSTEM = "system"


class TelemetrySeverity(StrEnum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class MetricAvailability(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


class TelemetryActor(StrictModel):
    kind: str = Field(min_length=1)
    identifier: str = Field(min_length=1)
    role: str | None = None


class TelemetryContext(StrictModel):
    project_id: str | None = None
    experiment_id: str | None = None
    cohort_id: str | None = None
    run_id: str = Field(min_length=1)
    attempt_id: str | None = None
    controller_id: str | None = None
    node_id: str | None = None
    task_id: str | None = None
    agent_id: str | None = None
    trace_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None
    stage: str | None = None
    environment_id: str | None = None


class TelemetryEvent(StrictModel):
    schema_version: str = "telemetry-event-v1"
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sequence: int = Field(default=0, ge=0)
    event_type: str = Field(min_length=1)
    occurred_at_utc: str
    occurred_at_monotonic_ns: int = Field(ge=0)
    context: TelemetryContext
    actor: TelemetryActor
    authority: TelemetryAuthority
    status: str = Field(min_length=1)
    severity: TelemetrySeverity = TelemetrySeverity.INFO
    links: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)
    previous_event_hash: str | None = None
    integrity_hash: str = ""

    @field_validator("payload", "links")
    @classmethod
    def reject_hidden_reasoning(cls, value: dict[str, Any]) -> dict[str, Any]:
        _assert_no_hidden_reasoning(value)
        return value


class MetricDefinition(StrictModel):
    metric_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    direction: str = Field(min_length=1)
    formula: str = Field(min_length=1)
    numerator: str | None = None
    denominator: str | None = None
    aggregation: str = Field(min_length=1)
    missing_data_rule: str = Field(min_length=1)
    source_description: str = Field(min_length=1)
    schema_version: str = "metric-definition-v1"


class MetricObservation(StrictModel):
    observation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metric_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    value: float | None = None
    unit: str = Field(min_length=1)
    availability: MetricAvailability
    unavailable_reason: str | None = None
    source_event_id: str | None = None
    source_artifact_id: str | None = None
    parser_version: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    observed_at_utc: str


class TelemetryRunSummary(StrictModel):
    run_id: str
    event_count: int = Field(ge=0)
    started_at: str | None = None
    last_event_at: str | None = None
    statuses: dict[str, int] = Field(default_factory=dict)
    event_types: dict[str, int] = Field(default_factory=dict)


class TelemetryStore:
    """Append-only SQLite ledger with an integrity hash chain and metric observations."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve() / ".agent-telemetry"
        self._root.mkdir(parents=True, exist_ok=True)
        self._database_path = self._root / "telemetry.sqlite3"
        self._lock = threading.RLock()
        # One connection for the store's lifetime: opening a fresh sqlite3
        # connection (plus its two setup PRAGMAs) on every single call was
        # measured as the dominant cost of a realistic run -- 138s of 279s in a
        # 15-run profile came from sqlite3.Connection.execute alone, almost
        # entirely reconnection overhead, not query cost. check_same_thread=False
        # is safe here because every access below is already serialized through
        # self._lock, not because concurrent use is otherwise fine.
        self._connection = sqlite3.connect(
            self._database_path, timeout=10, isolation_level=None, check_same_thread=False
        )
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._initialize()

    def close(self) -> None:
        """Close the persistent connection. Safe to call multiple times.

        Not required for correctness during normal operation, but Windows
        refuses to delete or rename a file, or its containing directory, while
        a handle to it is open -- unlike POSIX. Confirmed in practice: a
        multi-run benchmark's `shutil.rmtree(..., ignore_errors=True)` silently
        left several runs' telemetry.sqlite3 behind because their store's
        connection was still open at cleanup time. Callers that need to remove
        a run root deterministically (test teardown, a benchmark script)
        should call this first.
        """

        with self._lock:
            self._connection.close()

    @property
    def root(self) -> Path:
        return self._root

    @property
    def database_path(self) -> Path:
        return self._database_path

    def emit(
        self,
        event_type: str,
        context: TelemetryContext,
        *,
        actor: TelemetryActor,
        authority: TelemetryAuthority,
        status: str,
        severity: TelemetrySeverity = TelemetrySeverity.INFO,
        links: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> TelemetryEvent:
        event = TelemetryEvent(
            event_type=event_type,
            occurred_at_utc=datetime.now(UTC).isoformat(),
            occurred_at_monotonic_ns=monotonic_ns(),
            context=context,
            actor=actor,
            authority=authority,
            status=status,
            severity=severity,
            links=links or {},
            payload=payload or {},
        )
        return self.append(event)

    def append(self, event: TelemetryEvent) -> TelemetryEvent:
        """Append one event atomically after assigning its sequence and hash-chain predecessor."""

        with self._lock, self._connection as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                "SELECT sequence, integrity_hash FROM events "
                "WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
                (event.context.run_id,),
            ).fetchone()
            sequence = (int(previous[0]) + 1) if previous else 1
            predecessor = str(previous[1]) if previous else None
            prepared = event.model_copy(
                update={
                    "sequence": sequence,
                    "previous_event_hash": predecessor,
                    "integrity_hash": "",
                }
            )
            digest = _canonical_hash(prepared.model_dump(mode="json"))
            prepared = prepared.model_copy(update={"integrity_hash": digest})
            connection.execute(
                """
                INSERT INTO events (
                    event_id, run_id, sequence, occurred_at_utc, event_type, status, severity,
                    integrity_hash, previous_event_hash, payload_json, event_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    prepared.event_id,
                    prepared.context.run_id,
                    prepared.sequence,
                    prepared.occurred_at_utc,
                    prepared.event_type,
                    prepared.status,
                    prepared.severity.value,
                    prepared.integrity_hash,
                    prepared.previous_event_hash,
                    _canonical_json(prepared.payload),
                    prepared.model_dump_json(),
                ),
            )
            connection.commit()
            return prepared

    def record_metric(self, observation: MetricObservation) -> MetricObservation:
        if observation.availability is MetricAvailability.AVAILABLE and observation.value is None:
            raise ValueError("Available metric observations require a numeric value.")
        if (
            observation.availability is MetricAvailability.UNAVAILABLE
            and not observation.unavailable_reason
        ):
            raise ValueError("Unavailable metric observations require an unavailable_reason.")
        with self._lock, self._connection as connection:
            connection.execute(
                """
                INSERT INTO metric_observations (
                    observation_id, metric_id, run_id, value, unit, availability,
                    unavailable_reason, source_event_id, source_artifact_id, parser_version,
                    context_json, observed_at_utc, observation_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    observation.observation_id,
                    observation.metric_id,
                    observation.run_id,
                    observation.value,
                    observation.unit,
                    observation.availability.value,
                    observation.unavailable_reason,
                    observation.source_event_id,
                    observation.source_artifact_id,
                    observation.parser_version,
                    _canonical_json(observation.context),
                    observation.observed_at_utc,
                    observation.model_dump_json(),
                ),
            )
            connection.commit()
        return observation

    def register_metric_definition(self, definition: MetricDefinition) -> MetricDefinition:
        with self._lock, self._connection as connection:
            connection.execute(
                """
                INSERT INTO metric_definitions (metric_id, definition_json)
                VALUES (?, ?)
                ON CONFLICT(metric_id) DO UPDATE SET definition_json = excluded.definition_json
                """,
                (definition.metric_id, definition.model_dump_json()),
            )
            connection.commit()
        return definition

    def list_metric_definitions(self) -> list[MetricDefinition]:
        with self._lock, self._connection as connection:
            rows = connection.execute(
                "SELECT definition_json FROM metric_definitions ORDER BY metric_id ASC"
            ).fetchall()
        return [MetricDefinition.model_validate_json(str(row[0])) for row in rows]

    def list_events(
        self,
        run_id: str,
        *,
        limit: int = 250,
        after_sequence: int = 0,
        through_sequence: int | None = None,
    ) -> list[TelemetryEvent]:
        if limit < 1 or limit > 1_000:
            raise ValueError("Telemetry event page size must be between 1 and 1000.")
        if through_sequence is not None and through_sequence < after_sequence:
            return []
        with self._lock, self._connection as connection:
            rows = connection.execute(
                """
                SELECT event_json FROM events
                WHERE run_id = ? AND sequence > ? AND (? IS NULL OR sequence <= ?)
                ORDER BY sequence ASC LIMIT ?
                """,
                (run_id, after_sequence, through_sequence, through_sequence, limit),
            ).fetchall()
        return [TelemetryEvent.model_validate_json(str(row[0])) for row in rows]

    def run_snapshot_sequence(self, run_id: str) -> int:
        """Return the highest persisted sequence for an explicit verification boundary."""

        with self._lock, self._connection as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) FROM events WHERE run_id = ?", (run_id,)
            ).fetchone()
        return int(row[0])

    def iter_events(
        self,
        run_id: str,
        *,
        page_size: int = 1_000,
        through_sequence: int | None = None,
    ) -> Iterator[TelemetryEvent]:
        """Stream a complete ordered run sequence through one fixed sequence boundary."""

        boundary = (
            self.run_snapshot_sequence(run_id) if through_sequence is None else through_sequence
        )
        after_sequence = 0
        while page := self.list_events(
            run_id,
            limit=page_size,
            after_sequence=after_sequence,
            through_sequence=boundary,
        ):
            yield from page
            after_sequence = page[-1].sequence

    def list_metrics(self, run_id: str) -> list[MetricObservation]:
        with self._lock, self._connection as connection:
            rows = connection.execute(
                "SELECT observation_json FROM metric_observations "
                "WHERE run_id = ? ORDER BY observed_at_utc ASC",
                (run_id,),
            ).fetchall()
        return [MetricObservation.model_validate_json(str(row[0])) for row in rows]

    def list_runs(self, *, limit: int = 100) -> list[TelemetryRunSummary]:
        if limit < 1 or limit > 1_000:
            raise ValueError("Telemetry run page size must be between 1 and 1000.")
        with self._lock, self._connection as connection:
            rows = connection.execute(
                """
                SELECT run_id, COUNT(*), MIN(occurred_at_utc), MAX(occurred_at_utc)
                FROM events GROUP BY run_id ORDER BY MAX(occurred_at_utc) DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
            summaries: list[TelemetryRunSummary] = []
            for run_id, count, started, last in rows:
                status_rows = connection.execute(
                    "SELECT status, COUNT(*) FROM events WHERE run_id = ? GROUP BY status",
                    (run_id,),
                ).fetchall()
                type_rows = connection.execute(
                    "SELECT event_type, COUNT(*) FROM events WHERE run_id = ? GROUP BY event_type",
                    (run_id,),
                ).fetchall()
                summaries.append(
                    TelemetryRunSummary(
                        run_id=str(run_id),
                        event_count=int(count),
                        started_at=str(started),
                        last_event_at=str(last),
                        statuses={str(key): int(value) for key, value in status_rows},
                        event_types={str(key): int(value) for key, value in type_rows},
                    )
                )
        return summaries

    def verify_run_chain(self, run_id: str) -> bool:
        boundary = self.run_snapshot_sequence(run_id)
        return self._verify_events(self.iter_events(run_id, through_sequence=boundary))

    @staticmethod
    def _verify_events(events: Iterable[TelemetryEvent]) -> bool:
        previous: str | None = None
        for event in events:
            expected = _canonical_hash(
                event.model_copy(update={"integrity_hash": ""}).model_dump(mode="json")
            )
            if event.previous_event_hash != previous or event.integrity_hash != expected:
                return False
            previous = event.integrity_hash
        return True

    def create_run_report(self, run_id: str) -> dict[str, Any]:
        boundary = self.run_snapshot_sequence(run_id)
        events = list(self.iter_events(run_id, through_sequence=boundary))
        metrics = self.list_metrics(run_id)
        if not events:
            raise ValueError(f'Telemetry run "{run_id}" is unknown.')
        report = {
            "schema_version": "run-report-v1",
            "run_id": run_id,
            "event_count": len(events),
            "verified_event_count": len(events),
            "verified_through_sequence": boundary,
            "integrity_chain_valid": self._verify_events(events),
            "statuses": _count(event.status for event in events),
            "event_types": _count(event.event_type for event in events),
            "watchdog_interventions": sum(
                event.event_type.startswith("watchdog.") for event in events
            ),
            "metrics": [metric.model_dump(mode="json") for metric in metrics],
            "metric_availability": _count(metric.availability.value for metric in metrics),
            "metric_summary": _summarize_metrics(metrics, self.list_metric_definitions()),
            "evidence_event_hashes": [event.integrity_hash for event in events],
        }
        reports = self._root / "reports"
        reports.mkdir(exist_ok=True)
        target = reports / f"{_safe_name(run_id)}.run-report.json"
        _atomic_write(target, json.dumps(report, indent=2, sort_keys=True).encode("utf-8"))
        return {**report, "report_path": str(target.relative_to(self._root))}

    def _initialize(self) -> None:
        with self._lock, self._connection as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    occurred_at_utc TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    integrity_hash TEXT NOT NULL,
                    previous_event_hash TEXT,
                    payload_json TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    UNIQUE(run_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS events_run_sequence ON events(run_id, sequence);
                CREATE INDEX IF NOT EXISTS events_type ON events(event_type);
                CREATE TABLE IF NOT EXISTS metric_observations (
                    observation_id TEXT PRIMARY KEY,
                    metric_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    value REAL,
                    unit TEXT NOT NULL,
                    availability TEXT NOT NULL,
                    unavailable_reason TEXT,
                    source_event_id TEXT,
                    source_artifact_id TEXT,
                    parser_version TEXT,
                    context_json TEXT NOT NULL,
                    observed_at_utc TEXT NOT NULL,
                    observation_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS metrics_run
                    ON metric_observations(run_id, observed_at_utc);
                CREATE TABLE IF NOT EXISTS metric_definitions (
                    metric_id TEXT PRIMARY KEY,
                    definition_json TEXT NOT NULL
                );
                """
            )


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def metric_observation(
    metric_id: str,
    run_id: str,
    *,
    unit: str,
    value: float | None,
    unavailable_reason: str | None = None,
    source_event_id: str | None = None,
    source_artifact_id: str | None = None,
    parser_version: str | None = None,
    context: dict[str, Any] | None = None,
) -> MetricObservation:
    availability = (
        MetricAvailability.AVAILABLE if value is not None else MetricAvailability.UNAVAILABLE
    )
    return MetricObservation(
        metric_id=metric_id,
        run_id=run_id,
        value=value,
        unit=unit,
        availability=availability,
        unavailable_reason=unavailable_reason,
        source_event_id=source_event_id,
        source_artifact_id=source_artifact_id,
        parser_version=parser_version,
        context=context or {},
        observed_at_utc=utc_now(),
    )


def _assert_no_hidden_reasoning(value: Any) -> None:
    forbidden = {"chain_of_thought", "hidden_reasoning", "reasoning_trace", "scratchpad"}
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in forbidden:
                raise ValueError("Telemetry must not persist hidden model reasoning.")
            _assert_no_hidden_reasoning(item)
    elif isinstance(value, list):
        for item in value:
            _assert_no_hidden_reasoning(item)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _count(values: Iterable[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[value] = result.get(value, 0) + 1
    return result


def _summarize_metrics(
    observations: Iterable[MetricObservation], definitions: Iterable[MetricDefinition]
) -> dict[str, dict[str, Any]]:
    """Aggregate values by their registered formula without turning missing values into zero."""

    by_definition = {definition.metric_id: definition for definition in definitions}
    grouped: dict[str, list[MetricObservation]] = {}
    for observation in observations:
        grouped.setdefault(observation.metric_id, []).append(observation)
    summary: dict[str, dict[str, Any]] = {}
    for metric_id, items in sorted(grouped.items()):
        available = [
            item.value for item in items if item.availability is MetricAvailability.AVAILABLE
        ]
        values = [value for value in available if value is not None]
        definition = by_definition.get(metric_id)
        aggregation = definition.aggregation if definition is not None else "unregistered"
        aggregate: float | None
        if not values:
            aggregate = None
        elif aggregation == "sum":
            aggregate = sum(values)
        elif aggregation == "mean":
            aggregate = sum(values) / len(values)
        elif aggregation == "min":
            aggregate = min(values)
        elif aggregation == "max":
            aggregate = max(values)
        elif aggregation == "last":
            aggregate = values[-1]
        else:
            aggregate = None
        summary[metric_id] = {
            "aggregation": aggregation,
            "value": aggregate,
            "available_observation_count": len(values),
            "unavailable_observation_count": len(items) - len(values),
            "unit": items[-1].unit,
            "missing_data_rule": definition.missing_data_rule
            if definition
            else "No definition registered.",
        }
    return summary


def _safe_name(value: str) -> str:
    return "".join(
        character if character.isalnum() or character in "-_." else "_" for character in value
    )


def _atomic_write(target: Path, content: bytes) -> None:
    temporary = target.with_name(f".{target.name}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, target)
