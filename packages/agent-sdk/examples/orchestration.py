"""Run a local, approval-gated orchestration with deterministic host bindings.

This example deliberately uses ScriptedModel rather than a provider. Replace only the
host-side binding factory with a real selected provider/tool executor after retaining
the same policy, approval, and graph-state boundaries.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agent_sdk import (
    AgentDefinition,
    AgentExecutionProfile,
    AgentRuntimeServices,
    CapabilityGrant,
    ComplexityRoutingRules,
    GapMetadata,
    GraphAgentBinding,
    GraphAgentBindingContext,
    ModelTier,
    OrchestrationPolicy,
    OrchestrationRequest,
    Orchestrator,
    Plan,
    PlanTask,
    ScopedAgentTask,
    ScriptedModel,
    SharedSubstrateSnapshot,
    SkillContext,
    TaskScope,
    TerminationPolicy,
    UserModelSelection,
    VersionedInstructions,
)


def binding_factory(context: GraphAgentBindingContext) -> GraphAgentBinding:
    """Supply only the executable host binding authorized by the assignment."""

    definition = AgentDefinition(
        identity=context.assignment.agent_identity,
        instructions=VersionedInstructions(
            version="example-v1",
            text="Return a complete structured review of this bounded task.",
        ),
        input_schema={"type": "object", "additionalProperties": False},
        model_binding=context.model.binding,
        output_schema={
            "type": "object",
            "properties": {
                "status": {"const": "complete"},
                "findings": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["status", "findings"],
            "additionalProperties": False,
        },
        termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
    )

    def task_adapter(node, _graph_context) -> ScopedAgentTask:
        return ScopedAgentTask(
            id=node.task_id or node.node_id,
            input={},
            scope=TaskScope(label=context.execution_task.scope),
            locked_interface=context.execution_task.locked_interface,
            instructions=context.execution_task.instructions,
            acceptance_criteria=[context.execution_task.acceptance_criteria],
        )

    def model_factory(_node, _graph_context) -> ScriptedModel:
        return ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}])

    return GraphAgentBinding(
        node_id=context.assignment.node_id,
        definition=definition,
        task_adapter=task_adapter,
        model_factory=model_factory,
        idempotent=True,
    )


async def main() -> None:
    run_root = Path(".agent-runs/orchestration-example")
    policy = OrchestrationPolicy(
        policy_id="rtl-review-policy-v1",
        routing_rules=ComplexityRoutingRules(
            multi_agent_min_categories=2,
            multi_agent_min_blast_radius=3,
            multi_agent_gap_types=["traceability"],
        ),
        skills=[
            SkillContext(
                id="rtl-review",
                version="1.0.0",
                content="Use only source-backed, locked-interface evidence.",
            )
        ],
        models=[
            UserModelSelection(
                model_key="selected-host-model",
                binding={"provider": "host", "model": "replace-with-selected-provider"},
                allowed_tiers=[ModelTier.STANDARD],
            )
        ],
        profiles=[
            AgentExecutionProfile(
                profile_id="rtl-reviewer",
                stage="rtl-development",
                role="rtl-reviewer",
                allowed_skill_ids=["rtl-review"],
                required_skill_ids=["rtl-review"],
                allowed_model_keys=["selected-host-model"],
                allowed_tool_names=[],
                capability_grant=CapabilityGrant(role="rtl-reviewer"),
                max_instances=2,
            )
        ],
        max_total_agents=2,
        max_parallel_agents=1,
        max_repair_attempts=1,
    )
    request = OrchestrationRequest(
        request_id="rtl-review-request-v1",
        stage="rtl-development",
        snapshot=SharedSubstrateSnapshot(
            snapshot_id="locked-rtl-spec-v1",
            version="1.0.0",
            content_hash="example-locked-specification-hash",
            artifact_ids=["specification:rtl"],
        ),
        gap_metadata=GapMetadata(categories_touched=["rtl", "interface"], blast_radius=1),
        plan=Plan(
            plan_id="rtl-review-plan-v1",
            tasks=[
                PlanTask(
                    task_id="review-reset",
                    scope="REQ-RESET",
                    locked_interface={"signals": [{"id": "reset_n"}]},
                    instructions="Review reset requirements.",
                    acceptance_criteria="Return source-backed reset findings.",
                    model_tier=ModelTier.STANDARD,
                ),
                PlanTask(
                    task_id="review-ready",
                    scope="REQ-READY",
                    locked_interface={"signals": [{"id": "ready"}]},
                    instructions="Review ready/valid requirements.",
                    acceptance_criteria="Return source-backed handshake findings.",
                    model_tier=ModelTier.STANDARD,
                ),
            ],
        ),
        selected_skill_ids=["rtl-review"],
        profile_id_by_task_id={
            "review-reset": "rtl-reviewer",
            "review-ready": "rtl-reviewer",
        },
    )

    orchestrator = Orchestrator(run_root, policy)
    prepared = await orchestrator.prepare(request)
    presented = orchestrator.submit_for_approval(prepared.orchestration_id)
    approved = orchestrator.approve(presented.orchestration_id, True, "Example designer approval.")
    completed = await orchestrator.dispatch_and_execute(
        approved.orchestration_id,
        AgentRuntimeServices.open(run_root),
        binding_factory,
    )
    print(
        {
            "orchestration_id": completed.orchestration_id,
            "architecture": completed.architecture.value,
            "status": completed.status.value,
            "graph_run_id": completed.graph_run_id,
        }
    )


if __name__ == "__main__":
    asyncio.run(main())
