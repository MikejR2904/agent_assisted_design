# Provider Adapters and Source-Bound Semantic Gate 1

**Status:** Implemented in `agent-design-agent-sdk` 0.17.0. This increment adds optional OpenAI-compatible adapters and activates the model-needed Gap 1 categories without moving credentials, policy, approvals, or semantic authority out of the host process.

## Purpose and scope

The framework design separates a model’s **proposal** from deterministic harness authority. A BaseAgent must carry an explicit model binding, typed input/output contracts, narrow tool declarations, and a verification boundary.[1] The Gate 1 design likewise distinguishes deterministic checks from ambiguity, semantic inconsistency, and unstated-assumption analysis, which may require targeted model analysis over structured source material.[2] [3]

This release implements the missing host injection points while preserving those boundaries:

| Concern | Implemented behavior | Deliberate non-authority |
|---|---|---|
| Chat model | `OpenAICompatibleAgentModel` maps Chat Completions function calls or JSON final turns into validated SDK turns. | It cannot grant a capability, bypass a tool schema, select a model binding, approve an action, or validate its own final output. |
| Tool continuation | `ProviderToolResultConsumer` supports one bounded, provider-native function-result handoff. | The result is not placed in ordinary `ModelContext.observations`, project state, or a transcript replay. |
| Embeddings | `OpenAICompatibleEmbeddingProvider` supplies the synchronous `EmbeddingProvider` shape consumed by `QdrantRetrievalIndex`. | Qdrant candidates still require frozen-snapshot and `SourceRef` validation before task-context admission. |
| Vision | `OpenAICompatibleVisionAdapter` emits a typed `VisionProposal`. | A proposal is accepted only by the existing confidence/attempt policy; image text is not trusted as an instruction. |
| Semantic gaps | `OpenAICompatibleSemanticGapAnalyzer` produces typed, receipt-bound **proposals**. `SpecificationGate` mechanically admits or rejects each one. | A model cannot create a critical gap, add a requirement, invent a source reference, soft-lock a specification, or override deterministic checks. |

The implementation follows OpenAI-compatible Chat Completions tool-call fields and JSON function arguments, which providers require callers to validate before execution.[4] It uses the standard embeddings response shape—one numeric vector in `data[].embedding`—and rejects malformed, non-numeric, or non-finite values.[5] Image input is sent as a base64 data URL only after the host loader supplies bounded bytes; current OpenAI vision documentation supports base64 data URLs but notes that images consume tokens.[6]

> **No live provider was contacted in this increment.** Tests use an in-memory transport with recorded protocol-shaped responses. A deployment owner must select the provider, exact models, endpoint, retention policy, and credentials.

## Host-owned construction

The endpoint and secret are never read from environment variables by the SDK and must never be serialized into an `AgentDefinition`, model binding parameters, MCP payload, audit entry, profiler attribute, or graph state. The application constructs them locally:

```python
from agent_sdk import (
    OpenAICompatibleAgentModel,
    OpenAICompatibleEmbeddingProvider,
    OpenAICompatibleEndpoint,
)

endpoint = OpenAICompatibleEndpoint(
    base_url="https://provider.example/v1",
    api_key=host_secret_store.read("selected-provider-api-key"),
    timeout_seconds=30,
)

chat = OpenAICompatibleAgentModel(
    endpoint,
    provider="selected-provider",
    model="approved-chat-model",
)
embedding = OpenAICompatibleEmbeddingProvider(
    endpoint,
    model="approved-embedding-model",
)
```

The `AgentDefinition.model_binding` must exactly match the `provider` and `model` supplied to `OpenAICompatibleAgentModel`. The adapter rejects a mismatch before sending a network request. Binding parameters may tune a provider request, but may not override endpoint, credential, model, messages, tools, tool choice, or output format. `OpenAICompatibleEndpoint` requires HTTPS by default. A local HTTP-compatible server requires `allow_insecure_http=True` as an explicit development decision; do not set that flag for a provider endpoint that carries a production credential.

The selected model is still an application-level policy decision. In a governed orchestration run, the host binding is independently checked against the approved `WorkerAssignment`; `Orchestrator` rejects a substituted provider/model pair before graph execution.[7]

## Chat/tool continuation behavior

For a normal final answer, the adapter sends the bounded task state and tool schemas, parses a JSON `AgentTurn`, and lets the existing output-schema and verification gates decide whether the task completes. For a provider function call, it returns the normal typed `ToolBatchTurn`. The BaseAgent’s deterministic scheduler still validates arguments, checks declared tools/capabilities/approvals, runs the tool, records the complete result in its journal, and reduces project state.

Some provider protocols require the result of a function call before they can generate the next turn. `ProviderToolResultConsumer` resolves that requirement through a **separate one-time continuation channel**. The BaseAgent serializes only the current batch’s result to canonical JSON, caps it at `ContextProjectionPolicy.tool_result_preview_chars`, and hands it back to an adapter that explicitly implements the protocol. The OpenAI-compatible adapter verifies that returned call IDs exactly equal the IDs issued by the provider, then sends `role: tool` messages with the provider’s original tool-call payload on the following request.

This exception does not relax state-first memory. The next ordinary `ModelContext` still has empty `observations` and `episodes`; full results remain in the tool-result journal and redacted audit evidence. The continuation exists because a selected external protocol needs a function result, not because the SDK has restored transcript replay. Hosts should keep the preview bound modest and treat tool-result content as untrusted data in the provider prompt.[1] [4]

## Grounded embeddings and Qdrant

`QdrantRetrievalIndex` remains optional. Its constructor needs a host-selected base URL, collection name, embedding provider, and **known dimension**. The service uses snapshot/category payload filters, but those filters only rank candidates; `GroundedRetrievalService` subsequently resolves every candidate against frozen local document trees and validates its `SourceRef` hash, document/node identity, and category before ordinary stage-aware selection.[8]

