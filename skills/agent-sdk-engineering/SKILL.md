---
name: agent-sdk-engineering
description: Extend, test, package, document, or benchmark the repository's Python Agent SDK and TypeScript MCP facade. Use for BaseAgent loops, provenance-grounded retrieval, structural specification versioning, governed tools, policy-bound orchestration/subagents, exact PCKP/PASK memory compaction, project state, vertical/lateral coordination, verification gates, telemetry, audit logs, optional LangGraph/LangChain/Jev interoperability, developer tools, and SDK consumer ergonomics.
---

# Agent SDK Engineering

## Purpose

Use this repository-owned skill when modifying `packages/agent-sdk`, the matching TypeScript MCP boundary in `packages/backend`, or their tests and developer documentation. The skill preserves the framework’s central boundary: a model proposes bounded typed work, while the deterministic harness owns authorization, policy, state transition, provenance, audit, and escalation.

Read [architecture and invariants](references/architecture-and-invariants.md) before changing runtime behavior. Read [implementation workflow](references/implementation-workflow.md) before editing code, tests, MCP contracts, or package documentation.

## Required workflow

1. **Establish source evidence.** Read the affected source and test files first. For design claims, cite the systems-design PDF with exact pages/lines, a versioned local proposal, or a primary external source. Treat user proposals as requested design changes, not independently proven research claims.
2. **Classify the change.** Use one path below. Do not mix model/provider code with deterministic policy or tool authority. Keep custom callbacks local to the embedding process; never serialize a Python callback through MCP.
3. **Design the contract.** Add or update Pydantic/TypeScript schemas before adding behavior. Preserve strict unknown-field rejection, typed terminal states, run-root containment, and explicit approval for mutating/process capabilities.
4. **Implement at the narrow boundary.** Prefer injection points: `AgentModel`, `ToolExecutor`, `VerificationGateRegistry`, `EpisodeRelevanceScorer`, `AgentRuntimeServices`, and `HarnessToolRegistry.with_extensions()`.
5. **Add focused tests.** Cover successful behavior, authority/policy rejection, a bounded/over-budget case, and a persistence or audit assertion where relevant. Preserve a baseline comparator for research algorithms.
6. **Document and validate.** Update the package README only as navigation; write detailed material under `docs/`. Run formatting, static checks, tests, examples, package build, TypeScript compilation if the façade changes, skill validation, and `git diff --check`.

## Change-selection guide

