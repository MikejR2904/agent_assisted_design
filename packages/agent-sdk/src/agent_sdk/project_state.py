"""State-based working memory with harness-owned, provenance-linked transitions.

`ProjectState` is the normal working memory for an agent invocation. Episode
records, raw tool output, and state-change events remain durable audit evidence;
they are not replayed as the agent's ordinary reasoning context.
"""

from __future__ import annotations

import hashlib
import json
import os
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from pydantic import Field, field_validator, model_validator

from .contracts import StrictModel, ToolCall, ToolExecutionResult, ToolResultHandle


class StateAuthority(StrEnum):
    HARNESS = "harness"
    CONTROLLER = "controller"
    HUMAN = "human"


class DecisionStatus(StrEnum):
    OPEN = "open"
    LOCKED = "locked"
    SUPERSEDED = "superseded"


class WorkItemStatus(StrEnum):
    NOT_STARTED = "not-started"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ArtifactStatus(StrEnum):
    NOT_STARTED = "not-started"
    IN_PROGRESS = "in-progress"
    COMPLETE = "complete"
    INVALID = "invalid"
    BLOCKED = "blocked"


class QuestionOwner(StrEnum):
    HUMAN = "human"
    CONTROLLER = "controller"


class StateEvidence(StrictModel):
    """Small provenance reference; never raw terminal output or a transcript."""

    evidence_id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    content_hash: str | None = None
    source_spans: list[str] = Field(default_factory=list)


class StageStateSchema(StrictModel):
    """Declared stage schema; no model may invent a stage-state field."""

    schema_id: str = Field(min_length=1)
    stage: str = Field(min_length=1)
    required_field_ids: list[str] = Field(default_factory=list, max_length=128)

    @field_validator("required_field_ids")
    @classmethod
    def field_ids_are_unique(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("required stage field IDs must be unique")
        return values


class StageStateField(StrictModel):
    field_id: str = Field(min_length=1)
    value: Any
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class ProjectDecision(StrictModel):
    decision_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=4_096)
    status: DecisionStatus
    authority: StateAuthority
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class OpenQuestion(StrictModel):
    question_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=4_096)
    owner: QuestionOwner
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class ProjectBlocker(StrictModel):
    blocker_id: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=4_096)
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class ProjectArtifactState(StrictModel):
    relative_path: str = Field(min_length=1)
    status: ArtifactStatus
    artifact_id: str | None = None
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class ProjectWorkItem(StrictModel):
    work_item_id: str = Field(min_length=1)
    status: WorkItemStatus
    owner: str = Field(min_length=1)
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class StateAction(StrictModel):
    action_id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    status: str = Field(min_length=1)
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)
    summary: dict[str, Any] = Field(default_factory=dict)

    @field_validator("summary")
    @classmethod
    def summary_is_bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(_canonical_json(value)) > 4_096:
            raise ValueError("state action summary exceeds the 4,096-character bound")
        return value


class ProjectState(StrictModel):
    """The bounded, current-state object used as normal agent working memory."""

    schema_version: str = "project-state-v1"
    project_id: str = Field(min_length=1)
    revision: int = Field(ge=0)
    stage_schema: StageStateSchema
    stage_fields: list[StageStateField] = Field(default_factory=list, max_length=128)
    artifacts: list[ProjectArtifactState] = Field(default_factory=list, max_length=1_024)
    decisions: list[ProjectDecision] = Field(default_factory=list, max_length=256)
    open_questions: list[OpenQuestion] = Field(default_factory=list, max_length=256)
    blocked: list[ProjectBlocker] = Field(default_factory=list, max_length=256)
    work_items: list[ProjectWorkItem] = Field(default_factory=list, max_length=1_024)
    last_action: StateAction | None = None
    step_count: int = Field(default=0, ge=0)
    state_hash: str = Field(min_length=1)

    @model_validator(mode="after")
    def state_is_well_formed(self) -> ProjectState:
        _ensure_unique(self.stage_fields, "field_id", "stage field IDs")
        _ensure_unique(self.artifacts, "relative_path", "artifact paths")
        _ensure_unique(self.decisions, "decision_id", "decision IDs")
        _ensure_unique(self.open_questions, "question_id", "question IDs")
        _ensure_unique(self.blocked, "blocker_id", "blocker IDs")
        _ensure_unique(self.work_items, "work_item_id", "work-item IDs")
        if self.stage_schema.stage != self.stage:
            raise ValueError("stage schema must describe the current project stage")
        field_ids = {field.field_id for field in self.stage_fields}
        missing = set(self.stage_schema.required_field_ids) - field_ids
        if missing:
            raise ValueError(f"project state is missing required stage fields: {sorted(missing)}")
        if self.state_hash != project_state_hash(self):
            raise ValueError("project state hash does not match canonical state fields")
        return self

    @property
    def stage(self) -> str:
        return self.stage_schema.stage

    def model_view(self) -> dict[str, Any]:
        """Return the bounded, current-state-only view intended for an agent model."""

        return self.model_dump(mode="json")


