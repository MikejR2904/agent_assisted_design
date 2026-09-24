"""Run from package root: ``uv run python examples/durable_runtime_with_pask.py``.

The example is deterministic: replace ``ScriptedModel`` with a host-owned
``AgentModel`` adapter before connecting a real provider. PASK remains local and
auditable; this example does not select a provider or grant any tool capability.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agent_sdk import (
    AgentDefinition,
    AgentRuntimeServices,
    CompactionStrategy,
    InMemoryEpisodeStore,
    ModelBinding,
    PaskCompactionPolicy,
    ScopedAgentTask,
    ScriptedModel,
    TaskScope,
    TerminationPolicy,
    VersionedInstructions,
)


async def main() -> None:
    services = AgentRuntimeServices.open(Path(".agent-runtime-example"))
    definition = AgentDefinition(
        identity="Complete a one-turn durable SDK example.",
        instructions=VersionedInstructions(version="1.0.0", text="Return structured completion."),
        input_schema={"type": "object", "additionalProperties": False},
        output_schema={
            "type": "object",
            "properties": {"status": {"const": "complete"}},
            "required": ["status"],
            "additionalProperties": False,
        },
        model_binding=ModelBinding(provider="replace-me", model="replace-me"),
        termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
    )
    task = ScopedAgentTask(
        id="durable-pask-example",
        input={},
        scope=TaskScope(label="example"),
        locked_interface={},
        instructions="Return the required structured status.",
        acceptance_criteria=["The status must be complete."],
    )
    agent = services.create_agent(
        definition,
        ScriptedModel([{"type": "final", "output": {"status": "complete"}}]),
        episode_store_factory=lambda: InMemoryEpisodeStore(
            compaction_policy=PaskCompactionPolicy(strategy=CompactionStrategy.PASK)
        ),
    )
    result = await agent.run(task)

    assert result.status.value == "completed", result.reason
    print(f"status={result.status.value} run_root={services.run_root}")


if __name__ == "__main__":
    asyncio.run(main())
