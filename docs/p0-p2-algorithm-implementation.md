# P0–P2 Deterministic Algorithm Implementation Record

**Status:** Implemented through **P2-A** in `agent-design-agent-sdk` 0.11.0. **P2-B semantic extensions remain intentionally deferred** until the deterministic baseline data are broadened beyond the frozen fixtures described here. This follows the approved roadmap’s rule that semantic extensions must not replace exact identifiers, mandatory closure, provenance, or source evidence.[1]

## Scope and decision record

This increment implements the approved P0–P2 sequence with one boundary. P0 exact retention, structural context closure, and graph-bound agent execution are implemented. P1 exact discovery routing, stage completeness, typed graph conflicts, and the required restrained research framing are implemented. P2-A supplies an independent small-instance oracle, frozen comparison cases, a reproducible runner, and a recorded result. P2-B is not claimed as implemented because the benchmark corpus currently contains engineering fixtures rather than an adjudicated real-design corpus.[1]

| Priority | Delivered mechanism | Implemented artifact | Validation evidence |
|---|---|---|---|
| P0-A | Exact dependency-closed PCKP plus a labelled greedy baseline and rooted-forest fast path | `optimization.py`, `memory.py` | Exact solver, shared prerequisite, zero-cost, forest, infeasible mandatory-closure, and independent exhaustive-oracle tests |
| P0-B | Source-addressed mandatory reachability closure followed by exact residual packing | `evidence_graph.py` | Structural closure and infeasible-required-closure tests |
| P0-C | Host-injected `BaseAgent` bindings for graph nodes | `graph_agent_executor.py`, `coordination.py` | Scripted graph-agent executor and durable coordinator tests |
| P1-A | Exact-reference postings, conjunctive matching, route-decision ledger, conditional edges, and filtered worker discovery views | `graph.py`, `shared_state.py`, `planning.py` | Exact-match, non-match, late-delivery, state filtering, and rehydration tests |
| P1-B | Finite stage readiness gate and persistent typed conflict ledger | `stage_gates.py`, `graph.py`, `controller_runtime.py` | Missing work-item/artifact, accepted state, source mismatch, immutable-write collision, and controller repair tests |
| P1-C | Conditional computational-surrogate framing | this record and the updated algorithm catalogue | Claims are constrained to explicit input representations and finite policies |
| P2-A | Frozen PCKP cases, comparative harness, report writer, and exhaustive oracle | `benchmarks.py`, `benchmarks/pckp_cases.json`, `scripts/run_pckp_benchmark.py` | `test_benchmarks.py`, `test_pckp_oracle.py`, committed run report |

## P0-A: exact episode retention

The previous PASK heuristic remains available only when explicitly selected. The default `EXACT_PCKP` policy converts static relevance, dependency centrality, provenance, recency, and frequency features into integer utilities and solves the directed-acyclic dependency-closed selection problem. It deliberately excludes the dynamic diversity term from the exact objective because that term changes with the current retained set and therefore is not additive.[1]

For each item `i`, the solver chooses a binary decision `xᵢ`, charges its token cost once, and enforces `xᵢ ≤ xⱼ` whenever `i` immediately requires `j`. Mandatory episode closure is computed before search. The branch-and-bound solver uses a fixed ID order, propagates prerequisite selection and dependent exclusion, rejects over-budget branches, and uses an exact rational fractional-knapsack upper bound. It reports `OPTIMAL` only when the search is exhausted; a configured branch-node cap produces `BEST_EFFORT` and never an exact claim. This is the general PCKP formulation, rather than a tree knapsack assumption, because an action can depend on multiple exploratory episodes and one exploratory episode can support several actions.[1] [2] [3]

A verified rooted-forest instance may use a capacity-indexed tree dynamic program. The test suite cross-checks the general branch-and-bound solver against an independent exhaustive enumerator for small cases; that oracle is deliberately implemented in the test rather than by reusing production selection code. Compaction dossiers preserve the policy, static utility records, required closure, PCKP problem certificate, retained and compacted IDs, and reason for infeasibility. Exact-compaction telemetry is emitted only when the exact solver actually runs; no fake zero observation is recorded for a context that was already under budget.

## P0-B: structural evidence selection

`EvidenceGraph` represents only source-backed nodes and explicitly declared relations. A relation means “including `from_node_id` requires `to_node_id`”; mandatory relation kinds are policy-controlled. `StructuralContextSelector` resolves exact IDs or approved unique aliases, performs a canonical breadth-first least-fixed-point traversal, records a witness path for every mandatory node, and returns `INFEASIBLE_REQUIRED_CLOSURE` if that closure exceeds the budget. It does not fall back to lexical top-k in that case.

Optional evidence receives a static policy score and is selected by the same exact PCKP solver under the residual budget. The returned packet includes graph and policy hashes, selected nodes, mandatory nodes, witnesses, omissions, token accounting, and the solver certificate. This realizes bidirectional traceability only over the **modelled, frozen** graph; it is not a claim that the graph contains every real-world dependency.[4] [5]

