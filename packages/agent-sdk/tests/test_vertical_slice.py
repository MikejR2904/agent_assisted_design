from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from agent_sdk.approvals import ApprovalRegistry
from agent_sdk.artifacts import ArtifactStore
from agent_sdk.base_agent import BaseAgent
from agent_sdk.contracts import ModelBinding, ScopedAgentTask, TaskScope
from agent_sdk.coordination import HarnessCoordinator
from agent_sdk.model import ScriptedModel
from agent_sdk.planning import (
    ModelTier,
    Plan,
    PlanTask,
    SignalRole,
    TaskSignalUse,
)
from agent_sdk.policy import CapabilityGrant, CapabilityPolicy
from agent_sdk.specialists import planning_agent_definition, rtl_worker_definition
from agent_sdk.supervisor import ProcessSupervisor
from agent_sdk.tool_registry import (
    HarnessExecutionContext,
    HarnessToolExecutor,
    HarnessToolRegistry,
)


@pytest.mark.anyio
async def test_scripted_planner_to_validated_rtl_worker_vertical_slice(tmp_path: Path):
    binding = ModelBinding(provider="scripted", model="test-only")
    plan = Plan(
        plan_id="vertical-plan",
        tasks=[
            PlanTask(
                task_id="rtl-accumulator",
                scope="REQ-RTL-ACCUMULATOR",
                locked_interface={"signals": [{"id": "ready", "width": 1}]},
                instructions="Write one accumulator RTL draft.",
                acceptance_criteria="validate_rtl_task_result",
                model_tier=ModelTier.STANDARD,
                signal_uses=[
                    TaskSignalUse(
                        task_id="rtl-accumulator",
                        signal_id="ready",
                        role=SignalRole.PRODUCE,
                        source_spans=["spec:24"],
                        scope_pointer="REQ-RTL-ACCUMULATOR",
                    )
                ],
            )
        ],
    )

    planner_task = ScopedAgentTask(
        id="planner-task",
        input={},
        scope=TaskScope(label="planning"),
        locked_interface={},
        instructions="Produce the supplied bounded plan.",
        acceptance_criteria=["Return a typed plan."],
    )
    planner_result = await BaseAgent(
        planning_agent_definition(binding),
        ScriptedModel(
            [
                {
                    "type": "final",
                    "output": {"status": "complete", "plan": plan.model_dump(mode="json")},
                }
            ]
        ),
    ).run(planner_task)
    asserted_plan = Plan.model_validate(planner_result.output["plan"])
    run = HarnessCoordinator(tmp_path).start_run(asserted_plan)
    assert run.plan_validation.valid is True

    plan_task = asserted_plan.tasks[0]
    locked_interface = plan_task.locked_interface
    rtl_task = ScopedAgentTask(
        id="rtl-task",
        input={},
        scope=TaskScope(label=plan_task.scope),
        locked_interface=locked_interface,
        instructions=plan_task.instructions,
        acceptance_criteria=[plan_task.acceptance_criteria],
    )
    approvals = ApprovalRegistry()
    policy = CapabilityPolicy(
        [
            CapabilityGrant(
                role="rtl", capabilities=["spec.read", "draft.write"], allowed_paths=["drafts"]
            )
        ]
    )
    context = HarnessExecutionContext(
        run_id=run.run_id,
        node_id="node:rtl-accumulator",
        role="rtl",
        plan_task=plan_task,
        run_root=tmp_path,
        artifacts=ArtifactStore(tmp_path),
        policy=policy,
        approvals=approvals,
        supervisor=ProcessSupervisor(),
        spec_snapshots={plan_task.scope: "output ready is one bit"},
        declared_output_paths=("drafts/accumulator.sv",),
    )
    executor = HarnessToolExecutor(HarnessToolRegistry(), context)
    draft_content = "module accumulator(output logic ready); assign ready = 1'b1; endmodule\n"

    first_attempt = await BaseAgent(
        rtl_worker_definition(binding),
        ScriptedModel(
            [
                {
                    "type": "tool-call",
                    "call": {
                        "id": "read",
                        "name": "read_spec",
                        "arguments": {"pointer": plan_task.scope},
                    },
                },
                {
                    "type": "tool-call",
                    "call": {
                        "id": "write",
                        "name": "write_draft",
                        "arguments": {"path": "drafts/accumulator.sv", "content": draft_content},
                        "consumed_episode_ids": ["episode-1"],
                    },
                },
            ]
        ),
        executor,
    ).run(rtl_task)
    assert first_attempt.status == "blocked"

    request = approvals.list(run.run_id)[0]
    approvals.submit(request.approval_id, True, "Approved declared RTL draft write.")
    approved_context = HarnessExecutionContext(
        **{**context.__dict__, "approval_ids_by_capability": {"draft.write": request.approval_id}}
    )
    interface_hash = hashlib.sha256(
        json.dumps(locked_interface, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    result = await BaseAgent(
        rtl_worker_definition(binding),
        ScriptedModel(
            [
                {
                    "type": "tool-call",
                    "call": {
                        "id": "read",
                        "name": "read_spec",
                        "arguments": {"pointer": plan_task.scope},
                    },
                },
                {
                    "type": "tool-call",
                    "call": {
                        "id": "write",
                        "name": "write_draft",
                        "arguments": {"path": "drafts/accumulator.sv", "content": draft_content},
                        "consumed_episode_ids": ["episode-1"],
                    },
                },
                {
                    "type": "final",
                    "output": {
                        "status": "complete",
                        "draft_artifact_id": "sha256:"
                        + hashlib.sha256(draft_content.encode()).hexdigest(),
                        "checks": [],
                        "locked_interface_hash": interface_hash,
                    },
                },
            ]
        ),
        HarnessToolExecutor(HarnessToolRegistry(), approved_context),
    ).run(rtl_task)

    assert result.status == "completed"
    assert (tmp_path / "drafts/accumulator.sv").read_text() == draft_content
