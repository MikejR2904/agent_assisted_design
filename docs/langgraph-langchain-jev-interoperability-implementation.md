# LangGraph, LangChain, and Jev Interoperability Implementation Record

**Status:** Implemented in `agent-design-agent-sdk` 0.13.0.
**Scope:** Optional, authority-preserving adapters for LangGraph and LangChain plus a TypeSafe Jev advisory evaluator.
**External actions:** No remote TypeSafe/Jev call, cloud model call, LangSmith configuration, credential collection, or external publication was performed.

## Delivered modules

| Module | Delivered behavior | Authority retained by the SDK |
|---|---|---|
| `agent_sdk.integrations.contracts` | Strict sanitization, run envelopes, external decision protocols, failure modes, digest-only receipts. | Canonical graph, audit, approval, policy, and capability state. |
| `agent_sdk.integrations.langgraph` | SDK-as-LangGraph node, explicit LangGraph-as-SDK node executor, safe interrupt challenge payload, optional graph builder. | `BaseAgent`, `StateGraph`, graph-state lateral coordination, approval validation, and governed tools. |
| `agent_sdk.integrations.langchain` | LangChain Runnable model adapter, SDK agent Runnable façade, schema-preserving SDK tool façade. | Typed turn validation, tool batch scheduler, policy, approval, watchdog, verification, result journals. |
| `agent_sdk.integrations.jev` | Typed Noul/Choice/Score request and answer contracts, bounded TypeSafe evaluator, required receipt sink, advisory verification composition, exploration ranking. | Deterministic gate precedence, capability/approval decisions, graph mutation, controller dispatch. |
| Packaging and examples | `langgraph`, `langchain`, `jev`, and `interop` extras; runnable offline framework example; root package exports. | Optional dependencies do not become base dependencies. |

## Source-grounded design decisions

The implementation preserves the project design’s separation between BaseAgents and deterministic authority modules.[1] It preserves typed-state, graph-based lateral coordination instead of shared worker conversations.[2] It does not use LangChain middleware or LangGraph scheduling as a reference monitor because the system design assigns policy/audit interception and process supervision to the harness/tool layer.[3]

LangGraph was adopted as an optional orchestration surface because its documentation describes durable, stateful low-level agent workflows.[4] Its persistence and interrupt mechanism are treated as recovery/context facilities rather than a replacement audit ledger; resumption still requires the SDK host to enforce immutable approval challenge and idempotency checks.[5] [6]

Jev was adopted only for advisory verification and exploration triage. TypeSafe documents it as typed System One evaluation rather than text/code generation, and its probability-calibration guidance prevents a claim that any one evaluator response proves correctness.[7] [8]

## Privacy and observability enforcement

`InteropRunEnvelope` state is sanitised before any framework/provider dispatch. `InteropReceipt` stores stable IDs and digests rather than raw framework state, prompt/messages, Jev state/question text, tool arguments/results, credentials, approval tokens, or response payloads. Jev construction requires a receipt sink, ensuring that a host explicitly chooses durable telemetry integration rather than accidentally dropping evaluator evidence. This aligns with TypeSafe’s data-sharing caution for state and tool arguments.[9]

## Validation

The release validation ran the package formatter/linter, **113 Python tests**, a source and wheel build, the offline framework example, focused TypeScript MCP-boundary compilation, repository-skill validation, and a clean base-wheel import smoke test. The integration suite uses fake framework/provider adapters to exercise SDK-owned contracts without making a remote call. It covers LangChain model and tool re-entry, LangGraph node reduction/building, required receipt persistence, Jev answer normalization, redaction-safe unavailable handling, deterministic-gate precedence, and deterministic exploration fallback.

## Known boundary

The SDK does not auto-convert arbitrary LangGraph graphs, infer a safe third-party state projection, run a default real LLM, provide a TypeSafe API key, enable LangSmith, or treat Jev as a correctness proof. A host must explicitly select a provider, data-sharing policy, question spec, model ID, receipt sink, executor, capability grants, approvals, and safe projection.

## References

[1]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 50, lines 4–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[2]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 60, lines 2–19](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[3]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 55, lines 2–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[4]: [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)

[5]: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

[6]: [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

[7]: [TypeSafe System One API](https://docs.typesafe.ai/api)

[8]: [TypeSafe System One concepts](https://docs.typesafe.ai/concepts/system-one)

[9]: [LangChain TypeSafe integration](https://docs.langchain.com/oss/python/integrations/providers/typesafe)
