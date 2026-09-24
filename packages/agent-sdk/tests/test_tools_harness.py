from __future__ import annotations

import sys
from pathlib import Path

import pytest

from agent_sdk.approvals import ApprovalRegistry
from agent_sdk.artifacts import ArtifactStore
from agent_sdk.contracts import ScopedAgentTask, TaskScope, ToolCall
from agent_sdk.planning import ModelTier, PlanTask
from agent_sdk.policy import CapabilityGrant, CapabilityPolicy, SideEffectClass
from agent_sdk.supervisor import CommandTemplate, ProcessSupervisor
from agent_sdk.tool_registry import (
    HarnessExecutionContext,
    HarnessToolExecutor,
    HarnessToolRegistry,
    RegisteredTool,
)
from agent_sdk.tools import ToolInvocationContext


def _plan_task() -> PlanTask:
    return PlanTask(
        task_id="rtl-1",
        scope="REQ-RTL-1",
        locked_interface={"signals": []},
        instructions="Write one draft.",
        acceptance_criteria="gate:rtl",
        model_tier=ModelTier.STANDARD,
    )


def _invocation(call: ToolCall) -> ToolInvocationContext:
    return ToolInvocationContext(
        agent_identity="RTL worker",
        task=ScopedAgentTask(
            id="task-1",
            input={},
            scope=TaskScope(label="rtl"),
            locked_interface={},
            instructions="Write one draft.",
            acceptance_criteria=["draft exists"],
        ),
        iteration=1,
        call=call,
    )


@pytest.mark.anyio
async def test_mutating_draft_tool_requires_typed_approval_then_writes_declared_path(
    tmp_path: Path,
):
    plan_task = _plan_task()
    approvals = ApprovalRegistry()
    policy = CapabilityPolicy(
        [CapabilityGrant(role="rtl", capabilities=["draft.write"], allowed_paths=["drafts"])]
    )
    context = HarnessExecutionContext(
        run_id="run-1",
        node_id="node-rtl",
        role="rtl",
        plan_task=plan_task,
        run_root=tmp_path,
        artifacts=ArtifactStore(tmp_path),
        policy=policy,
        approvals=approvals,
        supervisor=ProcessSupervisor(),
        declared_output_paths=("drafts/top.sv",),
    )
    tool = next(tool for tool in HarnessToolRegistry().names() if tool == "write_draft")
    from agent_sdk.contracts import EpisodeKind, ToolDefinition

    definition = ToolDefinition(
        name=tool,
        description="write",
        input_schema={"type": "object"},
        episode_kind=EpisodeKind.ACTION,
    )
    call = ToolCall(
        id="write-1",
        name="write_draft",
        arguments={"path": "drafts/top.sv", "content": "module top; endmodule"},
    )

    blocked = await HarnessToolExecutor(HarnessToolRegistry(), context).execute(
        definition, _invocation(call)
    )
    assert blocked.status == "blocked"
    approval_id = blocked.output["approval_id"]
    approvals.submit(approval_id, True, "approved test write")

    approved_context = HarnessExecutionContext(
        **{**context.__dict__, "approval_ids_by_capability": {"draft.write": approval_id}}
    )
    result = await HarnessToolExecutor(HarnessToolRegistry(), approved_context).execute(
        definition, _invocation(call)
    )

    assert result.status == "succeeded"
    assert (tmp_path / "drafts/top.sv").read_text() == "module top; endmodule"


@pytest.mark.anyio
async def test_process_supervisor_records_registered_command_and_timeout(tmp_path: Path):
    supervisor = ProcessSupervisor(
        [
            CommandTemplate(
                name="echo",
                command=[sys.executable, "-c", "print('lint ok')"],
                timeout_seconds=1,
            ),
            CommandTemplate(
                name="slow",
                command=[sys.executable, "-c", "import time; time.sleep(1)"],
                timeout_seconds=0.01,
            ),
        ]
    )

    completed = await supervisor.execute("echo", cwd=tmp_path)
    timed_out = await supervisor.execute("slow", cwd=tmp_path)

    assert completed.return_code == 0
    assert "lint ok" in completed.output
    assert timed_out.timed_out is True


@pytest.mark.anyio
async def test_custom_tool_extension_remains_registered_and_policy_governed(tmp_path: Path):
    async def inspect_manifest(context: HarnessExecutionContext, arguments: dict[str, object]):
        return {
            "run_id": context.run_id,
            "component": arguments["component"],
            "status": "inspected",
        }

    registry = HarnessToolRegistry.with_extensions(
        [RegisteredTool("inspect_manifest", "manifest.inspect", SideEffectClass.READ_ONLY)],
        handlers={"inspect_manifest": inspect_manifest},
    )
    context = HarnessExecutionContext(
        run_id="run-1",
        node_id="node-rtl",
        role="rtl",
        plan_task=_plan_task(),
        run_root=tmp_path,
        artifacts=ArtifactStore(tmp_path),
        policy=CapabilityPolicy([CapabilityGrant(role="rtl", capabilities=["manifest.inspect"])]),
        approvals=ApprovalRegistry(),
        supervisor=ProcessSupervisor(),
    )
    from agent_sdk.contracts import EpisodeKind, ToolDefinition

    call = ToolCall(
        id="inspect-1",
        name="inspect_manifest",
        arguments={"component": "top"},
    )
    result = await HarnessToolExecutor(registry, context).execute(
        ToolDefinition(
            name="inspect_manifest",
            description="Inspect an approved manifest.",
            input_schema={
                "type": "object",
                "properties": {"component": {"type": "string"}},
                "required": ["component"],
                "additionalProperties": False,
            },
            episode_kind=EpisodeKind.EXPLORATORY,
        ),
        _invocation(call),
    )

    assert result.status == "succeeded"
    assert result.output == {"run_id": "run-1", "component": "top", "status": "inspected"}
