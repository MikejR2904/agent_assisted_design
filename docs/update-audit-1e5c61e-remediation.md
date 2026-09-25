# Update Audit Remediation Record for `1e5c61e`

**Scope:** Local remediation of the fetched `dev` update headed by `1e5c61e` (“Optimized IO operations”).

**Status:** Implemented and validated locally; not pushed from this environment.
**Decision:** Retain the update’s performance-oriented direction only where its correctness, recovery, and authority invariants can be demonstrated by code and regression tests.

## 1. Audit basis and decision criteria

The supplied audit reported that the update had improved several boundaries but left material reliability gaps: cache-key coercion could alter a host-owned JSON Schema; process-local initialization could fail after run-root recreation; portable artifact manifest names broke legacy lookup; split run/controller persistence could mix snapshots with newer sidecar history; and audit JSONL appends were not serialized across independent processes.[1] The audit also identified an unbounded general-DAG branch-and-bound invocation in the default compaction path, incomplete bounds around `notebook_edit`, credential-key synonym gaps at framework boundaries, and broad unprotected atomic replacements.[1]

The remediation uses the framework’s stated requirements for deterministic bookkeeping, source-linked records, bounded execution, explicit deadlock behavior, and restart validation—not a performance claim as the decision criterion.[2] In particular, the framework says that the harness, rather than an agent, wires dependency metadata mechanically and that compaction must surface a named deadlock rather than silently force an unsafe result.[2] The affected SDK modules therefore preserve their existing authority boundaries: no new model capability, tool authority, remote execution target, or provider integration is introduced.

## 2. Findings reproduced and repaired

| Finding | Risk confirmed by regression test | Repair | Verification evidence |
|---|---|---|---|
| Schema-cache coercion | Serializing a non-JSON host schema with `default=str` changed a `Decimal` `const` constraint. | Cache only schemas whose canonical JSON serialization is lossless; validate non-JSON schemas directly with `jsonschema`. | `test_schema_cache_does_not_coerce_non_json_schema_constants`.[3] |
| Recreated run root / legacy artifact manifest | A class-level “initialized” root cache could skip directory creation after deletion; manifests written before portable filename sanitization could not be loaded. | Recreate required artifact directories on construction, preserve portable logical IDs, and probe the legacy manifest filename when needed. | Artifact recreation and legacy lookup regressions.[3] |
| Split run/controller persistence | Appending sidecar history before replacing the snapshot could make restart merge a stale snapshot with an uncommitted suffix. | Bind each snapshot to an exact sidecar entry count and SHA-256 prefix hash. Recovery replays only that prefix; the next write truncates unpublished suffixes. Legacy full snapshots remain readable. | Legacy and forced-replacement-failure recovery regressions.[3] |
| Audit JSONL writers | Concurrent store instances/processes could derive the same tail sequence and predecessor hash. | Serialize one tail-read/hash/write/fsync transaction with a process-local per-run lock and a portable OS lock-file guard. | Independent-process append regression verifies contiguous sequence and full chain.[3] |
| Windows destination-handle race | Raw `os.replace` calls had inconsistent retry behavior. | Centralize publication in `atomic_io.replace_atomic()` and route every SDK `os.replace` call through it. The helper retries only `PermissionError`, preserving other failure modes. | Retry-once and terminal-failure regressions; source sweep finds `os.replace` only inside the helper.[4] |
| General-DAG PCKP search | Default episode compaction passed no branch-node limit to general branch-and-bound search. | Add policy-owned `exact_max_branch_nodes` (default 50,000). A cap yields an explicit feasible `BEST_EFFORT` certificate; rooted-forest dynamic programming remains exact. | Bounded-certificate regression plus existing exact-oracle coverage.[5] |
| Notebook sparse allocation | An arbitrary `cell_index` could materialize an arbitrarily large number of notebook cells. | Enforce a direct-dispatch and JSON-Schema maximum of 2,000 cells. | Sparse-index rejection regression.[6] |
| Interoperability credential synonyms | Canonicalization covered case/separator variants but omitted common key families such as `access_token`, `refresh_token`, `jwt`, and `client_secret`. | Add synonym families to the authority-material denylist while retaining bounded, JSON-compatible projections. | Camel/kebab/case synonym regressions.[7] |
| Uncovered core controls | Cancellation, lexical relevance, and several `CapabilityPolicy.evaluate()` branches were not directly verified. | Add deterministic tests for early cancellation, unique-query-term lexical coverage, contained paths, missing/mismatched/pending/rejected/approved mutation approvals, and deny-by-default grants. | Runtime, compaction, and policy test modules.[8] |

The sidecar design deliberately treats the JSON snapshot as the commit record. If sidecar append succeeds but snapshot replacement fails, the old snapshot continues to name the old prefix; recovery ignores the extra lines. On the next successful save, those unpublished lines are discarded before new state is calculated. This avoids the prior unsafe “latest of each file” merge without adding a hidden transactional database or accepting an inconsistent partial state.[3]

## 3. Inline-comment review

