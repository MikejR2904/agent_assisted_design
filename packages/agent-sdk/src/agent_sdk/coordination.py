"""Durable run coordination over the deterministic typed graph."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import Field

from .approvals import ApprovalRegistry, ApprovalRequest
from .contracts import StrictModel
from .graph import (
    GraphNode,
    GraphNodeKind,
    GraphNodeResult,
    GraphNodeStatus,
    GraphSharedState,
    NodeExecutor,
    StateGraph,
)
from .planning import Plan, PlanValidationReport, PlanValidator
from .shared_state import ExploratoryDiscovery, LateralDependencyRequest, SharedStateWrite


class RunRecord(StrictModel):
    schema_version: str = "agent-run-v1"
    run_id: str = Field(min_length=1)
    plan_id: str = Field(min_length=1)
    graph: dict[str, Any]
    plan_validation: PlanValidationReport
    cancelled: bool = False
    run_hash: str = Field(min_length=1)


def _replace_with_retry(temporary: Path, target: Path, *, attempts: int = 5) -> None:
    """Retry ``os.replace`` on a transient Windows ``PermissionError``.

    ``MoveFileEx`` (what ``os.replace`` uses on Windows) can fail with WinError 5
    when another process briefly holds an open handle on the destination -- most
    commonly real-time antivirus or search-indexer scanning of a just-written
    file. This is a known source of flaky atomic writes under bursty save rates
    on Windows specifically (reproduced under a rapid multi-save stress test);
    POSIX ``rename`` has no equivalent failure mode.
    """

    for attempt in range(attempts):
        try:
            os.replace(temporary, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.01 * (attempt + 1))


class RunStateStore:
    """Versioned atomic JSON run records; graph snapshots include lateral state.

    Growing history (events, discoveries, values, lateral-dependency requests,
    route decisions, conflicts) is persisted append-only in a companion
    ``<run_id>.history.jsonl`` file instead of being rewritten inside the main
    record on every save, so save() cost no longer grows with accumulated run
    history. ``graph.snapshot()``/``StateGraph.from_snapshot()`` are unchanged;
    the split and its reversal happen entirely inside this store, so ``load()``
    still returns a ``RunRecord`` with a fully populated ``graph`` dict, byte-for-
    byte equivalent to what the unsplit implementation produced (verified via the
    unchanged ``run_hash`` integrity check below).
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve() / ".agent-runs"
        self._root.mkdir(parents=True, exist_ok=True)
        # run_id -> (list-path -> persisted count, dict-path -> persisted keys,
        # dict-of-list-path -> {key: persisted count}). Self-healing: rebuilt from
        # the history file on first access after a process restart.
        self._persisted: dict[str, _PersistedHistoryCounts] = {}

    def save(self, record: RunRecord) -> None:
        counts = self._counts_for(record.run_id)
        if _history_shrunk(record.graph, counts):
            # Fewer entries than already on disk: this run_id's history restarted
            # (e.g. a fresh graph reusing an old run_id). Rewrite the log rather
            # than silently losing entries that no longer have a persisted count
            # to diff against.
            self._history_path(record.run_id).unlink(missing_ok=True)
            counts = _PersistedHistoryCounts()
        new_entries, counts = _diff_history(record.graph, counts)
        if new_entries:
            self._append_history(record.run_id, new_entries)
        self._persisted[record.run_id] = counts
        target = self._root / f"{record.run_id}.json"
        temporary = target.with_name(f".{target.name}.tmp")
        snapshot = record.model_copy(update={"graph": _emptied_history(record.graph)})
        temporary.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        _replace_with_retry(temporary, target)

    def load(self, run_id: str) -> RunRecord:
        target = self._root / f"{run_id}.json"
        if not target.is_file():
            raise ValueError(f'Run "{run_id}" is unknown.')
        snapshot = RunRecord.model_validate_json(target.read_text(encoding="utf-8"))
        history, counts = _replay_history(self._history_path(run_id))
        self._persisted[run_id] = counts
        graph = _merge_history(snapshot.graph, history)
        record = snapshot.model_copy(update={"graph": graph})
        expected = _hash_run(
            record.run_id, record.plan_id, record.graph, record.plan_validation, record.cancelled
        )
        if record.run_hash != expected:
            raise ValueError(f'Run "{run_id}" failed integrity verification.')
        return record

    def exists(self, run_id: str) -> bool:
        return (self._root / f"{run_id}.json").is_file()

    def _history_path(self, run_id: str) -> Path:
        return self._root / f"{run_id}.history.jsonl"

    def _counts_for(self, run_id: str) -> _PersistedHistoryCounts:
        cached = self._persisted.get(run_id)
        if cached is not None:
            return cached
        _history, counts = _replay_history(self._history_path(run_id))
        return counts

    def _append_history(self, run_id: str, entries: list[dict[str, Any]]) -> None:
        path = self._history_path(run_id)
        with path.open("a", encoding="utf-8") as handle:
            for entry in entries:
                handle.write(json.dumps(entry, sort_keys=True, separators=(",", ":")))
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())