class ProjectStateProjectionPolicy(StrictModel):
    """Explicit bound for the project state supplied to one model turn."""

    token_budget: int = Field(default=2_000, ge=128, le=1_000_000)


class ProjectStateView(StrictModel):
    """Bounded current-state view, deliberately excluding event and transcript history."""

    project_id: str = Field(min_length=1)
    revision: int = Field(ge=0)
    stage_schema: StageStateSchema
    stage_fields: list[StageStateField] = Field(default_factory=list)
    artifacts: list[ProjectArtifactState] = Field(default_factory=list)
    decisions: list[ProjectDecision] = Field(default_factory=list)
    open_questions: list[OpenQuestion] = Field(default_factory=list)
    blocked: list[ProjectBlocker] = Field(default_factory=list)
    work_items: list[ProjectWorkItem] = Field(default_factory=list)
    last_action: StateAction | None = None
    step_count: int = Field(ge=0)
    state_hash: str = Field(min_length=1)
    estimated_tokens: int = Field(ge=0)
    token_budget: int = Field(ge=128)
    omitted_artifact_count: int = Field(ge=0)
    omitted_work_item_count: int = Field(ge=0)
    over_budget: bool = False


class ProjectStateProjector:
    """Deterministically select current-state entries without transcript replay."""

    def __init__(self, policy: ProjectStateProjectionPolicy | None = None) -> None:
        self._policy = policy or ProjectStateProjectionPolicy()

    @property
    def policy(self) -> ProjectStateProjectionPolicy:
        return self._policy

    def project(self, state: ProjectState) -> ProjectStateView:
        core = {
            "project_id": state.project_id,
            "revision": state.revision,
            "stage_schema": state.stage_schema,
            "stage_fields": state.stage_fields,
            "decisions": state.decisions,
            "open_questions": state.open_questions,
            "blocked": state.blocked,
            "last_action": state.last_action,
            "step_count": state.step_count,
            "state_hash": state.state_hash,
        }
        used = _estimated_tokens(core)
        artifacts: list[ProjectArtifactState] = []
        work_items: list[ProjectWorkItem] = []
        if used <= self._policy.token_budget:
            for artifact in reversed(state.artifacts):
                cost = _estimated_tokens(artifact)
                if used + cost > self._policy.token_budget:
                    continue
                artifacts.append(artifact)
                used += cost
            for work_item in reversed(state.work_items):
                cost = _estimated_tokens(work_item)
                if used + cost > self._policy.token_budget:
                    continue
                work_items.append(work_item)
                used += cost
        artifacts.reverse()
        work_items.reverse()
        return ProjectStateView(
            **core,
            artifacts=artifacts,
            work_items=work_items,
            estimated_tokens=used,
            token_budget=self._policy.token_budget,
            omitted_artifact_count=len(state.artifacts) - len(artifacts),
            omitted_work_item_count=len(state.work_items) - len(work_items),
            over_budget=used > self._policy.token_budget,
        )


