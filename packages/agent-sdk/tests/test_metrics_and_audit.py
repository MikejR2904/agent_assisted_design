from __future__ import annotations

from pathlib import Path

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.audit_log import AuditTranscriptStore
from agent_sdk.base_agent import BaseAgent
from agent_sdk.contracts import FinalTurn
from agent_sdk.model import ModelContext, ModelTurnResponse, ProviderUsage
from agent_sdk.telemetry import TelemetryStore


class UsageModel:
    async def next_turn(self, _context: ModelContext) -> ModelTurnResponse:
        return ModelTurnResponse(
            turn=FinalTurn(output={"status": "complete", "findings": ["verified"]}),
            usage=ProviderUsage(
                input_tokens=17,
                output_tokens=5,
                cached_input_tokens=3,
                context_window_tokens=128,
                request_id="provider-request-1",
            ),
        )


@pytest.mark.anyio
async def test_agent_records_attempt_context_provider_metrics_and_redacted_audit_log(
    tmp_path: Path,
) -> None:
    telemetry = TelemetryStore(tmp_path)
    audit = AuditTranscriptStore(tmp_path, max_payload_chars=512)
    result = await BaseAgent(
        sample_definition(),
        UsageModel(),
        telemetry=telemetry,
        audit_logs=audit,
    ).run(sample_task())

    assert result.status.value == "completed"
    by_id = {}
    for observation in telemetry.list_metrics(sample_task().id):
        by_id.setdefault(observation.metric_id, []).append(observation)
    assert by_id["agent.model_turn_attempt_count"][-1].value == 1
    assert by_id["context.remaining_working_budget_tokens"][-1].value is not None
    assert by_id["model.provider_input_tokens"][-1].value == 17
    assert by_id["model.provider_remaining_context_tokens"][-1].value == 111
    assert by_id["model.provider_reasoning_tokens"][-1].availability.value == "unavailable"
    assert "context.exact_pckp_compaction_count" not in by_id
    report = telemetry.create_run_report(sample_task().id)
    assert report["metric_summary"]["agent.model_turn_attempt_count"]["value"] == 1
    assert report["metric_summary"]["model.provider_reasoning_tokens"]["value"] is None
    assert audit.verify(sample_task().id)
    entries = audit.list_entries(sample_task().id)
    assert any(entry.event_type == "task-received" for entry in entries)
    assert any(entry.event_type == "model-turn" for entry in entries)
    transcript = audit.render_markdown(sample_task().id)
    assert transcript.is_file()


def test_audit_log_redacts_secrets_and_rejects_hidden_reasoning(tmp_path: Path) -> None:
    store = AuditTranscriptStore(tmp_path)
    entry = store.append(
        "run-1",
        "tool-result",
        {"api_key": "must-not-appear", "output": "ok"},
    )
    assert entry.payload["api_key"] == "[REDACTED]"
    assert store.verify("run-1")
    with pytest.raises(ValueError, match="hidden model reasoning"):
        store.append("run-1", "model-output", {"scratchpad": "private"})
