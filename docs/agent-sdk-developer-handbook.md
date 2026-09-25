# Agent SDK Developer Handbook

**Status:** Package `agent-design-agent-sdk` 0.15.0.
**Audience:** Engineers embedding the SDK in a Python application, extending its governed tools, implementing provider adapters, or maintaining the Python/MCP runtime.

## 1. What the SDK is responsible for

The Agent SDK separates **model proposal** from **harness authority**. A model adapter may return a typed final answer or a typed tool request. The deterministic runtime validates the request, authorizes a declared capability, executes the chosen tool through a supplied executor, records evidence, updates bounded project state, applies verification, and terminates, repairs, or escalates according to declared policy. This reflects the framework’s common BaseAgent boundary: identity, instructions, schemas, narrow tools, model binding, memory, termination policy, and an optional deterministic verification gate are explicit contract elements.[1]

The SDK is intentionally not an autonomous RTL-to-GDSII flow. It does not select a provider, create an SSH/Desktop/Sandbox target, infer a capability grant, approve a state-changing action, run an arbitrary shell command, or convert an LLM statement into a verified engineering fact. Those authority decisions remain in the embedding host.[1] [2]

| Concern | SDK owns | Embedding host owns |
|---|---|---|
| Agent loop | Typed turns, schema validation, batch dependency scheduling, context budgets, termination, watchdog integration | Provider client and its credentials |
| Tool execution | Tool schemas, capability/approval boundary, artifact/result evidence adapters | Which tools and capabilities are granted for a task |
| Verification | Gate registry and bounded invocation | The trusted callback implementation and fixed local arguments |
| Working memory | Bounded project-state view, episode evidence, result handles, compaction policy | Stage schema, source snapshot, and human decisions |
| Coordination | Graph state, declared dependencies, routing, provenance, repair/escalation state machine | Plan content, approval decision, graph-agent bindings |
| Observability | Hash-linked telemetry, metrics, redacted audit transcript, profiles | Retention policy, access control, model/provider measurements |

## 2. Installation and repository layout

Install a local checkout or the package subdirectory from Git. The package requires Python 3.12 or later. Use the development dependency group when running lint, test, build, or the source-quality developer command.

```bash
# Consumer installation
uv pip install ./packages/agent-sdk

# SDK maintenance
cd packages/agent-sdk
uv sync --all-groups
```

The implementation is modular. `base_agent.py` contains the bounded task loop. `contracts.py` contains strict serializable public contracts. `model.py`, `tools.py`, `verification.py`, and `runtime.py` provide the principal host injection points. `policy.py`, `tool_registry.py`, `supervisor.py`, and `approvals.py` implement the governed tool boundary. `project_state.py`, `memory.py`, `context_projection.py`, and `optimization.py` implement bounded working-state and evidence retention. `graph.py`, `graph_agent_executor.py`, `coordination.py`, and `controller_runtime.py` implement coordination. `telemetry.py`, `audit_log.py`, `metrics.py`, and `profiler.py` provide observability.[1] [2]

## 3. Start with durable runtime services

`AgentRuntimeServices` is the recommended composition root. It makes persistence wiring repeatable without making authority decisions. It creates the tool-result journal, project-state store, telemetry database, and audit transcript store below the selected run root. It does not construct a provider adapter or capability-granting executor.

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
    identity="Return one validated status.",
    instructions=VersionedInstructions(version="demo-v1", text="Complete the bounded task."),
    input_schema={"type": "object", "additionalProperties": False},
    output_schema={
        "type": "object",
        "properties": {"status": {"const": "complete"}},
        "required": ["status"],
        "additionalProperties": False,
    },
    model_binding=ModelBinding(provider="host", model="selected-model"),
    termination_policy=TerminationPolicy(max_iterations=1, status_field="status"),
)
task = ScopedAgentTask(
    id="demo-task",
    input={},
    scope=TaskScope(label="demo"),
    locked_interface={},
    instructions="Return a complete status.",
    acceptance_criteria=["The output status equals complete."],
)

