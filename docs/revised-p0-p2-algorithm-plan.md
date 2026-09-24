# Revised P0–P2 Deterministic Algorithm Plan

**Status:** Implemented through P2-A in SDK 0.11.0; P2-B semantic extensions remain deliberately deferred pending broader deterministic baseline evidence. See the [implementation record](p0-p2-algorithm-implementation.md).
**Decision basis:** The plan incorporates the supplied DeepSeek review, corrects its tree-knapsack assumption where it does not hold for the SDK’s current directed acyclic episode graph, and preserves the framework rule that agents exchange typed graph state rather than conversation.[1] [2]

## Executive decision

The roadmap should be revised. **Exact episode retention, structural evidence closure, and a production graph-node executor are all P0.** A content-based discovery router is P1 because it depends on a persisted graph state and an executable node context. Semantic relevance, semantic change-impact analysis, and empirical scaling studies remain P2 until their deterministic baselines are measured.

The DeepSeek review correctly identifies that a memory algorithm should be evaluated rather than merely described. Its proposed *tree* dynamic program, however, is valid only when the immediate dependency relation is a rooted forest. The SDK permits an action episode to depend on several exploratory episodes and permits exploratory evidence to support several actions. Therefore the general problem is a **precedence-constrained knapsack problem (PCKP)**, not tree knapsack. The P0 solver will be exact for the general directed acyclic graph and may use tree dynamic programming only after an explicit forest predicate succeeds.[1] [4] [5]

> **Non-negotiable safety rule.** A budget may reduce optional evidence only. If a mandatory dependency closure, required specification closure, or required source evidence exceeds its budget, the runtime returns a typed deadlock/infeasibility dossier. It must not silently remove required evidence.[2] [3]

## Revised priorities and deliverables

| Priority | Increment | Deterministic algorithm and concrete deliverables | Success condition |
|---|---|---|---|
| P0-A | Exact memory retention | Replace default greedy retention with an additive-utility, dependency-closed **PCKP branch-and-bound solver** using integer costs and utilities, exact arithmetic bounds, canonical tie breaking, and a proof-bearing result. Retain greedy PASK only as an identical-objective baseline. Add an optional forest-only tree-DP fast path validated against the general solver. | Results labeled `OPTIMAL` are closure-valid, budget-valid, and have equal incumbent and upper bound. |
| P0-B | Structural context closure | Introduce a source-addressed typed evidence graph with exact requirement, interface, signal, acceptance, dependency, source-span, and relation nodes. Resolve exact request seeds, compute policy-defined mandatory reachability closure, then exactly pack optional evidence with the residual budget. | All modeled mandatory evidence is selected or an explicit infeasibility dossier is returned; no semantic model or embedding is required. |
| P0-C | Production graph agent executor | Add host-injected `GraphAgentExecutor` bindings that adapt a `PlanTask` plus `GraphNodeExecutionContext` to a `ScopedAgentTask`, invoke a bound `BaseAgent`, map its typed result to `GraphNodeResult`, record provenance, and persist wave lifecycle/recovery state. | A scripted end-to-end multi-agent graph executes without transcript exchange; crash recovery never silently repeats a non-idempotent node. |
| P1-A | Content-based discovery routing | Add exact `affected_refs` to discoveries, exact consumer routing references to plan/node metadata, persisted inverted indices, a route-decision ledger, filtered node state views, and conditional-edge delivery. | Each route is reproducible from a frozen graph/policy snapshot, including rejection and late-delivery reasons. |
| P1-B | Stage completeness and conflicts | Formalize stage schemas/completeness gates and replace incidental shared-write exceptions with typed conflicts, late-discovery outcomes, and controller escalation rules. | Missing required state, incompatible writes, and late discoveries have explicit deterministic dispositions. |
| P1-C | Thesis framing | Rewrite the catalogue around conditional computational surrogates: derivation provenance, byte/reference fixity, policy authorization, and trace-policy accountability. Each claim names its input representation, trust assumptions, output, and cost. | The documentation makes no universal claim of semantic truth, institutional legitimacy, or unique blame. |
| P2-A | Measured comparison harness | Add reproducible datasets, exhaustive small-instance oracle tests, and benchmark reports for greedy versus exact retention, lexical versus structural context, and manual versus indexed discovery routing. | Metrics report quality, resource cost, and unavailable values honestly on identical frozen inputs. |
| P2-B | Semantic extensions | Add only versioned, reproducible host extensions for semantic relevance and semantic change-impact propagation after deterministic baselines are evaluated. | Extensions never replace mandatory closure, exact IDs, provenance, or source-link requirements. |

## P0-A: exact provenance-aware episode retention

### Correct problem formulation

