# Algorithmic Approaches in the Agent-Assisted Design SDK

**Status:** Historical baseline catalogue; implementation status is updated through P2-A in [the P0–P2 implementation record](p0-p2-algorithm-implementation.md).
**Scope:** The catalogue describes algorithms actually implemented in `packages/agent-sdk`, identifies where a rule is a deterministic heuristic rather than an optimal solver, and proposes bounded next algorithms only where the current source does not yet satisfy the framework intent.

> **Terminology.** In this SDK, *state graph* means the deterministic graph of plan nodes, typed node results, shared discoveries/values, edges, and state transitions. It is distinct from the *episode graph*, which represents agent-local exploratory/action memory. The normal model working memory is a bounded `ProjectStateView`, not either full graph replay or a transcript.[1]

## 1. Architectural correction: lateral coordination is graph-state sharing

The framework design says that graph nodes exchange typed `PlanTask`, `ToolResult`, and `AgentResult` state—not prose—and that a shared state object is passed through graph edges.[2] The SDK now implements that direction directly: `StateGraph.snapshot()` contains nodes, statuses, terminal typed results, edges, and `GraphSharedState`. The latter contains the immutable source substrate, source-backed discoveries, immutable shared values, and lateral dependency requests. `HarnessCoordinator` persists precisely this single snapshot as part of `RunRecord`; `ControllerRuntime` no longer saves a second run-shared discovery store.[3]

A producer can publish a closed `ExploratoryDiscovery` only after its graph node completes and only when its source snapshot/version match the graph substrate. A consumer requests the discovery by stable ID. The graph records the request and adds a conditional producer-to-consumer edge before the consumer starts. On a scheduler wave, a node executor receives only (a) typed results for its declared graph dependencies and (b) a deep-copied read-only `GraphSharedState`; it does not receive a sibling transcript or arbitrary sibling result payload. This preserves explicit data dependencies and avoids an implicit shared scratchpad.[3]

**Implementation update.** `GraphAgentExecutor` now binds host-owned `BaseAgent` factories to graph agent nodes. It supplies only `GraphNodeExecutionContext`, maps typed terminal results into `GraphNodeResult`, and preserves the controller’s durable wave/recovery boundary. The host still owns model, tool, verification, task-adaptation, and idempotence choices; the executor does not grant ambient credentials or replay non-idempotent work.[3]

## 2. Algorithm inventory

