from __future__ import annotations

import asyncio

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.base_agent import BaseAgent
from agent_sdk.context import assemble_initial_context
from agent_sdk.context_projection import (
    ContextProjectionPolicy,
    ContextProjector,
    InMemoryToolResultJournal,
)
from agent_sdk.contracts import FinalTurn, ToolCallTurn, ToolExecutionResult
from agent_sdk.memory import CompactionStatus, InMemoryEpisodeStore
from agent_sdk.model import ModelContext, ModelTurnResponse, ProviderContinuation, ScriptedModel
from agent_sdk.tools import InMemoryTaskToolExecutor


@pytest.mark.anyio
async def test_batch_schedules_parallel_reads_then_serial_dependent_action():
    definition = sample_definition(
        tools=[
            {
                **tool.model_dump(mode="json"),
                "concurrency": "parallel-safe",
            }
            if tool.name == "read_locked_interface"
            else tool.model_dump(mode="json")
            for tool in sample_definition().tools
        ]
    )
    started: list[str] = []
    finished: list[str] = []

    class TimedExecutor(InMemoryTaskToolExecutor):
        async def execute(self, tool, context):
            started.append(context.call.id)
            if context.call.name == "read_locked_interface":
                await asyncio.sleep(0.01)
            result = await super().execute(tool, context)
            finished.append(context.call.id)
            return result

    model = ScriptedModel(
        [
            {
                "type": "tool-batch",
                "calls": [
                    {"id": "read-a", "name": "read_locked_interface", "arguments": {}},
                    {"id": "read-b", "name": "read_locked_interface", "arguments": {}},
                    {
                        "id": "echo-c",
                        "name": "echo",
                        "arguments": {"value": "ready"},
                        "depends_on_call_ids": ["read-a", "read-b"],
                    },
                ],
            },
            {"type": "final", "output": {"status": "complete", "findings": ["batched"]}},
        ]
    )

    result = await BaseAgent(definition, model, TimedExecutor()).run(sample_task())

    assert result.status == "completed"
    assert result.iterations == 2
    assert started[:2] == ["read-a", "read-b"]
    assert finished.index("echo-c") > finished.index("read-a")
    assert finished.index("echo-c") > finished.index("read-b")
    second_context = model.calls[1]
    assert second_context.observations == ()
    assert second_context.episodes == ()
    assert second_context.project_state.revision == 3
    assert second_context.project_state.last_action is not None
    assert second_context.project_state.last_action.action_id == "echo-c"
    assert any(event.type == "tool-batch-completed" for event in result.events)


@pytest.mark.anyio
async def test_parallel_safe_calls_run_concurrently():
    definition = sample_definition(
        tools=[
            {
                **tool.model_dump(mode="json"),
                "concurrency": "parallel-safe",
            }
            for tool in sample_definition().tools
        ]
    )
    active = 0
    peak_active = 0

    class ConcurrentExecutor(InMemoryTaskToolExecutor):
        async def execute(self, tool, context):
            nonlocal active, peak_active
            active += 1
            peak_active = max(peak_active, active)
            try:
                await asyncio.sleep(0.01)
                return await super().execute(tool, context)
            finally:
                active -= 1

    model = ScriptedModel(
        [
            {
                "type": "tool-batch",
                "calls": [
                    {"id": "read-a", "name": "read_locked_interface", "arguments": {}},
                    {"id": "read-b", "name": "read_locked_interface", "arguments": {}},
                ],
            },
            {"type": "final", "output": {"status": "complete", "findings": []}},
        ]
    )

    result = await BaseAgent(definition, model, ConcurrentExecutor()).run(sample_task())

    assert result.status == "completed"
    assert peak_active == 2


def test_batch_contract_rejects_unknown_or_cyclic_dependencies():
    from pydantic import ValidationError

    from agent_sdk.contracts import ToolBatchTurn

    with pytest.raises(ValidationError, match="unknown batch call IDs"):
        ToolBatchTurn.model_validate(
            {
                "type": "tool-batch",
                "calls": [
                    {
                        "id": "one",
                        "name": "read_locked_interface",
                        "arguments": {},
                        "depends_on_call_ids": ["missing"],
                    }
                ],
            }
        )
    with pytest.raises(ValidationError, match="acyclic"):
        ToolBatchTurn.model_validate(
            {
                "type": "tool-batch",
                "calls": [
                    {
                        "id": "one",
                        "name": "read_locked_interface",
                        "arguments": {},
                        "depends_on_call_ids": ["two"],
                    },
                    {
                        "id": "two",
                        "name": "read_locked_interface",
                        "arguments": {},
                        "depends_on_call_ids": ["one"],
                    },
                ],
            }
        )


