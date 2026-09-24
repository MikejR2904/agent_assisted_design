from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.contracts import SkillContext
from agent_sdk.graph_agent_executor import GraphAgentBinding
from agent_sdk.integrations import JevArchitectureAdvice
from agent_sdk.model import ScriptedModel
from agent_sdk.orchestration import (
    ComplexityRoutingRules,
    GapMetadata,
    WorkflowArchitecture,
)
from agent_sdk.orchestrator import (
    AgentExecutionProfile,
    OrchestrationPolicy,
    OrchestrationRequest,
    OrchestrationStatus,
    Orchestrator,
    UserModelSelection,
)
from agent_sdk.planning import ModelTier, Plan, PlanTask
from agent_sdk.policy import CapabilityGrant
from agent_sdk.runtime import AgentRuntimeServices
from agent_sdk.shared_state import SharedSubstrateSnapshot, canonical_hash


def _plan(task_ids: list[str]) -> Plan:
    return Plan(
        plan_id="orchestration-plan",
        tasks=[
            PlanTask(
                task_id=task_id,
                scope=f"REQ-{task_id}",
                locked_interface={"signals": []},
                instructions=f"Complete bounded task {task_id}.",
                acceptance_criteria="Return a complete structured result.",
                model_tier=ModelTier.STANDARD,
            )
            for task_id in task_ids
        ],
    )


def _policy(*, max_instances: int = 2) -> OrchestrationPolicy:
    return OrchestrationPolicy(
        policy_id="user-policy-v1",
        routing_rules=ComplexityRoutingRules(
            multi_agent_min_categories=2,
            multi_agent_min_blast_radius=3,
            multi_agent_gap_types=["traceability"],
        ),
        skills=[
            SkillContext(
                id="rtl-skill",
                version="1.0.0",
                content="Use the locked interface and report structured findings.",
            )
        ],
        models=[
            UserModelSelection(
                model_key="standard-model",
                binding={"provider": "test", "model": "standard"},
                allowed_tiers=[ModelTier.STANDARD],
            )
        ],
        profiles=[
            AgentExecutionProfile(
                profile_id="rtl-worker",
                role="rtl-worker",
                stage="rtl-development",
                allowed_skill_ids=["rtl-skill"],
                required_skill_ids=["rtl-skill"],
                allowed_model_keys=["standard-model"],
                allowed_tool_names=["read_file"],
                capability_grant=CapabilityGrant(
                    role="rtl-worker",
                    capabilities=["filesystem.read"],
                    allowed_paths=["rtl"],
                ),
                max_instances=max_instances,
            )
        ],
        max_total_agents=4,
    )


def _request(task_ids: list[str], gap: GapMetadata) -> OrchestrationRequest:
    return OrchestrationRequest(
        request_id="request-1",
        stage="rtl-development",
        snapshot=SharedSubstrateSnapshot(
            snapshot_id="spec-v1",
            version="1.0.0",
            content_hash=canonical_hash({"specification": "locked"}),
        ),
        plan=_plan(task_ids),
        gap_metadata=gap,
        selected_skill_ids=["rtl-skill"],
    )


def _binding_factory(context):
    definition = sample_definition(
        identity=context.assignment.agent_identity,
        model_binding=context.model.binding.model_dump(mode="json"),
        tools=[
            {
                "name": "read_file",
                "description": "Read a permitted project file.",
                "input_schema": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
                "episode_kind": "exploratory",
            }
        ],
    )

    def task_adapter(node, _graph_context):
        return sample_task(
            id=node.task_id or node.node_id,
            instructions="Complete the user-approved scoped assignment.",
        )

    def model_factory(_node, _graph_context):
        return ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}])

    return GraphAgentBinding(
        node_id=context.assignment.node_id,
        definition=definition,
        task_adapter=task_adapter,
        model_factory=model_factory,
        idempotent=True,
    )


