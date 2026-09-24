# P0 Trust-Guarantee Repair Record

**Status:** Implemented in Agent SDK **0.16.0**.
**Scope:** Repairs to existing provenance, confidentiality, accountability, and availability guarantees. This increment does **not** implement semantic-fidelity proof, document admission, a decision-to-authority policy, shared-service tenancy, or live worker interruption.

## Purpose and decision basis

The capstone distinguishes **provenance, fidelity, authority, and accountability** as independent trustworthiness properties.[1] The preceding assessment established that several SDK mechanisms implied stronger guarantees than their implementation actually provided. The approved P0 scope repairs those mechanisms only. This separation is deliberate: passing a hash check, policy check, or model-mediated review does not prove that an RTL or GDSII result could only have been derived from the intended requirement.[2]

| Property | P0 contribution | Deliberately not claimed |
|---|---|---|
| Provenance | Immutable write-occurrence records identify each governed mutable draft write. Variant worktrees are bound to an approved tag commit. | Requirement-to-artifact semantic derivation proof. |
| Accountability | Telemetry and audit verification now traverse whole ledgers; terminal SDK failures preserve bounded causal codes/details. | Detection of truncation/rollback by a storage operator without an externally retained checkpoint. |
| Confidentiality | A diff requires authorization for both content operands, except for a draft proven by the current task’s immutable occurrence. Interop forbidden-key matching normalizes common spelling variants. | Generic secret discovery in arbitrary values or content. |
| Availability | Model-facing regex matching has a strict process deadline and aggregate input budgets. Supervisor termination has a Windows-specific path. | Container/cgroup isolation, real EDA-resource control, or empirical Windows execution coverage. |

## Implemented guarantees

### 1. Content identity is separate from write occurrence

`ArtifactStore` retains `artifact_id = sha256(content)` for compatible deduplication, but it now persists immutable content blobs and a unique `ArtifactWriteOccurrence` for every registration. An occurrence contains its path, digest, kind, timestamp, and manifest. Thus two runs that write the same bytes retain two independently recoverable attribution records instead of overwriting one hash-named manifest.

The default governed `HarnessToolExecutor` supplies `run_id`, `node_id`, and `PlanTask.task_id` through `CoreToolServices.write_manifest`. This applies to `write_draft`, `edit_draft`, and `notebook_edit`; a custom registered handler still has precedence by design. A raw `ArtifactStore` or standalone `CoreToolDispatcher` remains a lower-level host API and does not falsely claim harness attribution.[3]

> **Invariant:** Every successful default governed mutable draft operation returns an occurrence ID whose immutable manifest names the executing run, node, and plan task.

### 2. Artifact diffs require both authorization boundaries

`diff_declared_artifacts` now requires that the base artifact be explicitly authorized in `PlanTask.authorized_artifact_ids`. Its draft side must either be explicitly authorized too or provide `draft_occurrence_id`. The latter is accepted only when the immutable occurrence proves that the draft’s content ID, declared output path, run ID, node ID, and task ID all match the executing context. An unrelated artifact cannot enter a diff simply because the other operand is authorized.[3]

This retains the legitimate plan-time limitation: a draft content hash does not exist until after it is written, so requiring it to be pre-listed would make an approved task unable to compare its own output.

### 3. “Verified” ledger integrity covers the complete stored chain

`TelemetryStore.iter_events()` pages through the complete ordered run sequence; `verify_run_chain()` uses that iterator rather than a single 1,000-event UI page. `create_run_report()` now derives `event_count`, `verified_event_count`, status summaries, and evidence hashes from all events at report generation time. `AuditTranscriptStore.iter_entries()` similarly streams the complete JSONL transcript, and a rendered review transcript declares both complete verified-entry count and bounded rendered-entry count.[4]

The check is a **local-chain integrity verification to the records present at its evaluation boundary**. It detects a malformed or modified suffix, including after event 1,000. A local hash chain alone cannot prove that a valid tail was deleted or that the underlying storage was rolled back; signed/exported checkpoints are a future assurance enhancement.

### 4. Terminal results carry bounded typed failures

`AgentResult.failure` and `ToolExecutionResult.failure` now carry `AgentFailure(code, message, details)`. The envelope preserves stable `AgentSdkError` classification for invalid provider turns, invalid tool arguments, and unknown verification gates, while keeping `reason` for compatibility. Details are redacted for secret-bearing and hidden-reasoning-like keys and are bounded to 2,048 serialized characters before being retained in a result.[5]

This is a causal-accountability improvement, not an assertion that all exceptions are safe to expose. Non-`AgentSdkError` host exceptions still retain existing bounded textual handling unless a host converts them to a typed SDK error.

### 5. Variant worktrees cannot misrepresent their approved base

`GitRepositoryAdapter.resolve_commit()` rejects option-like references, resolves a Git revision with `rev-parse --verify --end-of-options`, and returns the immutable commit ID. `SpecificationVersionService.create_variant_worktree()` now requires the requested `base_ref` and declared `specification_tag` to resolve to the same commit, creates the worktree from that resolved commit, and records both the supplied ref and resolved base commit in `VariantWorktreeRecord` v2.[6]

This repair addresses provenance integrity. Git remains invoked with an argument vector, so the original finding was **not** a shell-injection claim.

### 6. Model-facing regex work has enforceable resource limits

