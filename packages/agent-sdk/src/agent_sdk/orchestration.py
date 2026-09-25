"""Deterministic upward/downward controller for approved agent graph runs."""

from __future__ import annotations

import hashlib
import os
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import Field

from .atomic_io import replace_atomic
from .contracts import StrictModel
from .planning import Plan, PlanValidationReport, PlanValidator
from .shared_state import SharedSubstrateSnapshot


class ControllerPhase(StrEnum):
    INTAKE = "intake"
    PLANNING = "planning"
    AWAITING_PLAN_APPROVAL = "awaiting-plan-approval"
    DISPATCH_READY = "dispatch-ready"
    EXECUTING = "executing"
    REPAIR_REQUIRED = "repair-required"
    ESCALATED = "escalated"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class WorkflowArchitecture(StrEnum):
    SINGLE_AGENT = "single-agent"
    MULTI_AGENT = "multi-agent"


class GapMetadata(StrictModel):
    categories_touched: list[str] = Field(default_factory=list)
    blast_radius: int = Field(default=0, ge=0)
    gap_types: list[str] = Field(default_factory=list)


class ComplexityRoutingRules(StrictModel):
    multi_agent_min_categories: int = Field(ge=1)
    multi_agent_min_blast_radius: int = Field(ge=1)
    multi_agent_gap_types: list[str] = Field(default_factory=list)


class SkillToolProfile(StrictModel):
    stage: str = Field(min_length=1)
    skill_ids: list[str] = Field(default_factory=list)
    capability_ids: list[str] = Field(default_factory=list)
    source_snapshot_id: str = Field(min_length=1)
    source_read_only: bool = True


class ControllerEvent(StrictModel):
    sequence: int = Field(ge=1)
    phase: ControllerPhase
    type: str = Field(min_length=1)
    details: dict[str, Any] = Field(default_factory=dict)


class ControllerRecord(StrictModel):
    controller_id: str = Field(min_length=1)
    project_state_id: str = Field(min_length=1)
    phase: ControllerPhase
    architecture: WorkflowArchitecture
    profile: SkillToolProfile
    snapshot: SharedSubstrateSnapshot
    repair_attempts: int = Field(default=0, ge=0)
    max_repair_attempts: int = Field(ge=0)
    plan: Plan | None = None
    plan_validation: PlanValidationReport | None = None
    plan_approved: bool | None = None
    run_id: str | None = None
    escalation_reason: str | None = None
    events: list[ControllerEvent] = Field(default_factory=list)
    events_entry_count: int = Field(default=0, ge=0)
    events_integrity_hash: str | None = None


class ComplexityRouter:
    """Route through configured deterministic thresholds, never an LLM guess."""

    def __init__(self, rules: ComplexityRoutingRules) -> None:
        self._rules = rules

    def route(self, metadata: GapMetadata) -> WorkflowArchitecture:
        if len(set(metadata.categories_touched)) >= self._rules.multi_agent_min_categories:
            return WorkflowArchitecture.MULTI_AGENT
        if metadata.blast_radius >= self._rules.multi_agent_min_blast_radius:
            return WorkflowArchitecture.MULTI_AGENT
        if set(metadata.gap_types) & set(self._rules.multi_agent_gap_types):
            return WorkflowArchitecture.MULTI_AGENT
        return WorkflowArchitecture.SINGLE_AGENT


