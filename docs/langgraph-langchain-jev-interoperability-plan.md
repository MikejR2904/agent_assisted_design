# LangGraph, LangChain, and Jev Interoperability Plan

**Status:** Implemented in Agent SDK 0.13.0. Optional framework dependencies are locked for
local validation; no remote Jev request, API key, LangSmith tracing configuration, or default
cloud-provider selection has been made.
**Scope:** Extend `packages/agent-sdk` so that applications can use the SDK inside LangGraph and LangChain, or use carefully bounded LangGraph/LangChain components from the SDK. Add Jev only as an optional, non-authoritative evaluator for verification and exploration triage.

## Executive decision

The SDK should **adopt LangGraph as an optional execution-orchestration integration**, because LangGraph is explicitly a low-level framework for durable, stateful orchestration that can mix deterministic and LLM-driven nodes.[1] This agrees with the framework design’s requirement that graph nodes exchange typed state and results rather than shared worker transcripts.[2] LangGraph must not become the SDK’s authority engine, audit ledger, or source of truth for approved side effects.

The SDK should **support LangChain as an optional component integration**, not replace `BaseAgent` with LangChain’s high-level agent loop. LangChain middleware can intercept model and tool calls, including retry behavior, but its hooks are an integration surface rather than the SDK’s deterministic capability, approval, watchdog, and verification boundary.[3] The implementation will therefore make the SDK available as a LangChain Runnable/tool bridge and will permit an injected LangChain Runnable to serve as a model adapter after host-owned projection and typed-turn validation.

The requested “Jev AI” resolves to **Jev, TypeSafe AI’s System One evaluator**. Jev evaluates a supplied state against typed `Noul`, `Choice`, or `Score` questions and returns structured probabilities; it does not generate text, code, tool calls, or explanations.[4] [5] The proposed use is therefore an optional, host-contained **advisory verifier and exploration triage provider**. It can block acceptance or request human/controller review, but it can never grant a capability, approve an operation, execute a tool, or replace deterministic checks.

> **Invariant:** An external framework or evaluator may propose, schedule, classify, or veto. Only the SDK host policy, approval registry, deterministic verification code, and governed tool executor may authorize or execute an action.

## Why the boundary is necessary

The system design requires a shared **typed graph state**, no shared worker conversation, deterministic graph modules, and mechanically checked contradictions.[2] Its common BaseAgent contract separately names tools, memory, termination, and verification.[6] It also identifies pre/post-tool interception as deterministic policy and audit points; subprocess supervision remains in the execution layer rather than in a model-facing hook.[7]

LangGraph offers useful graph compilation, checkpoints, persistence, and interrupts. Its checkpointers persist thread-scoped graph snapshots while stores retain application-defined cross-thread data.[8] Those are operational recovery primitives, not documented cryptographic audit records. The SDK will retain its hash-linked telemetry and audit stores as the authority evidence. LangGraph’s interrupt documentation also states that a resumed node restarts from the beginning, which makes host-issued idempotency keys and post-approval execution mandatory.[9]

Jev is similarly not a replacement for the current verification design. TypeSafe describes calibrated probabilities as group-level behavior and explicitly notes that calibration does not guarantee an individual answer is correct.[5] A Jev result can therefore supplement semantic review, but cannot prove RTL correctness, satisfy a deterministic acceptance criterion, or act as an authorization decision.

## Compatibility architecture

### Framework-neutral interoperability contracts

Add `agent_sdk.integrations` as a small dependency-free package. Its contracts will be strict Pydantic data models and Python protocols only. This package will define the following concepts:

| Contract | Purpose | Data explicitly excluded |
|---|---|---|
| `InteropRunEnvelope` | A versioned, sanitized run/node envelope: SDK run ID, external thread/run ID, current graph node ID, remaining host turn budget, opaque state/result references, and digests. | Raw transcript, API keys, approval tokens, tool arguments/results, capability grants. |
| `SanitizedStateProjector` | A host-injected function that turns an SDK graph node context into the envelope’s allowed JSON projection. | Any direct framework state serialization. |
| `InteropReceipt` | A canonical external-operation receipt: provider/framework ID, operation type, projection digest, result digest, model/version, timing, status, and request identifier when supplied. | Raw remote request/response. |
| `ExternalDecisionProvider` | A read-only asynchronous decision protocol for optional evaluators such as Jev. | Tool executor, callback, mutable graph state, authority handle. |
| `InteropFailureMode` | Explicit `ESCALATE`, `REJECT`, or `FALLBACK_DETERMINISTIC` behavior. | Silent retry or implicit authorization. |

The BaseAgent, policy engine, approval registry, `ToolExecutor`, and existing `StateGraph` stay framework-owned. An integration imports those contracts; it does not replace them.

### LangGraph adapter: SDK inside LangGraph

Add `agent_sdk.integrations.langgraph` behind an optional `langgraph` extra. It will expose a factory that constructs a LangGraph node around a registered `GraphAgentBinding` and `AgentRuntimeServices`. The node will receive a host-defined, sanitized LangGraph state, restore only opaque SDK references, call the existing graph-bound `BaseAgent` executor, and return a reduced envelope containing status, result digest, provenance hash, next routing key, remaining host budget, and ledger/checkpoint references.