```python
from agent_sdk import QdrantRetrievalIndex

index = QdrantRetrievalIndex(
    base_url="https://qdrant.example",
    collection_name="frozen-specification-nodes",
    embedding_provider=embedding,
    embedding_dimensions=1536,  # deployment-owned, verified against the selected model
)
```

Do not treat Qdrant or Redis as specification truth. Redis remains only an optional digest-keyed TTL cache; neither backend receives raw audit history, tool evidence, approvals, graph state, or credentials.[8]

## Vision adapters and source integrity

`OpenAICompatibleVisionAdapter` is a `VisionAdapter` implementation. It needs an explicit image loader because many extracted image nodes are embedded inside PDFs, DOCX, or office packages rather than independent files. The host’s loader is responsible for package-aware extraction and for enforcing any source-policy restrictions.

For manifest-declared standalone PNG/JPEG documents, `SourceVerifiedImageLoader(specification_root)` is available. It enforces root containment, byte bound, supported format, file existence, and SHA-256 equality with the node’s frozen `SourceRef.source_hash` before bytes leave the process. It deliberately does not pretend to extract embedded document images.

A vision response must validate as `VisionProposal`. `SpecificationPreprocessor.resolve_images()` retains the existing threshold and retry behavior: a high-confidence structured proposal can become `ACCEPTED`; otherwise the node becomes `REVIEW_REQUIRED`. No model response becomes source truth by itself.[9]

## Semantic Gate 1 workflow

The system design identifies three non-deterministic classes: **ambiguity**, **inconsistency**, and **unstated assumption**. It also specifies deterministic checks for absence, traceability, circular dependencies, and verifiability.[2] The SDK therefore uses two phases:

1. A host-selected analyzer receives only the frozen requirement view—ID, category, text, dependencies, and exact source references—and returns JSON findings. `OpenAICompatibleSemanticGapAnalyzer` rebinds each response to the selected provider/model and derives a digest over the frozen request view plus finding.
2. `SpecificationGate.validate(..., semantic_findings=...)` independently verifies the finding ID, cited requirement IDs, exact source-reference multiset, semantic category, severity bound, and deterministic downstream impact. Rejected findings remain in `GapReport.semantic_admissions` with a reason; only accepted findings are appended to `GapReport.gaps`.

An inconsistency must cite at least two requirements. Semantic findings cannot be `CRITICAL`: the model cannot alone create a stop-the-line condition. `blast_radius` includes the cited requirement(s) plus their reverse-reachable dependents over the frozen `(dependent, prerequisite)` graph. The `source` field retains only `semantic-analysis:<provider>:<receipt digest>`; raw hidden reasoning is never requested, stored, or exposed.

```python
analysis = await semantic_analyzer.analyze(unified_specification)
graph, report = gate.validate(
    unified_specification,
    required_categories=required_categories,
    semantic_findings=analysis.findings,
)
# A designer still decides whether a report with gaps may be soft-locked.
```

The data-only `validate_gate_one` MCP tool and TypeScript façade can carry already-created `semantic_findings`, so a host may use another trusted local analysis adapter. MCP does **not** expose endpoint registration, credentials, or a generic provider-execution tool. This preserves the project’s Python-owned semantics and host-local executable-binding rule.[7]

## Operational limits and review checklist

Before enabling a real deployment, verify all of the following:

- Use a named model binding approved by the policy/profile; do not use dynamic user input as provider, model, base URL, or tool schema.
- Store API credentials in the host’s secret manager and rotate them outside SDK records.
- Set outbound network controls appropriate to the deployment. The standard-library transport requires an explicit HTTPS endpoint by default and rejects HTTP redirects so its bearer credential remains endpoint-bound; it does not provide tenant isolation or certificate-pinning policy.
- Calibrate `embedding_dimensions` to the selected embedding model and perform an integration test against the actual vector service.
- Set image byte limits and implement a package-aware loader before enabling PDF/DOCX embedded-image processing.
- Review proposed semantic findings, their `semantic_admissions`, source references, and receipt digest before soft lock. A receipt is a reproducibility digest, not a cryptographic attestation by the provider.
- Keep a deterministic verification gate for final agent output and a human approval for state-changing actions or soft lock.

## Validation completed

Offline contract tests validate provider/model mismatch rejection, numeric vector validation, source-hash image loading, typed vision parsing, OpenAI-compatible tool-call mapping, the bounded tool-result continuation, semantic finding provenance, Gate 1 rejection of unbound source references, MCP admission, and TypeScript compilation. The project does not claim live provider behavior, EDA execution, semantic correctness of any provider, or a production credential integration.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 50, lines 4–14; p. 51, lines 16–34"

[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 38, lines 3–29"

[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 39, lines 31–49"

[4]: https://platform.openai.com/docs/api-reference/chat/create "Chat Completions tool calls, JSON arguments, and caller-side argument validation"

[5]: https://platform.openai.com/docs/api-reference/embeddings "Embeddings create response and `data[].embedding` numeric vector contract"

[6]: https://platform.openai.com/docs/guides/images-vision "Image and vision inputs, including base64 data URLs and token accounting"

[7]: /home/ubuntu/work/agent_assisted_design/docs/orchestration-guide.md "Approved model bindings, host-local graph bindings, and data-only MCP lifecycle"

[8]: /home/ubuntu/work/agent_assisted_design/docs/grounded-retrieval-and-versioning.md "Frozen-snapshot provenance validation and cache boundary"

[9]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/specifications.py "VisionAdapter protocol, confidence threshold, and review-required fallback"
