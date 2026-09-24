from __future__ import annotations

import pytest

from agent_sdk.graph import (
    GraphNode,
    GraphNodeKind,
    GraphNodeResult,
    GraphNodeStatus,
    GraphSharedState,
    StateGraph,
)
from agent_sdk.shared_state import (
    ExploratoryDiscovery,
    LateralDependencyRequest,
    SharedSubstrateSnapshot,
    canonical_hash,
)


@pytest.mark.anyio
async def test_graph_executes_independent_nodes_then_deterministic_fan_in():
    graph = StateGraph(
        [
            GraphNode(node_id="a", kind=GraphNodeKind.FUNCTION),
            GraphNode(node_id="b", kind=GraphNodeKind.FUNCTION),
            GraphNode(node_id="join", kind=GraphNodeKind.GATE, dependencies=["a", "b"]),
        ]
    )
    seen: list[tuple[str, list[str], str]] = []

    async def execute(node, context):
        seen.append(
            (
                node.node_id,
                sorted(context.dependencies),
                context.shared_state.substrate.snapshot_id,
            )
        )
        return GraphNodeResult(status=GraphNodeStatus.COMPLETED, output={"node": node.node_id})

    results = await graph.execute({GraphNodeKind.FUNCTION: execute, GraphNodeKind.GATE: execute})

    assert list(results) == ["a", "b", "join"]
    assert seen == [
        ("a", [], "graph-unbound"),
        ("b", [], "graph-unbound"),
        ("join", ["a", "b"], "graph-unbound"),
    ]
    assert graph.status("join") is GraphNodeStatus.COMPLETED


@pytest.mark.anyio
async def test_parallel_node_executors_receive_isolated_graph_state_copies():
    graph = StateGraph(
        [
            GraphNode(node_id="a", kind=GraphNodeKind.FUNCTION),
            GraphNode(node_id="b", kind=GraphNodeKind.FUNCTION),
        ]
    )

    async def execute(node, context):
        context.shared_state.values[f"attempted-write:{node.node_id}"] = None  # type: ignore[assignment]
        return GraphNodeResult(status=GraphNodeStatus.COMPLETED)

    await graph.execute({GraphNodeKind.FUNCTION: execute})

    assert graph.shared_state.values == {}


def test_graph_persists_lateral_discovery_inside_its_single_snapshot():
    snapshot = SharedSubstrateSnapshot(
        snapshot_id="locked-spec-v1",
        version="1.0.0",
        content_hash=canonical_hash({"spec": "locked"}),
    )
    graph = StateGraph(
        [
            GraphNode(node_id="producer", kind=GraphNodeKind.FUNCTION),
            GraphNode(node_id="consumer", kind=GraphNodeKind.FUNCTION),
        ],
        shared_state=GraphSharedState(substrate=snapshot),
    )
    graph.mark_started("producer")
    graph.mark_terminal("producer", GraphNodeResult(status=GraphNodeStatus.COMPLETED))
    payload = {"reset": "synchronous"}
    graph.publish_discovery(
        ExploratoryDiscovery(
            episode_id="discovery-1",
            producer_node_id="producer",
            owner_id="worker-producer",
            snapshot_id=snapshot.snapshot_id,
            snapshot_version=snapshot.version,
            source_spans=["REQ-1#line:2"],
            description="Synchronous reset is required.",
            payload=payload,
            provenance_hash=canonical_hash(payload),
        )
    )
    graph.request_lateral_dependency(
        LateralDependencyRequest(
            consumer_node_id="consumer",
            consumer_action_id="write-rtl",
            discovery_episode_id="discovery-1",
            reason="The consumer must preserve reset semantics.",
        )
    )

    persisted = StateGraph.from_snapshot(graph.snapshot())
    state = persisted.shared_state
    assert state.discoveries["discovery-1"].payload == payload
    assert state.lateral_dependencies["discovery-1"][0].consumer_node_id == "consumer"
    assert any(edge["metadata"].get("lateral") for edge in persisted.snapshot()["edges"])


def test_graph_caps_and_traces_elastic_children():
    graph = StateGraph(
        [GraphNode(node_id="root", kind=GraphNodeKind.AGENT)],
        max_elastic_depth=1,
        max_elastic_nodes=1,
    )
    child = GraphNode(
        node_id="elastic-1",
        kind=GraphNodeKind.ELASTIC,
        dependencies=["root"],
        elastic_depth=1,
    )

    graph.spawn_elastic_child("root", child)

    with pytest.raises(ValueError, match="Elastic node cap"):
        graph.spawn_elastic_child(
            "root",
            GraphNode(
                node_id="elastic-2",
                kind=GraphNodeKind.ELASTIC,
                dependencies=["root"],
                elastic_depth=1,
            ),
        )
