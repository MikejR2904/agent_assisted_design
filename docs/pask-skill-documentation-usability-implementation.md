# PASK, Agent SDK Skill, Documentation, and Usability Implementation Record

**Status:** Implemented and validated on 24 September 2026.
**Release:** `agent-design-agent-sdk` `0.9.0`.

## Delivered changes

This increment introduces `CompactionStrategy.PASK` as the default episode-memory retention selector while preserving `CompactionStrategy.GREEDY_BASELINE` for controlled comparison. PASK is a deterministic, provenance-aware, dependency-closed greedy selector. It scores a candidate episode by task relevance, live dependency centrality, provenance class, explicit harness access recency/frequency, and marginal lexical coverage; it ranks feasible candidate closures by utility-to-marginal-token-cost. The implementation does not claim that this greedy heuristic exactly solves dependency-constrained 0/1 knapsack, has a universal approximation bound, or improves downstream design results without experiments.[1] [2]

PASK retains the framework’s hard safety boundary. It computes a mandatory closure containing active/protected episodes, open records, manifest-incomplete EDA actions, and every live prerequisite of those records. If that closure exceeds the token budget, the runtime safely compacts nonmandatory leaves where possible, then returns `protected-over-budget` or `context-deadlock` with an explicit dossier. Compaction leaves the complete tool-result journal and audit evidence intact; it tombstones only episode payloads and releases reverse dependency links after the dependent record is tombstoned.[3]

The implementation adds explicit `access_count` and `last_access_sequence` fields to episode records. These reflect only harness-observed dependency consumption, not model-generated claims. Every PASK decision records strategy, policy weights, token budget, mandatory/retained/compacted IDs, score components, and a hash of the bounded task relevance signal. It does not write raw task text into the compaction dossier. The telemetry metric catalogue now records PASK decision, retained/compacted count, and mandatory-retention availability/rate observations.[4]

The SDK now includes `AgentRuntimeServices`, a narrow composition helper that opens durable result-journal, project-state, telemetry, and audit stores under one caller-selected run root. It preserves the host authority boundary: a caller must still supply a model adapter and, where relevant, a capability-governed tool executor. It never implicitly selects a provider, grants a capability, auto-approves a side effect, or chooses Desktop/Sandbox/SSH execution. The helper exposes `episode_store_factory` so a host can select PASK policy or preserve the greedy baseline without duplicating durable service construction.[5]

`HarnessToolRegistry.with_extensions()` now allows a host to append explicitly declared named governed tools and local async handlers. The normal capability and typed-approval check occurs before the custom handler. This makes tool extension easier without admitting a generic shell, a runtime-discovered tool name, or policy bypass.[6]

A repository-owned `skills/agent-sdk-engineering/` skill was created using the mandatory `/skill-creator` initializer and then adapted to the actual SDK. It contains a focused workflow plus architecture/invariant and implementation references. The new developer guide and context/coordination explainer document installation, durable usage, models, tools, verification, profiling, PASK, vertical/lateral coordination, audit, telemetry, limitations, and evaluation protocol.

## Validation

The following completed successfully from `packages/agent-sdk`:

```text
uv run ruff format src tests examples
uv run ruff check src tests examples
uv run pytest                         # 72 passed
uv run python examples/durable_runtime_with_pask.py
uv build --out-dir /tmp/agent-sdk-pask-build
```

The package build produced both `agent_design_agent_sdk-0.9.0.tar.gz` and `agent_design_agent_sdk-0.9.0-py3-none-any.whl`. The tests include PASK relevance/closure retention, mandatory-closure escalation, greedy-baseline comparison, explicit access-frequency scoring, PASK telemetry, `AgentRuntimeServices` durability, and policy-governed custom tool extension.

## Remaining research limitations

The default relevance scorer is deterministic lexical overlap. An embedding-based scorer is only an injected host extension and has not been supplied. The PASK evaluation claims are therefore research hypotheses. A valid benchmark must compare PASK and greedy baseline under identical typed episode graphs, budgets, task signals, tool outcomes, verification gates, and evaluation dataset; it must report token cost, critical-evidence retention, provenance completeness, deadlocks, downstream success, and duration. Provider token data, EDA/PPA evidence, and human-correction results remain unavailable until real adapters and measurement parsers record them.[4]

The verified dependency-aware compression source is not a PASK implementation: it uses dynamic programming on a topologically sorted dependency graph. Learned approaches such as MemAct and Memex(RL) are distinct future alternatives with different reproducibility and governance properties. They were not included in deterministic runtime authority.[2] [7]

## References

[1]: /home/ubuntu/upload/pasted_content_2.txt "User-approved PASK proposal, lines 19–70"

[2]: https://doi.org/10.1145/3829441.3829513 "Dependency-Aware Chain-of-Thought Compression for Financial Reasoning; dynamic-programming dependency-constrained selection"

[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 62–64"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/memory.py`

[4]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Proposal pp. 30–35"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/metrics.py`

[5]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/runtime.py "AgentRuntimeServices composition root"

[6]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/tool_registry.py "Custom handler registry extension, policy-governed executor"

[7]: https://aclanthology.org/2026.findings-acl.956/ "Memory as Action"; https://arxiv.org/abs/2603.04257 "Memex(RL)"; https://arxiv.org/abs/2608.20400 "DSGC preprint"
