from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.base_agent import AgentWatchdogPolicy, BaseAgent, ToolHookDecision
from agent_sdk.episodes import InMemoryEpisodeGraph
from agent_sdk.model import ScriptedModel
from agent_sdk.project_state import (
    InMemoryProjectStateStore,
    ProjectStateProjectionPolicy,
    StageStateSchema,
    StateAuthority,
    StateEvidence,
    StateTransition,
    StateTransitionKind,
)
from agent_sdk.tools import InMemoryTaskToolExecutor


@pytest.mark.anyio
async def test_runtime_enforces_capabilities_records_episodes_and_verifies_output():
    hook_trace: list[str] = []

    async def pre_hook(context):
        hook_trace.append(f"pre:{context.call.name}")
        return ToolHookDecision(True)

    async def post_hook(context, _result):
        hook_trace.append(f"post:{context.call.name}")

    model = ScriptedModel(
        [
            {
                "type": "tool-call",
                "call": {"id": "read-1", "name": "read_locked_interface", "arguments": {}},
            },
            {
                "type": "tool-call",
                "call": {
                    "id": "echo-1",
                    "name": "echo",
                    "arguments": {"value": "draft checked"},
                    "consumed_episode_ids": ["episode-1"],
                },
            },
            {
                "type": "final",
                "output": {"status": "complete", "findings": ["interface preserved"]},
            },
        ]
    )
    agent = BaseAgent(
        sample_definition(),
        model,
        InMemoryTaskToolExecutor(),
        pre_tool_hooks=[pre_hook],
        post_tool_hooks=[post_hook],
        now=lambda: datetime(2026, 9, 22, 15, 0, tzinfo=UTC),
    )

    result = await agent.run(sample_task())

    assert result.status == "completed"
    assert result.output == {"status": "complete", "findings": ["interface preserved"]}
    assert hook_trace == [
        "pre:read_locked_interface",
        "post:read_locked_interface",
        "pre:echo",
        "post:echo",
    ]
    assert [(episode.kind, episode.dependency_ids) for episode in result.episodes] == [
        ("exploratory", []),
        ("action", ["episode-1"]),
    ]
    assert any(event.type == "verification-completed" for event in result.events)


@pytest.mark.anyio
async def test_undeclared_tool_is_a_typed_failure():
    model = ScriptedModel(
        [{"type": "tool-call", "call": {"id": "unsafe-1", "name": "run_shell", "arguments": {}}}]
    )
    result = await BaseAgent(sample_definition(), model, InMemoryTaskToolExecutor()).run(
        sample_task()
    )

    assert result.status == "failed"
    assert result.reason == 'Tool "run_shell" is not declared for this agent.'
    assert result.context is not None
    assert result.escalation is not None


@pytest.mark.anyio
async def test_verification_gate_rejection_is_terminal():
    model = ScriptedModel([{"type": "final", "output": {"status": "not-complete", "findings": []}}])
    result = await BaseAgent(sample_definition(), model).run(sample_task())

    assert result.status == "failed"
    assert result.iterations == 3
    assert "Maximum iteration limit" in result.reason


@pytest.mark.anyio
async def test_pre_tool_policy_can_block_without_dispatch():
    async def denied(_context):
        return ToolHookDecision(False, "Human approval is required for this action.")

    model = ScriptedModel(
        [
            {
                "type": "tool-call",
                "call": {"id": "echo-1", "name": "echo", "arguments": {"value": "x"}},
            }
        ]
    )
    executor = InMemoryTaskToolExecutor()
    result = await BaseAgent(sample_definition(), model, executor, pre_tool_hooks=[denied]).run(
        sample_task()
    )

    assert result.status == "blocked"
    assert result.reason == "Human approval is required for this action."
    assert executor.calls == []


@pytest.mark.anyio
async def test_model_turn_watchdog_has_a_stable_terminal_reason():
    class SlowModel:
        async def next_turn(self, _context):
            await asyncio.sleep(0.05)
            return {"type": "final", "output": {"status": "complete", "findings": []}}

    result = await BaseAgent(
        sample_definition(),
        SlowModel(),
        watchdog_policy=AgentWatchdogPolicy(model_turn_timeout_seconds=0.001),
    ).run(sample_task())

    assert result.status == "failed"
    assert result.reason == "WATCHDOG_MODEL_TIMEOUT"


@pytest.mark.anyio
async def test_invalid_model_turn_preserves_typed_failure_envelope() -> None:
    class InvalidTurnModel:
        async def next_turn(self, _context):
            return {"type": "unknown-turn"}

    result = await BaseAgent(
        sample_definition(),
        InvalidTurnModel(),
    ).run(sample_task())

    assert result.status == "failed"
    assert result.failure is not None
    assert result.failure.code == "MODEL_TURN_INVALID"
    assert result.failure.details["validation_error"]


@pytest.mark.anyio
async def test_invalid_tool_arguments_preserve_typed_failure_envelope() -> None:
    result = await BaseAgent(
        sample_definition(),
        ScriptedModel(
            [{"type": "tool-call", "call": {"id": "echo-1", "name": "echo", "arguments": {}}}]
        ),
        InMemoryTaskToolExecutor(),
    ).run(sample_task())

    assert result.status == "failed"
    assert result.failure is not None
    assert result.failure.code == "SCHEMA_VALIDATION_FAILED"


@pytest.mark.anyio
async def test_unknown_verification_gate_preserves_typed_failure_envelope() -> None:
    result = await BaseAgent(
        sample_definition(verification_gate_id="local-gate-not-registered"),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
    ).run(sample_task())

    assert result.status == "failed"
    assert result.failure is not None
    assert result.failure.code == "VERIFICATION_GATE_UNKNOWN"


@pytest.mark.anyio
async def test_project_state_budget_exhaustion_is_explicit_not_silent():
    task = sample_task()
    store = InMemoryProjectStateStore()
    store.ensure(task.id, StageStateSchema(schema_id="rtl-v1", stage="rtl-development"))
    store.apply(
        task.id,
        StateTransition(
            kind=StateTransitionKind.HUMAN_DECISION,
            actor=StateAuthority.HUMAN,
            action_id="decision:D-001",
            payload={"decision_id": "D-001", "content": "x" * 2_000, "status": "locked"},
            evidence=[StateEvidence(evidence_id="REQ-1", kind="spec-source")],
        ),
    )
    result = await BaseAgent(
        sample_definition(),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
        project_state_store=store,
        project_state_projection_policy=ProjectStateProjectionPolicy(token_budget=128),
    ).run(task)

    assert result.status == "blocked"
    assert result.reason == (
        "PROJECT_STATE_BUDGET_EXCEEDED: mandatory current-state fields exceed the configured "
        "state token budget."
    )


def test_episode_graph_rejects_action_to_action_dependencies():
    graph = InMemoryEpisodeGraph(lambda: datetime(2026, 9, 22, tzinfo=UTC))
    exploratory = graph.add_exploratory("Read locked interface.")
    action = graph.add_action("Ran deterministic lint.", [exploratory.id])

    with pytest.raises(Exception, match="may depend only on exploratory"):
        graph.add_action("Invalid dependency.", [action.id])