class ControllerStateMachine:
    """Own plan review, dispatch readiness, bounded repair, and user escalation."""

    def __init__(
        self,
        controller_id: str,
        snapshot: SharedSubstrateSnapshot,
        profile: SkillToolProfile,
        routing_rules: ComplexityRoutingRules,
        gap_metadata: GapMetadata,
        *,
        project_state_id: str,
        max_repair_attempts: int,
    ) -> None:
        if profile.source_snapshot_id != snapshot.snapshot_id or not profile.source_read_only:
            raise ValueError("Controller profile must bind the immutable source snapshot.")
        self._validator = PlanValidator()
        self.record = ControllerRecord(
            controller_id=controller_id,
            project_state_id=project_state_id,
            phase=ControllerPhase.PLANNING,
            architecture=ComplexityRouter(routing_rules).route(gap_metadata),
            profile=profile,
            snapshot=snapshot,
            max_repair_attempts=max_repair_attempts,
        )
        self._emit("controller-started", {"gap_metadata": gap_metadata.model_dump(mode="json")})

    @classmethod
    def from_record(cls, record: ControllerRecord) -> ControllerStateMachine:
        instance = cls.__new__(cls)
        instance._validator = PlanValidator()
        instance.record = record
        return instance

    def submit_plan(self, plan: Plan) -> ControllerRecord:
        self._require(ControllerPhase.PLANNING, ControllerPhase.REPAIR_REQUIRED)
        validation = self._validator.validate(plan)
        self.record = self.record.model_copy(
            update={
                "plan": plan,
                "plan_validation": validation,
                "plan_approved": None,
                "phase": ControllerPhase.AWAITING_PLAN_APPROVAL,
            }
        )
        self._emit("plan-presented", {"valid": validation.valid, "plan_id": plan.plan_id})
        return self.record

    def apply_advisory_architecture(
        self,
        architecture: WorkflowArchitecture,
        *,
        reason: str,
    ) -> ControllerRecord:
        """Record only a monotonic single-to-multi advisory routing lift.

        Deterministic complexity routing is the default.  An external advisory
        cannot lower a deterministic multi-agent requirement or mutate routing
        after plan review begins; it can only make a conservative planning-phase
        single-to-multi escalation explicit and auditable.
        """

        self._require(ControllerPhase.PLANNING)
        current = self.record.architecture
        if architecture is current:
            return self.record
        if (
            current is WorkflowArchitecture.SINGLE_AGENT
            and architecture is WorkflowArchitecture.MULTI_AGENT
        ):
            self.record = self.record.model_copy(update={"architecture": architecture})
            self._emit("architecture-advisory-lift", {"reason": reason})
            return self.record
        raise ValueError("Architecture selection may not lower a deterministic route.")

    def approve_plan(self, approved: bool, reason: str | None = None) -> ControllerRecord:
        self._require(ControllerPhase.AWAITING_PLAN_APPROVAL)
        if self.record.plan_validation is None or not self.record.plan_validation.valid:
            raise ValueError("Only a deterministically valid plan can be approved for dispatch.")
        phase = ControllerPhase.DISPATCH_READY if approved else ControllerPhase.PLANNING
        self.record = self.record.model_copy(update={"plan_approved": approved, "phase": phase})
        self._emit("plan-approval-recorded", {"approved": approved, "reason": reason})
        return self.record

    def begin_dispatch(self) -> ControllerRecord:
        self._require(ControllerPhase.DISPATCH_READY)
        self.record = self.record.model_copy(update={"phase": ControllerPhase.EXECUTING})
        self._emit("dispatch-started", {"architecture": self.record.architecture.value})
        return self.record

    def bind_run(self, run_id: str) -> ControllerRecord:
        self._require(ControllerPhase.EXECUTING)
        previous_run_id = self.record.run_id
        self.record = self.record.model_copy(update={"run_id": run_id})
        self._emit(
            "graph-run-bound" if previous_run_id is None else "graph-run-rebound",
            {"run_id": run_id, "previous_run_id": previous_run_id},
        )
        return self.record

    def record_stage_failure(self, reason: str) -> ControllerRecord:
        self._require(ControllerPhase.EXECUTING)
        next_attempt = self.record.repair_attempts + 1
        if next_attempt > self.record.max_repair_attempts:
            self.record = self.record.model_copy(
                update={"phase": ControllerPhase.ESCALATED, "escalation_reason": reason}
            )
            self._emit("user-escalation-required", {"reason": reason})
            return self.record
        self.record = self.record.model_copy(
            update={"phase": ControllerPhase.REPAIR_REQUIRED, "repair_attempts": next_attempt}
        )
        self._emit("bounded-repair-requested", {"reason": reason, "attempt": next_attempt})
        return self.record

    def complete(self) -> ControllerRecord:
        self._require(ControllerPhase.EXECUTING)
        self.record = self.record.model_copy(update={"phase": ControllerPhase.COMPLETED})
        self._emit("controller-completed", {})
        return self.record

    def cancel(self, reason: str) -> ControllerRecord:
        if self.record.phase in {ControllerPhase.COMPLETED, ControllerPhase.CANCELLED}:
            raise ValueError("Terminal controller runs cannot be cancelled again.")
        self.record = self.record.model_copy(update={"phase": ControllerPhase.CANCELLED})
        self._emit("controller-cancelled", {"reason": reason})
        return self.record

    def _require(self, *allowed: ControllerPhase) -> None:
        if self.record.phase not in allowed:
            labels = ", ".join(item.value for item in allowed)
            raise ValueError(
                f'Controller command is invalid in phase "{self.record.phase.value}"; '
                f"expected {labels}."
            )

    def _emit(self, type_: str, details: dict[str, Any]) -> None:
        event = ControllerEvent(
            sequence=len(self.record.events) + 1,
            phase=self.record.phase,
            type=type_,
            details=details,
        )
        self.record = self.record.model_copy(update={"events": [*self.record.events, event]})


