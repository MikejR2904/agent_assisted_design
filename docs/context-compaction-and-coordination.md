# Context Compaction and Agent Coordination

**Status:** Implemented deterministic PASK selector with retained greedy baseline.
**Scope:** This document explains the actual SDK mechanism, its mathematical model, safety constraints, coordination semantics, and limitations. It does not claim that PASK is an exact solver, a learned policy, or experimentally superior before benchmark data exists.

## What is compressed

The SDK separates four stores. The normal model working memory is a bounded `ProjectStateView`; complete tool outcomes are in a `ToolResultJournal`; reviewable interaction events are in the audit transcript; and typed task episodes form a dependency graph for recovery, provenance, and compaction. The model does not ordinarily receive prior tool observations or episode payloads. Consequently, compaction does not delete full evidence from the journal or audit store; it tombstones selected in-memory episode payloads and retains structural checkpoint data.[1]

This distinction matters. It prevents the otherwise linear growth of repeated tool output in model input while preserving identifiers, hashes, results, and audit evidence for a human or an authorized deterministic tool. Project-state projection independently bounds model-visible current state. If mandatory project state does not fit, BaseAgent blocks rather than dropping it.[1]

## Original greedy baseline

`CompactionStrategy.GREEDY_BASELINE` preserves the earlier deterministic rule. While the episode store is over budget, it evicts an eligible closed leaf in a fixed priority order: action episode, substrate-backed exploratory episode, then ordinary exploratory episode, with episode ID as tie-break. It never evicts an active/protected node, a non-leaf with live dependents, or an EDA action still missing its required manifest. When it cannot continue, it returns an explicit `protected-over-budget` or `context-deadlock` dossier.[2]

The baseline is intentionally retained for research comparison. It is fast and predictable, but it does not use the current task’s semantic signal, evidence coverage, or utility-to-cost trade-off.

## PASK: Provenance-Aware Submodular Knapsack

PASK is the user-approved extension proposal. It is implemented as a deterministic, dependency-closed greedy selector. It borrows the budget-selection framing from dependency-aware compression research but does not claim to reproduce that research’s dynamic-programming algorithm.[3]

For each candidate episode `e`, PASK computes a bounded normalized utility:

> `U(e) = wR R(e) + wC C(e) + wP P(e) + wA A(e) + wF F(e) + wD D(e)`

| Component | Implemented source | Interpretation |
|---|---|---|
| `R(e)` | `EpisodeRelevanceScorer`; lexical token overlap by default | Task relevance from the scope label, task instruction, and acceptance criteria. |
| `C(e)` | Live `depended_on_by` count, normalized by maximum live count | Structural centrality of a prerequisite. |
| `P(e)` | Substrate-backed/exploratory/action manifest class | Provenance priority. |
| `A(e)` | Explicit harness access sequence | Recency of actual dependency use, not transcript order. |
| `F(e)` | Explicit harness access count | Frequency of actual dependency use. |
| `D(e)` | New lexical terms beyond selected closure | Deterministic marginal coverage; a limited submodular-style diversity term. |

The selector considers an episode together with all live prerequisites in its dependency closure. It calculates marginal cost as the sum of closure members not yet retained, discards choices that would exceed the episode budget, and chooses the feasible option with greatest `U(e) / marginal_cost`. Ties use descending ratio, descending utility, lower cost, then lexical episode ID. This deterministic order ensures a reproducible result for identical records, policy, scorer, and task signal.

The implementation is a **greedy heuristic**, not a globally exact solution to dependency-constrained 0/1 knapsack. The verified primary source for dependency-constrained chain-of-thought compression explicitly uses dynamic programming over a topologically sorted dependency graph, so PASK must not be described as that paper’s greedy method.[3]

## Hard retention rules and failure behavior

The following records form the mandatory retained set: active episode; explicit protected episodes; open records; action records that require an absent EDA manifest; and complete dependency closure of every mandatory record. If mandatory closure exceeds the configured budget, PASK safely tombstones every nonmandatory leaf it can, then returns `protected-over-budget` when explicit protection caused the conflict or `context-deadlock` otherwise. It includes the budget, mandatory tokens, mandatory IDs, compacted IDs, and query digest in the dossier. The caller blocks/escalates rather than assuming that a retained fact can be silently lost.[2]

After choosing the retained set, PASK compacts the complement leaf-first. Retained dependencies cannot be compacted because retained selection is dependency closed; reverse dependency references are released only when the dependent tombstone is written. This preserves the framework’s structural checkpoint concept and its manifest safety rule.[2]

## Complexity and auditability

For `n` live records, PASK repeatedly evaluates remaining candidates and dependency closures. Its simple implementation is approximately quadratic in the number of candidates, plus the cost of closure traversal and token estimation; its memory use is linear in the records and score dossier. This is an implementation characterization, not an asymptotic performance guarantee for arbitrary custom relevance scorers. The deterministic lexical scorer is local and bounded. A custom embedding scorer must document its model version, input normalization, source assets, output range, and deterministic test fixtures.

Every decision includes strategy, policy weights, query digest, mandatory/retained/compacted IDs, and selected component scores. Standard telemetry records PASK decision count, retained/compacted episode counts, and mandatory-retention availability/rate. The audit log records the lifecycle event but never raw hidden reasoning. These metrics support comparison with the greedy baseline; they do not prove downstream task success by themselves.[4]

## Vertical coordination

The controller is the vertical authority. It binds an immutable source snapshot, selects the skill/tool profile, validates the plan, awaits user approval, dispatches the typed graph, records results into project state, attempts bounded repair, and escalates an unresolved failure. A worker cannot bypass that path through conversation. This corresponds to the planning-worker-verification workflow and typed state graph in the systems design.[5]

## Lateral coordination

Parallel workers do not exchange conversation histories. The authoritative run snapshot is the `StateGraph`: it contains scheduler state, typed node results, `GraphSharedState`, and conditional edges together. A completed producer publishes a closed `ExploratoryDiscovery` or immutable shared value into that graph-owned state; a consumer requests the discovery, and the graph adds a conditional producer-to-consumer edge only while the consumer remains unstarted. A node executor receives declared predecessor results plus a read-only graph-state copy, not arbitrary sibling outputs. At fan-in, `ProvenanceContractGate` checks record uniqueness, required source snapshot IDs, and result-schema compatibility. This provides lateral cooperation without either a transcript or a parallel discovery store.[6]

## Experimental protocol

A credible PASK evaluation runs the same typed episode graph, task signal, policy budget, tool outcomes, and verification gate under both selectors. Report total input-token estimate, episode tokens before/after, mandatory evidence retention, provenance contract outcome, context-deadlock count, task completion/verification result, tool/model duration, and human review where available. Store unavailable provider token or downstream EDA metrics as unavailable. Do not substitute zero or infer them from SDK estimates.[4]

A learned memory editor such as MemAct or an indexed RL memory system such as Memex(RL) is a future research comparator, not part of the deterministic PASK runtime. They have different reproducibility, audit, training-data, and authority implications.[7]

## References

[1]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 23–113 and 137–148"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py`

[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 62–64"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/memory.py`

[3]: https://doi.org/10.1145/3829441.3829513 "Dependency-Aware Chain-of-Thought Compression for Financial Reasoning"

[4]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Proposal pp. 30–35"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/metrics.py`

[5]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 41–42 and 58–60"

[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, p. 60"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/graph.py`; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/coordination.py`

[7]: https://aclanthology.org/2026.findings-acl.956/ "MemAct"; https://arxiv.org/abs/2603.04257 "Memex(RL)"; https://arxiv.org/abs/2608.20400 "DSGC preprint"
