from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.audit_log import AuditTranscriptStore
from agent_sdk.base_agent import BaseAgent
from agent_sdk.contracts import FinalTurn
from agent_sdk.model import ModelContext, ModelTurnResponse, ProviderUsage
from agent_sdk.telemetry import TelemetryActor, TelemetryAuthority, TelemetryContext, TelemetryStore


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


def test_telemetry_verifies_complete_chain_and_detects_suffix_tampering(tmp_path: Path) -> None:
    store = TelemetryStore(tmp_path)
    context = TelemetryContext(run_id="run-complete-chain")
    actor = TelemetryActor(kind="system", identifier="test", role="test")
    for sequence in range(1_001):
        store.emit(
            "test.event",
            context,
            actor=actor,
            authority=TelemetryAuthority.DETERMINISTIC,
            status="completed",
            payload={"sequence": sequence},
        )

    report = store.create_run_report(context.run_id)
    assert report["event_count"] == 1_001
    assert report["verified_event_count"] == 1_001
    assert store.verify_run_chain(context.run_id)

    with store._connection as connection:  # noqa: SLF001 - verifies persisted integrity boundary.
        serialized = str(
            connection.execute(
                "SELECT event_json FROM events WHERE run_id = ? AND sequence = ?",
                (context.run_id, 1_001),
            ).fetchone()[0]
        )
        tampered = json.loads(serialized)
        tampered["integrity_hash"] = "0" * 64
        connection.execute(
            "UPDATE events SET event_json = ? WHERE run_id = ? AND sequence = ?",
            (json.dumps(tampered), context.run_id, 1_001),
        )
        connection.commit()
    assert not store.verify_run_chain(context.run_id)


def test_audit_verifies_complete_chain_and_detects_suffix_tampering(tmp_path: Path) -> None:
    store = AuditTranscriptStore(tmp_path)
    for sequence in range(1_001):
        store.append("run-complete-audit", "test-event", {"sequence": sequence})

    assert store.entry_count("run-complete-audit") == 1_001
    assert store.verify("run-complete-audit")

    path = tmp_path / ".agent-audit-logs" / "run-complete-audit.jsonl"
    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[-1])
    tampered["integrity_hash"] = "0" * 64
    lines[-1] = json.dumps(tampered, sort_keys=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert not store.verify("run-complete-audit")


def test_integrity_verification_uses_fixed_sequence_boundaries(tmp_path: Path) -> None:
    telemetry = TelemetryStore(tmp_path / "telemetry")
    context = TelemetryContext(run_id="run-boundary")
    actor = TelemetryActor(kind="system", identifier="test", role="test")
    for value in range(2):
        telemetry.emit(
            "test.event",
            context,
            actor=actor,
            authority=TelemetryAuthority.DETERMINISTIC,
            status="completed",
            payload={"value": value},
        )
    telemetry_boundary = telemetry.run_snapshot_sequence(context.run_id)
    telemetry.emit(
        "test.event",
        context,
        actor=actor,
        authority=TelemetryAuthority.DETERMINISTIC,
        status="completed",
        payload={"value": "after-boundary"},
    )
    assert [
        event.sequence
        for event in telemetry.iter_events(context.run_id, through_sequence=telemetry_boundary)
    ] == [1, 2]

    audit = AuditTranscriptStore(tmp_path / "audit")
    audit.append("run-boundary", "test-event", {"value": 1})
    audit_boundary = audit.snapshot_sequence("run-boundary")
    audit.append("run-boundary", "test-event", {"value": "after-boundary"})
    assert [
        entry.sequence
        for entry in audit.iter_entries("run-boundary", through_sequence=audit_boundary)
    ] == [1]