For every live episode `i`, define a binary decision variable `x_i`. Let `t_i` be its non-negative integer token cost and `u_i` its non-negative integer, **static** utility. If selecting episode `i` requires immediate prerequisite `j`, the solver enforces `x_i ≤ x_j`. The exact problem is:

> maximize `Σ u_i x_i`
> subject to `Σ t_i x_i ≤ B`; `x_i ≤ x_j` for every immediate dependency `(i → j)`; and `x_i = 1` for mandatory episodes.

Immediate constraints are sufficient because transitive closure follows by induction. The solver must charge a shared prerequisite once, not once per selected dependent. This is the standard binary PCKP formulation; it is NP-hard in the general case. The tree-specific pseudo-polynomial dynamic program is an optimization only for a verified rooted-forest dependency relation.[4] [5] [6]

The current PASK `diversity` term is a **dynamic coverage feature**, so its utility changes with the already retained set. It is not the additive PCKP objective above. The migration therefore introduces two explicitly different modes:

1. `EXACT_PCKP`: static, reproducible integer utility features only. This becomes the default correctness mode.
2. `GREEDY_PASK_BASELINE`: the same static objective and canonical tie break, so it is comparable to exact PCKP.
3. `DYNAMIC_DIVERSITY_HEURISTIC`: retained only as an opt-in experimental heuristic; it cannot be reported as exact PCKP and is evaluated separately.

### Solver design

`ExactPckpSolver` will use custom single-threaded deterministic branch-and-bound. It first validates acyclicity, computes mandatory closure, fails when the mandatory cost exceeds the budget, and fixes a canonical episode-ID order. At each branch node, selecting an episode forces its prerequisite closure; excluding an episode forces all dependents to zero. The solver prunes contradictory or over-budget states. A fractional-knapsack relaxation that ignores remaining precedence constraints provides an admissible upper bound. The solver uses exact rational arithmetic for that bound, explores a fixed branch order, and explores equal-value branches so that the lexicographically smallest selected ID set is chosen among equal optima. `OPTIMAL` is emitted only after every branch is exhausted or safely bounded.

An optional time/node-limited mode is allowed only as `BEST_EFFORT`. It must return the incumbent utility, a valid upper bound, the gap, and an explicit non-optimal status. It must never be presented as exact. A tree-DP fast path is allowed only after a structural validator confirms that the immediate dependency graph is a rooted forest; generated forest cases must cross-check it against the general solver.[4] [5]

### Exact-compaction telemetry and evaluation

The run records policy hash, dependency graph hash, token costs, utilities, retained IDs, compacted IDs, mandatory closure, status, branch count, elapsed time, optimum value, upper bound, and gap. Unit tests include chains, forests, diamonds with shared prerequisites, multiple prerequisites, zero-cost episodes, an exact budget boundary, and infeasible mandatory closure. For small graphs, an independent exhaustive enumerator verifies the selected set and utility. The experiment harness compares greedy and exact methods on identical episodes/budgets and reports retained utility, required-closure coverage, solve time, and downstream verification outcome.[1] [3]

## P0-B: structural context closure and exact evidence packing

### Evidence graph boundary

The preprocessor remains source-preserving. A new **immutable evidence graph** is built from only explicit, source-backed relations: requirement dependencies, requirement source references, locked interface signals, accepted acceptance/verification links, approved aliases, and declared interface/dependency links. A relation has a type, direction, hard/advisory strength, source span, source revision, and policy version. No language-model extraction, lowercase modal verb, or free-text similarity creates a mandatory edge.

This is consistent with NASA’s requirement-management guidance: requirements must maintain bidirectional traceability through baselined parent/source requirements, design documents, and test plans/procedures.[7]

### Selection algorithm

1. Resolve exact canonical request targets from declared scope IDs, approved aliases, locked-interface signal IDs, and acceptance IDs. Ambiguous, missing, stale, or unapproved aliases are diagnostics.
2. Select the stage policy’s mandatory relation types. Traverse the graph in canonical order to the least fixed-point mandatory closure. Each retained node records its seed, predecessor edge, and source locator.
3. If mandatory closure cost exceeds budget, return `INFEASIBLE_REQUIRED_CLOSURE` with the complete witness-path and omission dossier. Do not fall back to lexical top-k.
4. Construct optional source-preserving evidence units. Score static, versioned features such as exact target match, acceptance linkage, interface linkage, dependency linkage, authority tier, exact lexical evidence, and cost.
5. Use the PCKP exact solver over the residual budget. Require companions that are necessary for interpretation to form an indivisible bundle.
6. Return selected units in canonical order, exact token accounting, selected/omitted reasons, policy hash, source digests, and the complete mandatory proof.

