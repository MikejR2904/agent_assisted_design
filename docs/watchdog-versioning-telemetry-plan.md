# Watchdog, Git Versioning, and Telemetry Implementation Plan

**Status:** Implemented on 2026-09-23; see `docs/watchdog-versioning-telemetry-implementation.md`.
**Scope:** Complete the missing deterministic watchdog boundary, implement Git-backed specification versioning and variant workspaces, and add durable trace/telemetry/reporting facilities. This plan extends `agent-design-agent-sdk` 0.3.0 without selecting a real model or executing a real EDA flow.

## Audit conclusion

The current package includes a **partial process supervisor**, not the watchdog described in the system design. `ProcessSupervisor` accepts only registered command templates, launches them in a new session, applies a wall-clock timeout, and sends `SIGTERM` then `SIGKILL` to the process group. It records command identity, return code, combined output, timeout, and cancellation state. This implements a useful baseline for a managed subprocess.[1]

It does not yet implement the described tool-layer watchdog completely. The design requires the EDA wrapper to enforce **time and resource limits**, monitor execution, and terminate the process tree, while hooks remain deterministic interception points rather than the kill mechanism.[2] Current shortcomings include unbounded `communicate()` buffering before output truncation, no CPU/RSS/disk/process-count enforcement, no active deadline for a model turn or a non-process tool, no bounded EDA retry policy, no durable supervisor audit stream, and no deterministic failure mapping for a timeout/cancellation/non-zero process result. The tool registry currently returns a successful `ToolExecutionResult` whenever `ProcessSupervisor.execute()` returns a record, including a record marked timed out or cancelled.[3]

The current Gate 1 implementation writes version metadata and validates a soft lock, but it does **not** invoke Git. The system design requires semantic versions, Git tags for complete soft-locked specifications, commits for changes, branches for exploration, `git diff` plus field/keyword analysis for classification, and separately rooted Git worktrees for divergent variants.[4] [5] [6]

The package has source hashes, graph/controller events, artifacts, and provenance records, but it does **not** have durable cross-layer telemetry or a report/dashboard. The research proposal explicitly calls for a Python telemetry sidecar recording HCR, tokens, and latency; a review-gate branch structure; diagnostic EDA telemetry; and evaluation metrics including PPA drift, WNS gap, DRC/LVS clean rate, interface mismatch count, HCR, FPAR, reflexion iterations, and downstream rework cost.[7] [8] [9] [10]

## Recommended scope and decisions

This increment should use a **local, durable, queryable telemetry store** under the configured run root, implemented with SQLite plus content-addressed log/report artifacts. SQLite is included with Python, provides atomic transactions, and avoids adding an external service before the system has real model/EDA runs. Raw process logs remain bounded artifacts; event rows retain only hashes, pointers, redacted structured facts, and metrics.

Git support should default to **local-only repository mutation**. The SDK will use a narrow Git adapter rather than a generic shell capability. It will not push, force-update, delete branches, delete worktrees, or modify the project’s current repository during unit tests. Tests will create disposable temporary repositories. Any eventual create-commit/tag/branch/worktree action against a configured repository will be a capability-gated, attributable operation requiring explicit approval. Remote push must remain a separate, explicit operation.

The existing frontend should receive a **read-only trace and metrics view** backed by TypeScript HTTP routes that forward to Python MCP. It will show run summaries, ordered event traces, approval and provenance links, model/tool timing, watchdog interventions, artifact/log references, EDA measurement rows when they exist, and report download/reference links. It will not display hidden model reasoning. Live display will contain safe lifecycle/status events and approved visible outputs only.

## Architecture to implement

### 1. Watchdog and EDA-execution contract

A new `WatchdogController` will own a typed operation state machine: `registered`, `started`, `sampled`, `retry-wait`, `terminated`, `completed`, `failed`, `cancelled`, and `resource-limited`. Every watched operation receives a correlation tuple of `run_id`, `node_id`, `task_id`, `tool_call_id`, and `attempt`.