| Subsystem | Implemented approach | Deterministic rule or objective | Main safety invariant | Complexity characterization | Status |
|---|---|---|---|---|---|
| Specification preprocessing | Manifest-driven source-preserving parser dispatch | Parse each declared file into ordered source-located nodes; SHA-256 each original input | Relative root containment; no lossy generic summary; images require accepted vision proposal or review | Normally linear in source bytes/nodes; parser-library behavior varies by format | Implemented |
| Image/diagram resolution | Bounded confidence retry | At most `max_attempts`; accept first non-empty structure meeting threshold, otherwise `review-required` | No automatic semantic acceptance below threshold | `O(image_nodes × max_attempts)` adapter calls | Implemented |
| Task-aware selection | Stage-category filter followed by pointer/lexical matching | Select nodes only from `STAGE_CATEGORIES[stage]` that match a scope pointer or extracted task token | Entire excluded categories are never scanned for selection | `O(N × (P + K + serialization))` after stage filter | Implemented baseline |
| Specification Gate 1 | Set, reference, and DFS cycle checks | Required-category set difference; missing acceptance check; unknown dependency; dependency-cycle enumeration | Ambiguity is flagged rather than deterministically “understood” | `O(R + E)` for graph traversal, plus requirement checks | Implemented |
| Version classification | Ordered explicit-field checks | Major field/interface change → major; added requirement → minor; otherwise patch | Soft lock and designer approval remain mandatory | `O(R × F)` for aligned requirements/fields | Implemented heuristic |
| Plan construction validation | Pairwise exact-signal edge derivation | Intersect locked-interface signals; producer→consumer; otherwise ordered generality fallback; reject ambiguity | Plan dependencies and cited proofs must equal recomputed edges | `O(T² × S)` plus `O(T + E)` cycle check | Implemented |
| Graph scheduling | Deterministic topological waves | Run all currently runnable nodes concurrently; commit results by sorted node ID | Only completed declared dependencies unlock a child; failed dependencies block it | One wave scan is `O(V + E)`; repeated waves are at most `O(V × (V + E))` in current implementation | Implemented |
| Lateral coordination | Conditional typed-state edge insertion | Publish closed discovery → cite it → add conditional edge before consumer starts | No worker transcript; source snapshot/version and producer completion required | Edge insertion/validation is linear in current edge count | Implemented structure; BaseAgent graph executor pending |
| Vertical coordination | Finite controller state machine | Planning → approval → execution → bounded repair or escalation | Controller, not worker/model, owns stage transitions | `O(1)` per transition; plan validation cost is separate | Implemented |
| Tool batches | Dependency-aware topological scheduler | Execute ready parallel-safe calls together; execute serial calls singly; block dependents after non-success | Tool schemas, dependencies, watchdog, policy, and result state are checked before reduction | Worst case `O(K²)` readiness scans for `K` calls, plus tool execution | Implemented |
| Model context | State-first bounded projection | Model sees immutable task/prompt plus bounded current project state; raw journal/audit history is omitted | If immutable prompt plus current state exceeds budget, block rather than truncate it | `O(A + W)` optional entries after core state serialization | Implemented |
| Episode compaction | Exact additive PCKP by default; PASK as opt-in diversity heuristic | Maximize dependency-closed static integer utility under a budget; dynamic PASK is labelled separately | Open/protected/manifest-incomplete/required prerequisites cannot be compacted; general-DAG search returns an explicit best-effort certificate at its policy-owned branch cap | Exponential worst case for general PCKP, bounded by `exact_max_branch_nodes`; forest fast path is pseudo-polynomial | Exact/default and heuristic modes implemented |
| Tool-result projection | Journal handles plus bounded preview | Persist full tool result; expose opaque handle and clipped preview | Full result remains durable but is not replayed by default | `O(result size)` to serialize/hash; preview bounded | Implemented |
| Project state | Deterministic reducer and hash-linked revisions | Apply typed transition from tool outcome/controller/human decision; hash canonical next state | Model cannot author state; every entry cites bounded evidence | `O(current state entries)` per copy-and-upsert transition | Implemented |
| Provenance fan-in | Contract checking | Reject duplicate producer IDs, wrong result schema, or missing expected snapshot | Agreement is checked mechanically rather than negotiated | `O(number of fan-in records)` | Implemented |
| Capability policy | Deny-by-default predicate | Role grant ∧ capability ∧ contained paths ∧ required approval | No ambient shell/path capability | `O(allowed paths)` after normalization | Implemented |
| Watchdog/process supervision | Bounded retry and process-tree termination | Registered command, timeout, bounded output, optional POSIX resource limits, retry only if idempotent and classified retryable | No raw shell; timeout terminates session process group | `O(attempts)` sequential attempts; output capped in retained memory | Implemented |
| Telemetry/audit | Append-only hash chain and metric reduction | Canonical event hash chaining; aggregate defined observations without treating unavailable as zero | Hidden-reasoning keys rejected; audit never becomes model context | Append transaction is constant-size; report scales with stored events/metrics | Implemented |
| Artifact integrity | Content-addressed manifest | SHA-256 content ID and manifest; rehash before read | Run-root containment and drift detection | `O(file bytes)` hashing/read | Implemented |

## 3. Algorithms in detail

### 3.1 Manifest-driven specification preprocessing

The preprocessor first resolves every manifest path beneath a configured root, hashes original bytes, and dispatches by declared format. It emits ordered `DocumentNode`s carrying `SourceRef(document_id, relative_path, source_hash, format, location)`. Text-like files become line nodes; tables retain rows; structured files retain parsed content; PDFs retain page and image locations; DOCX retains paragraph/table/image locations; and VSDX retains page XML parts. It adds only two adjacent context snippets, rather than replacing the source structure with a summary.[4]

Image extraction uses a bounded retry loop. For image node `i`, the procedure calls the configured `VisionAdapter` at most `m` times, accepting the first candidate with confidence `≥ θ` and nonempty structure. If no candidate qualifies, it returns `review-required`; it does not synthesize a diagram interpretation. This is a deterministic control policy around an optional non-deterministic adapter, rather than a deterministic vision algorithm.[4]

The current implementation performs no cross-document semantic merge, diagram semantic graph reconstruction, OCR fallback, or requirement extraction from prose. Those are deliberate missing algorithms; the typed document tree is the safe substrate on which they can later be implemented.

### 3.2 Current task-aware context selection

The current `TaskAwareContextSelector` is a two-stage filter:

