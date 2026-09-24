# Agent SDK Skill, Documentation, and Usability Plan

**Status:** Approved and revised for implementation on 23 September 2026.
**Purpose:** Turn the implementation workflow used for the Agent-Assisted Design SDK into a reusable skill, provide an external-developer guide, replace fixed-priority compaction with deterministic provenance-aware selection, and reduce SDK setup burden without weakening deterministic authority boundaries.

## Source-grounded starting point

The SDK already separates model behavior from deterministic harness authority. `BaseAgent` validates data-only definitions, constructs a scoped prompt, compacts typed episode memory before model calls, projects a bounded `ProjectStateView`, validates untrusted turns, schedules declared tool batches, and records durable outcome evidence. The framework requires a common BaseAgent contract, tool/hook control, typed state-graph coordination, and structural checkpoints rather than an unbounded transcript.[1] [2] [3]

The original code used **deterministic greedy fixed-priority eviction** rather than a mathematical graph-minimization optimization. The revised algorithm changes this. It will retain the fixed-priority policy as a controlled `greedy-baseline` comparator and make `PASK`—Provenance-Aware Submodular Knapsack—the default deterministic selector. PASK uses a bounded task-scoped relevance signal, dependency centrality, provenance class, explicit access recency/frequency, and marginal lexical coverage. It selects candidates by deterministic utility-to-marginal-token-cost order, adds each candidate's full dependency closure, and tombstones the remaining closed records in reverse dependency order. It preserves the existing hard safety rules: open, active, protected, manifest-incomplete, and closure-required evidence is never silently evicted; an over-budget mandatory closure returns a typed dossier and blocks/escalates.[2] [8]

The normal BaseAgent model call deliberately receives empty observation and episode arrays. It receives immutable task prompt data, a bounded current `ProjectStateView`, context-projection metadata, and an opaque provider continuation. The `ProjectStateProjector` retains mandatory state plus newest artifact/work-item entries that fit a separate budget. If mandatory state exceeds that budget, the agent blocks rather than silently dropping it.[4] Therefore the current runtime does not apply a global cost/benefit optimization or graph partitioning algorithm. The documentation must state this explicitly and define the existing complexity: compaction makes repeated full token-size estimation and deterministic candidate scans; the state graph uses deterministic topological readiness waves and acyclicity checks.[2] [4] [5]

Vertical coordination is the controller path. `ControllerRuntime` creates a controller from an immutable shared snapshot and selected profile, accepts a validated plan, waits for explicit approval, starts a graph run, records node results into project state, requests bounded repair through the controller state machine, and escalates unresolved failure.[5] Lateral coordination is not agent-to-agent dialogue. A completed producer publishes a closed exploratory discovery with snapshot version and provenance. A consumer creates a lateral dependency request, and the runtime adds a conditional producer-to-consumer edge only before the consumer begins. A fan-in uses a deterministic provenance contract gate.[5] [6]

## Proposed deliverables

| Deliverable | Content | Validation |
|---|---|---|
| `agent-sdk-engineering` repository-owned skill | Compact workflow for inspecting evidence, modifying the Python SDK/TypeScript MCP boundary, preserving policy/state/audit separation, PASK/greedy-baseline experiments, writing tests, and documenting limitations. The initialized skill is moved into this repository under `skills/`. | Initialize using the mandatory skill-creator script; validate with `quick_validate.py`. |
| Skill references | One reference for SDK architecture and extension boundaries; one for source-grounded validation/checklist. | Review paths and ensure every reference is linked directly from `SKILL.md`. |
| External developer guide | Installation, minimum agent, durable observed agent, custom model adapter, custom tools, core tools, gates, telemetry/audit, controller coordination, MCP integration, test recipe, and limits. | Runnable examples and package build. |
| Context and coordination explainer | Precise account of PASK, the retained greedy baseline, result journals, project-state projection, state graph scheduling, vertical control, lateral discoveries, provenance fan-in, complexity, experiment metrics, and non-goals. | Unit test references and source citations. |
| Ergonomic runtime helper | A public runtime-services/factory API that creates durable result journal, project-state store, telemetry ledger, audit log, and profiler from one run root; keeps the model, policy, plan task, and tool executor explicitly host-owned. | New unit tests, runnable example, public export, and package build. |
| Extension templates | Short runnable examples for a model adapter, custom verification gate, custom tool executor, and governed harness context. | Examples compile/run without selected real model or EDA tool. |

