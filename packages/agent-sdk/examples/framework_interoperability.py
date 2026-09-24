"""Run from the package root after ``uv sync --extra interop``.

This example uses local, deterministic LangChain and LangGraph components. It
makes no remote model or Jev call. A production host must supply a reviewed
state projector and a durable Jev receipt sink before it constructs a real
TypeSafeJevDecisionEvaluator.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from langchain_core.runnables import RunnableLambda
from typing_extensions import TypedDict

from agent_sdk import (
    AgentDefinition,
    AgentRuntimeServices,
    InteropRunEnvelope,
    LangChainAgentModelAdapter,
    LangGraphSdkNode,
    LangGraphSdkNodeBinding,
    ModelBinding,
    ScopedAgentTask,
    TaskScope,
    TelemetryContext,
    TelemetryInteropReceiptSink,
    TerminationPolicy,
    VersionedInstructions,
    build_langgraph_state_graph,
    parse_structured_sdk_turn,
)
from agent_sdk.integrations import JevNoulQuestion, JevQuestionSpec


class HostState(TypedDict, total=False):
    task_id: str
    agent_sdk_transition: dict[str, Any]


def definition() -> AgentDefinition:
    return AgentDefinition(
        identity="Return a bounded interface validation result.",
        instructions=VersionedInstructions(
            version="interop-example-v1",
            text="Return a typed final result without requesting a tool.",
        ),
        input_schema={"type": "object", "additionalProperties": False},
        output_schema={
            "type": "object",
            "properties": {"status": {"const": "complete"}, "findings": {"type": "array"}},
            "required": ["status", "findings"],
            "additionalProperties": False,
        },
        model_binding=ModelBinding(provider="host", model="local-example"),
        termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
    )


def task() -> ScopedAgentTask:
    return ScopedAgentTask(
        id="interop-example-task",
        input={},
        scope=TaskScope(label="demo"),
        locked_interface={"signals": ["ready"]},
        instructions="Return the declared structured output.",
        acceptance_criteria=["Return status complete."],
    )


async def langchain_turn(_: dict[str, Any]) -> dict[str, Any]:
    return {"type": "final", "output": {"status": "complete", "findings": []}}


def make_model() -> LangChainAgentModelAdapter:
    return LangChainAgentModelAdapter(
        RunnableLambda(langchain_turn),
        lambda context: {
            "task_id": context.task.id,
            "project_state": context.project_state.model_dump(mode="json"),
        },
        parse_structured_sdk_turn,
    )


async def main() -> None:
    services = AgentRuntimeServices.open(Path(".interop-example-run"))
    binding = LangGraphSdkNodeBinding(
        node_name="sdk-agent",
        definition=definition(),
        task_adapter=lambda _: task(),
        model_factory=lambda _: make_model(),
    )
    sdk_node = LangGraphSdkNode(
        services,
        binding,
        lambda _: InteropRunEnvelope(
            run_id="interop-example-run",
            projection={"task_ref": task().id},
            remaining_turn_budget=1,
        ),
        receipt_sink=TelemetryInteropReceiptSink(
            services.telemetry,
            lambda receipt: TelemetryContext(
                run_id=receipt.run_id,
                task_id=task().id,
                stage="interop-example",
            ),
        ),
    )
    graph = build_langgraph_state_graph(HostState, "sdk-agent", sdk_node)
    result = await graph.ainvoke({"task_id": task().id})
    print(result["agent_sdk_transition"])

    # A fixed host-owned question specification is safe to define locally.  The
    # evaluator is deliberately not constructed or called in this offline example.
    review_question = JevQuestionSpec(
        spec_id="review-completeness",
        version="v1",
        questions={
            "complete": JevNoulQuestion(
                instructions="The evidence supports completeness.",
                criteria={True: "All required evidence exists.", False: "Evidence is missing."},
            )
        },
    )
    print(review_question.digest)


if __name__ == "__main__":
    asyncio.run(main())