1. Map design stage `s` to a fixed allowed category set `C(s)`.
2. For each node in documents whose category is in `C(s)`, select it if a supplied scope pointer occurs in its source location/content or a token extracted from task text occurs in serialized node content.[5]

In set notation, with nodes `n`, scope pointers `P`, and lexical task tokens `K`, the current selector returns:

> `S = { n | category(n) ∈ C(s) ∧ (∃p ∈ P : p matches n) ∨ (∃k ∈ K : k occurs in n) }`

This has two useful properties: the stage category policy is inspectable, and it provides a source-linked selection reason. It is **not** semantic retrieval, a learned ranker, dependency closure, or an optimization problem. It also records a document-level reason even when only some nodes match, so it should not be reported as a complete evidence-ranking algorithm.[5]

#### Implemented replacement: deterministic evidence packing

The SDK now provides a **task-aware, dependency-closed evidence packer** in `evidence_graph.py`. It uses an explicit immutable evidence graph and exact PCKP packing rather than the PASK heuristic; the legacy lexical selector remains available as a baseline:

1. Filter to stage-allowed categories.
2. Make mandatory the exact scope-pointer nodes, exact locked-interface signal nodes, and acceptance-criterion nodes. Add their document/requirement dependency closure.
3. If mandatory cost exceeds the budget, return an explicit `CONTEXT_DEADLOCK` dossier; do not silently discard a locked-source requirement.
4. For each remaining candidate, calculate a versioned deterministic score from exact scope match, exact signal match, acceptance-check linkage, category relevance, source/dependency centrality, and marginal term coverage.
5. Select optional source-preserving evidence by exact PCKP under the residual budget. Break ties canonically.
6. Record selected/omitted source spans, weights, budget, and score components in a dossier.

The proposed objective is:

> `max Σᵢ xᵢ [αMᵢ + βIᵢ + γAᵢ + δCᵢ + εGᵢ + ζΔcoverageᵢ]`
> subject to `Σᵢ xᵢ costᵢ ≤ B`, mandatory set `⊆ S`, and `closure(S) = S`.

The implementation uses exact identifiers and structural links only. Any embedding score remains a separately versioned, reproducible host extension. This boundary is grounded in the framework’s source-preserving input requirement and its locked-interface plan rules.[4] [6]

### 3.3 Specification gating, versioning, and Git worktrees

Gate 1 calculates required-category absence through a set difference, checks each requirement’s acceptance-check presence, constructs a directed requirement dependency graph, then uses depth-first traversal to identify cycles. It deliberately marks ambiguity/inconsistency as model-analysis-required rather than claiming those semantic decisions are deterministic.[7]

The version classifier applies an ordered decision list: initial baseline is major; changed architecture/process/schema/objective field or changed existing interface requirement is major; added requirement is minor; otherwise patch. The Git adapter independently classifies the diff by configured filename keywords, validates strict SemVer bump relations, requires an accepted soft lock and typed approval, then atomically creates an annotated local tag and lock record. Variant worktrees require another matching typed approval and a safe branch name.[7] [8]

These are governance algorithms, not a substitute for semantic change-impact analysis. The Git-diff keyword classifier is explicitly heuristic and should be evaluated as such.

### 3.4 Plan-to-DAG derivation

For every unordered task pair `(A, B)`, `PlanValidator` intersects the exact signal IDs copied into the locked interfaces. For each shared signal, it uses cited `TaskSignalUse` roles to derive producer→consumer direction. If neither task produces the signal, it applies an ordered fallback by `(generality_rank, task_id)`. Dual producers, missing citations, and mismatching proof sets are rejected. The validator then requires the proposed dependency sets to equal the recomputed union and runs a DFS cycle check.[6]

This is a conservative, evidence-driven graph-construction algorithm. It does not use a model to invent edges. Its `O(T² × S)` pairwise structure is acceptable for early bounded plans; for large task counts, the improvement is to build an inverted index `signal_id → tasks` and derive only within each signal bucket, reducing work toward `Σsignal |bucket(signal)|²`.

### 3.5 Vertical and lateral coordination

**Vertical coordination** is a finite-state controller. The controller binds an immutable source snapshot and skill/tool profile, validates a plan, waits for explicit plan approval, dispatches the graph, accepts bounded repairs, and then escalates. Its routing rule is a deterministic threshold predicate over touched categories, blast radius, and configured gap types—not an inferred “complexity” label.[9]