The reachability computation is `O(|V_reached| + |E_reached|)`. Exact optional packing is PCKP, and has exponential worst case; this is why it is bounded by the context packet’s modest candidate count and emits a transparent best-effort mode only when explicitly configured. The result is a deterministic evidence packet, not a semantic retrieval claim.[4] [7]

### Evaluation

A frozen benchmark will use independently adjudicated exact source-node/span IDs. It reports mandatory-closure recall, weighted critical-evidence recall, false-omission rate, path completeness, infeasible-closure rate, token utilization, and irrelevant-budget share. Baselines are seed-only, one-hop closure, current lexical/pointer selection, and exact structural closure at the same budget. The selector’s reported completeness is conditional on explicit graph-link completeness; missing links remain graph-quality gaps rather than evidence of no dependency.[1] [7]

## P0-C: a durable production graph agent executor

The current `StateGraph.execute()` has a safe execution context but no `BaseAgent` node executor. P0 adds the following host-owned boundary:

| Type | Responsibility |
|---|---|
| `GraphAgentBinding` | Binds a graph node ID to an agent definition, an injected model factory, a governed tool-executor factory, a deterministic task adapter, verification gates, and a binding/version digest. No credential or model object is persisted in the graph. |
| `GraphTaskAdapter` | Deterministically converts the `PlanTask`, immutable source snapshot, declared predecessor results, and filtered routed discoveries into the agent’s `ScopedAgentTask`. It is explicit because no generic plan-to-agent input mapping can be correct for every consumer schema. |
| `GraphAgentExecutor` | Invokes `AgentRuntimeServices.create_agent()`, executes the scoped agent task, maps terminal agent status to `GraphNodeResult`, writes artifact/provenance references, and does not copy audit transcripts to graph state. |
| `HarnessCoordinator.execute_wave()` | Persists `RUNNING` state before execution, commits terminal results in canonical node-ID order, saves after each commit, and applies restart policy. |
| `RestartPolicy` | Default is **no automatic replay** of an interrupted agent node. Only a binding explicitly marked idempotent may be requeued; otherwise the node becomes a typed interrupted failure and the controller enters bounded repair/escalation. |

The executor context stays narrow: declared typed predecessor results and the node-filtered graph shared state. Model-visible state is bounded project state plus the adapted task. Transcript/audit evidence stays in its existing bounded audit log. This implements the framework’s graph-mediated typed communication boundary.[2]

Validation will use scripted models and in-memory governed tools. Tests cover parallel isolated workers, typed predecessor-only visibility, filtered discovery visibility, failure mapping, cancellation, idempotent versus non-idempotent restart recovery, controller repair/escalation, provenance fan-in, and durable graph rehydration.

## P1-A: deterministic content-based discovery routing

### Data model and matching

`ExploratoryDiscovery` gains `affected_refs`, containing canonical requirement IDs, exact signal IDs, exact task IDs, optional explicit schema type/version, and source spans supporting those references. Each `PlanTask` gains an explicit `routing_refs` profile. Signal IDs may be derived from its locked interface, but requirement and scope IDs must be explicit rather than inferred from prose.

`GraphSharedState` persists a `DiscoveryRoutingIndex` and `DiscoveryRouteDecision` ledger. The index maps each canonical reference to sorted pending consumer node IDs. On publication, the router computes exact set intersections over requirement, signal, task, schema, source snapshot, and policy constraints. It performs final deterministic eligibility checks, records every accepted/rejected/late route, and adds a conditional edge only for a matching consumer that has not started.

Sorted postings permit two-pointer intersection in time linear in the accessed postings lengths. Evaluating conjunctions in increasing posting-list size reduces intermediate results. The routing decision is a pure function of the frozen graph, policy, and discovery; it is not a semantic model call.[8] [9]

### Delivery semantics

A node receives only discoveries routed to that node, not every graph discovery. Discovery publication after a consumer has started is a typed `LATE_DISCOVERY` result and triggers the configured controller repair/escalation policy. A route is not permission to execute: graph dependency status and capability/approval rules remain separate. This preserves declared-edge reproducibility and prevents a content match from becoming ungoverned agent-to-agent messaging.[2] [9]

The evaluation records reach latency from graph publication to durable consumer visibility, routing decision rate, exact-match hit rate, adjudicated false-delivery/false-omission rate, late-route rate, index freshness, and deterministic replay equality. Every metric carries snapshot and policy IDs.[1]

## P1-B: stage gates, conflicts, and trust-property framing

P1 formalizes stage-specific project-state schema requirements and deterministic completeness gates. It also adds typed conflict records for duplicate immutable shared writes, schema mismatch, source-version mismatch, and late discovery; each outcome is one of reject, block, bounded repair, or escalation.

The algorithm catalogue’s introduction will be rewritten around **conditional computational surrogates**, not broad real-world claims:

