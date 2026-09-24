# Coordination and Specification-Preprocessing Implementation Record

**Status:** Historical `0.3.0` implementation record; lateral state was superseded by graph-owned state in the current SDK.
**Scope:** This increment implements the approved delta plan for vertical coordination, lateral discovery handoff, provenance checking, specification ingestion, task-aware context selection, and deterministic Gate 1 artifacts. It does not select or invoke a real model, a multimodal API, a real EDA executable, or Git history operations.

## Conclusion

The preceding `0.2.0` harness contained a typed graph primitive but not the complete coordination and preprocessing flow. Version `0.3.0` added a controller-owned upward/downward state machine and an initial run-scoped shared substrate for the only permitted worker-to-worker handoff: a consuming action’s explicit dependency on another worker’s closed exploratory discovery. The current SDK supersedes that parallel substrate: `StateGraph` now persists typed node results, discoveries, immutable shared values, and conditional edges together. The implementation never introduces a worker mailbox, shared conversation, or transcript exchange.[1] [2]

The specification layer is now an evidence-preserving preprocessing system rather than a generic retrieval index. A YAML manifest points to source files. Every processed document node includes a path, content hash, format, document identifier, and a source location. Stage-specific selection prunes the document tree before scope/keyword matching, so agents do not receive the full corpus by default.[3] [4] [5]

## Implemented vertical coordination

`ControllerStateMachine` defines the states `planning`, `awaiting-plan-approval`, `dispatch-ready`, `executing`, `repair-required`, `escalated`, `completed`, and `cancelled`. `ComplexityRouter` selects a single-agent or multi-agent architecture from configured thresholds over the documented gap metadata: touched categories, blast radius, and gap type. The selected `SkillToolProfile` must bind an explicitly read-only `SharedSubstrateSnapshot` before a controller starts.[6] [7]

The controller only accepts a plan after `PlanValidator` reports it valid. The plan then enters an approval phase. `approve_plan` is an explicit typed action and `dispatch` is rejected before approval. Dispatch creates an integrity-checked graph run whose snapshot contains its shared graph state. A stage failure invokes a bounded repair request until the configured limit; the next unresolved failure creates an escalation record. This follows the design requirement that the planning agent escalates a workplan upward and that unresolved repair loops return to the designer.[8]

The controller record and event sequence are atomically persisted under `.agent-controllers`. Graph runs are persisted under `.agent-runs`; `StateGraph.from_snapshot` rehydrates node status, results, edges, and events after coordinator reconstruction. The implementation proves graph-state rehydration in a unit test. It does **not** automatically restart a real worker process, rehydrate a pending approval registry, or determine repair content autonomously after restart.

## Implemented lateral coordination and contract gates

**Supersession note.** `RunSharedState` was the initial standalone container for a `SharedSubstrateSnapshot`, `ExploratoryDiscovery` records, immutable typed writes, and `LateralDependencyRequest` records. The current runtime retains those payload types but stores them in `GraphSharedState` inside `RunRecord.graph`, along with node results and edges. A discovery must be closed, exploratory, associated with the current source snapshot/version, and published by a distinct completed producer node. A consumer request names the discovery episode and consumer action; the graph persists that request and a conditional edge in one snapshot. No record carries an agent transcript.[1] [2]

`ProvenanceRecord` is a canonical hash over node identity, input hashes, snapshot identifiers, source spans, tool-record hashes, artifact identifiers, result schema version, and result hash. `ProvenanceContractGate` verifies expected snapshots, expected schema version, and producer uniqueness at a fan-in boundary. A rejected contract requests a bounded controller repair while capacity remains. The gate is a deterministic function callable through MCP, not a language-model judgment.[1]

## Implemented source-preserving preprocessing

`SpecificationPreprocessor` accepts a `specification-manifest.yaml` containing canonical `documents` entries or the project document’s category-tree form. All source paths are constrained beneath one specification root. The processor calculates a content hash and emits an ordered `DocumentTree` for each input. `SourceRef` records document identifier, relative path, format, source hash, and exact location.

| Document family | Implemented parsing behaviour | Traceability result |
|---|---|---|
| Plain/declarative text: TXT, Markdown, TeX, SystemRDL, SDC, UPF, PlantUML, DOT, WaveDrom, Mermaid, TikZ | Source-preserving line blocks. Declarative graph formats are labelled `diagram-source`. | Line number. |
| Word DOCX | Paragraphs, tables, and paragraph-anchored drawing placeholders. | Paragraph/table/image ordinal. |
| PDF | Page text plus image placeholders discovered per page. | Page and image ordinal. |
| CSV/XLSX | Entire CSV table or worksheet table. | Row range or worksheet/range. |
| YAML/JSON | Parsed structured root. | Root. |
| XML/SVG/draw.io | Defused XML tree/source capture. | XML root path. |
| VSDX | ZIP-contained Visio page XML parts. | VSDX package part. |
| PNG/JPEG | Source image node plus filename and adjacent-node context. | Image ordinal. |

