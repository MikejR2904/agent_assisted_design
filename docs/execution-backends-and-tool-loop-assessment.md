# Execution Backends and Tool-Loop Assessment

**Status:** Architecture assessment; its context/runtime correction was implemented in SDK v0.5.0 and replaced with **state-first working memory** in SDK v0.6.0. Sandbox, Desktop, SSH, model-provider, and remote-host execution remain unimplemented.
**Scope:** Current repository audit and a source-grounded design for future execution targets and context-efficient tool use.

## Conclusion

The current SDK contains a **deterministic coordination and safety harness**, but it does **not** yet contain a real provider adapter, a Sandbox execution backend, a Desktop execution backend, SSH credential/host management, or a remote-workspace tool. The safe next step is not to give a model a generic `ssh` or shell tool. It is to add a target-aware execution layer in which the model requests a **typed operation**—for example `inspect_workspace(target_id)` or `run_recipe(target_id, recipe_id, arguments)`—and a deterministic backend constructs and supervises the actual local, Desktop, or SSH command.

**Implementation update (v0.6.0):** `ToolBatchTurn`, dependency-aware serial/parallel-safe scheduling, full result journals, pre-turn episode compaction, protected fresh evidence, runtime budgets, opaque provider continuation, and a hash-linked `ProjectState` reducer are implemented and tested. Normal model calls now receive the immutable scoped prompt plus current typed project state, not prior tool observations or episode summaries. The episode graph and full result journal remain audit/recovery evidence. See the [state-first implementation record](state-based-memory-implementation.md). The remaining execution-backend recommendations in this assessment are still proposed work.

A model/tool loop necessarily requires another model inference whenever the next decision depends on the previous tool result. No framework can remove that information dependency. The implemented runtime reduces cost by batching independent calls, executing deterministic multi-step probes inside one tool, preserving full evidence outside the prompt, mechanically reducing outcomes into bounded project state, compacting episode evidence, and isolating verbose work in subagents. The model’s normal working context is the current `ProjectState`, not a growing `ModelObservation` sequence.[1] [2]

> The project framework already establishes the central boundary: a BaseAgent sees its identity, immutable scoped task data, matched skills, and exactly its declared tool definitions; the harness—not the model—owns deterministic watchdog authority.[3] [4]

## Current implemented harness

| Harness area | Current implementation | Status and boundary |
|---|---|---|
| BaseAgent contract and loop | `AgentDefinition`, immutable scoped task, JSON-schema output validation, optional deterministic verification gate, termination/escalation, tool hooks, typed lifecycle events, and optional wall-clock budgets. | Implemented. The current provider adapter is **only** `ScriptedModel`; no real model call occurs. |
| Model abstraction | `AgentModel` protocol and ordered `FailoverAgentModel`. | Implemented as an abstraction. No OpenAI, Anthropic, or other provider adapter is wired. |
| Context construction | Deterministic order: identity, instructions, verbatim scoped task/locked interface, skills, and declared tool schemas. | Implemented. It matches the system-design context order.[3] |
| Planning and vertical coordination | Typed plan/DAG validation, deterministic complexity routing, explicit plan approval, dispatch, bounded repair, controller escalation/cancellation, and persistence. | Implemented. Worker-to-worker dialogue is intentionally absent. |
| Lateral coordination | Immutable shared substrate, exploratory discoveries, consumer dependency requests, conditional graph edges, and provenance fan-in validation. | Implemented. Cross-worker communication is through typed discoveries, not chat transcripts.[5] |
| State-first memory and restart safety | Bounded `ProjectState` with revision/hash-linked events; task/work/artifact status; human decisions; open questions; blockers; evidence references; typed exploratory/action episodes; dependency graph; EDA-manifest protection; deterministic compaction; and context-deadlock state. | Implemented. BaseAgent projects only current `ProjectState` as normal working memory; episodes and journals are audit evidence. Stage-specific minimum schemas and multi-process revision conflict control remain open. |
| Policy and approval | Deny-by-default role/capability/path policy and typed approvals for non-read-only actions. | Implemented. Approval storage is not yet persistently rehydrated. |
| Artifacts and preprocessing | Content-addressed artifacts; manifest-driven source-preserving document trees; source locations; task-aware context selection; Gate 1 checks and soft-lock artifacts. | Implemented. No semantic EDA parsers or real vision/model API are connected. |
| Tool supervision and watchdog | Closed registered command templates; timeouts; bounded output capture; process groups; `SIGTERM` then `SIGKILL`; optional POSIX resource limits; typed process outcome and retry metadata. | Implemented for injected templates. It does not yet provide cgroup/container isolation or execute an EDA tool in the shipped MCP path.[4] |
| Git control | Local Git state, diff classification, approved specification tags/locks, and approved local variant worktrees. | Implemented; remote Git operations are deliberately absent. |
| Telemetry and reporting | SQLite event ledger, hash chain, metric definitions/observations, trace report, controller/BaseAgent/watchdog events, and runtime telemetry UI panel. | Implemented. Unmeasured PPA/model/human-review metrics remain explicitly unavailable. |
| TypeScript/Python bridge | TypeScript backend routes and MCP client communicate with Python through Streamable HTTP MCP. | Implemented and integration-tested. |

