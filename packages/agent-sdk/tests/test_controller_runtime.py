from __future__ import annotations

from pathlib import Path

from agent_sdk.controller_runtime import ControllerRuntime
from agent_sdk.graph import GraphNodeResult, GraphNodeStatus
from agent_sdk.orchestration import (
    ComplexityRoutingRules,
    ControllerPhase,
    GapMetadata,
    SkillToolProfile,
    WorkflowArchitecture,
)
from agent_sdk.planning import (
    DependencyProof,
    DependencyRule,
    ModelTier,
    Plan,
    PlanTask,
    SignalRole,
    TaskSignalUse,
)
from agent_sdk.shared_state import (
    ExploratoryDiscovery,
    LateralDependencyRequest,
    SharedSubstrateSnapshot,
    canonical_hash,
    make_provenance_record,
)
from agent_sdk.stage_gates import StageCompletenessPolicy


def _plan() -> Plan:
    producer = PlanTask(
        task_id="producer",
        scope="REQ-PRODUCER",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Produce ready.",
        acceptance_criteria="gate:producer",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="producer",
                signal_id="ready",
                role=SignalRole.PRODUCE,
                source_spans=["spec:1"],
                scope_pointer="REQ-PRODUCER",
            )
        ],
    )
    consumer = PlanTask(
        task_id="consumer",
        scope="REQ-CONSUMER",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Consume ready.",
        dependencies=["producer"],
        acceptance_criteria="gate:consumer",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="consumer",
                signal_id="ready",
                role=SignalRole.CONSUME,
                source_spans=["spec:2"],
                scope_pointer="REQ-CONSUMER",
            )
        ],
    )
    return Plan(
        plan_id="controller-plan",
        tasks=[producer, consumer],
        dependency_proofs=[
            DependencyProof(
                parent_task_id="producer",
                child_task_id="consumer",
                shared_signal_ids=["ready"],
                applied_rule=DependencyRule.PRODUCER_TO_CONSUMER,
                source_spans=["spec:1", "spec:2"],
            )
        ],
    )


def _runtime(tmp_path: Path) -> ControllerRuntime:
    return ControllerRuntime(tmp_path)


def _controller(runtime: ControllerRuntime):
    snapshot = SharedSubstrateSnapshot(
        snapshot_id="spec-v1",
        version="1.0.0",
        content_hash=canonical_hash({"locked": "spec"}),
    )
    profile = SkillToolProfile(
        stage="rtl-development",
        skill_ids=["rtl"],
        capability_ids=["spec.read"],
        source_snapshot_id=snapshot.snapshot_id,
    )
    return runtime.create_controller(
        snapshot,
        profile,
        ComplexityRoutingRules(
            multi_agent_min_categories=2,
            multi_agent_min_blast_radius=3,
            multi_agent_gap_types=["traceability"],
        ),
        GapMetadata(categories_touched=["architecture", "interface"], blast_radius=0),
        max_repair_attempts=1,
    )


def test_controller_requires_valid_plan_and_explicit_user_approval(tmp_path: Path):
    runtime = _runtime(tmp_path)
    controller = _controller(runtime)
    assert controller.architecture is WorkflowArchitecture.MULTI_AGENT

    presented = runtime.submit_plan(controller.controller_id, _plan())
    assert presented.phase is ControllerPhase.AWAITING_PLAN_APPROVAL
    assert presented.plan_validation and presented.plan_validation.valid

    ready = runtime.approve_plan(controller.controller_id, True, "Designer approved the plan.")
    record, run = runtime.dispatch(ready.controller_id)

    assert record.phase is ControllerPhase.EXECUTING
    assert record.run_id == run.run_id
    assert record.project_state_id == "spec-v1"
    assert run.graph["statuses"]["node:producer"] == "runnable"


