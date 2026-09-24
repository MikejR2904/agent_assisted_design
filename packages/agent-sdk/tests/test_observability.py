from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from agent_sdk.git_versioning import (
    GitApproval,
    GitRepositoryAdapter,
    SpecificationVersionService,
)
from agent_sdk.specification_gate import (
    DependencyGraph,
    GapReport,
    UnifiedSpecification,
    VersionChangeKind,
    VersionMetadata,
)
from agent_sdk.supervisor import CommandTemplate, ProcessExitKind, ProcessSupervisor
from agent_sdk.telemetry import (
    MetricDefinition,
    TelemetryActor,
    TelemetryAuthority,
    TelemetryContext,
    TelemetryStore,
    metric_observation,
)


def _approval(action: str) -> GitApproval:
    return GitApproval(
        approved=True,
        approver_id="designer-1",
        reason="approved in test",
        action=action,
        approval_id=f"approval-{action}",
        at_utc=datetime.now(UTC).isoformat(),
    )


def _git(arguments: list[str], cwd: Path) -> None:
    subprocess.run(["git", *arguments], cwd=cwd, check=True, capture_output=True, text=True)


def _specification() -> UnifiedSpecification:
    return UnifiedSpecification(version="1.0.0", documents=[], requirements=[])


def _hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def test_telemetry_store_orders_hashes_and_reports_observed_facts(tmp_path: Path):
    store = TelemetryStore(tmp_path)
    context = TelemetryContext(run_id="run-observed", task_id="task-observed")
    first = store.emit(
        "run.created",
        context,
        actor=TelemetryActor(kind="system", identifier="test", role="runtime"),
        authority=TelemetryAuthority.DETERMINISTIC,
        status="started",
    )
    second = store.emit(
        "agent.turn-started",
        context,
        actor=TelemetryActor(kind="agent", identifier="rtl-worker", role="worker"),
        authority=TelemetryAuthority.DETERMINISTIC,
        status="running",
        payload={"iteration": 1},
    )
    definition = store.register_metric_definition(
        MetricDefinition(
            metric_id="latency_seconds",
            name="Latency",
            unit="s",
            direction="lower-is-better",
            formula="terminal_time - start_time",
            aggregation="mean",
            missing_data_rule="unavailable when no terminal event exists",
            source_description="run lifecycle events",
        )
    )
    unavailable = store.record_metric(
        metric_observation(
            "latency_seconds",
            "run-observed",
            unit="s",
            value=None,
            unavailable_reason="No real model or EDA terminal event was recorded.",
        )
    )

    events = store.list_events("run-observed")
    report = store.create_run_report("run-observed")

    assert [event.sequence for event in events] == [1, 2]
    assert events[1].previous_event_hash == first.integrity_hash
    assert second.integrity_hash == events[1].integrity_hash
    assert store.verify_run_chain("run-observed") is True
    assert definition.metric_id == "latency_seconds"
    assert unavailable.availability.value == "unavailable"
    assert report["integrity_chain_valid"] is True
    assert (store.root / report["report_path"]).is_file()


def test_telemetry_rejects_hidden_reasoning_payload(tmp_path: Path):
    store = TelemetryStore(tmp_path)
    with pytest.raises(ValueError, match="hidden model reasoning"):
        store.emit(
            "model.completed",
            TelemetryContext(run_id="run-privacy"),
            actor=TelemetryActor(kind="model", identifier="provider/model"),
            authority=TelemetryAuthority.MODEL_MEDIATED,
            status="completed",
            payload={"chain_of_thought": "must not be persisted"},
        )


@pytest.mark.anyio
async def test_watchdog_streams_bounded_output_and_emits_timeout_telemetry(tmp_path: Path):
    telemetry = TelemetryStore(tmp_path)
    context = TelemetryContext(run_id="run-watchdog", task_id="task-watchdog")
    supervisor = ProcessSupervisor(
        [
            CommandTemplate(
                name="loud",
                command=[sys.executable, "-c", "import sys; sys.stdout.write('x' * 4096)"],
                timeout_seconds=2,
                max_output_bytes=64,
            ),
            CommandTemplate(
                name="slow",
                command=[sys.executable, "-c", "import time; time.sleep(1)"],
                timeout_seconds=0.01,
            ),
        ],
        telemetry=telemetry,
        telemetry_context_factory=lambda _name: context,
    )

    loud = await supervisor.execute("loud", cwd=tmp_path)
    timed_out = await supervisor.execute("slow", cwd=tmp_path)

    assert loud.exit_kind is ProcessExitKind.SUCCEEDED
    assert loud.output_bytes_total == 4096
    assert loud.output_bytes_retained == 64
    assert loud.output_truncated_bytes == 4032
    assert timed_out.exit_kind is ProcessExitKind.TIMED_OUT
    assert timed_out.error_code == "PROCESS_TIMEOUT"
    assert any(
        event.event_type == "watchdog.timed-out" for event in telemetry.list_events("run-watchdog")
    )


def test_git_soft_lock_captures_complete_clean_state_and_variant_worktree(tmp_path: Path):
    root = tmp_path / "runtime"
    repository = root / "specification-repository"
    repository.mkdir(parents=True)
    _git(["init"], repository)
    _git(["config", "user.name", "Test Designer"], repository)
    _git(["config", "user.email", "designer@example.test"], repository)
    (repository / "specification.yaml").write_text("version: 1.0.0\n", encoding="utf-8")
    _git(["add", "specification.yaml"], repository)
    _git(["commit", "-m", "initial specification"], repository)

    specification = _specification()
    metadata = VersionMetadata(
        version="1.0.0",
        change_kind=VersionChangeKind.MAJOR,
        unified_specification_hash=_hash(specification.model_dump(mode="json")),
        soft_locked=True,
    )
    adapter = GitRepositoryAdapter(repository)
    service = SpecificationVersionService(root)
    lock = service.create_lock(
        adapter,
        specification,
        DependencyGraph(),
        GapReport(document_version="1.0.0"),
        metadata,
        _approval("create-specification-lock"),
    )
    variant = service.create_variant_worktree(
        adapter,
        name="feasibility-16bit",
        branch="feasibility/16bit",
        base_ref="HEAD",
        specification_tag=lock.tag_name,
        purpose="Explore a 16-bit design variant.",
        approval=_approval("create-variant-worktree"),
    )

    assert lock.tag_name == "v1.0.0"
    assert adapter.tag_exists("v1.0.0")
    assert Path(variant.path).is_dir()
    assert variant.specification_tag == "v1.0.0"


def test_git_lock_rejects_unapproved_action(tmp_path: Path):
    repository = tmp_path / "repository"
    repository.mkdir()
    _git(["init"], repository)
    _git(["config", "user.name", "Test Designer"], repository)
    _git(["config", "user.email", "designer@example.test"], repository)
    (repository / "specification.yaml").write_text("version: 1.0.0\n", encoding="utf-8")
    _git(["add", "specification.yaml"], repository)
    _git(["commit", "-m", "initial specification"], repository)
    specification = _specification()
    metadata = VersionMetadata(
        version="1.0.0",
        change_kind=VersionChangeKind.PATCH,
        unified_specification_hash=_hash(specification.model_dump(mode="json")),
        soft_locked=True,
    )
    rejected = _approval("create-specification-lock").model_copy(update={"approved": False})

    with pytest.raises(ValueError, match="approved"):
        SpecificationVersionService(tmp_path).create_lock(
            GitRepositoryAdapter(repository),
            specification,
            DependencyGraph(),
            GapReport(document_version="1.0.0"),
            metadata,
            rejected,
        )
