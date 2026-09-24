from __future__ import annotations

import json

import pytest

from agent_sdk.contracts import ToolCall, ToolExecutionResult, ToolResultHandle
from agent_sdk.project_state import (
    DecisionStatus,
    FileProjectStateStore,
    InMemoryProjectStateStore,
    ProjectStateProjectionPolicy,
    ProjectStateProjector,
    ProjectStateReducer,
    QuestionOwner,
    StageStateField,
    StageStateSchema,
    StateAuthority,
    StateEvidence,
    StateTransition,
    StateTransitionKind,
)


def _schema() -> StageStateSchema:
    return StageStateSchema(
        schema_id="rtl-development-v1",
        stage="rtl-development",
        required_field_ids=["top-module"],
    )


def _state_store() -> InMemoryProjectStateStore:
    store = InMemoryProjectStateStore()
    store.ensure(
        "project-1",
        _schema().model_copy(
            update={
                "required_field_ids": [],
            }
        ),
    )
    return store


def test_project_state_reducer_records_tool_evidence_not_full_tool_transcript():
    store = _state_store()
    state = store.apply(
        "project-1",
        ProjectStateReducer.tool_transition(
            ToolCall(id="write-1", name="write_draft", arguments={}),
            ToolExecutionResult(
                status="succeeded",
                output={
                    "artifact_id": "sha256:artifact",
                    "relative_path": "rtl/top.sv",
                    "very_large_log": "x" * 10_000,
                },
            ),
            ToolResultHandle(
                handle_id="result-1",
                content_hash="tool-hash",
                byte_count=10_000,
                truncated=True,
            ),
        ),
    )

    assert state.revision == 1
    assert state.artifacts[0].relative_path == "rtl/top.sv"
    assert state.artifacts[0].status == "in-progress"
    assert state.last_action is not None
    assert state.last_action.evidence[0].evidence_id == "result-1"
    assert "x" * 500 not in json.dumps(state.model_view())


def test_human_decision_and_question_require_explicit_evidence():
    store = _state_store()
    decision = store.apply(
        "project-1",
        StateTransition(
            kind=StateTransitionKind.HUMAN_DECISION,
            actor=StateAuthority.HUMAN,
            action_id="decision:D-001",
            payload={
                "decision_id": "D-001",
                "content": "Use AXI4-Lite.",
                "status": DecisionStatus.LOCKED.value,
            },
            evidence=[StateEvidence(evidence_id="REQ-AXI#line:1", kind="spec-source")],
        ),
    )
    questioned = store.apply(
        "project-1",
        StateTransition(
            kind=StateTransitionKind.QUESTION_OPENED,
            actor=StateAuthority.HARNESS,
            action_id="question:Q-001",
            payload={
                "question_id": "Q-001",
                "content": "Is ECC required?",
                "owner": QuestionOwner.HUMAN.value,
            },
            evidence=[StateEvidence(evidence_id="REQ-ECC#line:3", kind="spec-gap")],
        ),
    )

    assert decision.decisions[0].authority is StateAuthority.HUMAN
    assert questioned.open_questions[0].owner is QuestionOwner.HUMAN
    assert questioned.revision == 2


def test_stage_schema_rejects_missing_declared_required_state_fields():
    store = InMemoryProjectStateStore()
    with pytest.raises(ValueError, match="missing required stage fields"):
        store.ensure("project-1", _schema())

    # A stage transition succeeds only when the controller supplies every required
    # field and evidence.
    state = _state_store().apply(
        "project-1",
        StateTransition(
            kind=StateTransitionKind.STAGE_CHANGED,
            actor=StateAuthority.CONTROLLER,
            action_id="stage:rtl",
            payload={
                "stage_schema": _schema().model_dump(mode="json"),
                "stage_fields": [
                    StageStateField(
                        field_id="top-module",
                        value="accumulator_top",
                        evidence=[StateEvidence(evidence_id="REQ-TOP#line:2", kind="spec-source")],
                    ).model_dump(mode="json")
                ],
            },
            evidence=[StateEvidence(evidence_id="gate-1", kind="controller-gate")],
        ),
    )
    assert state.stage == "rtl-development"
    assert state.stage_fields[0].field_id == "top-module"


def test_file_store_detects_tampered_state_event_chain(tmp_path):
    store = FileProjectStateStore(tmp_path)
    store.ensure("project-1", _state_store().load("project-1").stage_schema)
    store.apply(
        "project-1",
        StateTransition(
            kind=StateTransitionKind.QUESTION_OPENED,
            actor=StateAuthority.HARNESS,
            action_id="question:Q-001",
            payload={
                "question_id": "Q-001",
                "content": "Need reset-domain decision.",
                "owner": "human",
            },
            evidence=[StateEvidence(evidence_id="REQ-RESET#line:5", kind="spec-gap")],
        ),
    )
    event_path = next((tmp_path / ".agent-project-state").glob("*/00000001.json"))
    payload = json.loads(event_path.read_text(encoding="utf-8"))
    payload["state_hash"] = "tampered"
    event_path.write_text(json.dumps(payload), encoding="utf-8")

    reloaded = FileProjectStateStore(tmp_path)
    with pytest.raises(ValueError, match="project state event hash"):
        reloaded.load("project-1")


def test_project_state_projection_bounds_noncritical_artifacts_and_work_items():
    store = _state_store()
    for index in range(10):
        store.apply(
            "project-1",
            ProjectStateReducer.tool_transition(
                ToolCall(id=f"write-{index}", name="write_draft", arguments={}),
                ToolExecutionResult(
                    status="succeeded",
                    output={
                        "artifact_id": f"sha256:{index}",
                        "relative_path": f"rtl/block_{index}.sv",
                    },
                ),
                ToolResultHandle(
                    handle_id=f"result-{index}",
                    content_hash=f"hash-{index}",
                    byte_count=100,
                    truncated=False,
                ),
            ),
        )

    view = ProjectStateProjector(ProjectStateProjectionPolicy(token_budget=500)).project(
        store.load("project-1")
    )

    assert view.over_budget is False
    assert view.estimated_tokens <= view.token_budget
    assert view.omitted_artifact_count > 0
    assert len(view.artifacts) < 10
    assert view.last_action is not None
