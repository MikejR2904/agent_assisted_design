from __future__ import annotations

from agent_sdk.planning import (
    DependencyProof,
    DependencyRule,
    ModelTier,
    Plan,
    PlanTask,
    PlanValidator,
    SignalRole,
    TaskSignalUse,
)


def _task(
    task_id: str,
    role: SignalRole,
    dependencies: list[str],
    *,
    signal: str = "ready",
) -> PlanTask:
    return PlanTask(
        task_id=task_id,
        scope=f"REQ-{task_id}",
        locked_interface={"signals": [{"id": signal, "width": 1}]},
        instructions="Do the scoped work.",
        dependencies=dependencies,
        acceptance_criteria="gate:rtl",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id=task_id,
                signal_id=signal,
                role=role,
                source_spans=[f"spec:{task_id}:1"],
                scope_pointer=f"REQ-{task_id}",
            )
        ],
    )


def test_plan_validator_recomputes_producer_to_consumer_dependencies():
    producer = _task("produce", SignalRole.PRODUCE, [])
    consumer = _task("consume", SignalRole.CONSUME, ["produce"])
    plan = Plan(
        plan_id="plan-1",
        tasks=[producer, consumer],
        dependency_proofs=[
            DependencyProof(
                parent_task_id="produce",
                child_task_id="consume",
                shared_signal_ids=["ready"],
                applied_rule=DependencyRule.PRODUCER_TO_CONSUMER,
                source_spans=["spec:produce:1", "spec:consume:1"],
            )
        ],
    )

    report = PlanValidator().validate(plan)

    assert report.valid is True
    assert report.recomputed_dependencies == {"consume": ["produce"], "produce": []}


def test_plan_validator_rejects_competing_signal_producers():
    left = _task("left", SignalRole.PRODUCE, [])
    right = _task("right", SignalRole.DEFINE, [])

    report = PlanValidator().validate(Plan(plan_id="plan-ambiguous", tasks=[left, right]))

    assert report.valid is False
    assert any(error.code == "SIGNAL_OWNERSHIP_AMBIGUITY" for error in report.errors)


def test_plan_validator_rejects_dependency_proof_mismatch():
    producer = _task("produce", SignalRole.PRODUCE, [])
    consumer = _task("consume", SignalRole.CONSUME, ["produce"])

    report = PlanValidator().validate(Plan(plan_id="plan-proof", tasks=[producer, consumer]))

    assert report.valid is False
    assert any(error.code == "DEPENDENCY_PROOF_MISMATCH" for error in report.errors)
