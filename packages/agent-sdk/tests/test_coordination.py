from __future__ import annotations

from pathlib import Path

from agent_sdk.coordination import HarnessCoordinator
from agent_sdk.graph import GraphNodeResult, GraphNodeStatus
from agent_sdk.planning import (
    DependencyProof,
    DependencyRule,
    ModelTier,
    Plan,
    PlanTask,
    SignalRole,
    TaskSignalUse,
)


def _valid_plan() -> Plan:
    parent = PlanTask(
        task_id="parent",
        scope="REQ-PARENT",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Produce ready.",
        acceptance_criteria="gate:parent",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="parent",
                signal_id="ready",
                role=SignalRole.PRODUCE,
                source_spans=["spec:1"],
                scope_pointer="REQ-PARENT",
            )
        ],
    )
    child = PlanTask(
        task_id="child",
        scope="REQ-CHILD",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Consume ready.",
        dependencies=["parent"],
        acceptance_criteria="gate:child",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="child",
                signal_id="ready",
                role=SignalRole.CONSUME,
                source_spans=["spec:2"],
                scope_pointer="REQ-CHILD",
            )
        ],
    )
    return Plan(
        plan_id="valid-plan",
        tasks=[parent, child],
        dependency_proofs=[
            DependencyProof(
                parent_task_id="parent",
                child_task_id="child",
                shared_signal_ids=["ready"],
                applied_rule=DependencyRule.PRODUCER_TO_CONSUMER,
                source_spans=["spec:1", "spec:2"],
            )
        ],
    )


def test_coordinator_persists_integrity_checked_run_state(tmp_path: Path):
    coordinator = HarnessCoordinator(tmp_path)
    started = coordinator.start_run(_valid_plan())

    restored = coordinator.get_run_state(started.run_id)

    assert restored.run_id == started.run_id
    assert restored.plan_validation.valid is True
    assert restored.graph["statuses"]["node:parent"] == "runnable"
    assert restored.graph["statuses"]["node:child"] == "pending"


def test_coordinator_cancellation_records_typed_terminal_state(tmp_path: Path):
    coordinator = HarnessCoordinator(tmp_path)
    started = coordinator.start_run(_valid_plan())

    cancelled = coordinator.cancel_run(started.run_id)

    assert cancelled.cancelled is True
    assert cancelled.graph["statuses"]["node:parent"] == "cancelled"
    assert cancelled.graph["statuses"]["node:child"] == "blocked"


def test_coordinator_rehydrates_integrity_checked_graph_after_restart(tmp_path: Path):
    started = HarnessCoordinator(tmp_path).start_run(_valid_plan())

    resumed = HarnessCoordinator(tmp_path).record_node_result(
        started.run_id,
        "node:parent",
        GraphNodeResult(status=GraphNodeStatus.COMPLETED, output={"status": "complete"}),
    )

    assert resumed.graph["statuses"]["node:parent"] == "completed"
    assert resumed.graph["statuses"]["node:child"] == "runnable"
