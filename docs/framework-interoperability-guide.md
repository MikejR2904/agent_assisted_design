# Framework Interoperability Guide

**Status:** Implemented in `agent-design-agent-sdk` 0.14.0.
**Scope:** Optional LangGraph, LangChain, and TypeSafe Jev integrations for an embedding host.
**Authority boundary:** The Agent SDK remains the sole authority for agent contracts, capability policy, approval, governed execution, deterministic verification, project state, graph-state coordination, telemetry, and audit evidence.

## 1. Purpose and non-negotiable boundary

The Agent SDK permits interoperability with established orchestration frameworks without ceding control of an ASIC-design run. This design follows the project framework’s separation of reasoning agents from deterministic modules and its common BaseAgent contract, which explicitly includes tools, memory, termination, and verification.[1] It also follows the framework’s requirement that workers coordinate through typed graph state rather than shared dialogue.[2]

> **External code may propose, schedule, classify, or veto. It may not grant a capability, approve an action, bypass a verification gate, mutate authoritative graph state, or execute a governed tool outside the SDK harness.**

This restriction is intentional. The project design identifies deterministic tool hooks as the lifecycle boundary and reserves process termination to the supervised tool-execution layer.[3] Therefore, a LangChain tool wrapper and a LangGraph node are integration façades, not reference monitors.

## 2. Installation

The optional extras keep the base package free of LangGraph, LangChain, TypeSafe, and cloud credentials.

```bash
# One framework only
uv pip install "agent-design-agent-sdk[langgraph]"
uv pip install "agent-design-agent-sdk[langchain]"
uv pip install "agent-design-agent-sdk[jev]"

# All currently supported adapters
uv pip install "agent-design-agent-sdk[interop]"
```

For repository development, run the already locked dependency set:

```bash
cd packages/agent-sdk
uv sync --all-groups --extra interop
uv run pytest tests/integrations
uv run python examples/framework_interoperability.py
```

Importing `agent_sdk.integrations` remains safe when no optional extra is installed. A concrete adapter lazily loads its framework and gives an actionable missing-extra error only when the host tries to use it.

## 3. Framework-neutral contracts

`agent_sdk.integrations.contracts` is the portable seam for another orchestration framework. It contains strict Pydantic contracts and Python protocols, not LangGraph or LangChain imports.

| Contract | Use | Deliberately excluded |
|---|---|---|
| `InteropRunEnvelope` | Versioned, bounded hand-off across a framework boundary. | Raw messages, audit transcript text, credentials, approval tokens, tool arguments/results, and capability grants. |
| `InteropReceipt` | Digest-only record of an external operation. | Raw request/response payloads. |
| `ExternalDecisionProvider` | Read-only provider protocol for an evaluator such as Jev. | Tool execution, callbacks, mutable graph access, authority handles. |
| `InteropFailureMode` | Explicit `escalate`, `reject`, or deterministic fallback policy. | Silent approval and implicit retry. |

The host must build `InteropRunEnvelope.projection` from a purpose-specific, sanitized data transfer object. `assert_sanitized_interop_value()` rejects credential-shaped keys, approval-related keys, raw transcript/message fields, callables, and non-JSON values before an adapter sends anything externally. `InteropRunEnvelope` derives the canonical projection digest when omitted and rejects a caller-supplied digest that does not match. A digest of that projection, rather than the projection itself, is what goes into a receipt.

## 4. Using the SDK inside LangGraph

LangGraph is a low-level framework for durable stateful agent workflows and supports mixing deterministic and model-driven nodes.[4] Its checkpointers support recovery, but the SDK keeps the canonical project-state, telemetry, and audit ledgers because a LangGraph checkpoint is not a substitute for the SDK’s evidence chain.[5]

Use `LangGraphSdkNode` with a host-owned `LangGraphSdkNodeBinding`:

```python
from agent_sdk import (
    AgentRuntimeServices,
    InteropRunEnvelope,
    LangGraphSdkNode,
    LangGraphSdkNodeBinding,
    TelemetryContext,
    TelemetryInteropReceiptSink,
    build_langgraph_state_graph,
)

services = AgentRuntimeServices.open(run_root)
binding = LangGraphSdkNodeBinding(
    node_name="rtl-worker",
    definition=rtl_definition,
    task_adapter=lambda host_state: make_scoped_task(host_state),
    model_factory=lambda host_state: host_model_adapter(),
)
node = LangGraphSdkNode(
    services,
    binding,
    lambda host_state: InteropRunEnvelope(
        run_id=run_id,
        external_thread_id=host_state.get("thread_id"),
        projection={"task_ref": host_state["task_ref"]},
        remaining_turn_budget=1,
    ),
    receipt_sink=TelemetryInteropReceiptSink(
        services.telemetry,
        lambda receipt: TelemetryContext(run_id=receipt.run_id, stage="langgraph"),
    ),
)
compiled = build_langgraph_state_graph(HostState, "rtl_worker", node)
```