The fetched update contained several comments tied to one machine’s measured import or I/O timings. Those claims were not source-controlled benchmark artifacts and could become misleading as dependencies or hosts change. They have been removed or replaced with concise invariant-bearing comments: why a `TypeAdapter` is safely module-cached, why the telemetry connection requires serialized access, why the regex timeout includes isolated-worker startup, and why the lazy MCP export is present in `dir()` without constructing a runtime. Comments that explain a security, recovery, or portability invariant were retained.[9]

## 4. Validation record

From `packages/agent-sdk`, the complete quality command passed after the repairs: Python byte-compilation, Ruff format check, Ruff lint, and **185 pytest tests**. The focused TypeScript forwarding façade also compiled with `tsc -p tsconfig.json`. The package and MCP runtime patch identifiers were advanced from `0.16.0` to `0.16.1`, and a `0.16.1` source distribution and wheel were built successfully. The test suite is evidence that these implemented contracts hold for the controlled fixtures; it is not evidence of a real provider, Jev API, EDA binary, Windows runner, Redis server, Qdrant server, Sandbox/Desktop/SSH backend, or ASIC-flow execution.[3] [8]

## 5. Residual limitations and intentionally deferred work

The repair does **not** claim serializable multi-process transactions for every multi-file semantic store. The run/controller sidecars now have a durable prefix boundary, and audit append obtains an interprocess lock, but project-state event/state ordering remains a separate state-transaction design concern. The SDK also does not claim rollback detection for a locally deleted history tail; an external checkpoint or append-only remote witness is required if that threat model is adopted.[10]

The exact compactor remains exponential in the worst case for a general dependency DAG. The new policy cap prevents unbounded default branch expansion and explicitly exposes a non-optimal result. Consumers that require a proof must inspect `solver.status == "optimal"`; they must not infer optimality from a retained set alone. The capacity-indexed rooted-forest path is still exact subject to its separately configured token-budget guard.[5]

The audit’s larger refactoring opportunities—such as decomposing `create_mcp_server()` and a full stage-specific semantic Gate 1 analysis—were not bundled into this correctness repair. They need an approved interface plan because they can change public routing behavior and research-stage semantics. Ambiguity, inconsistency, and unstated-assumption gap types remain model-needed categories rather than fabricated deterministic checks, consistent with the documented Gate 1 boundary.[11]

## References

[1]: [Supplied audit attachment](/home/ubuntu/upload/pasted_content_7.txt), lines 1–57.

[2]: [Agent-Assisted Design Framework Systems Design](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf), p. 63, lines 13–26 and p. 64, lines 2–21; [`memory.py`](../packages/agent-sdk/src/agent_sdk/memory.py).

[3]: [`test_update_audit_regressions.py`](../packages/agent-sdk/tests/test_update_audit_regressions.py); [`contracts.py`](../packages/agent-sdk/src/agent_sdk/contracts.py); [`artifacts.py`](../packages/agent-sdk/src/agent_sdk/artifacts.py); [`coordination.py`](../packages/agent-sdk/src/agent_sdk/coordination.py); [`orchestration.py`](../packages/agent-sdk/src/agent_sdk/orchestration.py); [`audit_log.py`](../packages/agent-sdk/src/agent_sdk/audit_log.py).

[4]: [`atomic_io.py`](../packages/agent-sdk/src/agent_sdk/atomic_io.py); [`test_atomic_io.py`](../packages/agent-sdk/tests/test_atomic_io.py).

[5]: [`optimization.py`](../packages/agent-sdk/src/agent_sdk/optimization.py); [`memory.py`](../packages/agent-sdk/src/agent_sdk/memory.py); [`test_exact_pckp.py`](../packages/agent-sdk/tests/test_exact_pckp.py); [`test_pckp_oracle.py`](../packages/agent-sdk/tests/test_pckp_oracle.py); [`test_pask_compaction.py`](../packages/agent-sdk/tests/test_pask_compaction.py).

[6]: [`core_tools.py`](../packages/agent-sdk/src/agent_sdk/core_tools.py); [`test_core_tools.py`](../packages/agent-sdk/tests/test_core_tools.py).

[7]: [`integrations/_utils.py`](../packages/agent-sdk/src/agent_sdk/integrations/_utils.py); [`test_framework_interop.py`](../packages/agent-sdk/tests/integrations/test_framework_interop.py).

[8]: [`test_base_agent.py`](../packages/agent-sdk/tests/test_base_agent.py); [`test_pask_compaction.py`](../packages/agent-sdk/tests/test_pask_compaction.py); [`test_policy.py`](../packages/agent-sdk/tests/test_policy.py).

[9]: [`base_agent.py`](../packages/agent-sdk/src/agent_sdk/base_agent.py); [`telemetry.py`](../packages/agent-sdk/src/agent_sdk/telemetry.py); [`core_tools.py`](../packages/agent-sdk/src/agent_sdk/core_tools.py); [`mcp_server.py`](../packages/agent-sdk/src/agent_sdk/mcp_server.py).

[10]: [`project_state.py`](../packages/agent-sdk/src/agent_sdk/project_state.py); [`p0-trust-guarantee-repair.md`](p0-trust-guarantee-repair.md).

[11]: [`specification_gate.py`](../packages/agent-sdk/src/agent_sdk/specification_gate.py), lines 23–29 and 121–223; [developer handbook](agent-sdk-developer-handbook.md#16-current-integration-limits).
