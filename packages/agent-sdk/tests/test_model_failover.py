from __future__ import annotations

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.model import FailoverAgentModel, ModelContext, ScriptedModel
from agent_sdk.project_state import (
    ProjectStateProjector,
    StageStateSchema,
    make_project_state,
)


class FailingModel:
    async def next_turn(self, _context: ModelContext):
        raise RuntimeError("rate limited")


@pytest.mark.anyio
async def test_failover_model_uses_next_adapter_after_primary_failure():
    from agent_sdk.context import assemble_initial_context

    task = sample_task()
    context = ModelContext(
        task=task,
        prompt=assemble_initial_context(sample_definition(), task),
        iteration=1,
        project_state=ProjectStateProjector().project(
            make_project_state(
                project_id=task.id,
                revision=0,
                stage_schema=StageStateSchema(schema_id="test-v1", stage="test"),
            )
        ),
        observations=(),
        episodes=(),
    )
    model = FailoverAgentModel(
        [
            FailingModel(),
            ScriptedModel([{"type": "blocked", "reason": "fallback answered"}]),
        ]
    )

    turn = await model.next_turn(context)

    assert turn.type == "blocked"
    assert turn.reason == "fallback answered"
    assert [attempt.index for attempt in model.attempts] == [0]