The adapter will not accept `MessagesState`, transmit full SDK audit text, or use `ToolNode` for governed SDK tools. A model-facing tool call stays inside the existing SDK batch scheduler and capability/approval path. This preserves the current architecture: agent nodes exchange typed results through the SDK graph, not sibling transcripts.[2]

The adapter will support a host-defined `thread_id`, but the existing SDK ledger remains canonical. A LangGraph checkpoint identifier and parent reference become cross-links in an SDK `InteropReceipt`; the adapter will not infer a hash chain from checkpoint ordering. Only a host-created telemetry event links the canonical redacted transition digest to the previous SDK event hash.

For human approval, the adapter will provide an **interrupt payload constructor**, not a direct approval executor. It serializes only a stable approval-challenge ID, action digest, display-safe summary, expiry, and policy version. On resume, the host must validate the same immutable challenge and idempotency key through the SDK approval registry before any action dispatch. The integration test will prove that an interrupted/resumed node cannot duplicate a state-changing host callback.[9]

### LangGraph adapter: LangGraph inside the SDK

Add a `LangGraphNodeExecutor` that satisfies the SDK `NodeExecutor` protocol. It will invoke a host-supplied compiled LangGraph Runnable only through a `LangGraphInvocationAdapter` that maps a read-only SDK `GraphNodeExecutionContext` to `InteropRunEnvelope`, validates a declared output schema, and reduces the response to an SDK `GraphNodeResult`. This supports an application that already owns LangGraph while retaining the SDK’s state graph as the lateral-coordination authority.

The initial release deliberately excludes automatic conversion of an arbitrary LangGraph graph into an SDK `StateGraph`. That conversion cannot prove that arbitrary nodes uphold the SDK’s policy, provenance, and state-isolation invariants. The adapter is explicit per node.

### LangChain adapter

Add `agent_sdk.integrations.langchain` behind optional `langchain` and `langchain-core` extras.

First, `LangChainRunnableAgent` will expose a typed SDK invocation through the LangChain Runnable interface. It will accept a `ScopedAgentTask` or an explicit validated task-envelope mapping and return a bounded `AgentResult` mapping. It will not accept ambient message histories.

Second, `LangChainAgentModelAdapter` will adapt a host-provided LangChain Runnable/model to the SDK’s `AgentModel` protocol. It requires an injected `LangChainPromptProjector` and `LangChainTurnParser`. The projector constructs the minimum model input from `ModelContext`; the parser must return the SDK’s validated `AgentTurn` or `ModelTurnResponse`. No convenience parser will infer tool calls from uncontrolled prose.

Third, `as_langchain_tool()` will create a schema-only LangChain tool façade for a declared SDK tool. Its sole implementation is an SDK-host callback that repeats policy, capability, approval, quota, idempotency, and schema validation before delegation. LangChain `wrap_tool_call` middleware can observe or pre-filter the façade, but it is explicitly defense in depth; it is not a reference monitor. LangChain documentation confirms that wrappers can short-circuit or retry calls, so action-side checks must remain in the SDK executor.[3]

The adapters will disable implicit tracing. They will not create LangSmith callbacks or emit raw framework state. An application that chooses LangSmith must build a separate redacted exporter from `InteropReceipt` and explicitly configure its own data-sharing policy.

### Jev evaluator provider

Add `agent_sdk.integrations.jev` behind an optional `typesafe-sdk` extra. The package remains import-safe without that extra; only construction of the concrete TypeSafe client raises an actionable dependency error.

The provider will implement a narrow `JevDecisionEvaluator` protocol and these serializable models:

| Model | Role |
|---|---|
| `JevQuestionSpec` | Versioned, allow-listed `Noul`, `Choice`, or `Score` question definitions. |
| `JevDecisionRequest` | Canonical redacted state projection, model ID, question-spec ID/version/hash, deadline, and purpose (`verification` or `exploration`). |
| `JevDecisionResult` | Resolved model ID, normalized typed answers, confidence/probability, provider request ID if returned, provider-reported usage, and a response digest. |
| `JevDecisionReceipt` | SDK persistence object containing digests, policy threshold/version, timing, retry count, outcome, and no raw remote payload. |

`TypeSafeJevDecisionEvaluator` will use `AsyncTypeSafeClient.system_one(...)`, as documented by TypeSafe’s Python SDK.[10] It will accept only a caller-selected model ID. The recommended default is a version-pinned model rather than the moving `jev-latest` alias. The evaluator will bound state bytes, question count/options, deadline, and retry attempts; it will map provider/network/overload failures to an explicit unavailable outcome, never to approval.[4]

A `JevAdvisoryVerificationGate` will compose an existing local deterministic gate and a fixed Jev question specification. The deterministic gate runs first. If it rejects, Jev cannot override that result. If it passes, Jev may produce one of three host-policy outcomes: **accept with advisory receipt**, **reject/retry**, or **escalate** when unavailable, below threshold, contradictory, or outside its declared applicability. It never returns “approved to execute.”

