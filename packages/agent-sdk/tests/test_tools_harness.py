from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from agent_sdk.approvals import ApprovalRegistry
from agent_sdk.artifacts import ArtifactStore
from agent_sdk.contracts import ScopedAgentTask, TaskScope, ToolCall
from agent_sdk.planning import ModelTier, PlanTask
from agent_sdk.policy import CapabilityGrant, CapabilityPolicy, SideEffectClass
from agent_sdk.supervisor import CommandTemplate, ProcessExitKind, ProcessSupervisor
from agent_sdk.tool_registry import (
    HarnessExecutionContext,
    HarnessToolExecutor,
    HarnessToolRegistry,
    RegisteredTool,
)
from agent_sdk.tools import ToolInvocationContext


def _plan_task(*, authorized_artifact_ids: list[str] | None = None) -> PlanTask:
    return PlanTask(
        task_id="rtl-1",
        scope="REQ-RTL-1",
        locked_interface={"signals": []},
        instructions="Write one draft.",
        acceptance_criteria="gate:rtl",
        model_tier=ModelTier.STANDARD,
        authorized_artifact_ids=authorized_artifact_ids or [],
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
    occurrence_id = result.output["occurrence_id"]
    occurrence = approved_context.artifacts.get_occurrence(occurrence_id)
    assert occurrence is not None
    assert occurrence.manifest == {
        "run_id": "run-1",
        "node_id": "node-rtl",
        "task_id": "rtl-1",
    }


def test_artifact_store_preserves_every_same_content_write_occurrence(tmp_path: Path) -> None:
    artifacts = ArtifactStore(tmp_path)
    first = artifacts.write_text(
        "drafts/first.sv",
        "module top; endmodule",
        manifest={"run_id": "run-first", "node_id": "node-first", "task_id": "task-first"},
    )
    second = artifacts.write_text(
        "drafts/second.sv",
        "module top; endmodule",
        manifest={"run_id": "run-second", "node_id": "node-second", "task_id": "task-second"},
    )

    assert first.artifact_id == second.artifact_id
    assert first.occurrence_id != second.occurrence_id
    recovered = ArtifactStore(tmp_path)
    first_occurrence = recovered.get_occurrence(first.occurrence_id or "")
    second_occurrence = recovered.get_occurrence(second.occurrence_id or "")
    assert first_occurrence is not None
    assert second_occurrence is not None
    assert first_occurrence.manifest["run_id"] == "run-first"
    assert second_occurrence.manifest["run_id"] == "run-second"


@pytest.mark.anyio
async def test_declared_artifact_diff_requires_both_authorization_or_current_draft_proof(
    tmp_path: Path,
) -> None:
    from agent_sdk.contracts import EpisodeKind, ToolDefinition

    artifacts = ArtifactStore(tmp_path)
    base = artifacts.write_text("inputs/base.sv", "module top; endmodule")
    unrelated = artifacts.write_text("inputs/private.sv", "confidential")
    context = HarnessExecutionContext(
        run_id="run-1",
        node_id="node-rtl",
        role="rtl",
        plan_task=_plan_task(authorized_artifact_ids=[base.artifact_id]),
        run_root=tmp_path,
        artifacts=artifacts,
        policy=CapabilityPolicy(
            [
                CapabilityGrant(
                    role="rtl",
                    capabilities=["artifact.diff"],
                )
            ]
        ),
        approvals=ApprovalRegistry(),
        supervisor=ProcessSupervisor(),
        declared_output_paths=("drafts/top.sv",),
    )
    definition = ToolDefinition(
        name="diff_declared_artifacts",
        description="diff",
        input_schema={"type": "object"},
        episode_kind=EpisodeKind.EXPLORATORY,
    )
    blocked = await HarnessToolExecutor(HarnessToolRegistry(), context).execute(
        definition,
        _invocation(
            ToolCall(
                id="diff-private",
                name="diff_declared_artifacts",
                arguments={
                    "base_artifact_id": base.artifact_id,
                    "draft_artifact_id": unrelated.artifact_id,
                },
            )
        ),
    )
    assert blocked.status == "failed"
    assert "current-task occurrence proof" in (blocked.error or "")
    assert "confidential" not in str(blocked.output)

    draft = artifacts.write_text(
        "drafts/top.sv",
        "module top(input logic clk); endmodule",
        manifest={"run_id": "run-1", "node_id": "node-rtl", "task_id": "rtl-1"},
    )
    permitted = await HarnessToolExecutor(HarnessToolRegistry(), context).execute(
        definition,
        _invocation(
            ToolCall(
                id="diff-draft",
                name="diff_declared_artifacts",
                arguments={
                    "base_artifact_id": base.artifact_id,
                    "draft_artifact_id": draft.artifact_id,
                    "draft_occurrence_id": draft.occurrence_id,
                },
            )
        ),
    )
    assert permitted.status == "succeeded"
    assert "input logic clk" in permitted.output["unified_diff"]


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
async def test_process_supervisor_returns_typed_record_after_cancellation(tmp_path: Path) -> None:
    supervisor = ProcessSupervisor(
        [
            CommandTemplate(
                name="slow",
                command=[sys.executable, "-c", "import time; time.sleep(5)"],
                timeout_seconds=10,
            )
        ]
    )
    execution = asyncio.create_task(supervisor.execute("slow", cwd=tmp_path))
    await asyncio.sleep(0.05)
    execution.cancel()
    record = await execution

    assert record.exit_kind is ProcessExitKind.CANCELLED
    assert record.error_code == "PROCESS_CANCELLED"
    assert record.termination_path


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