@pytest.mark.anyio
async def test_orchestrator_executes_user_authorized_multi_agent_workers(tmp_path):
    orchestrator = Orchestrator(tmp_path, _policy())
    request = _request(
        ["rtl-a", "rtl-b"],
        GapMetadata(categories_touched=["architecture", "interface"], blast_radius=0),
    )

    prepared = await orchestrator.prepare(request)

    assert prepared.architecture is WorkflowArchitecture.MULTI_AGENT
    assert len(prepared.assignments) == 2
    assert {item.agent_identity for item in prepared.assignments} == {
        "rtl-worker:rtl-a",
        "rtl-worker:rtl-b",
    }
    presented = orchestrator.submit_for_approval(prepared.orchestration_id)
    approved = orchestrator.approve(presented.orchestration_id, True, "Designer approved.")
    executed = await orchestrator.dispatch_and_execute(
        approved.orchestration_id,
        AgentRuntimeServices.open(tmp_path),
        _binding_factory,
    )

    assert executed.status is OrchestrationStatus.EXECUTED
    assert executed.graph_run_id is not None
    project_state = orchestrator.controller_runtime().project_state(executed.controller_id or "")
    assert {item.work_item_id: item.status for item in project_state.work_items} == {
        "node:rtl-a": "completed",
        "node:rtl-b": "completed",
    }


@pytest.mark.anyio
async def test_orchestrator_enforces_policy_parallel_worker_limit(tmp_path):
    policy = _policy().model_copy(update={"max_parallel_agents": 1})
    orchestrator = Orchestrator(tmp_path, policy)
    prepared = await orchestrator.prepare(
        _request(
            ["rtl-a", "rtl-b"],
            GapMetadata(categories_touched=["architecture", "interface"], blast_radius=0),
        )
    )
    approved = orchestrator.approve(
        orchestrator.submit_for_approval(prepared.orchestration_id).orchestration_id,
        True,
    )
    tracker = {"active": 0, "maximum": 0}

    class TrackingModel(ScriptedModel):
        async def next_turn(self, context):
            tracker["active"] += 1
            tracker["maximum"] = max(tracker["maximum"], tracker["active"])
            try:
                await asyncio.sleep(0.01)
                return await super().next_turn(context)
            finally:
                tracker["active"] -= 1

    def limited_factory(context):
        binding = _binding_factory(context)

        def model_factory(_node, _graph_context):
            return TrackingModel([{"type": "final", "output": {"status": "complete"}}])

        return replace(binding, model_factory=model_factory)

    await orchestrator.dispatch_and_execute(
        approved.orchestration_id,
        AgentRuntimeServices.open(tmp_path),
        limited_factory,
    )

    assert tracker["maximum"] == 1


@pytest.mark.anyio
async def test_orchestrator_uses_explicit_policy_repair_limit(tmp_path):
    policy = _policy().model_copy(update={"max_repair_attempts": 3})
    orchestrator = Orchestrator(tmp_path, policy)
    prepared = await orchestrator.prepare(
        _request(["rtl-a"], GapMetadata(categories_touched=["implementation"], blast_radius=0))
    )

    submitted = orchestrator.submit_for_approval(prepared.orchestration_id)
    controller = orchestrator.controller_runtime().get_controller(submitted.controller_id or "")

    assert controller.max_repair_attempts == 3


@pytest.mark.anyio
async def test_jev_can_lift_but_not_lower_deterministic_architecture(tmp_path):
    class LiftRouter:
        async def advise(self, **kwargs):
            assert kwargs["deterministic_architecture"] == "single-agent"
            return JevArchitectureAdvice(
                deterministic_architecture="single-agent",
                architecture="multi-agent",
                used_deterministic_fallback=False,
                reason="Bounded Jev advisory identified independently scoped work.",
            )

    orchestrator = Orchestrator(tmp_path, _policy(), jev_router=LiftRouter())
    prepared = await orchestrator.prepare(
        _request(["rtl-a"], GapMetadata(categories_touched=["implementation"], blast_radius=0))
    )

    assert prepared.deterministic_architecture is WorkflowArchitecture.SINGLE_AGENT
    assert prepared.architecture is WorkflowArchitecture.MULTI_AGENT
    presented = orchestrator.submit_for_approval(prepared.orchestration_id)
    assert presented.controller_id is not None
    controller = orchestrator.controller_runtime().get_controller(presented.controller_id)
    assert controller.architecture is WorkflowArchitecture.MULTI_AGENT


