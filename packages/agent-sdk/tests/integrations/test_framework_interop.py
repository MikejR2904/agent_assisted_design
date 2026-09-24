from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest
from conftest import sample_definition, sample_task
from pydantic import ValidationError

from agent_sdk.base_agent import BaseAgent
from agent_sdk.graph import (
    GraphNode,
    GraphNodeExecutionContext,
    GraphNodeKind,
    GraphNodeResult,
    GraphNodeStatus,
    GraphSharedState,
)
from agent_sdk.integrations import (
    InMemoryInteropReceiptStore,
    InteropOperationStatus,
    InteropReceipt,
    InteropRunEnvelope,
    LangChainAgentModelAdapter,
    LangChainSdkRunnable,
    LangChainSdkToolFacade,
    LangGraphNodeExecutor,
    TelemetryInteropReceiptSink,
    build_langgraph_state_graph,
    parse_structured_sdk_turn,
)
from agent_sdk.model import ModelContext
from agent_sdk.telemetry import TelemetryContext, TelemetryStore
from agent_sdk.tools import InMemoryTaskToolExecutor, ToolInvocationContext


def test_interop_envelope_derives_and_verifies_projection_digest() -> None:
    envelope = InteropRunEnvelope(
        run_id="interop-digest-test",
        projection={"task_ref": "task-interface-1"},
        remaining_turn_budget=1,
    )

    assert envelope.projection_digest is not None
    with pytest.raises(ValidationError, match="projection_digest"):
        InteropRunEnvelope(
            run_id="interop-digest-test",
            projection={"task_ref": "task-interface-1"},
            projection_digest="0" * 64,
            remaining_turn_budget=1,
        )


@pytest.mark.parametrize(
    "unsafe_projection",
    [
        {"messages": [{"role": "user", "content": "raw transcript"}]},
        {"approval_token": "must-not-cross-boundary"},
        {"callback": lambda: None},
    ],
)
def test_interop_envelope_rejects_authority_and_transcript_material(
    unsafe_projection: dict[str, Any],
) -> None:
    with pytest.raises((TypeError, ValueError), match="Unsafe key|JSON-compatible"):
        InteropRunEnvelope(
            run_id="interop-redaction-test",
            projection=unsafe_projection,
            remaining_turn_budget=1,
        )


def test_interop_envelope_rejects_oversized_projection_data() -> None:
    with pytest.raises(ValueError, match="maximum length"):
        InteropRunEnvelope(
            run_id="interop-bounds-test",
            projection={"safe_ref": "x" * 16_385},
            remaining_turn_budget=1,
        )


def test_generic_receipt_sink_persists_digest_only_event(tmp_path) -> None:
    telemetry = TelemetryStore(tmp_path)
    receipt = InteropReceipt(
        provider="langgraph",
        operation="sdk-agent-node",
        status=InteropOperationStatus.SUCCEEDED,
        run_id="interop-receipt-test",
        projection_digest="a" * 64,
        result_digest="b" * 64,
    )

    TelemetryInteropReceiptSink(
        telemetry,
        lambda event_receipt: TelemetryContext(run_id=event_receipt.run_id),
    )(receipt)

    event = telemetry.list_events("interop-receipt-test")[0]
    assert event.event_type == "interop.external_operation"
    assert event.payload["projection_digest"] == "a" * 64


@dataclass
class RecordingRunnable:
    response: Any
    inputs: list[Any]

    async def ainvoke(self, input: Any, config: dict[str, Any] | None = None) -> Any:
        del config
        self.inputs.append(input)
        return self.response


@pytest.mark.anyio
async def test_langchain_model_adapter_runs_through_sdk_contract_validation() -> None:
    runnable = RecordingRunnable(
        response={"type": "final", "output": {"status": "complete", "findings": []}},
        inputs=[],
    )
    model = LangChainAgentModelAdapter(
        runnable,
        lambda _: {"messages": [{"role": "user", "content": "validate artifact"}]},
        parse_structured_sdk_turn,
    )

    result = await BaseAgent(sample_definition(), model).run(sample_task())

    assert result.status.value == "completed"
    assert runnable.inputs == [{"messages": [{"role": "user", "content": "validate artifact"}]}]