class StateTransitionKind(StrEnum):
    TOOL_OUTCOME = "tool-outcome"
    AGENT_RESULT = "agent-result"
    HUMAN_DECISION = "human-decision"
    QUESTION_OPENED = "question-opened"
    WORK_ITEM_UPDATED = "work-item-updated"
    STAGE_CHANGED = "stage-changed"


class StateTransition(StrictModel):
    """A typed state mutation request accepted only by the deterministic store."""

    kind: StateTransitionKind
    actor: StateAuthority
    action_id: str = Field(min_length=1)
    payload: dict[str, Any]
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)


class ProjectStateEvent(StrictModel):
    schema_version: str = "project-state-event-v1"
    project_id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    kind: StateTransitionKind
    actor: StateAuthority
    action_id: str = Field(min_length=1)
    evidence: list[StateEvidence] = Field(min_length=1, max_length=32)
    previous_state_hash: str = Field(min_length=1)
    state_hash: str = Field(min_length=1)
    event_hash: str = Field(min_length=1)

    @model_validator(mode="after")
    def event_hash_matches(self) -> ProjectStateEvent:
        expected = _event_hash(
            self.project_id,
            self.revision,
            self.kind,
            self.actor,
            self.action_id,
            self.evidence,
            self.previous_state_hash,
            self.state_hash,
        )
        if self.event_hash != expected:
            raise ValueError("project state event hash does not match canonical fields")
        return self


class ProjectStateRepository(Protocol):
    def ensure(self, project_id: str, stage_schema: StageStateSchema) -> ProjectState: ...

    def load(self, project_id: str) -> ProjectState: ...

    def apply(self, project_id: str, transition: StateTransition) -> ProjectState: ...


