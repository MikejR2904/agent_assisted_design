# Agent SDK Developer Guide

**Status:** Concise integration guide for package `0.12.0`. Read the [developer handbook](agent-sdk-developer-handbook.md) for the complete provider, tool, coordination, observability, developer-command, and contribution workflow; see the [P0–P2 implementation record](p0-p2-algorithm-implementation.md) for exact retention and graph algorithms.
**Audience:** Developers embedding the Agent-Assisted Design SDK in a Python host application or extending its governed harness.

## Purpose and installation

`agent-design-agent-sdk` is a Python library for bounded, auditable agent execution. It is not an autonomous EDA flow and does not select a model provider, a remote execution target, a tool capability, or a human approval on behalf of a host application. The framework design requires the BaseAgent to bind identity, instructions, schemas, narrow tools, model binding, memory scope, termination, and optional deterministic validation; the SDK implements that contract as strict serializable models plus injected runtime dependencies.[1]

Install from a checkout or Git source.

```bash
uv pip install ./packages/agent-sdk
# or
uv pip install "git+https://github.com/MikejR2904/agent_assisted_design.git#subdirectory=packages/agent-sdk"
```

The package requires Python 3.12 or later. `ScriptedModel` is a reproducible test adapter, not a provider adapter. A production host must implement `AgentModel.next_turn(context)` for its chosen provider and should return `ModelTurnResponse` only when it can report provider data accurately.

## Fastest durable setup

`AgentRuntimeServices` is the recommended composition root. It creates durable SDK-owned tool-result, project-state, telemetry, and audit stores below one host-selected `run_root`; it does **not** choose a model or tool executor.

```python
from pathlib import Path

from agent_sdk import (
    AgentDefinition,
    AgentRuntimeServices,
    ModelBinding,
    ScopedAgentTask,
    ScriptedModel,
    TaskScope,
    TerminationPolicy,
    VersionedInstructions,
)

services = AgentRuntimeServices.open(Path(".agent-runs/demo"))
definition = AgentDefinition(
    identity="Return a validated structured status.",
    instructions=VersionedInstructions(version="1", text="Complete one bounded task."),
    input_schema={"type": "object", "additionalProperties": False},
    output_schema={
        "type": "object",
        "properties": {"status": {"const": "complete"}},
        "required": ["status"],
        "additionalProperties": False,
    },
    model_binding=ModelBinding(provider="host-selected", model="host-selected"),
    termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
)
task = ScopedAgentTask(
    id="demo-task",
    input={},
    scope=TaskScope(label="demo"),
    locked_interface={},
    instructions="Return complete.",
    acceptance_criteria=["The output status is complete."],
)
agent = services.create_agent(
    definition,
    ScriptedModel([{"type": "final", "output": {"status": "complete"}}]),
)
result = await agent.run(task)
```

The run root contains `.agent-tool-results/`, `.agent-project-state/`, `.agent-telemetry/`, and `.agent-audit-logs/`. These are durable evidence and review stores, not a transcript replayed to the next model turn.

## Model adapters and context

Implement `AgentModel` in the embedding application. `ModelContext` contains the immutable scoped task/prompt, iteration, bounded `ProjectStateView`, optional opaque `ProviderContinuation`, and projection metadata. In the normal state-first loop, `observations` and `episodes` are empty; the model must not depend on raw history replay. The host can report provider token counts and context-window capacity through `ProviderUsage`, but the SDK never estimates provider usage or stores provider hidden reasoning.[2]

Provider continuation is intentionally opaque. A provider adapter may preserve its own session or response state in `ProviderContinuation`; BaseAgent forwards it without parsing, constructing, or exposing provider-specific material. Register model fallbacks through `FailoverAgentModel` only in the definition-declared order.

## Tool models and governed execution

An `AgentDefinition` declares each `ToolDefinition`, including JSON Schema, episode kind, and serial or parallel-safe concurrency. A model can emit `tool-call` or an acyclic `tool-batch`. The SDK validates every tool name, arguments, batch dependency, hook, watchdog outcome, and result before state reduction.[1]

For ordinary unit tests, provide any `ToolExecutor`. For governed harness use, build a `HarnessExecutionContext` with a `PlanTask`, `ArtifactStore`, `CapabilityPolicy`, `ApprovalRegistry`, `ProcessSupervisor`, and run root, then inject `HarnessToolExecutor`. The standard registry exposes source/artifact reads, bounded result-handle retrieval, `glob`, `grep`, run-root-contained draft edits, web fetch/search, human questions, brief/sleep, named registered commands, and declared EDA command templates. It does not expose generic shell execution, arbitrary local network calls, or dynamically discovered tools.[3]

### Add a custom governed tool

Use an explicit capability and registered name. The registry evaluates policy and approval **before** invoking the handler. Keep handler configuration in the embedding process and validate its arguments in the declared `ToolDefinition`.

```python
from agent_sdk import (
    HarnessToolRegistry, RegisteredTool, SideEffectClass,
)

async def inspect_manifest(context, arguments):
    component = arguments["component"]
    return {"component": component, "run_id": context.run_id, "status": "inspected"}

registry = HarnessToolRegistry.with_extensions(
    [RegisteredTool("inspect_manifest", "manifest.inspect", SideEffectClass.READ_ONLY)],
    handlers={"inspect_manifest": inspect_manifest},
)
```

For a mutating or process extension, choose `SideEffectClass.MUTATING` or `PROCESS`; the host must grant the matching capability and submit a matching typed approval. An extension handler does not bypass policy merely because it is Python code.[3]

## Verification gates and hooks