`ProcessSupervisor` will be upgraded to stream stdout/stderr through a bounded ring buffer or bounded spool file rather than buffering the complete stream. Its `ProcessExecutionRecord` will gain start/end timestamps, monotonic duration, PID/PGID, exit signal/return code, output byte count, truncation count, termination path, and resource samples. A deterministic mapper will convert non-zero exits, timeouts, cancellation, resource violations, and policy violations into stable tool failure codes rather than success payloads.

For Linux-hosted EDA processes, the implementation will define an optional resource-enforcement adapter. It will enforce the portable wall-clock and output limits in all tests. CPU/RSS/process-count/I/O limits will be designed behind an interface and only activated where cgroup v2 and the configured execution environment permit it. The design will expose an explicit `unsupported`/`not-enforced` state rather than falsely reporting containment.

A typed `RetryPolicy` will govern only declared retry-safe operations. It will define maximum attempts, retryable failure codes, backoff, idempotency, and required approval for mutating retries. The initial policy will not retry draft writes, Git mutations, or physical-flow actions automatically.

### 2. Git-backed specification versions and variants

A new `GitRepositoryAdapter` will expose separated read-only and mutating operations. Read-only operations will resolve repository identity, `HEAD`, status, commit/tree IDs, tags, branches, worktrees, and a scoped `git diff`. Mutating operations will include commit, annotated tag, branch, worktree creation, merge, checkout, and removal as distinct capabilities—not one broad Git permission.

`SpecificationVersionService` will validate `MAJOR.MINOR.PATCH`, resolve the previous approved lock, calculate the structured specification difference plus Git diff, and apply the supplied major/minor/patch trigger matrix. It will require the candidate metadata, version, source digest, repository identity, and Git `HEAD` to agree before tagging.[4] [5]

Soft lock will become an approval-gated transaction. The service will validate fresh Gate 1 outputs; create an immutable handover directory; create and verify an annotated local tag that captures the complete specification state; then persist a lock record with pre/post commit IDs, tree ID, tag object ID, source digest, approval record, gap-waiver record if used, and artifact hashes. A failed operation must not claim a completed lock.

`VariantWorkspaceService` will create named Git worktrees on designer-selected branches. It will record the branch, `HEAD`, specification tag, base version, and variant purpose. Promotion/merge, destructive branch/worktree removal, tag replacement, and remote push will remain separate privileged operations. This follows the design’s instruction that divergent variants may be kept in separate worktrees and that the designer chooses which is main/release versus a feature/feasibility branch.[6]

### 3. Durable telemetry, logs, metrics, and reports

A versioned `TelemetryEvent` envelope will be appended transactionally to the local SQLite store. Each event will include the following classes of fields:

| Field group | Required content |
|---|---|
| Identity and order | Event ID, schema version, UTC and monotonic time, ordered sequence, run/controller/node/task/attempt IDs, trace/span/parent-span IDs. |
| Decision authority | System, model, human, or tool actor; actor/role identifier; authority mode; applied policy/approval identifiers. |
| Evidence links | Specification snapshot/version/source spans, Git commit/tag/worktree, artifact IDs/hashes, tool records, provenance records, and predecessor-event hash. |
| Execution status | Stage, event type, stable status/failure code, retry lineage, duration, and diagnostic summary. |
| Integrity and privacy | Canonical payload hash, hash-chain predecessor, classification/redaction flag, and log/artifact pointer. |

The initial event families will cover run/controller/graph lifecycle; agent/task context; model request/completion/failure/fallback/output rejection; approval/review; tool policy/request/start/termination/exit; watchdog samples/interventions; artifact creation; provenance validation; Git version/worktree actions; and report production. Model telemetry will record provider/model/version, request/response identifiers where permitted, token fields supplied by the eventual provider, latency, fallback index, and sanitized input/output artifact hashes. It will never request or store hidden chain-of-thought.

`MetricDefinition` and `MetricObservation` will preserve a metric’s formula, unit, direction, numerator/denominator, aggregation rule, missing-data rule, source event/artifact, parser version, context such as PVT corner/workload, and measured value. No metric will be fabricated: absent real EDA/model/human-review inputs will appear as unavailable with their reason.

