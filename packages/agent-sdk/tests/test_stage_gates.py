from __future__ import annotations

from agent_sdk.project_state import (
    ArtifactStatus,
    ProjectArtifactState,
    ProjectWorkItem,
    StageStateField,
    StageStateSchema,
    StateEvidence,
    WorkItemStatus,
    make_project_state,
)
from agent_sdk.stage_gates import StageCompletenessGate, StageCompletenessPolicy


def _evidence() -> list[StateEvidence]:
    return [StateEvidence(evidence_id="evidence-1", kind="test", content_hash="hash")]


def test_stage_gate_reports_declared_incomplete_artifacts_and_work_items():
    state = make_project_state(
        project_id="project-1",
        revision=0,
        stage_schema=StageStateSchema(
            schema_id="rtl-v1", stage="rtl", required_field_ids=["interface-locked"]
        ),
        stage_fields=[
            StageStateField(field_id="interface-locked", value=True, evidence=_evidence())
        ],
        artifacts=[
            ProjectArtifactState(
                relative_path="rtl/core.sv", status=ArtifactStatus.IN_PROGRESS, evidence=_evidence()
            )
        ],
        work_items=[
            ProjectWorkItem(
                work_item_id="rtl-core",
                status=WorkItemStatus.BLOCKED,
                owner="rtl-worker",
                evidence=_evidence(),
            )
        ],
    )

    decision = StageCompletenessGate().evaluate(
        state,
        StageCompletenessPolicy(
            policy_id="rtl-gate-v1",
            stage="rtl",
            required_artifact_paths=["rtl/core.sv"],
            required_work_item_ids=["rtl-core"],
        ),
    )

    assert decision.complete is False
    assert decision.incomplete_artifact_paths == ["rtl/core.sv"]
    assert decision.incomplete_work_item_ids == ["rtl-core"]


def test_stage_gate_accepts_complete_declared_state():
    state = make_project_state(
        project_id="project-1",
        revision=0,
        stage_schema=StageStateSchema(
            schema_id="rtl-v1", stage="rtl", required_field_ids=["interface-locked"]
        ),
        stage_fields=[
            StageStateField(field_id="interface-locked", value=True, evidence=_evidence())
        ],
        artifacts=[
            ProjectArtifactState(
                relative_path="rtl/core.sv", status=ArtifactStatus.COMPLETE, evidence=_evidence()
            )
        ],
        work_items=[
            ProjectWorkItem(
                work_item_id="rtl-core",
                status=WorkItemStatus.COMPLETED,
                owner="rtl-worker",
                evidence=_evidence(),
            )
        ],
    )

    decision = StageCompletenessGate().evaluate(
        state,
        StageCompletenessPolicy(
            policy_id="rtl-gate-v1",
            stage="rtl",
            required_artifact_paths=["rtl/core.sv"],
            required_work_item_ids=["rtl-core"],
        ),
    )

    assert decision.complete is True
    assert decision.reasons == []
