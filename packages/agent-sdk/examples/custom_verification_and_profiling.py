"""Run from the package root with: uv run python examples/custom_verification_and_profiling.py.

The example uses ScriptedModel only to make the extension boundary reproducible. Replace it
with an AgentModel implementation that calls the provider selected by the embedding project.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agent_sdk import (
    AgentDefinition,
    AgentRunProfiler,
    BaseAgent,
    ModelBinding,
    ScopedAgentTask,
    ScriptedModel,
    TaskScope,
    TerminationPolicy,
    VerificationContext,
    VerificationGateRegistry,
    VersionedInstructions,
)


async def require_named_check(
    context: VerificationContext,
    required_check: str,
) -> tuple[bool, str | None]:
    """A consumer-owned gate with fixed local configuration."""

    checks = context.output.get("checks", []) if isinstance(context.output, dict) else []
    if required_check in checks:
        return True, None
    return False, f'Required check "{required_check}" was not reported.'


async def main() -> None:
    gates = VerificationGateRegistry()
    gates.register_callable("require-lint-check", require_named_check, "lint")
    profiler = AgentRunProfiler()
    definition = AgentDefinition(
        identity="Validate one reusable SDK integration example.",
        instructions=VersionedInstructions(version="1.0.0", text="Return structured completion."),
        input_schema={"type": "object", "additionalProperties": False},
        output_schema={
            "type": "object",
            "properties": {
                "status": {"const": "complete"},
                "checks": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["status", "checks"],
            "additionalProperties": False,
        },
        model_binding=ModelBinding(provider="replace-me", model="replace-me"),
        termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
        verification_gate_id="require-lint-check",
    )
    task = ScopedAgentTask(
        id="external-sdk-example",
        input={},
        scope=TaskScope(label="sdk-example", boundaries={"stage": "verification"}),
        locked_interface={},
        instructions="Run the supplied local acceptance policy.",
        acceptance_criteria=["Report the lint check."],
    )
    result = await BaseAgent(
        definition,
        ScriptedModel([{"type": "final", "output": {"status": "complete", "checks": ["lint"]}}]),
        verification_gates=gates,
        profiler=profiler,
    ).run(task)

    assert result.status.value == "completed", result.reason
    profile_path = profiler.write_json(Path("agent-run-profile.json"))
    print(f"status={result.status.value} profile={profile_path}")


if __name__ == "__main__":
    asyncio.run(main())