## Current tools

### Agent-facing harness tools

The closed `HarnessToolRegistry` contains the following nine candidate tools. A role must have the corresponding capability and every mutating/process operation requires the configured typed approval path.

| Tool | Capability | Side effect | Current semantics |
|---|---|---|---|
| `read_spec` | `spec.read` | Read-only | Reads only the scoped specification pointer from an injected snapshot. |
| `read_artifact` | `artifact.read` | Read-only | Reads an authorized content-addressed artifact. |
| `grep_artifact` | `artifact.read` | Read-only | Searches an authorized artifact and returns matching line numbers. |
| `write_draft` | `draft.write` | Mutating | Writes only a declared output path beneath the run root. |
| `diff_declared_artifacts` | `artifact.diff` | Read-only | Diffs declared/authorized artifacts. |
| `run_verilator` | `rtl.verilator` | Process | Resolves to a registered `verilator` command template when injected. |
| `run_yosys` | `rtl.yosys` | Process | Resolves to a registered `yosys` command template when injected. |
| `run_openroad` | `physical.openroad` | Process | Resolves to a registered `openroad` command template when injected. |
| `run_opensta` | `physical.opensta` | Process | Resolves to a registered `opensta` command template when injected. |

This deliberately matches the RTLWorker tool contract in the systems design: scoped specification/artifact reads, a declared-path draft write, declared-input Verilator/Yosys execution, and diffing.[6] There is **no** generic shell tool, Sandbox tool, Desktop tool, SSH tool, remote credential tool, remote file-transfer tool, or remote worktree tool.

Two additional tools—`read_locked_interface` and `echo`—exist only in `InMemoryTaskToolExecutor` for deterministic unit and MCP tests. The shipped `run_agent_task` MCP operation currently instantiates that test executor, not `HarnessToolExecutor`. Consequently, the listed EDA process tools are reusable harness code but are **not reachable as real EDA execution through the current MCP task endpoint**.

### Python MCP control surface

The current server registers **37 MCP tools**. They are control and data APIs, not all agent-callable execution tools.

| Group | MCP tools |
|---|---|
| BaseAgent | `validate_agent_definition`, `assemble_initial_context`, `run_agent_task` |
| Plan and graph run | `validate_plan`, `start_run`, `get_run_state`, `cancel_run`, `submit_approval`, `resume_run` |
| Vertical/lateral coordination | `create_controller`, `submit_controller_plan`, `approve_controller_plan`, `dispatch_controller`, `record_controller_node_result`, `publish_exploratory_discovery`, `request_lateral_dependency`, `get_controller_state`, `get_shared_state`, `verify_provenance_contract`, `record_controller_stage_failure`, `complete_controller`, `cancel_controller` |
| Specification and Gate 1 | `process_specification_manifest`, `select_task_context`, `validate_gate_one`, `soft_lock_specification` |
| Telemetry | `list_telemetry_runs`, `get_telemetry_events`, `register_metric_definition`, `list_metric_definitions`, `record_metric_observation`, `get_telemetry_metrics`, `create_telemetry_report` |
| Local Git | `get_git_repository_state`, `classify_specification_version`, `create_specification_git_lock`, `create_variant_worktree` |