The node validates the envelope budget, runs the normal `BaseAgent` through `AgentRuntimeServices`, and returns a compact `agent_sdk_transition` mapping containing terminal status, remaining turn budget, binding digest, result digest, and project-state digest. A durable receipt sink is required and separately records the `InteropReceipt`. It does not pass `MessagesState`, raw LangGraph state, or a sibling worker transcript into the model.

### Human approval and interrupts

`langgraph_interrupt_payload()` makes a display-safe `LangGraphApprovalChallenge`. It contains a stable challenge ID, immutable action digest, expiry, policy version, and human-readable safe summary. It is **not** an approval executor. On resume, the embedding host must resolve the same challenge and idempotency key through the SDK approval registry before dispatching a state-changing tool. This is necessary because a resumed LangGraph node may restart from its entry point.[6]

## 5. Using a LangGraph component inside the SDK graph

Use `LangGraphNodeExecutor` when a particular SDK `StateGraph` node should delegate bounded computation to a host-owned compiled LangGraph Runnable. The adapter receives `GraphNodeExecutionContext`, projects declared dependencies plus a read-only graph-state view, invokes the Runnable, and reduces validated output into `GraphNodeResult`.

```python
executor = LangGraphNodeExecutor(
    compiled_langgraph,
    input_projector=lambda node, context: {
        "node_id": node.node_id,
        "dependencies": {key: value.model_dump(mode="json") for key, value in context.dependencies.items()},
    },
    output_reducer=reduce_to_declared_graph_result,
)
```

An arbitrary LangGraph graph is intentionally not auto-converted into `StateGraph`. The SDK cannot infer whether arbitrary third-party nodes respect the project’s exact dependency proofs, capability policy, provenance, or graph-isolation requirements.[2]

## 6. LangChain integration

LangChain provides middleware that can wrap model and tool calls.[7] The SDK treats those wrappers as optional observation or pre-filtering points only; it preserves SDK validation and tool authority.

### 6.1 Adapt a LangChain model to `AgentModel`

`LangChainAgentModelAdapter` requires two host functions:

1. A **prompt projector** from bounded `ModelContext` to the minimum LangChain input.
2. A **turn parser** that returns an SDK `AgentTurn` or `ModelTurnResponse`.

```python
from agent_sdk import LangChainAgentModelAdapter, parse_structured_sdk_turn

model = LangChainAgentModelAdapter(
    runnable=selected_langchain_model,
    prompt_projector=lambda context: {
        "task_id": context.task.id,
        "project_state": context.project_state.model_dump(mode="json"),
    },
    turn_parser=parse_structured_sdk_turn,
)
```

`parse_structured_sdk_turn` validates a structured mapping; it never infers a tool call from uncontrolled prose. The SDK then validates the resulting turn and applies its normal tool-batch scheduler, policy, watchdog, result-journal, verification, and telemetry paths.

For a chat-model Runnable, the prompt projector may emit one bounded `system` message and one bounded `user` message. The adapter rejects assistant/tool roles, duplicate roles, any other message field, and more than two messages, so ambient conversation history cannot cross this boundary.

### 6.2 Expose an SDK agent as a LangChain Runnable

`LangChainSdkRunnable` accepts a `ScopedAgentTask` or a validated JSON mapping and returns a bounded `AgentResult` mapping. It does not accept ambient chat history.

### 6.3 Expose a declared SDK tool as a LangChain tool

`LangChainSdkToolFacade` turns one declared `ToolDefinition` into a schema-preserving `StructuredTool`. It re-enters the supplied SDK `ToolExecutor` with a constructed `ToolInvocationContext`; it does not create a direct shell or callback path. The embedding host must still supply capability policy and approval through its executor.

## 7. TypeSafe Jev: advisory verification and exploration

Jev is TypeSafe AI’s System One evaluator. It answers typed `Noul`, `Choice`, or `Score` questions over caller-supplied state; it is not a generative model, code producer, or tool executor.[8] TypeSafe describes its outputs as calibrated probabilities and explicitly cautions that calibration is not a guarantee of correctness for an individual answer.[9]

The SDK therefore supports Jev only as an **optional, read-only advisor**. Suitable uses include semantic-review triage, deciding which already-safe diagnostic deserves additional investigation, and adding a bounded advisory result after a deterministic gate passes. It is unsuitable for proving RTL correctness, granting a capability, approving EDA execution, changing a locked interface, or accepting an output by itself.

### 7.1 Define a versioned question specification