The format split follows the source design: text is parsed directly; declarative and XML diagrams are direct structural inputs; mixed documents preserve text/table/image order; raster/unstructured content uses a multimodal extraction boundary only after text and local context are assembled.[9] [10] [11]

`VisionAdapter` is provider-neutral. `ScriptedVisionAdapter` enables controlled test responses. `UnconfiguredVisionAdapter` yields a low-confidence result. The resolver caps attempts at three, accepts only a non-empty structured proposal at or above the configured confidence threshold, and otherwise marks the image `review-required`. This is the implemented confidence/retry/review state machine. It does not claim a real model has understood any image.[12]

## Implemented context selection and Gate 1

`TaskAwareContextSelector` encodes the supplied stage matrix for Architecture Exploration, RTL Development, RTL Verification, Synthesis/DFT, Physical Design, Firmware Development, Safety/Security Analysis, and Signoff. It first prunes document trees to the allowed categories, then selects exact scope-pointer and normalized keyword matches. The output includes only selected nodes and selection reasons, each still carrying `SourceRef` provenance.[4] [5]

`SpecificationGate` generates a `DependencyGraph` and deterministic `GapReport`. It detects missing required categories, empty requirement statements, absent acceptance checks, broken requirement references, and circular dependencies. The report supports the source taxonomy including ambiguity, inconsistency, and unstated-assumption labels, but the current deterministic gate does not claim to detect those model-needed categories. `soft_lock` requires explicit designer approval and rejects residual gaps unless an explicit proceed-with-gaps override accompanies that approval.[13] [14]

`Gate1ArtifactStore` atomically persists `unified-specification.yaml`, `dependency-graph.yaml`, `gap-report.yaml`, `version-metadata.yaml`, and submitted plans under `specifications/`. `classify_version_change` supports an initial major baseline, explicit major field/interface changes, added requirement minor changes, and a patch default. It does not execute `git diff`, create tags, create branches, or create worktrees; those later operations change repository state and remain a separately scoped workflow.[15] [16]

## MCP and TypeScript boundary

The Python MCP server has added controller lifecycle tools, discovery publication and lateral dependency tools, a provenance gate, manifest processing, task-context selection, Gate 1 validation, and soft lock. `PythonAgentRuntimeClient.ts` and `agentRuntime.routes.ts` expose matching forwarding methods and HTTP routes. TypeScript still does not reproduce the Python controller or preprocessing logic.[17] [18]

## Validation

| Layer | Validation | Result |
|---|---|---|
| Python code quality | `compileall`, Ruff check, and Ruff formatting | Passed. |
| Python test suite | `uv run pytest` | **35 passed**. |
| Controller workflow | Unit tests cover plan approval before dispatch, complexity routing, bounded repair/escalation, shared discovery, lateral conditional edge, provenance acceptance/rejection, and restart rehydration. | Passed. |
| Preprocessing | Unit tests cover legacy YAML category manifest ingestion, text trees, source references, scripted/unconfigured image review, task-aware pruning, DOCX paragraph/table extraction, VSDX page XML parsing, Gate 1 validation, and artifact persistence. | Passed. |
| TypeScript compile | Focused compilation includes client, routes, and two integration scripts. | Passed. |
| Live controller MCP path | TypeScript discovered 26 MCP tools, performed scripted BaseAgent execution, validated/cancelled a graph run, created/approved/dispatched a controller, completed a producer, published a discovery, and created a lateral conditional edge. | Passed. |
| Live preprocessing MCP path | TypeScript wrote a YAML manifest and two source documents, processed two trees, selected RTL context, generated a zero-gap Gate 1 report, and soft-locked the specification. | Passed. |

## Limitations retained deliberately

No real model, vision model, or EDA program is used. The parser creates image references and contextual placeholders but does not materialize PDF/DOCX embedded image binaries. SystemRDL, SDC, and UPF are source-preserving inputs, not semantic compiler outputs. The planner is still tested through scripted turns. Stage tool contracts remain fully specified only for RTL work.

The source design’s complete Git history mechanism—field/keyword `git diff` classification, cohesive tags, branches, and worktrees—is documented but not executed. Public MCP authentication, concurrent multi-process locking, a database store, resource quotas beyond the existing process wall-time/output controls, approval-registry persistence, and automatic process/executor reattachment remain future engineering work.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 60, lines 2–19"
[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 63, lines 2–26"
[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 22–23, lines 2–12 and 2–48"
[4]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 31, lines 2–10"
[5]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 32–33, lines 1–32 and 2–20"
[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 41, lines 2–12"
[7]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 42, lines 2–13"
[8]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 43, lines 2–11"
[9]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 24–26, lines 2–12, 2–12, and 2–11"
[10]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 29–30, lines 2–11 and 6–16"
[11]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 30, lines 13–16"
[12]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 27–28, lines 2–30 and 2–16"
[13]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 38–39, lines 2–29 and 2–27"
[14]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 44, lines 2–27"
[15]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 48, lines 2–13"
[16]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 45–47, lines 2–13, 2–13, and 2–16"
[17]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports "Model Context Protocol transports"
[18]: https://ts.sdk.modelcontextprotocol.io/ "MCP TypeScript SDK client"