class ProjectStateReducer:
    """Mechanical reducer: tool outcomes and controller events, never model claims."""

    @staticmethod
    def tool_transition(
        call: ToolCall,
        result: ToolExecutionResult,
        handle: ToolResultHandle,
    ) -> StateTransition:
        artifact = _artifact_from_result(call, result)
        payload: dict[str, Any] = {
            "tool_call_id": call.id,
            "tool_name": call.name,
            "status": result.status,
            "error": _bounded_text(result.error, 1_024),
            "output_summary": _bounded_value(result.output, 256),
        }
        if artifact is not None:
            payload["artifact"] = artifact
        return StateTransition(
            kind=StateTransitionKind.TOOL_OUTCOME,
            actor=StateAuthority.HARNESS,
            action_id=call.id,
            payload=payload,
            evidence=[
                StateEvidence(
                    evidence_id=handle.handle_id,
                    kind="tool-result-handle",
                    content_hash=handle.content_hash,
                )
            ],
        )

    @staticmethod
    def agent_result_transition(
        task_id: str,
        status: str,
        result_hash: str,
    ) -> StateTransition:
        return StateTransition(
            kind=StateTransitionKind.AGENT_RESULT,
            actor=StateAuthority.HARNESS,
            action_id=f"agent-result:{task_id}",
            payload={"task_id": task_id, "status": status},
            evidence=[
                StateEvidence(
                    evidence_id=f"agent-result:{task_id}",
                    kind="agent-result",
                    content_hash=result_hash,
                )
            ],
        )

    @staticmethod
    def apply(current: ProjectState, transition: StateTransition) -> ProjectState:
        artifacts = list(current.artifacts)
        blocked = list(current.blocked)
        work_items = list(current.work_items)
        decisions = list(current.decisions)
        questions = list(current.open_questions)
        stage_schema = current.stage_schema
        stage_fields = list(current.stage_fields)
        payload = transition.payload
        action_status = str(payload.get("status", "recorded"))

        if transition.kind is StateTransitionKind.TOOL_OUTCOME:
            artifact = payload.get("artifact")
            if isinstance(artifact, dict):
                artifacts = _upsert(
                    artifacts,
                    "relative_path",
                    ProjectArtifactState.model_validate(
                        {
                            **artifact,
                            "evidence": transition.evidence,
                        }
                    ),
                )
            if action_status == "blocked":
                blocked = _upsert(
                    blocked,
                    "blocker_id",
                    ProjectBlocker(
                        blocker_id=f"tool:{transition.action_id}",
                        subject_id=str(payload.get("tool_name", transition.action_id)),
                        reason=str(payload.get("error") or "Tool reported a blocked requirement."),
                        evidence=transition.evidence,
                    ),
                )

        elif transition.kind is StateTransitionKind.AGENT_RESULT:
            status = str(payload["status"])
            work_items = _upsert(
                work_items,
                "work_item_id",
                ProjectWorkItem(
                    work_item_id=str(payload["task_id"]),
                    status=WorkItemStatus.COMPLETED
                    if status == "completed"
                    else WorkItemStatus.BLOCKED
                    if status == "blocked"
                    else WorkItemStatus.CANCELLED
                    if status == "cancelled"
                    else WorkItemStatus.FAILED,
                    owner="base-agent",
                    evidence=transition.evidence,
                ),
            )

        elif transition.kind is StateTransitionKind.HUMAN_DECISION:
            if transition.actor is not StateAuthority.HUMAN:
                raise ValueError("Only a human authority may record a human decision.")
            decisions = _upsert(
                decisions,
                "decision_id",
                ProjectDecision(
                    decision_id=str(payload["decision_id"]),
                    content=str(payload["content"]),
                    status=DecisionStatus(payload["status"]),
                    authority=StateAuthority.HUMAN,
                    evidence=transition.evidence,
                ),
            )

        elif transition.kind is StateTransitionKind.QUESTION_OPENED:
            questions = _upsert(
                questions,
                "question_id",
                OpenQuestion(
                    question_id=str(payload["question_id"]),
                    content=str(payload["content"]),
                    owner=QuestionOwner(payload["owner"]),
                    evidence=transition.evidence,
                ),
            )

        elif transition.kind is StateTransitionKind.WORK_ITEM_UPDATED:
            if transition.actor not in {StateAuthority.CONTROLLER, StateAuthority.HARNESS}:
                raise ValueError("Only controller or harness authority may update a work item.")
            work_items = _upsert(
                work_items,
                "work_item_id",
                ProjectWorkItem(
                    work_item_id=str(payload["work_item_id"]),
                    status=WorkItemStatus(payload["status"]),
                    owner=str(payload["owner"]),
                    evidence=transition.evidence,
                ),
            )

        elif transition.kind is StateTransitionKind.STAGE_CHANGED:
            if transition.actor not in {StateAuthority.CONTROLLER, StateAuthority.HUMAN}:
                raise ValueError("Only controller or human authority may change project stage.")
            stage_schema = StageStateSchema.model_validate(payload["stage_schema"])
            stage_fields = [
                StageStateField.model_validate(item) for item in payload.get("stage_fields", [])
            ]

        else:
            raise ValueError(f"Unsupported state transition {transition.kind.value}.")

        return make_project_state(
            project_id=current.project_id,
            revision=current.revision + 1,
            stage_schema=stage_schema,
            stage_fields=stage_fields,
            artifacts=artifacts,
            decisions=decisions,
            open_questions=questions,
            blocked=blocked,
            work_items=work_items,
            last_action=StateAction(
                action_id=transition.action_id,
                kind=transition.kind.value,
                status=action_status,
                evidence=transition.evidence,
                summary=_bounded_value(payload, 2_048),
            ),
            step_count=current.step_count + 1,
        )


class InMemoryProjectStateStore:
    """Deterministic state repository for a bounded task and unit tests."""

    def __init__(self) -> None:
        self._states: dict[str, ProjectState] = {}
        self._events: dict[str, list[ProjectStateEvent]] = {}

    def ensure(self, project_id: str, stage_schema: StageStateSchema) -> ProjectState:
        if project_id not in self._states:
            self._states[project_id] = make_project_state(
                project_id=project_id,
                revision=0,
                stage_schema=stage_schema,
            )
            self._events[project_id] = []
        return self._states[project_id]

    def load(self, project_id: str) -> ProjectState:
        state = self._states.get(project_id)
        if state is None:
            raise ValueError(f'Project state "{project_id}" is unknown.')
        return state

    def apply(self, project_id: str, transition: StateTransition) -> ProjectState:
        current = self.load(project_id)
        next_state = ProjectStateReducer.apply(current, transition)
        event = _make_event(current, next_state, transition)
        self._states[project_id] = next_state
        self._events[project_id].append(event)
        return next_state

    def events(self, project_id: str) -> tuple[ProjectStateEvent, ...]:
        self.load(project_id)
        return tuple(self._events[project_id])