@pytest.mark.anyio
async def test_orchestrator_rejects_host_binding_that_changes_user_model(tmp_path):
    orchestrator = Orchestrator(tmp_path, _policy())
    prepared = await orchestrator.prepare(
        _request(["rtl-a"], GapMetadata(categories_touched=["implementation"], blast_radius=0))
    )
    presented = orchestrator.submit_for_approval(prepared.orchestration_id)
    approved = orchestrator.approve(presented.orchestration_id, True)

    def invalid_factory(context):
        binding = _binding_factory(context)
        return replace(
            binding,
            definition=binding.definition.model_copy(
                update={"model_binding": {"provider": "test", "model": "unauthorized"}}
            ),
        )

    with pytest.raises(ValueError, match="model"):
        await orchestrator.dispatch_and_execute(
            approved.orchestration_id,
            AgentRuntimeServices.open(tmp_path),
            invalid_factory,
        )


def test_orchestrator_rejects_profile_tool_without_matching_capability(tmp_path):
    policy = _policy().model_copy(
        update={
            "profiles": [
                _policy().profiles[0].model_copy(update={"allowed_tool_names": ["run_yosys"]})
            ]
        }
    )

    with pytest.raises(ValueError, match="lacks capability"):
        Orchestrator(tmp_path, policy)


@pytest.mark.anyio
async def test_orchestrator_rejects_collapsed_tasks_with_conflicting_profile_selection(tmp_path):
    second_profile = (
        _policy().profiles[0].model_copy(update={"profile_id": "rtl-worker-2", "max_instances": 2})
    )
    policy = _policy().model_copy(update={"profiles": [_policy().profiles[0], second_profile]})
    request = _request(
        ["rtl-a", "rtl-b"], GapMetadata(categories_touched=["implementation"], blast_radius=0)
    )
    request = request.model_copy(
        update={"profile_id_by_task_id": {"rtl-a": "rtl-worker", "rtl-b": "rtl-worker-2"}}
    )

    with pytest.raises(ValueError, match="collapsed"):
        await Orchestrator(tmp_path, policy).prepare(request)


@pytest.mark.anyio
async def test_orchestrator_rejects_a_runtime_root_split(tmp_path):
    orchestrator = Orchestrator(tmp_path, _policy())
    prepared = await orchestrator.prepare(
        _request(["rtl-a"], GapMetadata(categories_touched=["implementation"], blast_radius=0))
    )
    presented = orchestrator.submit_for_approval(prepared.orchestration_id)
    approved = orchestrator.approve(presented.orchestration_id, True)

    with pytest.raises(ValueError, match="run_root"):
        await orchestrator.dispatch_and_execute(
            approved.orchestration_id,
            AgentRuntimeServices.open(tmp_path / "another-runtime"),
            _binding_factory,
        )


@pytest.mark.anyio
async def test_jev_cannot_lower_a_deterministic_multi_agent_route(tmp_path):
    class InvalidLowerRouter:
        async def advise(self, **_kwargs):
            return JevArchitectureAdvice(
                deterministic_architecture="multi-agent",
                architecture="single-agent",
                used_deterministic_fallback=False,
                reason="This should never be accepted.",
            )

    orchestrator = Orchestrator(tmp_path, _policy(), jev_router=InvalidLowerRouter())
    with pytest.raises(ValueError, match="may not lower"):
        await orchestrator.prepare(
            _request(
                ["rtl-a", "rtl-b"],
                GapMetadata(categories_touched=["architecture", "interface"], blast_radius=0),
            )
        )