```python
from agent_sdk.integrations import JevNoulQuestion, JevQuestionSpec

question_spec = JevQuestionSpec(
    spec_id="review-completeness",
    version="v1",
    questions={
        "complete": JevNoulQuestion(
            instructions="The supplied evidence supports a complete review.",
            criteria={True: "All required evidence exists.", False: "Evidence is missing."},
        )
    },
)
```

A request has a selected pinned model identifier, bounded redacted JSON state, a deadline, a maximum of three attempts, and either `verification` or `exploration` purpose. `TypeSafeJevDecisionEvaluator` requires an explicit receipt sink. Production code should use `TelemetryJevReceiptSink`; `InMemoryJevReceiptStore` is intended only for tests and offline development.

```python
from agent_sdk.integrations import (
    TelemetryJevReceiptSink,
    TypeSafeJevDecisionEvaluator,
)

jev = TypeSafeJevDecisionEvaluator(
    receipt_sink=TelemetryJevReceiptSink(telemetry, lambda receipt: telemetry_context),
    policy_version="review-policy-v1",
)
```

The evaluator writes receipt metadata only: state digest, question-spec digest, response digest, model/request reference when supplied, duration, retry count, status, policy outcome, and provider-reported token counters. It must never write submitted Jev state, question text, provider response payload, secrets, or approval tokens.

### 7.2 Compose Jev with a local verification gate

`JevAdvisoryVerificationGate` runs the existing deterministic gate first. A local rejection is final and does not call Jev. A successful deterministic result may then be accepted, rejected for retry, or escalated according to fixed host policy. Jev cannot change a local rejection into acceptance.

### 7.3 Rank safe exploration candidates

`JevExplorationAdvisor` receives candidates the SDK has already judged safe to consider. Its output only chooses an order among those candidates. If the provider is unavailable, its declared `InteropFailureMode` controls deterministic fallback, rejection, or escalation; no evaluator error becomes an approval.

### 7.4 Conservatively advise orchestration architecture

`JevArchitectureRouter` is the only Jev path that reaches orchestration. The SDK first
computes a `ComplexityRouter` result from user-configured thresholds. The advisory then
receives only a bounded projection: stage, gap metadata, task/dependency counts, model
tiers, and declared elastic limits. A policy-valid advisory may lift
`single-agent` to `multi-agent`; it may not lower a deterministic multi-agent route,
override `multi_agent_enabled`, approve the plan, select a model, grant a capability,
or mutate the `StateGraph`.[11] [12]

The orchestration record stores the typed advice and its routing outcome. A real host
uses the same sanitized request and receipt requirements as every other Jev operation.
The remote MCP lifecycle intentionally cannot receive an evaluator response or
credentials, preventing a caller-supplied advisory payload from becoming authority.
Read the [governed orchestration guide](orchestration-guide.md) for the complete
policy and host-binding lifecycle.[12]

## 8. Observability and data-sharing policy

Interop operations should create both a `TelemetryEvent` and an `InteropReceipt`. A receipt contains hashes and stable identifiers only, while existing SDK audit logs stay local and review-only. The host’s data-sharing policy determines whether it may send a sanitized projection to a third party. TypeSafe’s LangChain documentation specifically warns that state and tool arguments sent to TypeSafe should not contain secrets unless that sharing is acceptable.[10]

Before enabling a remote evaluator, test the state projector with fixtures containing secrets, approval tokens, transcripts, callbacks, and raw tool results. The integration layer must reject them before dispatch. Do not enable a tracing service merely because a framework supports it; construct a separate redacted exporter from receipts if the project later authorizes that data flow.

## 9. Supported extension path for another framework

A host can adapt another known framework without changing `BaseAgent` by doing four things: use `InteropRunEnvelope` as the hand-off DTO; project only allowed JSON; invoke SDK graph/agent/tool/verification interfaces rather than bypassing them; and persist an `InteropReceipt` in the host-selected telemetry path. Add a dedicated optional extra, a lazy import, strict input/output validation, missing-dependency behavior, authority-boundary tests, and a source-grounded guide before calling the adapter supported.

## References

[1]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 50, lines 4–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[2]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 60, lines 2–19](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[3]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 55, lines 2–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[4]: [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)

[5]: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

[6]: [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

[7]: [LangChain custom middleware](https://docs.langchain.com/oss/python/langchain/middleware/custom)

[8]: [TypeSafe System One API](https://docs.typesafe.ai/api)

[9]: [TypeSafe System One concepts](https://docs.typesafe.ai/concepts/system-one)

[10]: [LangChain TypeSafe integration](https://docs.langchain.com/oss/python/integrations/providers/typesafe)

[11]: [Agent-Assisted Design Framework Systems Design, updated PDF, pp. 41–42, lines 2–12 and 2–13](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[12]: [Agent SDK orchestration implementation](../packages/agent-sdk/src/agent_sdk/orchestrator.py)
