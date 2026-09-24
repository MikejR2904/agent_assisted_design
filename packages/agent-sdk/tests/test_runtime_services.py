from __future__ import annotations

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.model import ScriptedModel
from agent_sdk.runtime import AgentRuntimeServices


@pytest.mark.anyio
async def test_runtime_services_create_durable_observed_agent(tmp_path):
    services = AgentRuntimeServices.open(tmp_path / "run")
    task = sample_task()
    agent = services.create_agent(
        sample_definition(),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
    )

    result = await agent.run(task)

    assert result.status.value == "completed"
    assert result.profile is not None
    assert services.telemetry.database_path.is_file()
    assert (services.run_root / ".agent-project-state").is_dir()
    assert (services.run_root / ".agent-audit-logs").is_dir()
    assert services.audit_logs.verify(task.id)
    assert services.telemetry.list_events(task.id)