@dataclass
class _PersistedHistoryCounts:
    """How much of each growing graph collection is already in the history log."""

    events: int = 0
    route_decisions: int = 0
    conflicts: int = 0
    discovery_keys: set[str] = field(default_factory=set)
    value_keys: set[str] = field(default_factory=set)
    lateral_dependency_counts: dict[str, int] = field(default_factory=dict)


def _emptied_history(graph: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``graph`` with every growing collection cleared.

    Copies only the top level and ``shared_state``; unrelated nested values
    (nodes, edges, statuses, results, substrate) are shared by reference rather
    than deep-copied, since this runs on every save and a full deep copy would
    defeat the point of no longer rewriting the full growing state.
    """

    result = dict(graph)
    shared_state = dict(result.get("shared_state", {}))
    result["shared_state"] = shared_state
    result["events"] = []
    shared_state["route_decisions"] = []
    shared_state["conflicts"] = []
    shared_state["discoveries"] = {}
    shared_state["values"] = {}
    shared_state["lateral_dependencies"] = {}
    return result


def _history_shrunk(graph: dict[str, Any], counts: _PersistedHistoryCounts) -> bool:
    shared_state = graph.get("shared_state", {})
    if len(graph.get("events", [])) < counts.events:
        return True
    if len(shared_state.get("route_decisions", [])) < counts.route_decisions:
        return True
    if len(shared_state.get("conflicts", [])) < counts.conflicts:
        return True
    if not counts.discovery_keys.issubset(shared_state.get("discoveries", {})):
        return True
    if not counts.value_keys.issubset(shared_state.get("values", {})):
        return True
    lateral_dependencies = shared_state.get("lateral_dependencies", {})
    return any(
        len(lateral_dependencies.get(key, [])) < already
        for key, already in counts.lateral_dependency_counts.items()
    )


def _diff_history(
    graph: dict[str, Any], counts: _PersistedHistoryCounts
) -> tuple[list[dict[str, Any]], _PersistedHistoryCounts]:
    """Return history entries new since ``counts``, and the resulting counts."""

    shared_state = graph.get("shared_state", {})
    entries: list[dict[str, Any]] = []
    updated = _PersistedHistoryCounts(
        events=counts.events,
        route_decisions=counts.route_decisions,
        conflicts=counts.conflicts,
        discovery_keys=set(counts.discovery_keys),
        value_keys=set(counts.value_keys),
        lateral_dependency_counts=dict(counts.lateral_dependency_counts),
    )

    events = graph.get("events", [])
    entries.extend({"kind": "event", "value": item} for item in events[counts.events :])
    updated.events = len(events)

    route_decisions = shared_state.get("route_decisions", [])
    entries.extend(
        {"kind": "route_decision", "value": item}
        for item in route_decisions[counts.route_decisions :]
    )
    updated.route_decisions = len(route_decisions)

    conflicts = shared_state.get("conflicts", [])
    entries.extend({"kind": "conflict", "value": item} for item in conflicts[counts.conflicts :])
    updated.conflicts = len(conflicts)

    for key, value in shared_state.get("discoveries", {}).items():
        if key not in counts.discovery_keys:
            entries.append({"kind": "discovery", "key": key, "value": value})
            updated.discovery_keys.add(key)

    for key, value in shared_state.get("values", {}).items():
        if key not in counts.value_keys:
            entries.append({"kind": "value", "key": key, "value": value})
            updated.value_keys.add(key)

    for key, items in shared_state.get("lateral_dependencies", {}).items():
        already = counts.lateral_dependency_counts.get(key, 0)
        entries.extend(
            {"kind": "lateral_dependency", "key": key, "value": item} for item in items[already:]
        )
        updated.lateral_dependency_counts[key] = len(items)

    return entries, updated


def _replay_history(path: Path) -> tuple[dict[str, Any], _PersistedHistoryCounts]:
    """Reconstruct every growing collection from the append-only history log."""

    events: list[Any] = []
    route_decisions: list[Any] = []
    conflicts: list[Any] = []
    discoveries: dict[str, Any] = {}
    values: dict[str, Any] = {}
    lateral_dependencies: dict[str, list[Any]] = {}
    if path.is_file():
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                entry = json.loads(line)
                kind = entry["kind"]
                if kind == "event":
                    events.append(entry["value"])
                elif kind == "route_decision":
                    route_decisions.append(entry["value"])
                elif kind == "conflict":
                    conflicts.append(entry["value"])
                elif kind == "discovery":
                    discoveries[entry["key"]] = entry["value"]
                elif kind == "value":
                    values[entry["key"]] = entry["value"]
                elif kind == "lateral_dependency":
                    lateral_dependencies.setdefault(entry["key"], []).append(entry["value"])
                else:
                    raise ValueError(f'Unknown run history entry kind "{kind}".')
    history = {
        "events": events,
        "route_decisions": route_decisions,
        "conflicts": conflicts,
        "discoveries": discoveries,
        "values": values,
        "lateral_dependencies": lateral_dependencies,
    }
    counts = _PersistedHistoryCounts(
        events=len(events),
        route_decisions=len(route_decisions),
        conflicts=len(conflicts),
        discovery_keys=set(discoveries),
        value_keys=set(values),
        lateral_dependency_counts={key: len(items) for key, items in lateral_dependencies.items()},
    )
    return history, counts


def _merge_history(snapshot_graph: dict[str, Any], history: dict[str, Any]) -> dict[str, Any]:
    """Recombine a history-emptied snapshot with its replayed growing collections."""

    graph = dict(snapshot_graph)
    shared_state = dict(graph.get("shared_state", {}))
    graph["shared_state"] = shared_state
    graph["events"] = history["events"]
    shared_state["route_decisions"] = history["route_decisions"]
    shared_state["conflicts"] = history["conflicts"]
    shared_state["discoveries"] = history["discoveries"]
    shared_state["values"] = history["values"]
    shared_state["lateral_dependencies"] = history["lateral_dependencies"]
    return graph


class HarnessCoordinator:
    """Own plan validation, graph state, approvals, cancellation, and persistence.

    A `RunRecord.graph` is the authoritative run state. It includes the scheduler
    snapshot, terminal node results, typed shared discoveries and values, and
    lateral dependency requests. The coordinator does not maintain a second
    lateral-state persistence channel.
    """

    def __init__(self, run_root: Path) -> None:
        self._store = RunStateStore(run_root)
        self._validator = PlanValidator()
        self._graphs: dict[str, StateGraph] = {}
        self._approvals: dict[str, ApprovalRegistry] = {}
        self._counter = 1

    def start_run(self, plan: Plan, *, shared_state: GraphSharedState | None = None) -> RunRecord:
        validation = self._validator.validate(plan)
        if not validation.valid:
            raise ValueError("Plan is invalid; start_run requires a valid deterministic plan.")
        while self._store.exists(f"run-{self._counter}"):
            self._counter += 1
        run_id = f"run-{self._counter}"
        self._counter += 1
        graph = StateGraph(
            [
                GraphNode(
                    node_id=f"node:{task.task_id}",
                    kind="agent-invocation",
                    task_id=task.task_id,
                    dependencies=[f"node:{dependency}" for dependency in task.dependencies],
                    routing_refs=task.routing_refs,
                )
                for task in plan.tasks
            ],
            shared_state=shared_state,
            max_elastic_depth=plan.max_elastic_depth,
            max_elastic_nodes=plan.max_elastic_nodes,
        )
        self._graphs[run_id] = graph
        self._approvals[run_id] = ApprovalRegistry()
        return self._save(run_id, plan.plan_id, graph, validation)

    def get_run_state(self, run_id: str) -> RunRecord:
        if run_id in self._graphs:
            stored = self._store.load(run_id)
            return self._save(
                run_id,
                stored.plan_id,
                self._graphs[run_id],
                stored.plan_validation,
                stored.cancelled,
            )
        stored = self._store.load(run_id)
        self._graphs[run_id] = StateGraph.from_snapshot(stored.graph)
        self._approvals.setdefault(run_id, ApprovalRegistry())
        return stored

    def shared_state(self, run_id: str) -> GraphSharedState:
        """Return graph-owned state after integrity-checked rehydration."""

        self.get_run_state(run_id)
        return self._graphs[run_id].shared_state

    def cancel_run(self, run_id: str) -> RunRecord:
        record = self.get_run_state(run_id)
        graph = self._graphs.get(run_id)
        if graph is not None:
            for node in graph.runnable():
                graph.mark_started(node.node_id)
                from .graph import GraphNodeResult, GraphNodeStatus

                graph.mark_terminal(
                    node.node_id,
                    GraphNodeResult(status=GraphNodeStatus.CANCELLED, reason="Run was cancelled."),
                )
            return self._save(run_id, record.plan_id, graph, record.plan_validation, cancelled=True)
        return RunRecord(
            run_id=record.run_id,
            plan_id=record.plan_id,
            graph=record.graph,
            plan_validation=record.plan_validation,
            cancelled=True,
            run_hash=_hash_run(
                record.run_id, record.plan_id, record.graph, record.plan_validation, True
            ),
        )

    def publish_discovery(self, run_id: str, discovery: ExploratoryDiscovery) -> RunRecord:
        """Persist a source-backed discovery in the graph snapshot."""

        record = self.get_run_state(run_id)
        graph = self._graphs[run_id]
        graph.publish_discovery(discovery)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    def write_shared_value(self, run_id: str, state_write: SharedStateWrite) -> RunRecord:
        """Persist an immutable typed shared value in the graph snapshot."""

        record = self.get_run_state(run_id)
        graph = self._graphs[run_id]
        graph.write_shared_value(state_write)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    def request_lateral_dependency(
        self, run_id: str, request: LateralDependencyRequest
    ) -> RunRecord:
        """Record a discovery consumer and its conditional graph edge atomically."""

        record = self.get_run_state(run_id)
        graph = self._graphs[run_id]
        graph.request_lateral_dependency(request)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    def add_lateral_dependency(
        self,
        run_id: str,
        producer_node_id: str,
        consumer_node_id: str,
        discovery_episode_id: str,
    ) -> RunRecord:
        """Compatibility wrapper; graph shared state must already carry the discovery."""

        record = self.get_run_state(run_id)
        graph = self._graphs.get(run_id)
        if graph is None:
            raise ValueError("Lateral graph updates require an active coordinator process.")
        graph.add_lateral_dependency(producer_node_id, consumer_node_id, discovery_episode_id)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    def record_node_result(
        self,
        run_id: str,
        node_id: str,
        result: GraphNodeResult,
    ) -> RunRecord:
        """Commit a typed terminal node result through the scheduler state machine."""

        record = self.get_run_state(run_id)
        graph = self._graphs[run_id]
        graph.mark_started(node_id)
        graph.mark_terminal(node_id, result)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    async def execute_run(
        self,
        run_id: str,
        executors: Mapping[GraphNodeKind, NodeExecutor],
        *,
        max_parallelism: int | None = None,
    ) -> RunRecord:
        """Execute graph waves while persisting starts and terminal commits.

        The scheduler commits terminal results in canonical node-ID order after
        each wave. A persisted `RUNNING` state is therefore always recoverable
        by ``recover_interrupted_run`` rather than being silently replayed.
        """

        record = self.get_run_state(run_id)
        if record.cancelled:
            return record
        graph = self._graphs[run_id]
        if max_parallelism is not None and max_parallelism < 1:
            raise ValueError("max_parallelism must be at least one.")
        while wave := graph.start_runnable_wave(max_parallelism=max_parallelism):
            record = self._save(
                run_id, record.plan_id, graph, record.plan_validation, record.cancelled
            )
            wave_state = graph.shared_state

            async def execute_one(node: GraphNode) -> GraphNodeResult:
                executor = executors.get(node.kind)
                if executor is None:
                    return GraphNodeResult(
                        status=GraphNodeStatus.FAILED,
                        reason=f'No executor is registered for node kind "{node.kind.value}".',
                    )
                try:
                    return await executor(
                        node,
                        graph.execution_context(node.node_id, shared_state=wave_state),
                    )
                except Exception as error:
                    return GraphNodeResult(status=GraphNodeStatus.FAILED, reason=str(error))

            results = await asyncio.gather(*(execute_one(node) for node in wave))
            for node, result in zip(wave, results, strict=True):
                graph.mark_terminal(node.node_id, result)
                record = self._save(
                    run_id, record.plan_id, graph, record.plan_validation, record.cancelled
                )
        return record

    def recover_interrupted_run(
        self,
        run_id: str,
        replayable_node_ids: set[str] = frozenset(),
    ) -> RunRecord:
        """Persist a conservative recovery of interrupted graph agent nodes."""

        record = self.get_run_state(run_id)
        graph = self._graphs[run_id]
        graph.recover_interrupted(replayable_node_ids)
        return self._save(run_id, record.plan_id, graph, record.plan_validation, record.cancelled)

    def submit_approval(
        self,
        run_id: str,
        approval_id: str,
        approved: bool,
        reason: str | None = None,
    ) -> ApprovalRequest:
        registry = self._approvals.get(run_id)
        if registry is None:
            raise ValueError(
                "Approval registry is unavailable after process restart in this increment."
            )
        return registry.submit(approval_id, approved, reason)

    def approvals(self, run_id: str) -> ApprovalRegistry:
        registry = self._approvals.get(run_id)
        if registry is None:
            raise ValueError(f'Run "{run_id}" is not active in this coordinator.')
        return registry

    def resume_run(self, run_id: str) -> RunRecord:
        """Re-read and integrity-verify the persisted graph state before reporting it."""

        return self.get_run_state(run_id)

    def _save(
        self,
        run_id: str,
        plan_id: str,
        graph: StateGraph,
        validation: PlanValidationReport,
        cancelled: bool = False,
    ) -> RunRecord:
        snapshot = graph.snapshot()
        record = RunRecord(
            run_id=run_id,
            plan_id=plan_id,
            graph=snapshot,
            plan_validation=validation,
            cancelled=cancelled,
            run_hash=_hash_run(run_id, plan_id, snapshot, validation, cancelled),
        )
        self._store.save(record)
        return record


def _hash_run(
    run_id: str,
    plan_id: str,
    graph: dict[str, Any],
    validation: PlanValidationReport,
    cancelled: bool,
) -> str:
    payload = {
        "run_id": run_id,
        "plan_id": plan_id,
        "graph": graph,
        "plan_validation": validation.model_dump(mode="json"),
        "cancelled": cancelled,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
