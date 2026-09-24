"""Run from the package root with ``uv run python examples/developer_tools_workflow.py``.

This example creates a deterministic local run, then uses the read-only developer
utilities to catalogue the public API and verify the durable evidence. It does not
call an external model, web service, tool executor, or shell command.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agent_sdk import (
    AgentDefinition,
    AgentRuntimeServices,
    ModelBinding,
    ScopedAgentTask,
    ScriptedModel,
    TaskScope,
    TerminationPolicy,
    VersionedInstructions,
)
from agent_sdk.developer_tools import (
    build_public_api_catalog,
    inspect_run,
    validate_contract_file,
    write_public_api_catalog,
)


async def main() -> None:
    root = Path(".developer-tools-example")
    services = AgentRuntimeServices.open(root)
    definition = AgentDefinition(
        identity="Return a complete status.",
        instructions=VersionedInstructions(version="example-v1", text="Complete one task."),
        input_schema={"type": "object", "additionalProperties": False},
        output_schema={
            "type": "object",
            "properties": {"status": {"const": "complete"}},
            "required": ["status"],
            "additionalProperties": False,
        },
        model_binding=ModelBinding(provider="example", model="scripted"),
        termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
    )
    task = ScopedAgentTask(
        id="developer-tools-demo",
        input={},
        scope=TaskScope(label="example"),
        locked_interface={},
        instructions="Return complete.",
        acceptance_criteria=["Return the complete status."],
    )
    result = await services.create_agent(
        definition,
        ScriptedModel([{"type": "final", "output": {"status": "complete"}}]),
    ).run(task)

    catalog_path = root / "public-api.json"
    catalog = write_public_api_catalog(catalog_path)
    definition_path = root / "definition.json"
    definition_path.write_text(definition.model_dump_json(), encoding="utf-8")
    validation = validate_contract_file(definition_path, "agent-definition")
    inspection = inspect_run(root, result.task_id)

    assert result.status.value == "completed"
    assert catalog == build_public_api_catalog()
    assert validation.valid
    assert inspection.telemetry_chain_valid
    assert inspection.audit_chain_valid
    print(f"Catalogued {len(catalog.symbols)} public SDK symbols.")
    print(f"Verified {inspection.event_count} telemetry events for {inspection.run_id}.")


if __name__ == "__main__":
    asyncio.run(main())