## API proposal: `AgentRuntimeServices`

The proposed helper is intentionally a **composition root**, not an authority bypass. It will accept one `run_root`, construct durable SDK-owned services, and expose:

```python
services = AgentRuntimeServices.open(run_root)
agent = services.create_agent(definition, model, tool_executor=host_executor)
result = await agent.run(task)
```

It will create `FileToolResultJournal`, `FileProjectStateStore`, `TelemetryStore`, `AuditTranscriptStore`, and a fresh `AgentRunProfiler`. It will not create an LLM adapter, declare capabilities, auto-approve actions, create a `PlanTask`, or select SSH/Desktop/Sandbox backends. A host still explicitly supplies its model and tool executor. This reduces boilerplate without violating the tool authority boundary.[1] [7]

## Implementation sequence

1. Initialize the new skill using `/home/ubuntu/skills/skill-creator/scripts/init_skill.py` and replace the generated placeholders with a concise workflow plus two direct reference files.
2. Implement `AgentRuntimeServices` and a minimal durable-runtime example. Add tests that prove the expected durable paths and an audit/telemetry/project-state result are created.
3. Implement PASK with its auditable score dossier, dependency-closure guarantee, greedy-baseline comparison mode, explicit runtime injection point, metrics, and unit tests before documenting it. Use the attached proposal only as the requested design change and distinguish it from independently verified research sources.
4. Write the developer guide and the context/coordination explainer. Use citations to the project design PDF, the state-based-memory proposal, current source implementation, and verified PASK-related literature. Clearly distinguish implemented behavior from future optimization alternatives.
5. Update the package README with a short navigation entry rather than duplicate the detailed guide.
6. Run `ruff`, `pytest`, examples, package build, TypeScript focused compilation where touched, skill validation, and repository whitespace checks.

## Decisions already fixed by current architecture

The new helper will not expose a generic shell, a mutable shared worker transcript, automatic approval, arbitrary Python callbacks from MCP, or automatic cross-session episode memory. These constraints follow the current system’s closed-capability, typed coordination, and human-approval boundaries.[1] [5] [6]

## PASK scope and limitations

PASK is a deterministic **greedy approximation**, not an exact solver for dependency-constrained 0/1 knapsack and not a learned RL policy. It makes no general approximation-ratio claim because dependency closure and marginal coverage change item costs and values. Its default relevance scorer is lexical, not embedding-based; a host may inject a reproducible local scorer through the SDK extension point. The implementation records a score dossier and metrics, retains the greedy baseline, and is intended to support measured comparison on downstream task success, critical-evidence retention, provenance completeness, and token cost. A future exact dynamic-programming solver or trained policy is separate research work.[8] [9] [10]

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 50–51 and 54–55, BaseAgent contract and tool/watchdog boundary"

[2]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/memory.py "Episode memory compaction implementation, lines 186–360"

[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 64, structured compaction and context-deadlock procedure"

[4]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py "Bounded ProjectState projection implementation, lines 182–260"

[5]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/controller_runtime.py "Vertical controller and graph-run orchestration implementation, lines 43–315"

[6]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/shared_state.py "Lateral shared substrate and provenance contract implementation, lines 26–272"

[7]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/tool_registry.py "Capability-governed harness tool execution, lines 25–266"

[8]: /home/ubuntu/upload/pasted_content_2.txt "User-approved PASK design proposal, lines 19–70"

[9]: https://doi.org/10.1145/3829441.3829513 "Dependency-Aware Chain-of-Thought Compression for Financial Reasoning; dependency-constrained budget selection solved by dynamic programming, not greedy selection"

[10]: https://aclanthology.org/2026.findings-acl.956/ "Memory as Action: Autonomous Context Curation for Long-Horizon Agentic Tasks; learnable deletion/insertion policy, cited only as a distinct future alternative"