The initial registry will support the proposal’s measurable fields: execution latency, tokens, retry/reflexion count; HCR through an explicitly versioned agent-draft-to-approved-artifact diff; FPAR with a documented eligible-task denominator; interface mismatch count; EDA WNS/TNS, area, power, utilization, congestion, DRC/LVS when parsers are introduced; PPA drift against a versioned target/tolerance; downstream rework duration; and fault-attribution latency.[7] [8] [9] [10]

A `RunReportService` will produce traceability reports, watchdog/tool summaries, human-review summaries, metric completeness reports, and cohort/ablation reports only when observed data permits. The report will carry the event/metric schema versions and hashes of its raw evidence. Statistical comparisons will remain unavailable until a real experiment manifest supplies conditions, baselines, replicates, seeds, inclusion/exclusion rules, and the predeclared metric definitions.[11]

### 4. MCP, backend, and frontend observability surface

Python MCP tools will provide list/get APIs for runs, event pages, event details, log artifact references, metrics, reports, Git repository state, version classification, Gate 1 lock candidates, and variant worktrees. Mutating Git operations will require typed capability approval and return the recorded approval/evidence identifiers.

The TypeScript MCP client and backend will expose read-only HTTP routes for trace browsing and aggregated statistics. It will also expose approval-request routes for a human to inspect exact Git action payloads before a mutation. The frontend will add a read-only telemetry view with filtering by run, agent, node, task, stage, status, watchdog intervention, model, tool, and Git/version; a trace timeline; a metric table with availability/completeness; and artifact/log links.

### 5. Test and validation plan

The test suite will use controlled fake models, fake tool executors, fixture processes, and temporary Git repositories. It will verify bounded output streaming, timeout, cancellation, SIGTERM-to-SIGKILL escalation, non-zero status mapping, retry caps, stable telemetry order/hash chain, no hidden reasoning persistence, atomic event/query behavior, HCR denominator logic, metric missingness, Git diff classification, SemVer rejection, tag creation/verification, tag-failure recovery, worktree isolation, approval enforcement, and read-only frontend/API data contracts.

A live integration test will use only a temporary local Git repository and a harmless controlled subprocess. It will demonstrate an approval-gated local version lock, branch/worktree creation, a supervised timeout/non-zero process mapping, durable telemetry capture, and a report populated from observed test events. It will not push or mutate the project repository.

## Implementation order

1. Correct the supervisor failure mapping and bounded-output behavior before exposing metrics, because otherwise timeout/failure statistics would be semantically wrong.
2. Add the telemetry event store, correlation propagation, artifact pointers, and read APIs. Instrument existing deterministic BaseAgent, controller, graph, approval, policy, artifact, provenance, and supervisor paths.
3. Implement the Git adapter, SemVer classifier, soft-lock transaction, and variant workspaces with temporary-repository tests.
4. Add metric registry, HCR/review capture primitives, report generation, MCP/backend routes, and the read-only frontend observability view.
5. Run unit, integration, packaging, TypeScript compilation, and temporary-repository live validation; publish a source-grounded implementation record listing any environmental limits.

## Explicit non-goals for this increment

This work will not configure a real model, call a real EDA tool, push to any remote, modify the current project repository’s tags/branches/worktrees, invent PPA values, or generate statistical claims from synthetic data. It will build the instrumentation and analysis substrate so real future runs can be traced and analyzed.

## References

[1]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/supervisor.py "Current registered-command process supervisor, lines 15–98"
[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 55, lines 5–14"
[3]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/tool_registry.py "Current registered process-tool result mapping, lines 118–184"
[4]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 45, lines 2–13"
[5]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 46, lines 2–13"
[6]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 47, lines 2–16"
[7]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration proposal, p. 30, lines 59–70; p. 31, lines 76–87"
[8]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration proposal, p. 32, lines 89–99"
[9]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration proposal, p. 33, lines 101–120"
[10]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration proposal, pp. 34–35, lines 123–150"
[11]: /home/ubuntu/upload/CA1Slides.pdf "CA1 Slides, p. 10, Question 4; p. 8, provenance, fidelity, authority, and accountability"