@pytest.mark.anyio
async def test_projection_bounds_raw_tool_result_and_preserves_journal_handle():
    class LargeResultExecutor(InMemoryTaskToolExecutor):
        async def execute(self, tool, context):
            if tool.name == "read_locked_interface":
                return ToolExecutionResult(status="succeeded", output={"log": "x" * 5_000})
            return await super().execute(tool, context)

    journal = InMemoryToolResultJournal()
    model = ScriptedModel(
        [
            {
                "type": "tool-call",
                "call": {"id": "read-a", "name": "read_locked_interface", "arguments": {}},
            },
            {"type": "final", "output": {"status": "complete", "findings": []}},
        ]
    )
    agent = BaseAgent(
        sample_definition(),
        model,
        LargeResultExecutor(),
        result_journal=journal,
        context_projection_policy=ContextProjectionPolicy(
            context_token_budget=4_000,
            episode_token_budget=2_000,
            tool_result_preview_chars=80,
        ),
    )

    result = await agent.run(sample_task())

    assert result.status == "completed"
    assert model.calls[1].observations == ()
    assert model.calls[1].project_state.last_action is not None
    assert model.calls[1].project_state.last_action.evidence[0].evidence_id == "result-1"
    assert "x" * 500 not in str(model.calls[1].project_state.last_action.summary)
    assert journal.read("result-1")["result"]["output"]["log"] == "x" * 5_000


@pytest.mark.anyio
async def test_context_projector_compacts_old_unprotected_episode_and_observation():
    model = ScriptedModel(
        [
            {
                "type": "tool-call",
                "call": {"id": "read-a", "name": "read_locked_interface", "arguments": {}},
            },
            {
                "type": "tool-call",
                "call": {"id": "read-b", "name": "read_locked_interface", "arguments": {}},
            },
            {"type": "final", "output": {"status": "complete", "findings": []}},
        ]
    )
    agent = BaseAgent(
        sample_definition(),
        model,
        InMemoryTaskToolExecutor(),
        context_projection_policy=ContextProjectionPolicy(
            context_token_budget=4_000,
            episode_token_budget=0,
            tool_result_preview_chars=128,
        ),
    )

    result = await agent.run(sample_task())

    assert result.status == "completed"
    assert model.calls[1].observations == ()
    assert model.calls[2].observations == ()
    assert model.calls[2].project_state.revision == 2
    assert any(event.type == "context-compacted" for event in result.events)


@pytest.mark.anyio
async def test_provider_continuation_is_forwarded_without_interpretation():
    class ContinuationModel:
        def __init__(self):
            self.contexts: list[ModelContext] = []

        async def next_turn(self, context: ModelContext):
            self.contexts.append(context)
            if context.iteration == 1:
                return ModelTurnResponse(
                    turn=ToolCallTurn.model_validate(
                        {
                            "type": "tool-call",
                            "call": {
                                "id": "read-a",
                                "name": "read_locked_interface",
                                "arguments": {},
                            },
                        }
                    ),
                    continuation=ProviderContinuation(
                        provider="test-provider", state={"opaque_response_id": "r-1"}
                    ),
                )
            assert context.continuation == ProviderContinuation(
                provider="test-provider", state={"opaque_response_id": "r-1"}
            )
            return FinalTurn(output={"status": "complete", "findings": []})

    model = ContinuationModel()
    result = await BaseAgent(sample_definition(), model, InMemoryTaskToolExecutor()).run(
        sample_task()
    )

    assert result.status == "completed"
    assert model.contexts[1].continuation is not None


def test_context_projector_marks_only_protected_overflow_without_deadlock():
    memory = InMemoryEpisodeStore()
    record = memory.open_exploratory("worker", content={"log": "x" * 1_000})
    memory.close(record.id, description="large live observation")
    projection = ContextProjector(
        ContextProjectionPolicy(
            context_token_budget=4_000,
            episode_token_budget=0,
            tool_result_preview_chars=64,
        )
    ).project(
        assemble_initial_context(sample_definition(), sample_task()),
        (),
        (),
        memory,
        frozenset({record.id}),
    )

    assert projection.compaction.status is CompactionStatus.PROTECTED_OVER_BUDGET