| Change type | Required reading | Key constraints |
|---|---|---|
| BaseAgent or model loop | Architecture reference; `base_agent.py`; `contracts.py`; loop tests | Model turns are untrusted. Provider continuation is opaque. Do not make audit history normal model context. |
| Memory compaction | Architecture reference; `memory.py`; `optimization.py`; `context_projection.py`; exact/PASK tests | Keep open, active, protected, manifest-incomplete, and dependency-closure evidence. Default exact PCKP accepts only additive static utility; retain PASK and greedy baselines for controlled experiments. |
| Tool or execution backend | Architecture reference; `policy.py`; `tool_registry.py`; supervisor tests | Add a named registered capability; never add generic shell or arbitrary network access. Mutating/process work requires typed approval. |
| Vertical/lateral coordination | Architecture reference; `orchestration.py`; `controller_runtime.py`; `graph.py`; `coordination.py` | `StateGraph` is the sole run-state carrier: it persists typed node results, discoveries, immutable shared values, and edges together. Workers exchange graph state, not transcripts. A lateral dependency must be published, versioned, provenance-linked, and added before the consumer starts. |
| Governed orchestration or subagents | Architecture reference; `orchestrator.py`; orchestration tests; orchestration guide | Compile only a validated plan and explicit user policy. Bind named skills/models/tools/capabilities, instance/total/parallel/repair limits, and immutable snapshot before approval. Require human plan approval before host-local binding/dispatch. Validate binding identity, exact model binding, node ID, and tool subset. MCP may persist data lifecycle only; never serialize model clients, callbacks, credentials, or executable bindings. Jev can lift single→multi only with a receipt; it cannot lower deterministic multi-agent routing or gain authority. |
| Gate/profile/telemetry | `verification.py`; `profiler.py`; `telemetry.py`; `audit_log.py` | Log reviewable public turns and result handles, never hidden reasoning or secrets. Mark absent measurements unavailable; do not infer them. |
| Retrieval/vector/cache | `retrieval.py`; `context_selection.py`; retrieval tests; grounded retrieval guide | Treat an index as untrusted candidate ranking only. Bind every candidate to frozen snapshot/category/document/node/source hash/location and resolve it locally before context admission. Keep provider credentials host-local. Qdrant is the optional single vector index; Redis may cache bounded digest-keyed retrieval results only, never source truth, graph state, approvals, locks, telemetry, audit history, raw text, or credentials. |
| Specification graph/version lock | `dependency_graph.py`; `specification_gate.py`; `git_versioning.py`; versioning tests | Use sorted deterministic graph traversals. Missing-reference blast radius is transitive reverse reachability. Classify version bumps from persisted structured snapshots and dependency edges, never filename keywords. Refuse automatic classification of a legacy tag without a snapshot until an approved baseline exists. |
| External framework or evaluator integration | `integrations/contracts.py`; target adapter; interoperability guide; boundary tests | Keep SDK authority local. Use an explicit sanitized projection, strict output reduction, digest-only receipt, explicit failure mode, lazy optional dependency, and host-selected durable receipt sink. No raw transcript/state, credentials, approval token, capability grant, or tool bypass may cross the boundary. |
| MCP/TypeScript change | `mcp_server.py`; Python tests; TypeScript client/routes/integration tests | Keep Python as semantic owner and TypeScript as a typed façade. Validate both language boundaries. |
| Consumer ergonomics or developer tooling | Developer handbook; examples; `runtime.py`; `developer_tools/` | Reduce boilerplate or add read-only inspection only. Do not auto-select models, grant capabilities, approve actions, or expose ambient execution. |

## Exact PCKP and PASK research protocol

`EXACT_PCKP` is the default selector for additive static utility. It must preserve its dependency-closure problem record, solver status, deterministic tie break, and optimality certificate; it must not include PASK’s dynamic marginal-diversity term while claiming exactness. PASK is an auditable deterministic diversity heuristic, not an exact solver or RL policy. Both strategies must report token budget, mandatory closure, retained IDs, compacted IDs, and policy/version information. The standard relevance scorer is lexical. Any embedding scorer must be local, deterministic, versioned, injectable, and tested for reproducibility.

When evaluating a selector, run the same scenario under `CompactionStrategy.EXACT_PCKP`, `CompactionStrategy.PASK`, and `CompactionStrategy.GREEDY_BASELINE` where their objectives are comparable. Compare token budget, retained critical evidence, mandatory-closure retention, provenance completeness, solver certificate, downstream task outcome, and execution time. Do not claim a heuristic approximation bound or downstream improvement without measured data.

## Repository validation

From `packages/agent-sdk` run:

```bash
uv sync --all-groups
uv run agent-sdk-dev quality .
uv run pytest
uv build --out-dir /tmp/agent-sdk-build
```

When modifying optional adapters, use `uv sync --all-groups --extra interop`, run
`uv run pytest tests/integrations`, execute the offline interoperability example, and
read the framework interoperability and Jev advisory guides before considering a
remote evaluator/provider call.

For the TypeScript MCP façade, use the project’s focused integration harness when available, then run its TypeScript compiler. For orchestration, run the local host-binding example and prove that the MCP surface has no remote dispatch method. Validate this skill with:

```bash
python /home/ubuntu/skills/skill-creator/scripts/quick_validate.py \
  /home/ubuntu/work/agent_assisted_design/skills/agent-sdk-engineering
```

## Sources

The workflow follows the framework’s orchestration/profile-routing requirements (updated systems-design PDF, pp. 41–42), common BaseAgent and tool/watchdog boundary (pp. 50–55), typed coordination model (p. 60), episode lifecycle/compaction contract (pp. 62–64), and state-based memory proposal. PASK is the user-approved extension in `pasted_content_2.txt`; consult the architecture reference for independently verified related literature and constraints.