| Property label | Defensible operational problem | Preconditions and cost |
|---|---|---|
| Derivation provenance | Reachability/derivation check over a complete, frozen typed evidence graph | `O(V + E)` for reachability after graph loading; proves only modeled derivations. |
| Fidelity | Digest/signature fixity or declared finite-state conformance against an authorized reference | Hash comparison is linear in bytes; semantic equivalence needs a separately specified decidable model. |
| Authority | Point-in-time decision under a finite, versioned policy | Constant-time indexed lookup after policy-hierarchy preprocessing, or traversal without it; does not prove institutional legitimacy. |
| Accountability | Attribution set under complete, authentic, ordered events and an explicit causality/attribution relation | Depends on the trace-policy monitor and relation; result is set-valued unless a total functional rule is supplied. |

This mirrors the source-grounded implementation without claiming that audit logs establish legal blame or that provenance proves source claims true. The present hash chains remain integrity evidence; cryptographic authenticity requires a separately configured signature/key/anchor mechanism.[10] [11]

## P2: empirical and semantic extensions

P2 introduces a reproducible benchmark runner and report generator. It runs all compared algorithms on the same frozen source snapshots, task packets, tool outcomes, budgets, and policy versions. It records outputs, exact/greedy gaps, structural-retrieval metrics, routing metrics, latency/resource use, verification outcomes, and unavailable measurements without coercing them to zero.[1] [3]

Only after P0/P1 baselines are evaluated may the SDK add versioned host extensions for semantic relevance, document/diagram relation extraction, or semantic change-impact propagation. They remain optional scoring/advisory components. They never create mandatory links, bypass exact source identifiers, or substitute for approval/provenance gates.

## Dependency order and non-goals

1. Implement exact PCKP contracts and objective migration first; its solver will be reused by optional evidence packing.
2. Implement evidence-graph structural closure and tests second.
3. Implement durable graph-agent execution third.
4. Implement routing index and filtered context after executable nodes and explicit routing profiles exist.
5. Add stage conflict semantics, research framing, and evaluation harnesses after the typed runtime contracts stabilize.

This increment does **not** select an LLM provider, issue SSH/Desktop/Sandbox privileges, infer hidden requirements, use embeddings, add a general-purpose MILP dependency, or claim a universal theorem about semantic fidelity, institutional authority, or legal accountability.

## Approval request

Approve this plan to implement the revised P0–P2 roadmap in the stated dependency order, using a custom deterministic exact branch-and-bound PCKP solver rather than an external native MILP dependency. The implementation will make the exact/default mode explicitly additive, retain greedy/dynamic-diversity modes only as labeled baselines/experiments, and add the benchmark/report artifacts required to demonstrate the claim.

## References

[1]: [DeepSeek algorithm review supplied by the project owner](/home/ubuntu/upload/pasted_content_3.txt) "Improving the Algorithm Design".

[2]: [Updated systems-design framework, extracted p. 60](/home/ubuntu/work/baseagent-planning/pages/page-060.txt) "Graph-mediated typed state and context isolation".

[3]: [PASK proposal supplied by the project owner](/home/ubuntu/upload/pasted_content_2.txt) "Provenance-aware state and memory design".

[4]: [Boland et al., Clique-based facets for the precedence constrained knapsack problem](https://link.springer.com/article/10.1007/s10107-010-0438-7) "Precedence-constrained knapsack formulation and exact methods".

[5]: [Cho and Shaw, A Depth-First Dynamic Programming Algorithm for the Tree Knapsack Problem](https://doi.org/10.1287/ijoc.9.4.431) "Tree-specific pseudo-polynomial dynamic programming".

[6]: [Samphaiboon and Yamada, Heuristic and Exact Algorithms for the Precedence-Constrained Knapsack Problem](https://link.springer.com/article/10.1023/A:1004649425222) "Exact algorithms for PCKP".

[7]: [NASA Systems Engineering Handbook, Requirements Management](https://www.nasa.gov/reference/6-2-requirements-management/) "Bidirectional traceability and baselined requirement relationships".

[8]: [Manning, Raghavan, and Schütze, Processing Boolean Queries](https://nlp.stanford.edu/IR-book/html/htmledition/processing-boolean-queries-1.html) "Sorted postings intersection and query order".

[9]: [Eugster et al., The Many Faces of Publish/Subscribe](https://systems.cs.columbia.edu/ds2-class/papers/eugster-pubsub.pdf) "Content-based publish/subscribe routing".

[10]: [Green, Karvounarakis, and Tannen, Provenance Semirings](https://dl.acm.org/doi/10.1145/1265530.1265535) "Representation-dependent derivation provenance".

[11]: [NIST FIPS 180-4, Secure Hash Standard](https://doi.org/10.6028/NIST.FIPS.180-4) "Digest-based modification detection".