def _replace_with_retry(temporary: Path, target: Path, *, attempts: int = 5) -> None:
    """Retry atomic replacement after transient destination-handle failures."""

    replace_atomic(temporary, target, attempts=attempts)


class ControllerStateStore:
    """Persist controller metadata with a snapshot-bound append-only event log.

    Snapshots with an event hash name the durable event prefix they own. A failed
    replacement therefore leaves a recoverable prior generation, not a record
    combined with an uncommitted suffix. Older one-file records remain readable.
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve() / ".agent-controllers"
        self._root.mkdir(parents=True, exist_ok=True)
        self._persisted_event_counts: dict[str, int] = {}

    def save(self, record: ControllerRecord) -> None:
        persisted = self._persisted_event_counts.get(record.controller_id)
        if persisted is None:
            persisted = self._committed_event_count(record.controller_id)
        event_path = self._events_path(record.controller_id)
        self._discard_uncommitted_events(record.controller_id, persisted)
        if len(record.events) < persisted:
            # A reused controller ID has a shorter in-memory event history, so
            # replace the sidecar before publishing the new snapshot boundary.
            self._write_events(record.controller_id, record.events)
        elif len(record.events) > persisted:
            self._append_events(record.controller_id, record.events[persisted:])
        event_count, event_hash = _event_boundary(event_path)
        if event_count != len(record.events):
            raise ValueError("Controller event boundary does not match the record event count.")
        target = self._root / f"{record.controller_id}.json"
        temporary = target.with_name(f".{target.name}.tmp")
        snapshot = record.model_copy(
            update={
                "events": [],
                "events_entry_count": event_count,
                "events_integrity_hash": event_hash,
            }
        )
        _write_json_candidate(temporary, snapshot.model_dump_json(indent=2))
        _replace_with_retry(temporary, target)
        self._persisted_event_counts[record.controller_id] = len(record.events)

    def load(self, controller_id: str) -> ControllerRecord:
        target = self._root / f"{controller_id}.json"
        if not target.is_file():
            raise ValueError(f'Controller "{controller_id}" is unknown.')
        snapshot = ControllerRecord.model_validate_json(target.read_text(encoding="utf-8"))
        if snapshot.events_integrity_hash is None:
            self._persisted_event_counts[controller_id] = 0
            return snapshot
        events, event_hash = self._read_events(
            controller_id, entry_limit=snapshot.events_entry_count
        )
        if (
            len(events) != snapshot.events_entry_count
            or event_hash != snapshot.events_integrity_hash
        ):
            raise ValueError(
                f'Controller "{controller_id}" event history failed integrity verification.'
            )
        _validate_event_sequence(events)
        record = snapshot.model_copy(update={"events": events})
        self._persisted_event_counts[controller_id] = len(events)
        return record

    def _events_path(self, controller_id: str) -> Path:
        return self._root / f"{controller_id}.events.jsonl"

    def _append_events(self, controller_id: str, events: list[ControllerEvent]) -> None:
        path = self._events_path(controller_id)
        with path.open("a", encoding="utf-8") as handle:
            for event in events:
                handle.write(event.model_dump_json())
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())

    def _write_events(self, controller_id: str, events: list[ControllerEvent]) -> None:
        path = self._events_path(controller_id)
        temporary = path.with_name(f".{path.name}.tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            for event in events:
                handle.write(event.model_dump_json())
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(temporary, path)

    def _read_events(
        self, controller_id: str, *, entry_limit: int | None = None
    ) -> tuple[list[ControllerEvent], str]:
        path = self._events_path(controller_id)
        if not path.is_file():
            return [], _event_hash([])
        with path.open(encoding="utf-8") as handle:
            events: list[ControllerEvent] = []
            for line in handle:
                if not line.strip():
                    continue
                if entry_limit is not None and len(events) >= entry_limit:
                    break
                events.append(ControllerEvent.model_validate_json(line))
        return events, _event_hash(events)

    def _committed_event_count(self, controller_id: str) -> int:
        target = self._root / f"{controller_id}.json"
        if not target.is_file():
            return 0
        snapshot = ControllerRecord.model_validate_json(target.read_text(encoding="utf-8"))
        if snapshot.events_integrity_hash is None:
            return 0
        events, event_hash = self._read_events(
            controller_id, entry_limit=snapshot.events_entry_count
        )
        if (
            len(events) != snapshot.events_entry_count
            or event_hash != snapshot.events_integrity_hash
        ):
            raise ValueError(
                f'Controller "{controller_id}" event history failed integrity verification.'
            )
        return len(events)

    def _discard_uncommitted_events(self, controller_id: str, committed_count: int) -> None:
        path = self._events_path(controller_id)
        if _nonempty_event_line_count(path) <= committed_count:
            return
        events, _event_hash_value = self._read_events_from_path(path, entry_limit=committed_count)
        self._write_events(controller_id, events)

    @staticmethod
    def _read_events_from_path(
        path: Path, *, entry_limit: int | None = None
    ) -> tuple[list[ControllerEvent], str]:
        if not path.is_file():
            return [], _event_hash([])
        with path.open(encoding="utf-8") as handle:
            events: list[ControllerEvent] = []
            for line in handle:
                if not line.strip():
                    continue
                if entry_limit is not None and len(events) >= entry_limit:
                    break
                events.append(ControllerEvent.model_validate_json(line))
        return events, _event_hash(events)


def _event_boundary(path: Path) -> tuple[int, str]:
    if not path.is_file():
        return 0, _event_hash([])
    with path.open(encoding="utf-8") as handle:
        events = [ControllerEvent.model_validate_json(line) for line in handle if line.strip()]
    return len(events), _event_hash(events)


def _nonempty_event_line_count(path: Path) -> int:
    if not path.is_file():
        return 0
    with path.open(encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


def _event_hash(events: list[ControllerEvent]) -> str:
    digest = hashlib.sha256()
    for event in events:
        digest.update(event.model_dump_json().encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _validate_event_sequence(events: list[ControllerEvent]) -> None:
    expected = list(range(1, len(events) + 1))
    actual = [event.sequence for event in events]
    if actual != expected:
        raise ValueError("Controller event history has non-contiguous sequence numbers.")


def _write_json_candidate(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
