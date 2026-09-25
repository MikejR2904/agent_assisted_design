from __future__ import annotations

import multiprocessing
from decimal import Decimal
from pathlib import Path

import pytest

from agent_sdk.artifacts import ArtifactStore
from agent_sdk.audit_log import AuditTranscriptStore
from agent_sdk.contracts import EpisodeKind, ToolDefinition, validate_tool_arguments
from agent_sdk.coordination import HarnessCoordinator
from agent_sdk.orchestration import (
    ComplexityRoutingRules,
    ControllerStateMachine,
    ControllerStateStore,
    GapMetadata,
    SkillToolProfile,
)
from agent_sdk.planning import ModelTier, Plan, PlanTask
from agent_sdk.shared_state import SharedSubstrateSnapshot, canonical_hash


def _append_audit_entries(root: str, run_id: str, count: int, start: multiprocessing.Event) -> None:
    store = AuditTranscriptStore(Path(root))
    start.wait(timeout=10)
    for index in range(count):
        store.append(run_id, "parallel-event", {"index": index})
    store.close()


def _plan() -> Plan:
    return Plan(
        plan_id="audit-plan",
        tasks=[
            PlanTask(
                task_id="audit-task",
                scope="REQ-AUDIT",
                locked_interface={"signals": []},
                instructions="Persist a bounded audit task.",
                acceptance_criteria="gate:audit",
                model_tier=ModelTier.STANDARD,
            )
        ],
    )


def _controller_record() -> ControllerStateMachine:
    snapshot = SharedSubstrateSnapshot(
        snapshot_id="audit-snapshot",
        version="1",
        content_hash=canonical_hash({"audit": "snapshot"}),
    )
    profile = SkillToolProfile(
        stage="rtl-development",
        skill_ids=["rtl"],
        capability_ids=["spec.read"],
        source_snapshot_id=snapshot.snapshot_id,
    )
    return ControllerStateMachine(
        "audit-controller",
        snapshot,
        profile,
        ComplexityRoutingRules(
            multi_agent_min_categories=2,
            multi_agent_min_blast_radius=2,
        ),
        GapMetadata(categories_touched=["rtl"], blast_radius=0),
        project_state_id=snapshot.snapshot_id,
        max_repair_attempts=1,
    )


def test_schema_cache_does_not_coerce_non_json_schema_constants() -> None:
    tool = ToolDefinition(
        name="decimal-constant",
        description="Retain non-JSON schema constants when validating host declarations.",
        input_schema={
            "type": "object",
            "properties": {"value": {"const": Decimal("1.0")}},
            "required": ["value"],
        },
        episode_kind=EpisodeKind.EXPLORATORY,
    )

    validate_tool_arguments(tool, {"value": Decimal("1.0")})

    try:
        validate_tool_arguments(tool, {"value": "1.0"})
    except Exception:
        pass
    else:
        raise AssertionError("The string representation must not satisfy a Decimal const schema.")


def test_artifact_store_recovers_after_run_root_recreation(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path)
    first = store.write_text("drafts/first.sv", "module first; endmodule")
    assert store.read_text(first.artifact_id) == "module first; endmodule"

    import shutil

    shutil.rmtree(tmp_path)
    recovered = ArtifactStore(tmp_path)
    second = recovered.write_text("drafts/second.sv", "module second; endmodule")

    assert recovered.read_text(second.artifact_id) == "module second; endmodule"


def test_artifact_store_reads_pre_portable_manifest_name(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path)
    record = store.write_text("drafts/top.sv", "module top; endmodule")
    portable = tmp_path / ".agent-artifacts" / f"{record.artifact_id.replace(':', '_')}.json"
    legacy = tmp_path / ".agent-artifacts" / f"{record.artifact_id}.json"
    portable.replace(legacy)

    restored = ArtifactStore(tmp_path)

    assert restored.get(record.artifact_id) is not None
    assert restored.read_text(record.artifact_id) == "module top; endmodule"


def test_run_state_store_loads_legacy_full_snapshot(tmp_path: Path) -> None:
    coordinator = HarnessCoordinator(tmp_path)
    started = coordinator.start_run(_plan())
    root = tmp_path / ".agent-runs"
    (root / f"{started.run_id}.history.jsonl").unlink()
    (root / f"{started.run_id}.json").write_text(
        started.model_dump_json(indent=2), encoding="utf-8"
    )

    restored = HarnessCoordinator(tmp_path).get_run_state(started.run_id)

    assert restored.model_dump(mode="json") == started.model_dump(mode="json")


def test_controller_state_store_loads_legacy_full_snapshot(tmp_path: Path) -> None:
    machine = _controller_record()
    store = ControllerStateStore(tmp_path)
    store.save(machine.record)
    root = tmp_path / ".agent-controllers"
    (root / "audit-controller.events.jsonl").unlink()
    (root / "audit-controller.json").write_text(
        machine.record.model_dump_json(indent=2), encoding="utf-8"
    )

    restored = ControllerStateStore(tmp_path).load("audit-controller")

    assert restored.events == machine.record.events


def test_run_state_store_recovers_previous_snapshot_after_replacement_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import agent_sdk.coordination as coordination

    coordinator = HarnessCoordinator(tmp_path)
    started = coordinator.start_run(_plan())

    def fail_replace(_temporary: Path, _target: Path, *, attempts: int = 5) -> None:
        del attempts
        raise PermissionError("simulated replacement failure")

    monkeypatch.setattr(coordination, "_replace_with_retry", fail_replace)
    with pytest.raises(PermissionError, match="simulated replacement failure"):
        coordinator.cancel_run(started.run_id)

    monkeypatch.undo()
    recovered = HarnessCoordinator(tmp_path).get_run_state(started.run_id)

    assert recovered.model_dump(
        mode="json", exclude={"history_entry_count", "history_integrity_hash"}
    ) == started.model_dump(mode="json", exclude={"history_entry_count", "history_integrity_hash"})


def test_controller_store_recovers_previous_snapshot_after_replacement_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import agent_sdk.orchestration as orchestration

    machine = _controller_record()
    store = ControllerStateStore(tmp_path)
    store.save(machine.record)
    baseline = machine.record.model_copy(deep=True)
    machine.cancel("simulated cancellation")

    def fail_replace(_temporary: Path, _target: Path, *, attempts: int = 5) -> None:
        del attempts
        raise PermissionError("simulated replacement failure")

    monkeypatch.setattr(orchestration, "_replace_with_retry", fail_replace)
    with pytest.raises(PermissionError, match="simulated replacement failure"):
        store.save(machine.record)

    monkeypatch.undo()
    recovered = ControllerStateStore(tmp_path).load("audit-controller")

    assert recovered.model_dump(
        mode="json", exclude={"events_entry_count", "events_integrity_hash"}
    ) == baseline.model_dump(mode="json", exclude={"events_entry_count", "events_integrity_hash"})


def test_audit_append_is_serialized_across_independent_processes(tmp_path: Path) -> None:
    start = multiprocessing.get_context("spawn").Event()
    processes = [
        multiprocessing.get_context("spawn").Process(
            target=_append_audit_entries,
            args=(str(tmp_path), "parallel-run", 12, start),
        )
        for _index in range(2)
    ]
    for process in processes:
        process.start()
    start.set()
    for process in processes:
        process.join(timeout=20)
        assert process.exitcode == 0

    store = AuditTranscriptStore(tmp_path)
    entries = list(store.iter_entries("parallel-run"))
    assert len(entries) == 24
    assert [entry.sequence for entry in entries] == list(range(1, 25))
    assert store.verify("parallel-run")
    store.close()