## P0-C and P1-A: graph-bound agents and lateral routing

`GraphAgentExecutor` accepts host-owned bindings containing a deterministic task adapter, model factory, optional governed tool-executor factory, gate registry, binding version, and explicit idempotence declaration. It receives a `GraphNodeExecutionContext` containing only declared predecessor results and a frozen, node-filtered graph state. It creates a `BaseAgent`, maps the typed agent terminal result to `GraphNodeResult`, and creates provenance from the result and binding digest. Model, credential, and callback objects are not persisted in the graph snapshot.

`StateGraph` is now the single lateral-state authority. Each graph node declares `routing_refs`; a discovery carries exact `affected_refs`. The graph persists sorted postings for requirement, signal, task, and schema references. On publication, nonempty reference categories are intersected. A matching not-yet-started consumer receives a conditional graph edge and a durable `ACCEPTED` decision. A consumer already running or terminal produces a durable `LATE_DISCOVERY` decision and typed conflict, not an out-of-band message. A worker receives only discoveries explicitly routed to its node. These rules implement graph-mediated typed state rather than transcript exchange, as required by the systems design.[6]

## P1-B: stage readiness and conflict disposition

`StageCompletenessGate` evaluates an explicit finite policy: required project stage, artifact paths, work-item IDs, open-question disposition, and blocker disposition. It returns all missing/incomplete identifiers and reasons. `ControllerRuntime.evaluate_stage_completeness()` records a stage failure during execution; the existing bounded-repair controller state machine then enters `REPAIR_REQUIRED` or `ESCALATED` according to its configured limit. The gate does not infer whether a free-text design is “complete.”

`GraphStateConflict` records immutable write collisions, discovery snapshot mismatch, discovery version mismatch, and late discovery. The `try_publish_discovery()` and `try_write_shared_value()` operations preserve the original valid graph state and return a typed, persisted conflict. This makes the disposition inspectable without treating a Python exception as the sole conflict representation.

## P2-A: frozen comparison evidence

The runnable comparison command is:

```bash
cd packages/agent-sdk
uv run python scripts/run_pckp_benchmark.py
```

It loads version-controlled inputs from `benchmarks/pckp_cases.json`, runs the exact and greedy static-objective solvers on each identical problem, and writes canonical JSON. The retained report is [PCKP comparison result](../packages/agent-sdk/benchmarks/results/pckp-report.json). It contains two cases in which exact selection retains one more unit of utility than the greedy baseline and an infeasible mandatory-closure case in which both solvers correctly refuse the budget. The elapsed-nanosecond fields are host-local timing observations, not portability claims.

The current fixture suite is sufficient to verify determinism, certificates, and the exact-vs-greedy distinction. It is **not** evidence for a population-level performance conclusion. A future empirical corpus must include independently adjudicated source spans, real frozen RTL-to-GDSII tasks, identical policy/source/tool versions, downstream verification outcomes, and explicit unavailable values before any broader claim is made.[1] [7]

## Validation

The release validation completed with **92 passing Python tests**, Ruff checks, formatting checks, and bytecode compilation. The suite includes the newly added exact solver oracle, structural selector, graph-agent executor, routing, conflict, stage-gate, and benchmark tests. The package has not selected a model provider or granted SSH, Desktop, Sandbox, or EDA execution capabilities in this increment.

## References

[1] [Approved revised P0–P2 algorithm plan](revised-p0-p2-algorithm-plan.md), especially sections P0-A through P2 and the supplied DeepSeek review it cites.

[2] [Boland et al., *Clique-based facets for the precedence constrained knapsack problem*](https://link.springer.com/article/10.1007/s10107-010-0438-7), referenced in the approved plan for the PCKP formulation.

[3] [Cho and Shaw, *A Depth-First Dynamic Programming Algorithm for the Tree Knapsack Problem*](https://doi.org/10.1287/ijoc.9.4.431), referenced in the approved plan for the forest-only dynamic-programming optimization.

[4] [NASA Systems Engineering Handbook, Requirements Management](https://www.nasa.gov/reference/6-2-requirements-management/), on baselined bidirectional traceability.

[5] [Updated systems-design framework, extracted p. 60](/home/ubuntu/work/baseagent-planning/pages/page-060.txt), lines 2–19, on graph-mediated typed state and context isolation.

[6] [Updated systems-design framework, extracted p. 60](/home/ubuntu/work/baseagent-planning/pages/page-060.txt), lines 2–19; [Manning, Raghavan, and Schütze, *Processing Boolean Queries*](https://nlp.stanford.edu/IR-book/html/htmledition/processing-boolean-queries-1.html), on sorted-postings intersection.

[7] [Matrix-accelerator research proposal](/home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf), the project’s stated evaluation and reporting intent.