## State-first loop and retained protocol obligations

The current loop is structurally:

```text
initial immutable prompt + declared tools
          │
          ▼
ModelContext(immutable prompt, ProjectState, continuation metadata)
          │
          ▼
one AgentTurn: final | blocked | exactly one ToolCall
          │
          ▼
policy/hooks → tool executor → typed ToolExecutionResult
          │
          ▼
deterministically reduce result into ProjectState plus audit evidence
          └─────────────────────────── next model turn receives only current state
```

The design prevents undeclared tools and validates tool arguments before execution. It records the full `ToolExecutionResult` in a journal, writes the compact evidence handle and outcome classification into `ProjectState`, and separately records typed episodes. `ContextProjector` invokes episode compaction before each model call. A large lint log, directory listing, or tool JSON result is not automatically replayed into later inference. The `ToolBatchTurn` contract permits a provider to request independent read calls in one turn.[1] [2]

The answer to the question “does the model append A, tool result 1, B, tool result 2?” is **protocol-dependent**:

1. The host must retain enough provider-native state to correlate a tool call with its result. With direct Anthropic client tools, that means the assistant tool-use block and a matching `tool_result` block. With OpenAI Responses, that means preserving the response/output lineage and returning a `function_call_output` with the exact `call_id`.[7] [8]
2. The host does **not** need to append hidden reasoning, a full terminal transcript, or all historical raw artifacts to the active model prompt. The agent should receive a budgeted summary plus stable handles to durable evidence.
3. A second inference is required only after a tool result that affects the next decision. If one result determines whether the next command is safe or useful, skipping that inference would make the runtime guess rather than reason from the observation.

## How tool choice should work

A model should not “know the SSH command” as a memorized string. The model should choose among a **small, declared set of typed capabilities** based on the task, tool descriptions, schemas, and current target descriptor. The deterministic harness converts a selected operation into the actual command, applies policy, executes it, and converts the result back into a typed observation.

For example, the model should see this conceptually:

```json
{
  "name": "inspect_workspace",
  "description": "Return a bounded, read-only workspace snapshot for an approved execution target.",
  "input_schema": {
    "type": "object",
    "properties": {"target_id": {"type": "string"}},
    "required": ["target_id"],
    "additionalProperties": false
  }
}
```

The model may request `inspect_workspace("target-lab-a")`. It does **not** receive a private key, host password, raw hostname, or arbitrary shell escape. An `SSHExecutionBackend` owned by the harness finds the target record and builds the non-interactive command from policy-controlled configuration. Its first operation can be a deterministic probe recipe that gathers `pwd`, selected Git state, configured workspace root, allowed tool versions, and bounded file manifest in one supervised call. The resulting `WorkspaceSnapshot` becomes durable state and a small prompt item.

This is the same general division documented by Anthropic and OpenAI: the model emits a structured request; the client application validates, authorizes, executes, and returns a correlated result. Neither vendor describes the model request as an authorization decision.[7] [8]

## Proposed execution-backend architecture

### A target is a first-class typed resource

Add a target record outside the model prompt:

```text
ExecutionTarget
  target_id                 stable opaque identifier
  kind                      sandbox | desktop | ssh
  display_name              user-visible, non-secret
  owner_id / approval_scope target authorization boundary
  workspace_root            declared allowed root on that target
  credential_ref            opaque secret reference; absent from prompts/logs
  host_key_ref              pinned SSH host-identity reference for ssh targets
  policy_profile_id         capability/path/recipe/resource policy
  environment_fingerprint   OS/tool/EDA version snapshot after inspection
  status                    configured | reachable | blocked | stale
```

A `TargetRouter` picks an implementation from `SandboxBackend`, `DesktopBackend`, or `SSHBackend`. The router must not let the model specify an arbitrary target endpoint. The controller supplies only user-configured target IDs compatible with the approved plan and agent capability profile.

| Backend | Intended use | Boundary |
|---|---|---|
| Sandbox | Disposable task-local workspace and reproducible EDA recipe execution. | Requires filesystem/network/process isolation stronger than the present process-group watchdog. Artifacts are copied/registered through content hashes. |
| Desktop | User-connected local-machine workspace. | Applies only to selected mounted roots. It must not imply whole-machine access; the desktop must remain connected for execution. |
| SSH | Existing remote compute/EDA server and its approved workspace. | Uses a configured opaque target and credentials, host identity verification, non-interactive execution, declared workspace root, command recipes, and remote artifact collection. |