Verification is host-owned. Register a named local callback in `VerificationGateRegistry`, then reference only its stable identifier from `AgentDefinition.verification_gate_id`. The callback receives `VerificationContext` plus fixed host-supplied arguments. It may return `VerificationDecision`, `bool`, or `(bool, reason)` and may be sync or async. BaseAgent runs it only after output JSON-schema validation and can bound it with `AgentWatchdogPolicy(verification_timeout_seconds=...)`.

```python
async def require_lint(context, required: str):
    checks = context.output.get("checks", [])
    return required in checks, None if required in checks else "Missing lint evidence."

gates.register_callable("require-lint", require_lint, "lint")
```

Never serialize a Python callback into an MCP payload or let a model select arbitrary callbacks. Use `pre_tool_hooks` and `post_tool_hooks` for local lifecycle policy only; both are bounded by the tool watchdog.

## Exact PCKP and PASK context compaction

`EXACT_PCKP` is the default deterministic compaction selector. It solves an additive, static-utility, dependency-closed PCKP instance with exact branch-and-bound and a rational upper-bound certificate; verified rooted forests use a capacity-indexed dynamic-programming fast path. PASK remains available as an opt-in diversity heuristic, while `GREEDY_BASELINE` supports controlled comparisons. The default exact objective deliberately excludes PASK’s dynamic marginal-diversity term and makes no downstream-design-performance claim without a broader benchmark corpus.[4]

```python
from agent_sdk import (
    CompactionStrategy, InMemoryEpisodeStore, PaskCompactionPolicy,
)

pask_store = lambda: InMemoryEpisodeStore(
    compaction_policy=PaskCompactionPolicy(
        strategy=CompactionStrategy.PASK,
        task_relevance_weight=0.40,
        dependency_centrality_weight=0.20,
    )
)
agent = services.create_agent(definition, model, episode_store_factory=pask_store)
```

The default `LexicalEpisodeRelevanceScorer` requires no model. An embedding-based scorer may be injected through `EpisodeRelevanceScorer`, but only when the embedding assets, version, input normalization, and scorer behavior are local and reproducible. PASK preserves open/protected/manifest-incomplete episodes and dependencies. If mandatory closure cannot fit, it returns a typed over-budget/deadlock result rather than silently losing it. The dossier records a query digest, not raw task text.

Compare exact PCKP, PASK, and `GREEDY_BASELINE` using the same episode graphs and budget. Measure token cost, mandatory evidence retention, provenance completeness, deadlock count, solver status/certificate, branch-node count, downstream task success, and selector execution time. The frozen PCKP runner provides a reproducible engineering baseline; do not claim downstream benefit until a broader real-task evaluation populates it.[4]

## State, coordination, and skills

`ProjectState` is the normal bounded working memory. It contains declared stage fields, artifact and work-item state, human decisions, questions, blockers, bounded evidence references, and hash-linked state transitions. It excludes raw transcripts, raw result payloads, and model hidden reasoning. A model cannot write a human decision: `StateAuthority.HUMAN` is required.[5]

The controller owns vertical coordination: source snapshot/profile binding, plan validation, explicit approval, graph dispatch, bounded repair, and escalation. Lateral coordination uses graph-owned `GraphSharedState`, persisted together with nodes, edges, statuses, and typed results in `RunRecord.graph`; the runtime no longer writes a second discovery substrate. A producer publishes a closed discovery/value into that state, a consumer creates a request, and the graph adds a conditional dependency only before that consumer starts. `GraphNodeExecutionContext` exposes declared predecessor results plus read-only graph state, not a shared conversation or arbitrary sibling outputs. Fan-in uses `ProvenanceContractGate` to require compatible snapshot/schema provenance.[6]

A `SkillContext` belongs to a task and should be versioned, scoped, concise, and source linked. Do not use a skill as a hidden bypass for capabilities or model memory. The repository-owned engineering process is available under `skills/agent-sdk-engineering/`.

## Telemetry, profiles, and audit logs

`TelemetryStore` is an append-only SQLite ledger with a per-run integrity chain and explicit metric availability. It records attempts, loopbacks, tool/verification failures, escalations, watchdog outcomes, SDK context estimates, provider-reported tokens when supplied, exact-PCKP or PASK compaction values, and profile durations. It marks unavailable data unavailable rather than replacing it with zero.[7]

`AuditTranscriptStore` writes redacted hash-linked JSONL and a review-only Markdown rendering. It can record task instructions, provider-visible structured model turns, tool call/results or journal handles, verification, escalation, and terminal events. It rejects hidden-reasoning fields and is never replayed into a model context. `AgentRunProfiler` records bounded timing spans without prompt/tool payloads or hidden reasoning.[7]

## Validation and limitations

Run `uv run agent-sdk-dev quality .`, `uv run pytest`, and `uv build` from `packages/agent-sdk`. The read-only developer CLI also generates the public API catalogue, validates JSON/YAML contracts, and verifies stored run evidence. For an MCP change, compile the focused TypeScript harness and run the live Python-to-TypeScript integration test. The current package has no selected real LLM provider, SSH/Desktop/Sandbox backend, EDA binary, persistent multi-process lock, or externally authenticated human identity; those are deliberate future integrations, not implicit SDK capabilities.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Updated systems-design document, pp. 50–55"

[2]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 23–113 and 137–148"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/model.py`

[3]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/tool_registry.py "Closed registry, policy path, and extension API"; /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "pp. 54–55"

[4]: /home/ubuntu/upload/pasted_content_2.txt "User-approved PASK proposal, lines 19–70"; https://doi.org/10.1145/3829441.3829513 "Dependency-aware budget selection solved by dynamic programming, not a greedy claim"

[5]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/project_state.py "Typed authority and state reducer"

[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "pp. 58–60 and 63"; /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/graph.py; /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/coordination.py

[7]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Proposal pp. 30–35"; `/home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/telemetry.py`