@pytest.mark.anyio
async def test_langchain_tool_facade_reenters_sdk_executor() -> None:
    definition = sample_definition()
    task = sample_task()
    tool = next(item for item in definition.tools if item.name == "echo")
    executor = InMemoryTaskToolExecutor()

    def invocation(arguments: dict[str, Any]) -> ToolInvocationContext:
        from agent_sdk.contracts import ToolCall

        return ToolInvocationContext(
            agent_identity=definition.identity,
            task=task,
            iteration=1,
            call=ToolCall(id="langchain-call", name="echo", arguments=arguments),
        )

    facade = LangChainSdkToolFacade(tool, executor, invocation)
    response = await facade.as_tool().ainvoke({"value": "safe"})

    assert response == {"status": "succeeded", "output": {"value": "safe"}, "error": None}
    assert len(executor.calls) == 1
    assert executor.calls[0].call.arguments == {"value": "safe"}


@pytest.mark.anyio
async def test_langchain_sdk_runnable_returns_agent_result_projection() -> None:
    async def run_agent(_: Any) -> dict[str, Any]:
        return {"type": "final", "output": {"status": "complete", "findings": []}}

    class OneTurnModel:
        async def next_turn(self, context: ModelContext) -> dict[str, Any]:
            del context
            return await run_agent(None)

    runnable = LangChainSdkRunnable(lambda _: BaseAgent(sample_definition(), OneTurnModel()))
    response = await runnable.as_runnable().ainvoke(sample_task().model_dump(mode="json"))

    assert response["status"] == "completed"
    assert response["output"] == {"status": "complete", "findings": []}


@pytest.mark.anyio
async def test_langgraph_executor_projects_and_reduces_without_importing_graph_state() -> None:
    runnable = RecordingRunnable(response={"outcome": "complete"}, inputs=[])
    node = GraphNode(node_id="external", kind=GraphNodeKind.FUNCTION)
    context = GraphNodeExecutionContext(shared_state=GraphSharedState.unbound())
    executor = LangGraphNodeExecutor(
        runnable,
        lambda current_node, _: {"node_id": current_node.node_id},
        lambda output, _, __: GraphNodeResult(
            status=GraphNodeStatus.COMPLETED,
            output=output,
        ),
    )

    result = await executor.execute(node, context)

    assert result.status is GraphNodeStatus.COMPLETED
    assert runnable.inputs == [{"node_id": "external"}]


@pytest.mark.anyio
async def test_langgraph_sdk_node_emits_a_durable_interop_receipt(tmp_path) -> None:
    from agent_sdk.integrations.langgraph import LangGraphSdkNode, LangGraphSdkNodeBinding
    from agent_sdk.model import ScriptedModel
    from agent_sdk.runtime import AgentRuntimeServices

    binding = LangGraphSdkNodeBinding(
        node_name="sdk-node",
        definition=sample_definition(),
        task_adapter=lambda _: sample_task(),
        model_factory=lambda _: ScriptedModel(
            [{"type": "final", "output": {"status": "complete", "findings": []}}]
        ),
    )
    receipts = InMemoryInteropReceiptStore()
    sdk_node = LangGraphSdkNode(
        AgentRuntimeServices.open(tmp_path),
        binding,
        lambda _: InteropRunEnvelope(
            run_id="langgraph-test",
            projection={"task_ref": "task-interface-1"},
            remaining_turn_budget=1,
        ),
        receipt_sink=receipts,
    )

    graph = build_langgraph_state_graph(dict, "sdk-node", sdk_node)
    result = await graph.ainvoke({})

    assert result["agent_sdk_transition"]["status"] == "completed"
    assert len(receipts.receipts) == 1
    assert receipts.receipts[0].provider == "langgraph"