This maps cleanly to the project’s worker contract, which already requires a task-local workspace, authorized source spans, declared artifacts, and bounded tool execution.[6] It adds environment identity and target policy without changing the controller/worker coordination model.

### Agent-facing execution tools should be operations, not unrestricted commands

The recommended initial catalog is:

| Tool | Model-supplied fields | Deterministic backend responsibility |
|---|---|---|
| `inspect_workspace` | `target_id` | Runs the target-specific read-only probe recipe and stores a `WorkspaceSnapshot`. |
| `read_workspace_file` | `target_id`, declared relative path, byte/line range | Enforces root containment and bounded return; creates an artifact handle for larger files. |
| `search_workspace` | `target_id`, declared scope, pattern, result limit | Runs a bounded target-specific search recipe. |
| `run_recipe` | `target_id`, `recipe_id`, typed arguments | Looks up a registered argv/template, environment, limits, working root, and expected manifest; no raw arbitrary command. |
| `write_workspace_draft` | `target_id`, declared output path, content or artifact ID | Requires the existing mutation approval policy and registers a content-addressed manifest. |
| `get_execution_result` | `result_handle`, optional bounded slice/filter | Retrieves durable tool evidence without replaying it automatically into every context. |

A later **escape hatch** for constrained exploratory commands could be considered only after recipes are working. It should be a separate high-risk capability such as `run_constrained_command`, restricted to a target/workspace, a noninteractive argv schema, deny/allow policy, timeout/resource profile, and typed approval. It should not be the first SSH API. OpenHarness exposes a general Bash tool, but its own source review shows that policy matching and command truncation do not amount to a complete command-language sandbox.[9]

### SSH authentication and workspace discovery

The planned SSH backend should use an application-owned target configuration and an injected secret/credential reference. Credentials, passphrases, raw key text, connection tokens, and host-specific environment secrets must never enter model context, telemetry payloads, episode content, or artifact manifests. The backend should perform an explicit target setup/approval step that records the declared remote workspace and host identity. It then executes noninteractive bounded recipes through the supervisor and returns a `WorkspaceSnapshot` or `ExecutionResult`.

The first useful action is not “start work”; it is a read-only inspection. The model then receives only the workspace facts it needs: repository identity and commit state, approved root, source manifest digest, configured tool availability/version, and any classified blocker. If those facts show the target is unsuitable, the controller can route back to another target or ask for user intervention rather than attempting a destructive repair.

## Context-efficient replacement for the active loop

### Required data structures

Add the following deterministic state, all outside the provider prompt by default:

| Store | Holds | Prompt exposure |
|---|---|---|
| Execution journal | Full structured request/result, bounded raw logs, artifact hashes, environment fingerprint, approval/target IDs. | None by default; referenced by `result_handle`. |
| Artifact store | Full files, logs, manifests, diffs, report files. | A hash, handle, size, and compact conclusion only. |
| Episode store | Closed exploratory/action records and dependency graph. | Eligibility-filtered summaries and source/manifest references. |
| Context budget manager | Exact token estimate, pinned facts, compacted records, context-deadlock dossier. | A deterministic projection for the next call. |
| Provider continuation store | Provider-native response/conversation/session identifiers and mandatory opaque items. | Passed only through the provider adapter according to that provider’s protocol. |

### Next-context projection

Before each inference, build—not append—the next model context in this order:

1. **Pinned immutable facts:** identity, task scope, locked interface, acceptance criteria, current approved target descriptor, and capability policy summary.
2. **Live plan state:** current graph node, required dependencies, declared outputs, verification criteria, and outstanding approvals.
3. **Recent causal evidence:** only the minimum closed episode summaries and tool-result summaries that the active action depends on.
4. **Handles for full evidence:** artifact IDs, source spans, result handles, log query handles, and workspace snapshot ID.
5. **A stage-specific tool subset:** only tools permitted for this role, target, and current plan node; not the full global registry.
6. **Provider-native continuation material:** only what the selected API requires for correct correlated tool continuation.