class FileProjectStateStore(InMemoryProjectStateStore):
    """Atomic persistent project state plus an append-only revision-event audit trail."""

    def __init__(self, run_root: Path) -> None:
        super().__init__()
        self._root = run_root.resolve() / ".agent-project-state"
        self._root.mkdir(parents=True, exist_ok=True)

    def ensure(self, project_id: str, stage_schema: StageStateSchema) -> ProjectState:
        target = self._state_path(project_id)
        if target.is_file():
            return self.load(project_id)
        state = super().ensure(project_id, stage_schema)
        self._write_json(target, state.model_dump(mode="json"))
        return state

    def load(self, project_id: str) -> ProjectState:
        if project_id in self._states:
            return super().load(project_id)
        target = self._state_path(project_id)
        if not target.is_file():
            raise ValueError(f'Project state "{project_id}" is unknown.')
        state = ProjectState.model_validate_json(target.read_text(encoding="utf-8"))
        self._states[project_id] = state
        self._events[project_id] = self._read_events(project_id)
        self._verify_history(project_id)
        return state

    def apply(self, project_id: str, transition: StateTransition) -> ProjectState:
        current = self.load(project_id)
        next_state = ProjectStateReducer.apply(current, transition)
        event = _make_event(current, next_state, transition)
        self._write_json(
            self._event_path(project_id, event.revision), event.model_dump(mode="json")
        )
        self._write_json(self._state_path(project_id), next_state.model_dump(mode="json"))
        self._states[project_id] = next_state
        self._events[project_id].append(event)
        return next_state

    def _state_path(self, project_id: str) -> Path:
        return self._root / f"{_safe_id(project_id)}.json"

    def _event_path(self, project_id: str, revision: int) -> Path:
        path = self._root / _safe_id(project_id)
        path.mkdir(parents=True, exist_ok=True)
        return path / f"{revision:08d}.json"

    def _read_events(self, project_id: str) -> list[ProjectStateEvent]:
        event_root = self._root / _safe_id(project_id)
        if not event_root.is_dir():
            return []
        return [
            ProjectStateEvent.model_validate_json(path.read_text(encoding="utf-8"))
            for path in sorted(event_root.glob("*.json"))
        ]

    def _verify_history(self, project_id: str) -> None:
        state = self._states[project_id]
        events = self._events[project_id]
        if state.revision != len(events):
            raise ValueError("Project state revision does not match persisted event count.")
        previous_hash: str | None = None
        for expected_revision, event in enumerate(events, start=1):
            if event.revision != expected_revision:
                raise ValueError("Project state event revisions are not contiguous.")
            if previous_hash is not None and event.previous_state_hash != previous_hash:
                raise ValueError("Project state event history has a broken state-hash chain.")
            previous_hash = event.state_hash
        if events and events[-1].state_hash != state.state_hash:
            raise ValueError("Latest project state hash does not match the event history.")

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        temporary = path.with_name(f".{path.name}.tmp")
        temporary.write_text(_canonical_json(value), encoding="utf-8")
        os.replace(temporary, path)