Python’s standard `re` supports backtracking syntax, so P0 preserves compatibility but runs each model-facing grep in an isolated child process. The parent enforces `max_grep_seconds` (default 2 seconds), terminates a worker that exceeds it, and returns a stable `GREP_REGEX_TIMEOUT` error. It also bounds candidate files (`max_grep_files`, default 500), per-file size (`max_read_bytes`), and total scanned bytes (`max_grep_total_bytes`, default 4 MB); outputs declare `scan_truncated` when an aggregate budget stops file admission.[7]

CWE-1333 identifies inefficient, potentially exponential regular-expression complexity as a CPU availability risk and recommends non-backtracking engines, execution limits, and input limits.[8] The process boundary provides an enforceable timeout without silently changing documented Python regex syntax. It does not make all regex patterns safe, and its creation overhead should be measured before any high-frequency use.

### 7. Interop sanitizer canonicalizes spelling variants

Interop projections now canonicalize camel case, snake case, kebab case, spacing, punctuation, and case before forbidden-key comparison. Therefore `privateKey`, `private_key`, `private-key`, and `PRIVATEKEY` all fail the same boundary check, as do variants of approval and capability tokens. This is a key-policy guard, not an entropy-based credential detector.[9]

### 8. Supervisor has a platform-specific termination route

On POSIX, a registered command starts in a session/process group and terminates through `SIGTERM` then `SIGKILL` if required. On Windows, the launcher uses `CREATE_NEW_PROCESS_GROUP`, and timeout/cancellation invokes `taskkill /PID <pid> /T /F` through an argument vector. Every supported timeout/cancellation path continues to construct a typed `ProcessExecutionRecord` and watchdog event even if the termination command reports an unsuccessful path.[10]

The Windows branch is implementation-covered but **not empirically executed in this Linux release validation**. A Windows CI smoke test must verify the documented tree-termination behavior before the project claims platform-test coverage.

## Regression evidence

The focused P0 suite covers governed write attribution, two same-content writes, both-side diff authorization, current-task draft proof, complete 1,001-entry telemetry/audit verification, suffix tampering, typed failure envelopes, commit-base mismatch rejection, sanitizer variants, catastrophic regex timeout, aggregate scan truncation, POSIX cancellation records, and existing interop behavior.

| Validation | Result in this increment |
|---|---|
| Ruff format/check on changed modules and tests | Passed |
| Focused P0 invariant suite | Passed |
| Full SDK suite | **159 passed** |
| SDK quality inspection | Passed (`agent-sdk-dev quality .`) |
| Wheel and source distribution | Built successfully (`0.16.0`) |
| Repository engineering skill validation | Passed |
| Focused TypeScript MCP façade compilation | Passed |

## Deferred items

The P0 assessment remains authoritative on the deferred P1/P2 topics: decision-class authority policy, differentiated destructive-action policy, structured `SourceRef` state evidence, normative document admission, model-context evidence projection, semantic ambiguity/inconsistency/assumption analysis, multi-tenant MCP isolation, cooperative in-flight cancellation, CI/supply-chain automation, and governance-overhead measurement.[11]

## References

[1]: /home/ubuntu/upload/CA1Slides.pdf "EE4002R CA1 Deliverable, pp. 8–11: provenance, fidelity, authority, accountability, and evaluation framing"

[2]: /home/ubuntu/upload/CA1Slides.pdf "EE4002R CA1 Deliverable, pp. 5 and 10: derivation gap and semantic fidelity beyond metric/formal checks"

[3]: ../packages/agent-sdk/src/agent_sdk/artifacts.py "Immutable content and write-occurrence persistence"; ../packages/agent-sdk/src/agent_sdk/tool_registry.py "Governed manifest propagation and both-side diff authorization"; ../packages/agent-sdk/src/agent_sdk/core_tools.py "Mutable core-tool registration"

[4]: ../packages/agent-sdk/src/agent_sdk/telemetry.py "Complete telemetry iterator, verification, and reports"; ../packages/agent-sdk/src/agent_sdk/audit_log.py "Complete transcript iterator, verification, and rendered-count disclosure"

[5]: ../packages/agent-sdk/src/agent_sdk/contracts.py "AgentFailure, AgentResult, and ToolExecutionResult contracts"; ../packages/agent-sdk/src/agent_sdk/errors.py "Bounded redaction of failure details"; ../packages/agent-sdk/src/agent_sdk/base_agent.py "Typed terminal failure propagation"

[6]: ../packages/agent-sdk/src/agent_sdk/git_versioning.py "Commit resolution and approved-tag worktree binding"

[7]: ../packages/agent-sdk/src/agent_sdk/core_tools.py "Bounded regex worker and aggregate scan controls"

[8]: https://cwe.mitre.org/data/definitions/1333.html "CWE-1333: Inefficient Regular Expression Complexity"

[9]: ../packages/agent-sdk/src/agent_sdk/integrations/_utils.py "Canonical forbidden-key enforcement"; ../packages/agent-sdk/src/agent_sdk/integrations/langchain.py "Failure-envelope-compatible interop projection"

[10]: ../packages/agent-sdk/src/agent_sdk/supervisor.py "Platform-specific launch and termination paths"

[11]: /home/ubuntu/Downloads/trust-boundary-assessment-and-remediation-plan.md "P0/P1/P2 assessment, constraints, and next-step recommendation"; https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html "Structured separation, least privilege, and action controls for LLM systems"