For a large Verilator run, the next context should resemble this:

```json
{
  "tool_result_summary": {
    "call_id": "call-18",
    "tool": "run_recipe",
    "status": "failed",
    "classification": "rtl-lint-error",
    "diagnostic_count": 2,
    "first_diagnostics": ["top.sv:42: width mismatch", "top.sv:91: undeclared signal"],
    "log_handle": "artifact:sha256:...",
    "manifest_handle": "artifact:sha256:...",
    "output_truncated": true
  }
}
```

The model may then call `get_execution_result(log_handle, range)` or `read_workspace_file(...)` if it needs more evidence. It does not receive a 100,000-line tool transcript repeatedly.

### Batching and subagents

Change the turn contract from one `ToolCall` to a `ToolBatch` with one or more calls and declared dependency metadata. The scheduler can execute read-only independent calls concurrently, serialize actions sharing a workspace, and return all correlated results in model-request order. Both Anthropic and OpenAI document multiple tool/function calls in a single model response; OpenHarness implements concurrent execution with result ordering for multi-call assistant messages.[7] [8] [9]

For a remote workspace, `inspect_workspace` itself should batch its fixed read-only probe commands inside the backend. This is not an LLM decision sequence, so it should be one tool execution. For genuinely independent longer investigations, a subagent can retain its own verbose tool history and return a concise typed report. Anthropic documents this as a context-isolation mechanism; only the subagent final response returns to the parent.[10]

### Compaction policy

Integrate the existing episode-compaction policy just before context projection. Preserve records still needed by the active action and preserve an EDA action until its input/output manifest exists. Compact dependency-free records in the documented priority order, retain tombstones/handles, and enter explicit `CONTEXT_DEADLOCK` when no safe candidate exists.[2] This directly implements the system design rather than adding a lossy ad hoc summarizer.

Use provider-native compaction where appropriate, but do not treat it as the durable source of truth. Claude Code documents automatic/manual compaction and post-compaction reminders; OpenAI Responses documents server-side or explicit compaction that preserves an opaque carried-forward context item.[11] [12] The SDK’s artifact, episode, and execution journals remain the audit/recovery authority.

## Example: requested SSH workflow

The following sequence shows the intended split between model judgment and deterministic execution.

```text
Controller receives: “Use approved remote target lab-a; inspect its workspace; work there.”
  │
  ├─ validates target is configured, approved, and reachable
  ├─ creates a task-local remote workspace binding and telemetry correlation ID
  │
  ▼
Model sees target descriptor plus `inspect_workspace(target_id)`
  │
  ├─ requests inspect_workspace("lab-a")
  │
  ▼
SSH backend retrieves credential reference, verifies target identity,
executes one bounded noninteractive inspection recipe, stores full evidence
  │
  ▼
Model sees WorkspaceSnapshot summary + handles, not SSH command/key/full logs
  │
  ├─ may batch independent reads/searches
  ├─ requests a registered lint/synthesis/draft recipe when plan and policy allow it
  │
  ▼
Supervisor records manifest, artifacts, telemetry, policy/approval decision, and typed result
  │
  ▼
Controller verifies result, schedules repair/escalates, or progresses the graph
```

If the model must decide what to repair after a lint result, it needs another inference. If a sequence is fixed—such as SSH workspace inspection, result harvesting, and environment fingerprinting—the backend should perform that sequence internally as one deterministic operation. This is the appropriate efficiency boundary.

## Recommended implementation order

| Increment | Deliverable | Reason for order |
|---|---|---|
| 1. Context/runtime correction | `ToolBatchTurn`, result handles, `ContextProjector`, budget checks, episode-compaction integration, and provider-continuation interface with fake adapters/tests. | Fixes the existing one-call/raw-observation bloat before adding a powerful execution target. |
| 2. Target contract and fake backend | `ExecutionTarget`, target policy/profile, workspace/result schemas, durable target/session records, and deterministic fake backend tests. | Lets coordination, approvals, and telemetry be validated without credentials or real machines. |
| 3. Sandbox backend | Task-local sandbox/worktree execution, recipe registry, artifact/manifest capture, target-scoped policies, and supervisor integration. | Establishes the safe reference backend and EDA recipe semantics. |
| 4. Desktop backend | Adapter for an explicitly connected Desktop target and selected mounted roots. | Reuses the target contract; requires an available desktop connection but no SSH secret design. |
| 5. SSH backend | Approved target provisioning, host-identity/credential references, read-only probe, recipe execution, remote artifact collection, and negative-path tests. | Adds remote access only after target boundaries, observability, and policy are proven. |
| 6. Provider adapter | Real selected model, native continuation handling, token/cost telemetry, tool batching, and provider integration tests. | Requires the project’s pending model/provider decision. |