def make_project_state(
    *,
    project_id: str,
    revision: int,
    stage_schema: StageStateSchema,
    stage_fields: list[StageStateField] | None = None,
    artifacts: list[ProjectArtifactState] | None = None,
    decisions: list[ProjectDecision] | None = None,
    open_questions: list[OpenQuestion] | None = None,
    blocked: list[ProjectBlocker] | None = None,
    work_items: list[ProjectWorkItem] | None = None,
    last_action: StateAction | None = None,
    step_count: int = 0,
) -> ProjectState:
    payload = {
        "schema_version": "project-state-v1",
        "project_id": project_id,
        "revision": revision,
        "stage_schema": stage_schema,
        "stage_fields": stage_fields or [],
        "artifacts": artifacts or [],
        "decisions": decisions or [],
        "open_questions": open_questions or [],
        "blocked": blocked or [],
        "work_items": work_items or [],
        "last_action": last_action,
        "step_count": step_count,
        "state_hash": "pending",
    }
    state_hash = project_state_hash_from_payload(payload)
    return ProjectState.model_validate({**payload, "state_hash": state_hash})


def project_state_hash(state: ProjectState) -> str:
    return project_state_hash_from_payload(state.model_dump(mode="json"))


def project_state_hash_from_payload(payload: dict[str, Any]) -> str:
    stable = {key: value for key, value in payload.items() if key != "state_hash"}
    return hashlib.sha256(_canonical_json(stable).encode("utf-8")).hexdigest()


def _make_event(
    previous: ProjectState,
    current: ProjectState,
    transition: StateTransition,
) -> ProjectStateEvent:
    return ProjectStateEvent(
        project_id=current.project_id,
        revision=current.revision,
        kind=transition.kind,
        actor=transition.actor,
        action_id=transition.action_id,
        evidence=transition.evidence,
        previous_state_hash=previous.state_hash,
        state_hash=current.state_hash,
        event_hash=_event_hash(
            current.project_id,
            current.revision,
            transition.kind,
            transition.actor,
            transition.action_id,
            transition.evidence,
            previous.state_hash,
            current.state_hash,
        ),
    )


def _event_hash(
    project_id: str,
    revision: int,
    kind: StateTransitionKind,
    actor: StateAuthority,
    action_id: str,
    evidence: list[StateEvidence],
    previous_state_hash: str,
    state_hash: str,
) -> str:
    return hashlib.sha256(
        _canonical_json(
            {
                "project_id": project_id,
                "revision": revision,
                "kind": kind.value,
                "actor": actor.value,
                "action_id": action_id,
                "evidence": [item.model_dump(mode="json") for item in evidence],
                "previous_state_hash": previous_state_hash,
                "state_hash": state_hash,
            }
        ).encode("utf-8")
    ).hexdigest()


def _artifact_from_result(
    call: ToolCall,
    result: ToolExecutionResult,
) -> dict[str, Any] | None:
    if call.name != "write_draft" or result.status != "succeeded":
        return None
    if not isinstance(result.output, dict):
        return None
    artifact_id = result.output.get("artifact_id")
    relative_path = result.output.get("relative_path")
    if not isinstance(artifact_id, str) or not isinstance(relative_path, str):
        return None
    return {
        "relative_path": relative_path,
        "artifact_id": artifact_id,
        "status": ArtifactStatus.IN_PROGRESS.value,
    }


def _upsert[T](items: list[T], key: str, value: T) -> list[T]:
    value_key = getattr(value, key)
    replacement = [item for item in items if getattr(item, key) != value_key]
    return [*replacement, value]


def _ensure_unique[T](items: list[T], key: str, label: str) -> None:
    values = [getattr(item, key) for item in items]
    if len(values) != len(set(values)):
        raise ValueError(f"{label} must be unique")


def _safe_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json(value: Any) -> str:
    def default(item: Any) -> Any:
        if hasattr(item, "model_dump"):
            return item.model_dump(mode="json")
        return str(item)

    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=default)


def _bounded_value(value: Any, max_chars: int) -> Any:
    encoded = _canonical_json(value)
    if len(encoded) <= max_chars:
        return value
    return {
        "kind": "truncated-state-summary",
        "preview": encoded[:max_chars],
        "truncated": True,
    }


def _bounded_text(value: str | None, max_chars: int) -> str | None:
    if value is None or len(value) <= max_chars:
        return value
    return f"{value[:max_chars]}… [truncated]"


def _estimated_tokens(value: Any) -> int:
    return max(1, len(_canonical_json(value)) // 4)
