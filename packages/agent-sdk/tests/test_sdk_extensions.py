from __future__ import annotations

import asyncio
import json

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.base_agent import AgentWatchdogPolicy, BaseAgent
from agent_sdk.model import ScriptedModel
from agent_sdk.profiler import AgentRunProfiler, ProfileSpanKind, ProfileSpanStatus
from agent_sdk.telemetry import TelemetryContext, TelemetryStore
from agent_sdk.verification import VerificationGateRegistry


@pytest.mark.anyio
async def test_consumer_callable_verification_gate_receives_context_and_fixed_arguments():
    observed: dict[str, object] = {}

    async def require_findings(
        context, minimum: int, *, required_prefix: str
    ) -> tuple[bool, str | None]:
        observed["task_id"] = context.task.id
        observed["minimum"] = minimum
        findings = context.output["findings"]
        valid = len(findings) >= minimum and all(
            isinstance(item, str) and item.startswith(required_prefix) for item in findings
        )
        return valid, None if valid else "Findings did not satisfy the local policy."

    gates = VerificationGateRegistry()
    gates.register_callable("consumer-findings", require_findings, 2, required_prefix="REQ-")
    definition = sample_definition(verification_gate_id="consumer-findings")
    result = await BaseAgent(
        definition,
        ScriptedModel(
            [
                {
                    "type": "final",
                    "output": {"status": "complete", "findings": ["REQ-1", "REQ-2"]},
                }
            ]
        ),
        verification_gates=gates,
    ).run(sample_task())

    assert result.status == "completed"
    assert observed == {"task_id": "task-interface-1", "minimum": 2}
    assert result.profile is not None
    assert any(span["kind"] == "verification" for span in result.profile["spans"])


@pytest.mark.anyio
async def test_custom_verification_rejection_is_terminal_and_reasoned():
    gates = VerificationGateRegistry()
    gates.register_callable(
        "reject-release", lambda _context: (False, "Release checklist is incomplete.")
    )
    result = await BaseAgent(
        sample_definition(verification_gate_id="reject-release"),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
        verification_gates=gates,
    ).run(sample_task())

    assert result.status == "failed"
    assert result.reason == "Release checklist is incomplete."


@pytest.mark.anyio
async def test_custom_verification_timeout_is_bounded_and_profiled():
    async def slow_gate(_context):
        await asyncio.sleep(0.05)
        return True

    gates = VerificationGateRegistry()
    gates.register_callable("slow-local-gate", slow_gate)
    result = await BaseAgent(
        sample_definition(verification_gate_id="slow-local-gate"),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
        verification_gates=gates,
        watchdog_policy=AgentWatchdogPolicy(verification_timeout_seconds=0.001),
    ).run(sample_task())

    assert result.status == "failed"
    assert result.reason == "WATCHDOG_VERIFICATION_TIMEOUT"
    assert result.profile is not None
    verification_spans = [
        span for span in result.profile["spans"] if span["kind"] == "verification"
    ]
    assert verification_spans[0]["status"] == "timed-out"


@pytest.mark.anyio
async def test_base_agent_emits_compact_profile_summary_to_telemetry(tmp_path):
    telemetry = TelemetryStore(tmp_path)
    task = sample_task()
    result = await BaseAgent(
        sample_definition(),
        ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}]),
        telemetry=telemetry,
        telemetry_context=TelemetryContext(run_id="profile-run", task_id=task.id),
    ).run(task)

    profile_events = [
        event
        for event in telemetry.list_events("profile-run")
        if event.event_type == "agent.profile-completed"
    ]
    assert result.profile is not None
    assert len(profile_events) == 1
    assert profile_events[0].payload["integrity_hash"] == result.profile["integrity_hash"]
    assert "chain_of_thought" not in profile_events[0].payload


def test_verification_registry_rejects_duplicate_gate_and_invalid_return_values():
    registry = VerificationGateRegistry()
    registry.register_callable("local", lambda _context: True)
    with pytest.raises(ValueError, match="already registered"):
        registry.register_callable("local", lambda _context: True)

    registry.register_callable("invalid", lambda _context: "not-a-decision")

    async def evaluate_invalid():
        await registry.evaluate(
            "invalid",
            {"status": "complete"},
            sample_definition(),
            sample_task(),
        )

    with pytest.raises(TypeError, match="Verification gate must return"):
        asyncio.run(evaluate_invalid())


def test_profiler_writes_integrity_checked_bounded_phase_record(tmp_path):
    profiler = AgentRunProfiler()
    root = profiler.begin_run("run-1", "task-1", "consumer-agent")
    phase = profiler.start_span(
        ProfileSpanKind.TOOL,
        "read_spec",
        parent_span_id=root.span_id,
        attributes={"tool_call_id": "read-1"},
    )
    profiler.finish_span(
        phase, ProfileSpanStatus.COMPLETED, attributes={"result_status": "succeeded"}
    )
    profiler.finish_span(root, ProfileSpanStatus.COMPLETED)
    profile = profiler.finish_run(ProfileSpanStatus.COMPLETED)
    output = profiler.write_json(tmp_path / "profile.json")

    assert profile.integrity_hash
    assert profile.wall_duration_ns is not None
    assert (
        profile.summaries[0].kind is ProfileSpanKind.RUN
        or profile.summaries[1].kind is ProfileSpanKind.TOOL
    )
    assert (
        json.loads(output.read_text(encoding="utf-8"))["integrity_hash"] == profile.integrity_hash
    )

    with pytest.raises(ValueError, match="hidden model reasoning"):
        profiler = AgentRunProfiler()
        profiler.begin_run("run-2", "task-2", "consumer-agent")
        profiler.start_span(
            ProfileSpanKind.MODEL_TURN,
            "model-turn",
            attributes={"chain_of_thought": "must not persist"},
        )