## Decisions required before implementation

1. **Desktop meaning:** Does “Desktop” mean the user-connected Manus local desktop, limited to explicitly selected mounted directories? This is the recommended interpretation.
2. **SSH trust model:** Should targets be preconfigured by an administrator/project owner, or may a task propose a new host that then requires setup approval? The recommended first increment permits only preconfigured opaque target IDs.
3. **SSH credentials:** Should the backend use an agent/SSH key reference, SSH agent forwarding, or another project-controlled secret mechanism? The key material must not enter prompts or telemetry.
4. **Command policy:** Should v1 permit only declared noninteractive recipes, or should it include a tightly governed arbitrary-command escape hatch? The recommended v1 permits recipes only.
5. **Mutating remote actions:** Should a target-level approval cover remote writes/EDA runs for an approved plan node, or should each remote mutation request a separate approval? The existing policy machinery can support either; per-capability approval is the safer default.
6. **Provider:** Which real model/provider should supply the first `AgentModel` adapter? Provider-native continuation and compaction mechanics depend on this choice.

## References

[1]: [Current BaseAgent loop](../packages/agent-sdk/src/agent_sdk/base_agent.py) — `ModelContext` construction and one-tool `AgentTurn` handling, lines 120–348 and 350–502.

[2]: [Current episode memory and compaction](../packages/agent-sdk/src/agent_sdk/memory.py) — closed/dependency-free eligibility, EDA manifest protection, context-deadlock behavior, and compaction priority, lines 188–326.

[3]: [Agent-Assisted Design Framework Systems Design, updated](file:///home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf) — BaseAgent contract and deterministic/non-deterministic role separation, p. 50, lines 4–14; deterministic initial-context construction, p. 61, lines 2–16.

[4]: [Agent-Assisted Design Framework Systems Design, updated](file:///home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf) — harness as deterministic watchdog, p. 54, lines 8–12; tool-hook and EDA supervisor responsibility, p. 55, lines 5–14.

[5]: [Agent-Assisted Design Framework Systems Design, updated](file:///home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf) — typed state graph and worker collaboration, p. 60, lines 2–19; cross-agent episode rules, p. 63, lines 2–26.

[6]: [Agent-Assisted Design Framework Systems Design, updated](file:///home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf) — RTLWorker task-local workspace, tool, memory, termination, and verification contract, p. 66, lines 2–17.

[7]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works "How tool use works — Claude Platform"; https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use "Parallel tool use — Claude Platform"; https://platform.claude.com/docs/en/agent-sdk/permissions "Configure permissions — Claude Agent SDK".

[8]: https://developers.openai.com/api/docs/guides/function-calling "Function calling — OpenAI API"; https://developers.openai.com/api/docs/guides/tools-shell "Shell — OpenAI API"; https://openai.github.io/openai-agents-python/running_agents/ "Running agents — OpenAI Agents SDK".

[9]: https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/engine/query.py#L633-L1018 "OpenHarness query loop and tool-call execution gate"; https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/tools/bash_tool.py#L18-L218 "OpenHarness Bash tool"; https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/config/settings.py#L77-L113 "OpenHarness sandbox configuration defaults".

[10]: https://platform.claude.com/docs/en/agent-sdk/subagents "Subagents in the SDK — Claude Agent SDK".

[11]: https://docs.anthropic.com/en/docs/claude-code/model-config "Model configuration — Claude Code"; https://docs.anthropic.com/en/docs/claude-code/hooks-guide "Automate actions with hooks — Claude Code".

[12]: https://developers.openai.com/api/docs/guides/compaction "Compaction — OpenAI API"; https://developers.openai.com/api/docs/guides/conversation-state "Conversation state — OpenAI API".