**Lateral coordination** is graph-state propagation. A completed producer publishes a typed discovery/value; a consuming node names it, and a conditional edge controls execution order. The graph scheduler dispatches runnable waves concurrently but commits results in sorted node-ID order. Each node sees typed predecessor results plus frozen graph-shared state for that wave. At fan-in, provenance contracts verify snapshot and result-schema compatibility. This corresponds directly to the framework’s stated shared-state-versus-shared-transcript model.[2] [3]

The graph itself is **not compressed**. Its topology, node status/result metadata, edges, and source-linked shared state remain as run evidence. PASK compresses only selected *episode payloads* in the agent-local recovery/provenance memory; raw tool outputs remain in the journal. `ProjectStateView` separately projects current working state for the model. Therefore, no claim should say that the SDK applies a mathematical graph-compression algorithm to the execution DAG.[1] [10]

### 3.6 PASK episode compaction

PASK is a dependency-closed greedy budgeted selector. Let `e` be an episode and `Add(e)` its live dependency closure not already retained. Its marginal cost is the estimated tokens of `Add(e)`. Its current utility is:

> `U(e) = wR·R(e) + wC·C(e) + wP·P(e) + wA·A(e) + wF·F(e) + wD·D(e)`

where `R` is injected deterministic task relevance (lexical overlap by default), `C` is normalized live dependent count, `P` is provenance class, `A`/`F` are explicit access recency/frequency, and `D` is marginal lexical coverage. PASK retains the feasible candidate with greatest `(U(e)/marginal_cost)` and full closure; tie-breaking is deterministic. Open, active, protected, manifest-incomplete, and required prerequisite episodes are mandatory. If their closure exceeds the budget, the compactor returns an over-budget/deadlock dossier instead of discarding evidence.[10] [11]

This is **not** an exact dependency-constrained 0/1-knapsack solver, and it does not carry a generic approximation guarantee. The `GREEDY_BASELINE` remains for controlled comparison. The current method is approximately quadratic in live candidates, plus repeated dependency closure and token-estimation work. The implementation logs strategy, policy, query digest, selected score components, retained IDs, compacted IDs, and mandatory set so an experiment can compare it with the baseline.[10]

### 3.7 State-first model context and tool-loop scheduling

`ProjectStateReducer` converts typed tool outcomes, agent terminal results, controller work-item updates, and human decisions into hash-linked revisions. A model receives a bounded `ProjectStateView`; it cannot write the reducer directly. The projector always includes core current state and greedily adds most-recent artifacts/work items until its configured budget is reached. The BaseAgent separately rejects a turn if immutable prompt plus projected state exceed its total context budget.[1] [12]

Tool batches are a topological scheduler over model-declared call dependencies. In each pass it finds calls whose declared predecessors have outcomes. Calls following a non-successful predecessor become typed `blocked` results. If a ready call is serial or undeclared, it runs one call; otherwise it gathers parallel-safe ready calls. All tool arguments, hooks, watchdogs, journal handles, project-state transitions, and terminal failure mapping are checked at the harness boundary.[13]

The state-first approach avoids replaying the entire tool conversation, but it does not eliminate necessary model calls: after a tool batch, a model must decide the next action from the changed state. Provider-native continuation can reduce provider-side replay when the adapter supports it, while the SDK’s durable state and handles keep the application’s own context bounded.[1] [13]

### 3.8 Watchdog, policy, telemetry, and audit algorithms

The capability predicate requires a matching role grant, capability, run-root-contained path, and typed approval for non-read-only side effects. The supervisor permits only registered commands, starts a separate process session, retains bounded output, uses timeout-triggered `SIGTERM` then `SIGKILL` for the group, applies supported POSIX resource limits, and retries only when a failure kind is explicitly retryable and the operation is declared idempotent.[14] [15]

Telemetry appends events in SQLite under a per-run sequence and canonical SHA-256 predecessor chain. Metrics use registered aggregation rules and preserve unavailable measurements as unavailable. The audit transcript records reviewable model-visible turns, tool calls/results, and terminal events in a separate hash-linked rendering; hidden-reasoning keys are rejected. These are traceability/data-analysis algorithms, not a source of normal model memory.[16]

## 4. Prioritized algorithm roadmap

