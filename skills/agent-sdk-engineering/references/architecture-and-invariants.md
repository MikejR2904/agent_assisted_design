# Architecture and Invariants Reference

## Authority model

The Agent-Assisted Design framework specifies a reusable BaseAgent with identity, versioned instructions, typed input/output, bounded declared tools, model binding, scoped memory, termination policy, and an optional deterministic verification gate. The model is an untrusted proposer; the harness validates all model turns and owns tool authorization, execution limits, result validation, and escalation.[1]

`BaseAgent` calls the model with a scoped immutable prompt, a bounded `ProjectStateView`, projection metadata, and optional opaque provider continuation. It does not supply raw tool observations, episode payloads, or audit transcripts as ordinary working context. Tool outcomes are journaled, reduced into provenance-linked state, and logged for review. This protects the context budget without making audit evidence unavailable.[2]

## State and evidence invariants

| Invariant | Implemented enforcement | Source |
|---|---|---|
| No raw transcript as routine working memory | `ModelContext.observations` and `episodes` are empty in normal BaseAgent calls; `ProjectStateProjector` emits a bounded current-state view. | State-based proposal; `base_agent.py`, `project_state.py`.[2] |
| Tool evidence remains available | Full results are stored in `ToolResultJournal`; project state keeps opaque evidence handles and bounded summaries. | `context_projection.py`, `project_state.py`.[2] |
| Human decisions are not model facts | Only the `HUMAN` state authority can write `HUMAN_DECISION`. | `project_state.py`.[3] |
| Mutations need approval | `CapabilityPolicy` permits a mutating/process tool only when a compatible typed approval is present. | `policy.py`; systems design pp. 54–55.[4] |
| Audit is review evidence, not hidden reasoning | Audit/profiler validators reject hidden-reasoning keys and redact secret-bearing keys. | `audit_log.py`, `profiler.py`.[5] |

## Context compaction and PASK

The original framework prescribes typed episodes, structural checkpoints, protected live episodes, dependency-aware eligibility, and a context-deadlock dossier rather than silent loss.[6] The repository retains that safety contract and preserves the original policy as `CompactionStrategy.GREEDY_BASELINE`.

The default `CompactionStrategy.PASK` is a user-approved design extension. It is a deterministic greedy retention heuristic, with no claimed global optimality bound. For a task-scoped textual query and each live episode `e`, the implementation computes:

> `U(e) = w_r R(e) + w_c C(e) + w_p P(e) + w_a A(e) + w_f F(e) + w_d D(e)`

`R` is host-injected deterministic relevance (lexical overlap by default); `C` is live reverse-dependency centrality; `P` is the provenance class; `A` is explicit harness access recency; `F` is explicit access frequency; and `D` is marginal lexical coverage of terms not represented by already selected episodes. The selector considers an episode with its full dependency closure, then chooses the feasible candidate with highest `U / marginal_token_cost`. Ties are deterministic: ratio, utility, lower cost, then episode ID. The retained set therefore remains dependency closed.

Open episodes, an explicitly active/protected episode, action episodes requiring a missing EDA manifest, and every dependency required by those records form the mandatory closure. If that closure alone exceeds budget, PASK tombstones every nonmandatory leaf it safely can, then returns `protected-over-budget` or `context-deadlock` with a dossier. It never silently discards mandatory state. It compacts unretained records leaf-first to release reverse edges safely. Each PASK dossier records policy weights, query digest, mandatory IDs, retained IDs, compacted IDs, and utility components; it does not persist raw task text as the query.

The primary dependency-aware compression source verified for this work formulates a dependency-constrained knapsack problem and solves it by dynamic programming on a topologically sorted graph. It should not be cited as support for a greedy approximation.[7] PASK is instead an engineering hypothesis defined by the user proposal; compare it empirically with the preserved greedy baseline. RL approaches such as MemAct are separate, non-deterministic/learned alternatives and are not implemented.[8]

## Vertical and lateral coordination

Vertical coordination is controller-owned. The controller binds an immutable source snapshot, selects a profile, validates a typed plan, requires explicit plan approval, dispatches the graph, records terminal node outcomes, performs bounded repair, and escalates unresolved failure. The controller cannot turn worker conversations into state because workers do not exchange conversations.[9]

Lateral coordination uses graph-owned `GraphSharedState`, persisted in the same `StateGraph` snapshot as nodes, edges, statuses, and typed results. A producer may publish only a closed exploratory discovery that records snapshot ID/version, source spans, owner, and provenance hash. A consumer submits a `LateralDependencyRequest`; only then can the graph insert a conditional edge, and only before the consumer starts. `GraphNodeExecutionContext` supplies declared predecessor results and a read-only graph-state copy; fan-in requires compatible source snapshot IDs and result schema versions through `ProvenanceContractGate`.[10]

## Sources

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 50–51, BaseAgent contract"

[2]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 23–113 and 137–148"; /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/base_agent.py "State-first model call"

[3]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py "StateAuthority and StateTransition reducer"

[4]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 54–55, tool hooks and watchdog"

[5]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/audit_log.py "Audit redaction and hidden-reasoning rejection"

[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 62–64, episode graph and compaction"

[7]: https://doi.org/10.1145/3829441.3829513 "Dependency-Aware Chain-of-Thought Compression for Financial Reasoning"

[8]: https://aclanthology.org/2026.findings-acl.956/ "Memory as Action: Autonomous Context Curation for Long-Horizon Agentic Tasks"

[9]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 58–60, planner/controller and state graph"

[10]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/graph.py "GraphSharedState and GraphNodeExecutionContext"; /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/shared_state.py "ProvenanceContractGate"
