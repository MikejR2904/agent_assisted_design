from __future__ import annotations

from agent_sdk.graph import (
    GraphNode,
    GraphNodeKind,
    GraphNodeResult,
    GraphNodeStatus,
    GraphSharedState,
    GraphStateConflictKind,
    StateGraph,
)
from agent_sdk.shared_state import (
    ExploratoryDiscovery,
    SharedStateWrite,
    SharedSubstrateSnapshot,
    canonical_hash,
)


def _completed_graph() -> tuple[StateGraph, SharedSubstrateSnapshot]:
    snapshot = SharedSubstrateSnapshot(
        snapshot_id="locked-v1", version="1", content_hash=canonical_hash({"locked": True})
    )
    graph = StateGraph(
        [GraphNode(node_id="producer", kind=GraphNodeKind.FUNCTION)],
        shared_state=GraphSharedState(substrate=snapshot),
    )
    graph.mark_started("producer")
    graph.mark_terminal("producer", GraphNodeResult(status=GraphNodeStatus.COMPLETED))
    return graph, snapshot


def test_graph_records_immutable_shared_value_collision_without_throwing():
    graph, _ = _completed_graph()
    initial = SharedStateWrite(
        producer_node_id="producer", key="interface", value={"width": 8}, provenance_hash="hash-1"
    )
    collision = SharedStateWrite(
        producer_node_id="producer", key="interface", value={"width": 16}, provenance_hash="hash-2"
    )

    assert graph.try_write_shared_value(initial) is None
    conflict = graph.try_write_shared_value(collision)

    assert conflict is not None
    assert conflict.kind is GraphStateConflictKind.IMMUTABLE_WRITE_COLLISION
    assert graph.shared_state.values["interface"].value == {"width": 8}


def test_graph_records_discovery_snapshot_conflict_without_publishing():
    graph, snapshot = _completed_graph()
    discovery = ExploratoryDiscovery(
        episode_id="d-1",
        producer_node_id="producer",
        owner_id="worker",
        snapshot_id="different-snapshot",
        snapshot_version=snapshot.version,
        source_spans=["REQ-1#line:1"],
        description="Source mismatch test.",
        payload={},
        provenance_hash="hash",
    )

    conflict = graph.try_publish_discovery(discovery)

    assert conflict is not None
    assert conflict.kind is GraphStateConflictKind.DISCOVERY_SNAPSHOT_MISMATCH
    assert graph.shared_state.discoveries == {}