def test_lateral_handoff_references_discovery_not_worker_transcript(tmp_path: Path):
    runtime = _runtime(tmp_path)
    controller = _controller(runtime)
    runtime.submit_plan(controller.controller_id, _plan())
    runtime.approve_plan(controller.controller_id, True)
    record, _run = runtime.dispatch(controller.controller_id)

    runtime.record_node_result(
        controller.controller_id,
        "node:producer",
        GraphNodeResult(status=GraphNodeStatus.COMPLETED, output={"status": "complete"}),
    )
    project_state = runtime.project_state(controller.controller_id)
    assert project_state.work_items[0].work_item_id == "node:producer"
    assert project_state.work_items[0].status == "completed"
    discovery_payload = {"clocking_observation": "ready requires synchronous reset"}
    runtime.publish_discovery(
        controller.controller_id,
        ExploratoryDiscovery(
            episode_id="episode-producer-1",
            producer_node_id="node:producer",
            owner_id="worker-producer",
            snapshot_id="spec-v1",
            snapshot_version="1.0.0",
            source_spans=["REQ-PRODUCER#line:4"],
            description="Identified synchronous-reset constraint for ready.",
            payload=discovery_payload,
            provenance_hash=canonical_hash(discovery_payload),
        ),
    )

    updated = runtime.request_lateral_dependency(
        controller.controller_id,
        LateralDependencyRequest(
            consumer_node_id="node:consumer",
            consumer_action_id="write-rtl",
            discovery_episode_id="episode-producer-1",
            reason="The consumer must preserve the discovered reset constraint.",
        ),
    )

    edge = next(edge for edge in updated.graph["edges"] if edge["metadata"].get("lateral"))
    assert edge["parent_node_id"] == "node:producer"
    assert edge["child_node_id"] == "node:consumer"
    assert updated.graph["shared_state"]["discoveries"]["episode-producer-1"]["payload"] == (
        discovery_payload
    )
    state = runtime.shared_state(record.controller_id)
    assert (
        state["lateral_dependencies"]["episode-producer-1"][0]["consumer_action_id"] == "write-rtl"
    )
    resumed = ControllerRuntime(tmp_path)
    resumed_state = resumed.shared_state(record.controller_id)
    assert resumed_state["discoveries"]["episode-producer-1"]["payload"] == discovery_payload
    assert (
        resumed_state["lateral_dependencies"]["episode-producer-1"][0]["consumer_action_id"]
        == "write-rtl"
    )


def test_controller_escalates_after_bounded_repair_attempts(tmp_path: Path):
    runtime = _runtime(tmp_path)
    controller = _controller(runtime)
    runtime.submit_plan(controller.controller_id, _plan())
    runtime.approve_plan(controller.controller_id, True)
    runtime.dispatch(controller.controller_id)

    repair = runtime.record_stage_failure(controller.controller_id, "first lint failure")
    assert repair.phase is ControllerPhase.REPAIR_REQUIRED
    presented = runtime.submit_plan(controller.controller_id, _plan())
    runtime.approve_plan(presented.controller_id, True)
    runtime.dispatch(presented.controller_id)
    escalated = runtime.record_stage_failure(controller.controller_id, "second lint failure")

    assert escalated.phase is ControllerPhase.ESCALATED
    assert escalated.escalation_reason == "second lint failure"


def test_incomplete_stage_gate_enters_bounded_controller_repair(tmp_path: Path):
    runtime = _runtime(tmp_path)
    controller = _controller(runtime)
    runtime.submit_plan(controller.controller_id, _plan())
    runtime.approve_plan(controller.controller_id, True)
    runtime.dispatch(controller.controller_id)

    decision = runtime.evaluate_stage_completeness(
        controller.controller_id,
        StageCompletenessPolicy(
            policy_id="rtl-completion-v1",
            stage="rtl-development",
            required_work_item_ids=["node:consumer"],
        ),
    )

    assert decision.complete is False
    assert runtime.get_controller(controller.controller_id).phase is ControllerPhase.REPAIR_REQUIRED


def test_provenance_contract_gate_checks_snapshot_and_result_schema(tmp_path: Path):
    runtime = _runtime(tmp_path)
    controller = _controller(runtime)
    runtime.submit_plan(controller.controller_id, _plan())
    runtime.approve_plan(controller.controller_id, True)
    runtime.dispatch(controller.controller_id)
    record = make_provenance_record(
        node_id="node:producer",
        input_hashes=[],
        source_snapshot_ids=["spec-v1"],
        source_spans=["REQ-PRODUCER#line:1"],
        tool_record_hashes=[],
        artifact_ids=[],
        result_schema_version="stage-result-v1",
        result={"status": "complete"},
    )

    accepted = runtime.verify_provenance_contract(
        controller.controller_id, [record], "stage-result-v1"
    )
    rejected = runtime.verify_provenance_contract(
        controller.controller_id, [record], "stage-result-v2"
    )

    assert accepted.accepted is True
    assert rejected.accepted is False
    assert runtime.get_controller(controller.controller_id).phase is ControllerPhase.REPAIR_REQUIRED