A `JevExplorationAdvisor` will optionally score or triage already-safe exploration candidates, such as which source-backed document segment deserves a human review or which failed diagnostic merits an elastic investigation. Its result only changes a proposed priority list. The existing deterministic `StructuralContextSelector`, PCKP selection, exact-reference graph routing, and policy engine remain unchanged by default. A Jev result cannot create an elastic node, alter locked interfaces, or publish graph state without the existing controller validations.

### Telemetry, audit, and privacy

Every external-framework or Jev operation writes an SDK telemetry event and `InteropReceipt` with `TelemetryAuthority.TOOL` or `SYSTEM`, a stable operation identifier, result/transition digests, duration, status, and provider-reported tokens when available. The standard metric catalogue will add explicit availability-aware metrics for interop calls, Jev input/output tokens, decision confidence, policy outcome, unavailable count, and escalation count. As with the current telemetry design, missing provider values remain unavailable rather than becoming zero.

Raw LangGraph state, LangChain messages, Jev state, question text, model output, tool arguments, credentials, and approval tokens are forbidden in `InteropReceipt`, telemetry payloads, and audit logs. The host must supply the state projector. This is essential because TypeSafe’s own LangChain documentation warns that state and tool arguments are sent to TypeSafe and should not contain secrets unless that transmission is acceptable.[11]

## Optional dependency and packaging plan

```toml
[project.optional-dependencies]
langgraph = ["langgraph>=1.2,<2"]
langchain = ["langchain>=1.2,<2", "langchain-core>=1.4,<2"]
jev = ["typesafe-sdk>=0.7,<1"]
interop = [
  "agent-design-agent-sdk[langgraph,langchain,jev]"
]
```

The implementation will resolve exact released versions during `uv lock` and record them in `uv.lock`. None of these packages becomes a base installation dependency. The package will import framework modules lazily so a base SDK user does not need LangGraph, LangChain, TypeSafe, a TypeSafe API key, LangSmith, or a cloud service.

## Conformance and security tests

The test suite will use fake LangGraph/LangChain/Jev adapters for unit-level invariant tests and optional-extras integration tests when installed. It will cover the following non-negotiable cases.

| Test | Required result |
|---|---|
| Missing extra | Importing the base SDK succeeds; constructing the corresponding concrete adapter reports its missing optional extra. |
| Sanitization | A state projection containing a raw transcript, credential-shaped key, approval token, or executable callback is rejected before framework/provider dispatch. |
| Tool authority | A LangChain tool façade cannot invoke a governed SDK tool without the same denied capability/approval behavior as a direct SDK request. |
| Turn/action bounds | The adapter carries and enforces host budgets; a framework retry cannot silently exceed an SDK turn/action budget. |
| Resume safety | A LangGraph interrupt/resume reuses an idempotency key and does not duplicate an irreversible host action. |
| Graph isolation | A LangGraph node and `LangGraphNodeExecutor` receive only declared dependencies and a sanitized graph-state projection, never a sibling transcript. |
| Ledger integrity | External checkpoint/request references link to the existing SDK hash chain; tampering with a receipt or ordering causes verification failure. |
| Jev fail modes | Fake unavailable, low-confidence, malformed, or contradictory Jev results lead to declared reject/escalate/fallback behavior and never to capability approval. |
| Jev redaction | Telemetry and audit logs contain only permitted receipt metadata/digests, not submitted Jev state/question text. |
| Type validation | Published LangGraph/LangChain/Jev boundary payloads reject unknown fields and malformed typed answers. |

## Deliverables

The implementation will add the adapters, models, tests, optional extras, example applications, developer-tool validation support, and three documents: an interoperability guide, a Jev verification/exploration guide, and an implementation record. The repository engineering skill and comprehensive developer handbook will be updated with the optional dependency, privacy, and authority rules.

## Explicit non-goals

The increment will not add a default cloud provider, collect an API key, make a TypeSafe request, enable LangSmith, grant an external framework tool access, treat Jev confidence as proof, expose a raw agent transcript to any framework, convert arbitrary framework graphs automatically, or replace the SDK’s graph state, approval registry, telemetry, audit log, PCKP compaction, or deterministic verification gates.

## References

[1]: https://docs.langchain.com/oss/python/langgraph/overview "LangGraph overview"

[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 60, lines 2–19"

[3]: https://docs.langchain.com/oss/python/langchain/middleware/custom "LangChain custom middleware"

[4]: https://docs.typesafe.ai/api "TypeSafe System One API reference"

[5]: https://docs.typesafe.ai/concepts/system-one "TypeSafe System One and Jev"

[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 50, lines 4–14"

[7]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 55, lines 2–14"

[8]: https://docs.langchain.com/oss/python/langgraph/persistence "LangGraph persistence"

[9]: https://docs.langchain.com/oss/python/langgraph/interrupts "LangGraph interrupts"

[10]: https://docs.typesafe.ai/sdk/python/ "TypeSafe Python SDK"

[11]: https://docs.langchain.com/oss/python/integrations/providers/typesafe "LangChain TypeSafe integrations"