agent = services.create_agent(
    definition,
    ScriptedModel([{"type": "final", "output": {"status": "complete"}}]),
)
result = await agent.run(task)
```

`ScriptedModel` is only a deterministic test adapter. A production host must supply an `AgentModel` implementation.

## 4. Implement a provider adapter carefully

An `AgentModel` exposes one asynchronous method: `next_turn(context)`. It may return an `AgentTurn` or a `ModelTurnResponse`. The latter additionally carries provider-reported usage and an opaque continuation. The BaseAgent treats both the turn and provider metadata as untrusted inputs: it validates the turn before acting, stores provider usage only when supplied, and forwards continuation without inspecting provider-specific state.

```python
from agent_sdk import FinalTurn, ModelTurnResponse, ProviderUsage

class HostProviderAdapter:
    async def next_turn(self, context):
        provider_response = await call_selected_provider(context)
        return ModelTurnResponse(
            turn=FinalTurn(output=provider_response.structured_output),
            usage=ProviderUsage(
                input_tokens=provider_response.input_tokens,
                output_tokens=provider_response.output_tokens,
                context_window_tokens=provider_response.context_window_tokens,
                request_id=provider_response.request_id,
            ),
        )
```

The adapter must return the SDK’s typed turn structure, not free-form text. If the provider cannot accurately report a usage field, omit it. The SDK records that metric as unavailable rather than estimating it. Never place hidden chain-of-thought, credentials, or raw provider session secrets in `ProviderUsage`, a tool result, or an audit payload.[3]

## 5. Declare tools before a model may request them

Every allowed tool is listed in `AgentDefinition.tools` as a `ToolDefinition`. The declaration includes a JSON Schema, an episode kind, and a concurrency policy. A model can emit a single `tool-call` or a dependency-acyclic `tool-batch`. The scheduler runs only ready `parallel-safe` calls concurrently, serializes `serial` calls, and prevents a dependent call until all prerequisite calls succeed.[4]

For controlled tests, any implementation of `ToolExecutor` is sufficient. For governed execution, use `HarnessToolExecutor` with a `HarnessExecutionContext`. It evaluates capability policy and approvals before invoking `HarnessToolRegistry` and the underlying handler. Standard core tools are opt-in declarations; their dispatcher constrains file paths to a run root, marks web text as untrusted, and accepts a named registered command rather than a raw shell command.[2] [4]

### Add a custom governed tool

A custom tool has four pieces: an explicit tool declaration, a registered name, a capability name, and a handler. The handler receives only the harness execution context and validated argument object. Keep configuration and credentials in the host process. A model must never choose an arbitrary Python callback.

```python
from agent_sdk import HarnessToolRegistry, RegisteredTool, SideEffectClass

async def inspect_manifest(context, arguments):
    component = arguments["component"]
    return {"component": component, "run_id": context.run_id, "status": "inspected"}

registry = HarnessToolRegistry.with_extensions(
    [RegisteredTool("inspect_manifest", "manifest.inspect", SideEffectClass.READ_ONLY)],
    handlers={"inspect_manifest": inspect_manifest},
)
```

Use `SideEffectClass.MUTATING` or `SideEffectClass.PROCESS` for state-changing or process-backed tools. The host must then supply the matching capability grant and approval record. This extension path is an authorization boundary, not merely a convenience wrapper.[2] [4]

## 6. Add a host-owned verification gate

A verification gate is referenced by a stable string in `AgentDefinition.verification_gate_id`, but the executable callback remains host-local. Register it with `VerificationGateRegistry.register_callable()`. The callback’s first input is `VerificationContext`; subsequent positional and keyword arguments are fixed by the host at registration time. It may be synchronous or asynchronous and may return `VerificationDecision`, `bool`, or `(bool, reason)`.

```python
from agent_sdk import VerificationGateRegistry

