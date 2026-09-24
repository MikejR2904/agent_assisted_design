from __future__ import annotations

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.graph import GraphNode, GraphNodeKind, GraphNodeStatus, StateGraph
from agent_sdk.graph_agent_executor import GraphAgentBinding, GraphAgentExecutor
from agent_sdk.model import ScriptedModel
from agent_sdk.runtime import AgentRuntimeServices


@pytest.mark.anyio
async def test_graph_agent_executor_runs_scoped_agent_without_sibling_transcript(tmp_path):
    services = AgentRuntimeServices.open(tmp_path)
    graph = StateGraph(
        [
            GraphNode(node_id="agent-a", kind=GraphNodeKind.AGENT, task_id="task-a"),
            GraphNode(node_id="agent-b", kind=GraphNodeKind.AGENT, task_id="task-b"),
        ]
    )
    contexts_seen: list[tuple[str, list[str]]] = []

    def task_adapter(node, context):
        contexts_seen.append((node.node_id, sorted(context.dependencies)))
        return sample_task(id=node.task_id or node.node_id)

    def model_factory(_node, _context):
        return ScriptedModel([{"type": "final", "output": {"status": "complete", "findings": []}}])

    bindings = {
        node_id: GraphAgentBinding(
            node_id=node_id,
            definition=sample_definition(),
            task_adapter=task_adapter,
            model_factory=model_factory,
            idempotent=node_id == "agent-a",
        )
        for node_id in ["agent-a", "agent-b"]
    }
    executor = GraphAgentExecutor(services, bindings)

    results = await graph.execute(executor.executors())

    assert all(result.status is GraphNodeStatus.COMPLETED for result in results.values())
    assert contexts_seen == [("agent-a", []), ("agent-b", [])]
    assert executor.idempotent_node_ids() == {"agent-a"}
    assert all(
        any(diagnostic.startswith("binding-hash:") for diagnostic in result.diagnostics)
        for result in results.values()
    )


def test_graph_recovery_replays_only_declared_idempotent_nodes():
    graph = StateGraph(
        [
            GraphNode(node_id="safe", kind=GraphNodeKind.AGENT),
            GraphNode(node_id="unsafe", kind=GraphNodeKind.AGENT),
        ]
    )
    graph.start_runnable_wave()

    recovered = graph.recover_interrupted({"safe"})

    assert recovered == ["safe", "unsafe"]
    assert graph.status("safe") is GraphNodeStatus.RUNNABLE
    assert graph.status("unsafe") is GraphNodeStatus.FAILED
    assert graph.result("unsafe").diagnostics == ["interrupted-non-idempotent"]
