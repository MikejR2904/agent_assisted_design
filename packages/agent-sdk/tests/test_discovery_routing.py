from __future__ import annotations

from agent_sdk.graph import (
    GraphNode,
    GraphNodeKind,
    GraphNodeResult,
    GraphNodeStatus,
    GraphSharedState,
    StateGraph,
)
from agent_sdk.shared_state import (
    DiscoveryRouteStatus,
    DiscoveryRoutingRefs,
    ExploratoryDiscovery,
    SharedSubstrateSnapshot,
    canonical_hash,
)


def _discovery(snapshot: SharedSubstrateSnapshot) -> ExploratoryDiscovery:
    payload = {"reset": "synchronous"}
    return ExploratoryDiscovery(
        episode_id="discovery-reset",
        producer_node_id="producer",
        owner_id="worker-producer",
        snapshot_id=snapshot.snapshot_id,
        snapshot_version=snapshot.version,
        source_spans=["REQ-RESET#line:2"],
        description="The reset interface is synchronous.",
        payload=payload,
        provenance_hash=canonical_hash(payload),
        affected_refs=DiscoveryRoutingRefs(requirement_ids=["REQ-RESET"], signal_ids=["reset"]),
    )


def _graph() -> tuple[StateGraph, SharedSubstrateSnapshot]:
    snapshot = SharedSubstrateSnapshot(
        snapshot_id="locked-v1",
        version="1",
        content_hash=canonical_hash({"spec": "locked"}),
    )
    return (
        StateGraph(
            [
                GraphNode(node_id="producer", kind=GraphNodeKind.FUNCTION),
                GraphNode(
                    node_id="matching-consumer",
                    kind=GraphNodeKind.FUNCTION,
                    routing_refs=DiscoveryRoutingRefs(
                        requirement_ids=["REQ-RESET"], signal_ids=["reset"]
                    ),
                ),
                GraphNode(
                    node_id="nonmatching-consumer",
                    kind=GraphNodeKind.FUNCTION,
                    routing_refs=DiscoveryRoutingRefs(requirement_ids=["REQ-RESET"]),
                ),
            ],
            shared_state=GraphSharedState(substrate=snapshot),
        ),
        snapshot,
    )


def test_graph_routes_only_exact_conjunctive_reference_matches_before_start():
    graph, snapshot = _graph()
    graph.mark_started("producer")
    graph.mark_terminal("producer", GraphNodeResult(status=GraphNodeStatus.COMPLETED))

    graph.publish_discovery(_discovery(snapshot))

    state = graph.shared_state
    assert state.routing_index.requirement_postings["REQ-RESET"] == [
        "matching-consumer",
        "nonmatching-consumer",
    ]
    assert state.routing_index.signal_postings["reset"] == ["matching-consumer"]
    decisions = {decision.consumer_node_id: decision for decision in state.route_decisions}
    assert decisions["matching-consumer"].status is DiscoveryRouteStatus.ACCEPTED
    assert "nonmatching-consumer" not in decisions

    graph.mark_started("matching-consumer")
    matching_context = graph.execution_context("matching-consumer")
    assert set(matching_context.shared_state.discoveries) == {"discovery-reset"}

    graph.mark_started("nonmatching-consumer")
    nonmatching_context = graph.execution_context("nonmatching-consumer")
    assert nonmatching_context.shared_state.discoveries == {}


def test_graph_records_late_discovery_without_conditional_delivery():
    graph, snapshot = _graph()
    graph.mark_started("producer")
    graph.mark_terminal("producer", GraphNodeResult(status=GraphNodeStatus.COMPLETED))
    graph.mark_started("matching-consumer")

    graph.publish_discovery(_discovery(snapshot))

    state = graph.shared_state
    decision = next(
        entry for entry in state.route_decisions if entry.consumer_node_id == "matching-consumer"
    )
    assert decision.status is DiscoveryRouteStatus.LATE_DISCOVERY
    assert state.lateral_dependencies == {}