async def require_lint(context, required_check):
    checks = context.output.get("checks", [])
    return required_check in checks, None if required_check in checks else "Missing lint evidence."

gates = VerificationGateRegistry()
gates.register_callable("require-lint", require_lint, "lint")
```

The runtime validates output JSON Schema before invoking the gate and can bound gate execution through `AgentWatchdogPolicy`. Do not serialize callbacks through MCP or permit models to select callback names dynamically.[1] [4]

## 7. Understand state-first memory and compaction

The normal model context is a bounded `ProjectStateView`, not a replay of the full conversation. It carries declared stage fields, decisions, questions, blockers, bounded artifact/work-item state, and evidence references. Tool payloads remain in result journals; audit transcripts remain review evidence; neither becomes ordinary next-turn prompt content. This prevents context growth from being proportional to the number or size of past tool results.[3]

`EXACT_PCKP` is the default episode-retention policy. It selects a dependency-closed set of static-utility episodes under a token budget. The general-DAG case uses deterministic branch-and-bound with rational upper bounds, but its policy-owned `exact_max_branch_nodes` cap (default 50,000) prevents unbounded runtime growth. A cap returns a feasible `BEST_EFFORT` certificate, not an optimality claim. A verified rooted forest can use capacity-indexed dynamic programming and remains exact. The solver dossier records selected IDs, closure, problem hash, search status, branch count, bound, and certificate. PASK remains an opt-in diversity heuristic, while `GREEDY_BASELINE` provides a deliberately weaker comparison mode. The safety rule is invariant across policies: open, active, protected, manifest-incomplete, or required dependency evidence is never silently discarded.[5] [6]

The source-backed `StructuralContextSelector` serves a different purpose. It computes mandatory relation closure in an immutable `EvidenceGraph`, rejects an over-budget mandatory closure explicitly, then packs optional evidence into the residual budget. Use it when selecting specification material for a task; use episode compaction for retaining task execution evidence.[5]

## 8. Coordinate workers through graph state

Vertical coordination is the controller lifecycle: bind source snapshot and profile, validate a plan, request explicit plan approval, dispatch a graph, record stage failures, enter bounded repair, and escalate unresolved failures. Lateral coordination is not chat. `StateGraph` persists nodes, edges, results, discoveries, immutable shared values, exact-reference routing postings, route decisions, and conflicts in one durable snapshot.[7]

A graph-bound agent is created through `GraphAgentExecutor` and a host-owned `GraphAgentBinding`. Each execution receives `GraphNodeExecutionContext`, which contains only declared predecessor results and a read-only, node-filtered graph state. Discoveries publish source spans, snapshot version, provenance hash, and exact affected references. The graph routes them by conjunctive exact-reference intersection. A not-yet-started matching consumer gets a conditional edge; a running or terminal consumer receives a persisted late-discovery conflict instead.[7]

Use `StageCompletenessGate` for finite readiness conditions such as required work items, artifacts, unanswered questions, and blockers. A failed gate enters the controller’s existing bounded repair/escalation lifecycle. It is not a free-text semantic-completeness oracle.[7]

## 9. Inspect observability without re-executing work

Telemetry is an append-only SQLite ledger with per-run event hash chains. Audit logs are bounded, redacted JSONL chains rendered as Markdown only for human review. Profiles measure SDK timing spans while excluding prompt payloads, tool payloads, and hidden reasoning. The metric catalogue distinguishes available provider-reported measurements from unavailable values; it does not replace missing measurements with zero.[8]

The `agent-sdk-dev` CLI is intentionally read-only. It contains four modular commands:

```bash
# Generate an inventory from agent_sdk.__all__.
agent-sdk-dev catalog --output api-catalog.json

# Validate a local data contract without running a model, tool, or callback.
agent-sdk-dev validate agent-definition definition.yaml
agent-sdk-dev validate plan plan.json

# Verify telemetry and audit integrity for an existing durable run.
agent-sdk-dev inspect-run .agent-runs/demo demo-task

