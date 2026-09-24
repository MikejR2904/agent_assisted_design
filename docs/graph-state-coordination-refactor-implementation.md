# Graph-State Lateral Coordination Refactor

**Status:** Implemented in `agent-design-agent-sdk` **0.10.0**.
**Scope:** This increment corrects the lateral-coordination ownership model and documents the SDK’s actual algorithmic approaches. It does not claim that a production multi-agent `BaseAgent` executor or a semantic evidence-packing selector exists yet.

## Decision and source basis

The framework defines collaboration through a shared state object propagated through graph edges; it explicitly distinguishes typed node state from a shared conversation.[1] The previous SDK increment instead persisted an auxiliary `RunSharedState` alongside the graph. That representation was structurally close to the intended design but left two run-state authorities. The current implementation makes `StateGraph` the sole authority for lateral state.

> **Decision:** A `RunRecord.graph` snapshot now includes the graph topology, node statuses, typed terminal results, events, immutable source substrate, closed discoveries, immutable shared values, and lateral dependency requests. No controller-managed second discovery-state file participates in normal coordination.

## Implemented changes

| Concern | Implementation | Evidence |
|---|---|---|
| Single lateral-state authority | Added `GraphSharedState` to `StateGraph` and serialized it in `snapshot()`/`from_snapshot()`. | `graph.py`; graph snapshot round-trip test.[2] |
| Upward/downward controller | `ControllerRuntime.dispatch()` constructs a graph with the controller’s immutable source snapshot; publication, shared values, and lateral requests route through `HarnessCoordinator`. | `controller_runtime.py`, `coordination.py`.[2] |
| Lateral handoff | A closed, completed-producer discovery is stored in `GraphSharedState`; a consumer request atomically adds a conditional edge and request record. | `StateGraph.request_lateral_dependency()`.[2] |
| Worker visibility | `GraphNodeExecutionContext` exposes only deep-copied declared predecessor results and an isolated graph-state copy to an executor. | `StateGraph.execute()`; isolation test.[2] |
| Persistence/recovery | `RunRecord` hashes one graph snapshot and `HarnessCoordinator.get_run_state()` rehydrates that graph. | `coordination.py`.[2] |
| Compatibility | `RunSharedState` and `SharedStateStore` remain exported legacy types but are no longer constructed by the controller/coordinator runtime. | `shared_state.py` compatibility note.[2] |
| Documentation | Updated SDK README, developer guide, repository skill, and compaction guide; added the algorithm catalogue. | Linked documentation below. |

## Execution semantics

A producer result does not become ambient worker conversation. A node becomes runnable only after all static and conditional predecessors complete. When the scheduler begins a runnable wave, it freezes and deep-copies graph state for every executor in that wave. It passes only that node’s declared dependency results and the copied state. Terminal results are committed in sorted node-ID order. A non-completed prerequisite blocks its dependents.[2]

The conditional discovery edge is intentionally added only after the producer has completed and before the consumer starts. Therefore, the producer’s completion proves there cannot be a new cycle through a still-pending consumer. The graph’s normal validation still checks all initial static/conditional dependencies for cycles.[2]

## Validation

| Validation | Command/result |
|---|---|
| Python format and lint | Ruff format check and Ruff check passed. |
| Python behavior | `uv run pytest` passed: **74 tests**. |
| Packaging | `uv build` produced `agent_design_agent_sdk-0.10.0.tar.gz` and `agent_design_agent_sdk-0.10.0-py3-none-any.whl`. |
| Repository skill | `quick_validate.py` reported `Skill is valid!`. |
| TypeScript boundary | Focused `tsc -p tsconfig.json` passed. |
| Diff integrity | `git diff --check` passed. |

## Honest remaining work

The generic graph scheduler is now equipped to deliver graph state to a node executor, but the runtime does **not** yet instantiate `BaseAgent` per graph node. Controller tests record typed node results externally. The next implementation must bind agent definitions, task scopes, model adapters, tool policies, project-state IDs, telemetry correlation, and verification gates to a production `GraphNode` executor; then it must prove restart/replay and dependency-only visibility with a real agent adapter. The algorithm catalogue specifies this as a P0 task rather than treating this refactor as a completed autonomous multi-agent execution engine.[3]

## References

[1]: [Updated systems-design framework, extracted p. 60](/home/ubuntu/work/baseagent-planning/pages/page-060.txt), lines 2–19.

[2]: [`graph.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/graph.py); [`coordination.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/coordination.py); [`controller_runtime.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/controller_runtime.py); [`test_graph.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/tests/test_graph.py); [`test_controller_runtime.py`](/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/tests/test_controller_runtime.py).

[3]: [Algorithmic approaches catalogue](./algorithmic-approaches-catalogue.md), sections 1, 3.5, and 4.
