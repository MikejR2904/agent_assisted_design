# Metrics, Conversation Audit Logs, and Governed Core Tools Implementation Record

**Status:** Implemented and validated on 23 September 2026.
**SDK release:** `agent-design-agent-sdk` **0.8.0**.
**Scope:** This record covers the telemetry/logging and generic tool increment completed before the C++ EDA-wrapper increment. It does not claim a real LLM provider, SSH remote executor, Sandbox/Desktop target, browser/computer-use provider, persistent scheduler, generic shell, or actual EDA binary wrapper.

## Delivered behavior

The SDK now has a **standard metric catalogue** in `metrics.py`. `BaseAgent` registers these definitions when telemetry is present and records lifecycle-derived model-turn attempts, recovery iterations, output rejections, tool attempts/failures/blocks, verification failures, escalations, unresolved escalations, compaction deadlocks, SDK-estimated context tokens, working-context budget, and estimated remaining working budget. The controller records bounded repair attempts and controller escalations. The profiler supplies agent wall/process-CPU duration and per-tool duration. Metric observations preserve `available` versus `unavailable`, so a missing provider/EDA/human measurement is not reported as zero.

`ModelTurnResponse` now accepts optional `ProviderUsage`. A future real provider adapter can report input, output, cached-input, reasoning, and context-window token counts together with a request identifier. The runtime records these only when supplied. It marks the counter unavailable otherwise. When the adapter supplies both input tokens and a context-window capacity, the runtime records a provider-reported remaining-context calculation. This is separate from the SDK’s deterministic working-context estimate and does not present an estimate as a provider fact.

The new `AuditTranscriptStore` produces an append-only JSONL audit chain and review Markdown transcript under `.agent-audit-logs/`. It records bounded/redacted public task instructions, provider-visible structured model turns, tool calls and results, verification, lifecycle events, escalation, and profile completion. Each entry carries a predecessor hash and integrity hash. Hidden-reasoning keys are rejected, common secret-bearing keys are redacted, and oversized payloads become content-hash plus preview records. The audit transcript is **not** projected into `ModelContext`; `ProjectState` remains the bounded working memory.

The generic core-tool surface is now explicit and opt-in through `core_tool_definitions()`. `CoreToolDispatcher` implements run-root-contained `read_file`, `glob`, `grep`, declared-path `write_draft` and exact `edit_draft`, `read_artifact`, `grep_artifact`, bounded `get_tool_result`, `web_fetch`, `web_search`, `sleep`, `brief`, `ask_human_question`, `notebook_edit`, and named `run_registered_command`. The existing `HarnessToolRegistry` maps these through `CapabilityPolicy` and approvals before execution. Generic shell execution is intentionally absent. Public web tools deny local/private targets and mark all returned content as untrusted evidence.

The MCP and TypeScript boundary now exposes `get_audit_log` and `render_audit_transcript` alongside telemetry metric/report operations. The TypeScript integration test invokes a Python agent run, reads automatically emitted metrics, reads the audit event sequence, and renders a hash-verified transcript.

## Metric coverage

| Requirement | Implementation status | Measurement authority |
|---|---|---|
| Attempts, loopbacks/recovery, tool failures, verification failures | Implemented as automatic `agent.*` metrics | Deterministic lifecycle and tool events |
| Agents unable to resolve/escalate | Implemented as `agent.escalation_count` and `agent.unsolved_escalation_count` | Terminal BaseAgent record |
| Controller repair/architectural escalation | Implemented as `controller.repair_attempt_count` and `controller.escalation_count` | Controller state machine |
| Token use and remaining context | Provider counters only when adapter reports them; separate SDK estimated input/working budget/remaining budget always labelled estimate | Provider adapter or deterministic context projector |
| Timing/profiling | Implemented via agent/tool profile-derived metrics | `AgentRunProfiler` |
| PPA, WNS, DRC/LVS, interfaces, HCR, FPAR, rework, insight accuracy, retrieval precision | Definitions registered now; observations remain unavailable until attributable EDA/human/retrieval evidence exists | Explicit parser/human/tool observation |
| Readable interaction/tool trace | Implemented as bounded audit JSONL plus rendered Markdown | Deterministic harness and provider-visible outputs |

## Validation performed

| Check | Result |
|---|---|
| Python compilation | Passed: `uv run python -m compileall -q src examples` |
| Formatting and lint | Passed: `uv run ruff format --check src tests examples` and `uv run ruff check src tests examples` |
| Python test suite | Passed: **66 tests** |
| Package build | Passed: wheel and source distribution `0.8.0` built with `uv build` |
| Live MCP interoperability | Passed: TypeScript client compiled and executed `batchedContextProjection.mcp.e2e.ts` against a loopback Python MCP service; it verified automatic metrics, audit entries, and transcript integrity |

## Important boundaries

The design document says the watchdog/supervisor, not the model, governs tool execution and termination.[1] This implementation maintains that boundary: `run_registered_command` selects an existing named `CommandTemplate`; it cannot provide a raw shell string. The source design also requires private agent context and typed coordination rather than transcript exchange.[2] Audit history is therefore retained for review without being passed back into the agent’s model context. The project proposal requires a traceability log for interactions and identifies PPA/quality/human-effort metrics.[3] The SDK registers those formulas, but it deliberately refuses to manufacture PPA or human-correction observations prior to a real EDA/human evidence source.

OpenHarness was treated as a pattern source, not as an unverified feature list. Its current source has a typed static tool registry, permission policy, untrusted-web handling, contextual hooks, and richer autopilot records, but it does not provide a fixed “all tools” number or an ordinary durable telemetry ledger for every chat run.[4] The implemented set adopts the grounded reusable patterns while keeping the ASIC harness’s stricter closed-capability and project-state boundaries.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 54–55, lines 2–12 and 2–14"

[2]: /home/ubuntu/work/watchdog-telemetry-audit/CA1Slides.txt "CA1 Slides consolidated text, lines 137–174: requirement provenance, private contexts, and typed shared state rather than conversation"

[3]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators, pp. 15–16, 23–24, and 30–35"

[4]: https://github.com/HKUDS/OpenHarness/tree/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness "OpenHarness source inventory, permission policy, session/stream/event records, and tool implementations inspected at commit 9b2efd795c6aa09f88b0c257d269a9e518da6ae7"