# Run configured unused-import, lint, and formatting checks in an SDK checkout.
agent-sdk-dev quality ./packages/agent-sdk
```

The same functions are importable from `agent_sdk.developer_tools`. `build_public_api_catalog()` inventories explicit supported exports. `validate_contract_file()` returns structured schema errors. `inspect_run()` reads and verifies evidence without creating a report file. `check_source_quality()` launches only a closed Ruff command over `src`, `tests`, `examples`, and `scripts`; it does not accept arbitrary process arguments.

## 10. Maintain a modular codebase

Place a new responsibility in the narrowest module that owns its invariant. Do not add provider code to `base_agent.py`, policy decisions to a model adapter, tool handlers to an MCP route, graph state to a second shared store, or opaque output to `ProjectState`. Depend on protocol and registry injection points rather than importing concrete host services. Keep public data contracts strict and serializable; keep executable callbacks local to the host process.[1] [2]

Every change should include focused tests for success, rejection or authority boundary, a bounded or over-budget case, and persistence/audit behavior where relevant. A deterministic research algorithm must retain a baseline comparator and must not claim downstream benefit without a frozen evaluation corpus and recorded outcomes.[5] [8]

The [update-audit remediation record](update-audit-1e5c61e-remediation.md) is the current example of this standard. It records the evidence for recovery-safe sidecar boundaries, interprocess audit serialization, portable atomic publication, and bounded exact-search fallback; it also identifies constraints that remain outside the repair’s scope.

## 11. Required maintenance workflow

Run the following from `packages/agent-sdk` before submitting SDK changes.

```bash
uv sync --all-groups
uv run agent-sdk-dev quality .
uv run pytest
uv build --out-dir /tmp/agent-sdk-build
```

If Python MCP contracts changed, compile and run the focused TypeScript integration boundary. If the repository engineering skill changed, validate it with `quick_validate.py`. Finally run `git diff --check`. The repository-owned engineering skill, `skills/agent-sdk-engineering/SKILL.md`, makes these constraints explicit for future SDK work.

## 12. Use optional framework interoperability

Install `agent-design-agent-sdk[langgraph]`, `[langchain]`, `[jev]`, or `[interop]`
only when the embedding host has selected that integration. `agent_sdk.integrations`
uses dependency-free contracts and lazy framework imports, so the base SDK does not
require any of these packages.

LangGraph may orchestrate an SDK node through `LangGraphSdkNode`, or a declared SDK
graph node may invoke a host-owned LangGraph component through `LangGraphNodeExecutor`.
In both directions, the SDK retains its state graph, capability/approval checks,
verification gate, telemetry, and audit stores. LangGraph is a durable orchestration
surface, while the framework design assigns typed graph state—not shared worker
dialogue—as the coordination mechanism.[7] [9]

`LangChainAgentModelAdapter` accepts only a host-projected bounded `ModelContext` and
a parser that returns a validated SDK turn. `LangChainSdkToolFacade` re-enters the
SDK executor rather than granting direct tool access. Jev is an optional typed,
read-only advisory evaluator: it is suitable for post-gate review triage or ranking
already-safe exploration candidates, but it cannot authorize action or prove an
individual design result.[10] [11]

Read the [framework interoperability guide](framework-interoperability-guide.md) and
[Jev advisory evaluation guide](jev-advisory-evaluation-guide.md) before enabling an
adapter. The runnable offline example is
`packages/agent-sdk/examples/framework_interoperability.py`.

## 13. Configure governed orchestration

`Orchestrator` compiles a validated `Plan` and an immutable source snapshot into an
approval-gated graph run. Its `OrchestrationPolicy` lets a user select skill IDs,
named exact model bindings, stage/role profiles, named registered tools, capability
grants, per-profile instances, total/parallel workers, repair attempts, and
multi-agent eligibility. These controls implement the framework’s planning-time
profile binding and deterministic single/multi-agent routing requirements.[12]

The deterministic route is calculated before any optional Jev advisory. A receipt-backed
Jev router can only lift a `single-agent` route to `multi-agent`; it cannot lower a
deterministic multi-agent requirement, enable a policy-prohibited route, approve the
plan, mutate graph state, grant a capability, or choose a model. Each worker receives
only its declared predecessor results and a read-only graph-state view, never another
worker’s transcript.[7] [11]

The host calls `prepare()`, presents the resulting execution plan through
`submit_for_approval()`, records a decision through `approve()`, and then calls
`dispatch_and_execute()` with a local `GraphAgentBindingFactory`. The factory supplies
nonserializable provider clients, tool callbacks, and verification callbacks; the SDK
checks its node ID, identity, exact `ModelBinding`, and tools against the already
approved assignment. `max_parallel_agents` bounds each graph wave, while
`max_repair_attempts` is independent of the plan’s elastic-node depth. Use the
[governed orchestration guide](orchestration-guide.md) and the runnable
`packages/agent-sdk/examples/orchestration.py` for the full host pattern.[12] [13]

MCP exposes only `prepare_orchestration`, `get_orchestration`,
`submit_orchestration_for_approval`, `approve_orchestration`, and
`cancel_orchestration`. It deliberately exposes no remote dispatch operation because a
data payload cannot safely convey executable callbacks or credentials. Policy and
record data persist under `.agent-orchestrations/` and may be recovered after restart;
the host must explicitly re-register bindings before execution resumes.[13] [14]

## 14. Use provenance-grounded retrieval

`GroundedRetrievalService` is the only SDK retrieval layer that may feed task
context. It accepts a frozen snapshot identifier and a bounded category-filtered
query, asks an index only for ranked `RetrievalCandidate` source references, and
then resolves every reference against locally held `DocumentTree` objects. A
candidate must match snapshot, category, document/node identifiers, source hash,
and source location before `TaskAwareContextSelector.select_verified_retrieval_nodes()`
can apply the ordinary stage matrix. The model never receives arbitrary vector-store
payload text.[15] [16]

`QdrantRetrievalIndex` is an optional host-local adapter. It uses snapshot and
category payload filters and creates keyword indexes for those fields. The host supplies
an `EmbeddingProvider`; no model, endpoint, or credential is serialized over MCP.
`DeterministicLexicalRetrievalIndex` is the offline deterministic alternative used by
tests. The [grounded retrieval and structural versioning guide](grounded-retrieval-and-versioning.md)
contains the full data-flow and host pattern.[15] [17]

`RedisRetrievalCache` is an optional TTL cache installed using the `redis-cache` extra.
It stores only digest-keyed bounded `RetrievalResult` records. It must not be used for
specification source truth, graph state, locks, approvals, telemetry, audit history,
tool evidence, or raw source/query text. `RetrievalTelemetrySink` records digest-only
outcomes and candidate/cache metrics when attached.[15]

The Gate 1 missing-reference blast radius is a deterministic reverse-reachability
calculation over `(dependent, prerequisite)` graph edges. It counts all transitive known
dependents, excluding the missing root. Both Gate 1 and plan validation use the same
sorted deterministic cycle traversal.[15] [18]

`SpecificationVersionService` persists a structured content-addressed snapshot with an
approved lock. It classifies subsequent versions by requirement IDs, existing
requirement text/category/structured fields, and dependency edges—not changed filenames.
Changed existing requirements, removed requirements, and edge changes are MAJOR; purely
additive requirement IDs are MINOR; acceptance-check/source-reference-only changes are
PATCH. Automatic classification refuses a pre-existing tag with no stored snapshot until
an approved baseline lock exists.[15]

## 15. Preserve P0 trust guarantees

The 0.16.0 P0 increment repairs guarantees already made by the local harness; it does
not establish semantic derivation or a multi-tenant service. `ArtifactStore` keeps a
content-addressed ID for compatibility and an immutable `ArtifactWriteOccurrence` for
each write. The default governed mutable tools attach run/node/task attribution. A
custom tool handler remains responsible for its own attribution because it intentionally
precedes the standard dispatcher.[19]

`diff_declared_artifacts` requires an authorized base plus either an authorized draft or
the draft occurrence returned by the current task’s declared mutable write. Do not relax
this to “one side authorized”: a diff reveals both contents. Telemetry and audit list
methods are still bounded review pages, but integrity verification now streams the full
stored chain; reports/transcripts declare their complete verified count separately from
their rendered page count. Local hash chains do not prove an undeleted historical tail;
use an externally retained checkpoint if rollback detection becomes a requirement.[19]

`AgentResult.failure` is the bounded/redacted structured envelope for terminal SDK
contract failures. Preserve `reason` for compatibility, but use `failure.code` for
reliable recovery classification. Interop projections reject canonical snake/camel/kebab
and case variants of authority/credential keys. Model-facing `grep` runs in an isolated
child with a deadline and file/byte budgets, because backtracking regular expressions can
cause unbounded CPU consumption.[19] [20]

Variant worktrees must resolve their `base_ref` to the approved specification-tag commit;
the durable record retains both ref and commit. On POSIX the supervisor kills a process
group; Windows uses a separate `taskkill /T /F` branch. The latter is implemented but has
not been exercised on a Windows runner, so do not claim Windows validation yet.[19]

Read [the P0 repair record](p0-trust-guarantee-repair.md) before extending these paths.
Every change must preserve occurrence history, full-chain verification, bounded failure
details, and both-side content authorization.

## 16. Current integration limits

The SDK has no selected real model provider, remote execution backend, SSH/Desktop/Sandbox connector, EDA binary, container/cgroup isolation, multi-process lock, external authenticated identity, or live RTL-to-GDSII benchmark corpus. It must not be presented as already providing those capabilities. The implemented PCKP benchmark is a frozen engineering fixture used to verify deterministic selection and compare it with the greedy baseline; it is not an ASIC-flow performance result.[5] [8]

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 50–51, lines 4–14 and 2–20"

[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 54–55, lines 2–12 and 2–14"

[3]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 23–113 and 137–148"

[4]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/base_agent.py "BaseAgent typed tool-batch validation, scheduling, watchdog, and state-reduction implementation"

[5]: /home/ubuntu/work/agent_assisted_design/docs/p0-p2-algorithm-implementation.md "P0–P2 Deterministic Algorithm Implementation Record"

[6]: https://link.springer.com/article/10.1007/s10107-010-0438-7 "Clique-based facets for the precedence constrained knapsack problem"

[7]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 58–60 and 63"

[8]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf "Human-Agent collaboration proposal, pp. 30–35"

[9]: https://docs.langchain.com/oss/python/langgraph/overview "LangGraph overview"

[10]: https://docs.langchain.com/oss/python/langchain/middleware/custom "LangChain custom middleware"

[11]: https://docs.typesafe.ai/concepts/system-one "TypeSafe System One concepts"

[12]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 41–42, lines 2–12 and 2–13"

[13]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/orchestrator.py "Implemented governed orchestration policy, lifecycle, binding, persistence, and dispatch"

[14]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/mcp_server.py "Data-only persisted orchestration MCP lifecycle"

[15]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/retrieval.py "Provenance-grounded retrieval contracts, cache boundary, Qdrant adapter, and telemetry sink"

[16]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 22–23 and 38–39, source pointers, task-aware loading, traceability traversal, and blast radius"

[17]: https://qdrant.tech/documentation/concepts/filtering/ "Qdrant filtering and payload-index documentation"

[18]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/dependency_graph.py "Deterministic reverse reachability and cycle traversal"

[19]: p0-trust-guarantee-repair.md "P0 Trust-Guarantee Repair Record: implemented contracts, invariants, evidence, and limitations"

[20]: https://cwe.mitre.org/data/definitions/1333.html "CWE-1333: Inefficient Regular Expression Complexity"
