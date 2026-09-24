# Telemetry, Conversation Logs, and Governed Core-Tools Plan

**Status:** Implemented as SDK v0.8.0 on 23 September 2026; see `telemetry-logs-and-core-tools-implementation.md`.
**Scope:** Extend the reusable Python SDK before any C++ EDA wrapper work. The increment adds source-grounded run metrics, a bounded conversation/audit log that is separate from model working memory, and the portable local/file/web/utility tools needed by an engineering agent. It does not claim to implement a real model adapter, a browser/computer-control tool, remote SSH, a persistent scheduler, or autonomous team spawning before their required execution/provider boundaries exist.

## Why the telemetry model changes

The existing SQLite ledger already records ordered, hash-linked lifecycle facts and arbitrary metric observations. It does not yet define a required metric catalogue, emit all retry/attempt/escalation outcomes automatically, record provider token usage when a provider supplies it, or produce a human-readable run log. The project proposal requires a traceability log for every interaction, including prompts, agent outputs, human corrections, and PPA deltas; it also identifies primary, secondary, convergence, retrieval, and diagnostic metrics.[1] The updated system design assigns watchdog and audit authority to deterministic layers, so the metric/log pipeline must not depend on a model’s self-report.[2]

The implementation therefore uses three separate data products. **ProjectState** remains the bounded current-state model context. **Episode/result journals** remain execution evidence and compaction inputs. The new **audit transcript** is an external, hash-linked, bounded text/JSONL log for review and research analysis. This separation follows the state-based-memory proposal: working state is not a replayed transcript, while episode/history evidence remains available for attribution and replay.[3]

## Metric catalogue and availability rules

| Group | Automatic metric IDs | Source and availability rule |
|---|---|---|
| Attempts and recovery | `agent.model_turn_attempt_count`, `agent.recovery_iteration_count`, `agent.output_rejection_count`, `agent.tool_call_attempt_count`, `agent.tool_failure_count`, `agent.tool_blocked_count`, `agent.verification_failure_count` | Derived only from BaseAgent lifecycle and tool outcomes. No inferred missing attempts. |
| Resolution and escalation | `agent.escalation_count`, `agent.unsolved_escalation_count`, `controller.repair_attempt_count`, `controller.escalation_count` | Derived from terminal BaseAgent/controller records. A bounded controller repair is distinct from an agent model turn. |
| Context | `context.estimated_input_tokens`, `context.working_budget_tokens`, `context.remaining_working_budget_tokens`, `context.deadlock_count` | The input count is explicitly **estimated** by the SDK’s deterministic estimator; the remaining amount is the configured working-context budget minus that estimate. It is not a claim about provider context capacity. |
| Provider usage | `model.provider_input_tokens`, `model.provider_output_tokens`, `model.provider_cached_input_tokens`, `model.provider_reasoning_tokens`, `model.provider_context_window_tokens`, `model.provider_remaining_context_tokens` | Recorded only when a real adapter returns provider-reported usage. The remaining-context calculation requires both provider input usage and capacity. Otherwise an explicit `unavailable` observation names the missing adapter field; zero is never substituted. |
| Execution resource/time | `agent.wall_duration_ms`, `agent.process_cpu_duration_ms`, `tool.duration_ms`, `tool.process_attempt_count` | Taken from the profiler/supervisor. External EDA CPU/memory is unavailable until an EDA wrapper emits an observed record. |
| Research outcome metrics | `research.ppa_drift_rate`, `research.wns_gap_ns`, `research.drc_lvs_clean_rate`, `research.interface_mismatch_count`, `research.human_correction_rate`, `research.first_pass_acceptance_rate`, `research.downstream_rework_cost_seconds`, `research.insight_accuracy`, `research.retrieval_precision` | Registered now but only observed through an explicit caller/tool result with parser/version/evidence identifiers. The proposal lists these as evaluation metrics; the SDK does not manufacture values.[1] |

Each metric definition states its formula, aggregation, unit, and missing-data rule. Report aggregation distinguishes a valid zero from unavailable data. The conversation log and telemetry ledger also retain event identifiers and evidence references so a plotted metric can be traced to its inputs.

## Conversation/audit log contract

Each task run receives an append-only JSONL log plus a rendered Markdown transcript. The log records bounded public task instructions, model-issued structured turns, tool-call identity/arguments, tool status/result handle or bounded preview, verification outcome, controller escalation, and terminal result. The associated SQLite event sequence and log-entry hash create a readable graph traversal without using the transcript as next-turn context.

The log rejects hidden-reasoning fields and redacts common secret-bearing keys. Each entry has a character bound; larger JSON values are represented by content hash, length, and a truncation marker. It records only provider-visible outputs and deterministic harness decisions, not hidden chain-of-thought. Restart checkpoints remain transcript-free as specified by the design.[3] [4]

## Governed core-tool scope

OpenHarness has a broad local registry, but its own source demonstrates why a numerical “all tools” claim is unsafe: it has 39 static built-ins, conditionally available MCP-resource tools, and unbounded dynamically named MCP adapters.[5] Its source does not contain a browser/computer-use agent tool. The SDK will take the reusable patterns—typed schemas, a common result shape, read-only/mutating classification, explicit confirmation/capability policy, a closed command catalogue, and untrusted web content—without copying generic shell execution.[5]

| Tool family | Implemented in this increment | Security boundary |
|---|---|---|
| Files and text | `read_file`, `glob`, `grep`, `write_draft`, `edit_draft`, `diff_declared_artifacts` | All paths resolve under the declared run root. Writes remain restricted to declared outputs and capability policy. |
| Evidence | `read_artifact`, `grep_artifact`, `get_tool_result` | Artifact authorization or opaque result-handle verification is mandatory; results are bounded. |
| Web research | `web_fetch`, `web_search` | HTTP(S) only, loopback/private-network denial, redirect revalidation, bounded textual results, and untrusted-content markers. Search/fetch content never becomes trusted instruction. |
| Execution | `run_registered_command` plus current named Verilator/Yosys/OpenROAD/OpenSTA registrations | Only named supervisor templates are executable. There is no generic `bash` or raw command argument. |
| Utilities | `sleep`, `brief`, optional `ask_human_question` through an injected local responder, and `notebook_edit` for declared notebook JSON outputs | Sleep is bounded. A missing responder causes a typed blocked result. Notebook edits do not execute cells. |
| Later, not fabricated | OpenHarness-style image generation, LSP, worktrees, cron/remote triggers, tasks, subagents, teams, arbitrary dynamic MCP tools, SSH, browser/computer use | These require selected providers, a persistent/task runtime, an authenticated remote-execution policy, or a backend service. Existing SDK controller/MCP operations already own typed coordination, Git versioning, and approval semantics. |

## Validation plan

Tests will cover metric definitions and availability, attempt/escalation/context calculations, provider usage propagation, transcript redaction/bounds/hash verification, conversation log rendering, each file/evidence/web failure boundary, private-network URL denial, registered-command-only execution, and BaseAgent-to-telemetry integration. The TypeScript MCP façade will expose the new telemetry summary and conversation-log read operations after the Python contract is validated.

## References

[1]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators, pp. 15–16, 23–24, and 30–35"

[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 54–55, lines 2–12 and 2–14"

[3]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 64–72, 89, and 101–113"

[4]: /home/ubuntu/work/baseagent-planning/pages/page-064.txt "Structured checkpoints and context-deadlock procedure, lines 3–21"

[5]: https://github.com/HKUDS/OpenHarness/tree/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/tools "OpenHarness tool registry and tool implementations"