| Priority | Algorithmic increment | Why it is next | Required evaluation |
|---|---|---|---|
| P0 | Bind a production `GraphNode` executor to `BaseAgent` using `GraphNodeExecutionContext` | Completes the implemented graph-state sharing path; currently the graph requires an external executor | Dependency-only result visibility, frozen wave state, lateral discovery visibility, restart/replay tests |
| P0 | Replace current context selector with deterministic evidence packing | Current selector is lexical/pointer filtering only and has no dependency closure or token budget | Exact-signal precision/recall, mandatory evidence retention, deadlock count, downstream verification outcome |
| P1 | Build inverted signal and requirement indices | Removes repeated all-pairs plan/context comparisons for larger designs | Runtime/memory versus current pairwise baseline; graph equivalence |
| P1 | Formalize stage-specific state schemas and completeness gates | State-first reasoning is only trustworthy if required stage fields are explicit | Missing-field detection, false-block/false-proceed rates, human correction rate |
| P1 | Add graph-state conflict semantics for independently written keys | Shared values are immutable today; concurrent result-level conflict/merge rules are not defined | Deterministic conflict outcomes, provenance completeness, no hidden write/write race |
| P2 | Evaluate exact/DP or branch-and-bound PASK comparators offline | Greedy PASK is auditable but not optimal | Utility/cost gap, latency, mandatory-closure retention, task success on identical runs |
| P2 | Add reproducible semantic relevance scorer | Lexical relevance misses synonyms and multi-modal evidence | Versioned assets, deterministic fixtures, selection quality versus lexical baseline |
| P2 | Add semantic change-impact propagation over requirement/interface graph | Current version classification is explicit-field/keyword heuristic | Precision/recall against annotated breaking/non-breaking changes |

## 5. Research reporting rules

For each algorithmic experiment, record the input version/snapshot hash, policy weights, budget, selected model/provider capability metadata, tool/EDA version, graph/run hash, verification outcome, and human approval where applicable. Compare an algorithm with a declared baseline on identical task, source snapshot, tool outcomes, and budgets. Report unavailable provider or EDA measurements as unavailable rather than zero. These constraints follow the project’s provenance, telemetry, and controlled-baseline commitments.[11] [16]

## References

[1]: [State-based working-memory proposal](/home/ubuntu/upload/pasted_content.txt), lines 23–113 and 137–148; [`project_state.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py), lines 1–6 and 210–260.

[2]: [Updated systems-design framework, extracted p. 60](/home/ubuntu/work/baseagent-planning/pages/page-060.txt), lines 2–19.

[3]: [`graph.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/graph.py); [`coordination.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/coordination.py); [`controller_runtime.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/controller_runtime.py); [`test_graph.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/tests/test_graph.py).

[4]: [Updated systems-design framework, extracted pp. 22–30](/home/ubuntu/work/baseagent-planning/pages/page-022.txt); [`specifications.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/specifications.py), lines 169–250 and 260–487.

[5]: [`context_selection.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/context_selection.py), lines 24–126; [`test_specifications.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/tests/test_specifications.py), lines 139–154.

[6]: [Updated systems-design framework, extracted p. 59](/home/ubuntu/work/baseagent-planning/pages/page-059.txt), lines 19–30; [`planning.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/planning.py), lines 138–347.

[7]: [Updated systems-design framework, extracted pp. 36–39](/home/ubuntu/work/baseagent-planning/pages/page-036.txt); [`specification_gate.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/specification_gate.py), lines 120–288.

[8]: [Updated systems-design framework, extracted pp. 45–48](/home/ubuntu/work/baseagent-planning/pages/page-045.txt); [`git_versioning.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/git_versioning.py), lines 180–360.

[9]: [Updated systems-design framework, extracted p. 41](/home/ubuntu/work/baseagent-planning/pages/page-041.txt); [`orchestration.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/orchestration.py), lines 17–212.

[10]: [PASK user-approved proposal](/home/ubuntu/upload/pasted_content_2.txt), lines 19–44 and 58–70; [`memory.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/memory.py), lines 1–8 and 441–651.

[11]: [Matrix-accelerator research proposal, telemetry/evaluation commitment](/home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf); [`metrics.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/metrics.py), lines 41–422.

[12]: [`project_state.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py), lines 319–498 and 537–708.

[13]: [`base_agent.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/base_agent.py), lines 480–618 and 774–1069; [`context_projection.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/context_projection.py), lines 124–246.

[14]: [Updated systems-design framework, extracted pp. 54–55](/home/ubuntu/work/baseagent-planning/pages/page-054.txt); [`policy.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/policy.py), lines 34–105; [`supervisor.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/supervisor.py), lines 119–347.

[15]: [`core_tools.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/core_tools.py), lines 94–323 and 548–620; [`artifacts.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/artifacts.py), lines 24–136.

[16]: [`telemetry.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/telemetry.py), lines 132–372 and 458–539; [`audit_log.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/audit_log.py).
