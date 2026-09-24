# Watchdog, Git Versioning, and Telemetry Implementation Record

**Status:** Implemented as `agent-design-agent-sdk` 0.4.0.
**Date:** 2026-09-23.
**Scope:** Local deterministic infrastructure only. No real model, EDA binary, remote Git operation, or research result was invoked or claimed.

## Delivered capabilities

### Deterministic watchdog boundary

`supervisor.py` now supervises only closed registered command templates. It streams combined process output into a bounded retained buffer while counting total bytes, avoiding the previous whole-output buffering followed by truncation. It records start/end time, monotonic duration, PID/PGID, return code, exit signal, termination path, output retention/truncation, retry attempt, and applied/unsupported POSIX limits. It starts commands in a separate process group and escalates from `SIGTERM` to `SIGKILL` after one second when necessary.

The supervisor emits a typed `ProcessExitKind`: `succeeded`, `exit-nonzero`, `timed-out`, `cancelled`, or `resource-limit`. `HarnessToolExecutor` now returns a typed **failed** tool result for all non-success outcomes. This corrects the prior semantic defect in which a timeout/cancellation/non-zero record was wrapped as a successful tool payload.

`AgentWatchdogPolicy` optionally bounds an agent run, model turn, and tool/hook call. It produces stable terminal reasons: `WATCHDOG_RUN_DEADLINE`, `WATCHDOG_MODEL_TIMEOUT`, and `WATCHDOG_TOOL_TIMEOUT`. `RetryPolicy` permits retries only for declared idempotent command operations and is conservative by default.

> The systems design calls for the harness—not the model—to act as deterministic watchdog; it locates mid-execution enforcement inside the EDA tool wrapper and requires time/resource limits, monitoring, and process-tree termination.[1]

The implementation enforces wall-clock and bounded-output limits everywhere. It can apply POSIX CPU, address-space, and file-size limits when supported, and reports unsupported enforcement explicitly. It does not claim cgroup/container containment, I/O quotas, or a real EDA manifest parser.

### Git versions, tags, and variant worktrees

`git_versioning.py` contains a narrow local Git adapter rather than a generic shell. It can inspect state, scoped diffs, local tags, and worktrees, create annotated local tags, and create a new worktree/branch. It intentionally has no remote, push, force-update, merge, delete-branch, delete-worktree, or arbitrary-command interface.

`SpecificationVersionService` validates plain `MAJOR.MINOR.PATCH`, calculates a deterministic diff-based classification, validates a required monotonic bump, validates a clean repository and unified-specification digest, creates and verifies an annotated local tag, and writes a lock record containing the Git repository path, `HEAD`, tree ID, tag object ID, Gate 1 hashes, classification, and attributable approval record. A tag is deleted if lock-record persistence fails. Variant worktrees require a different approved action and a pre-existing specification tag.

> The framework defines a version as `MAJOR.MINOR.PATCH`, binds versions to Git tags, changes to commits, and explorations to branches. It calls for `git diff` plus keyword/field analysis, a tag covering the whole specification state, and isolated worktrees for divergent variants selected by the designer.[2] [3] [4]

The service is restricted by the MCP server to repositories located under the configured runtime root. The lock and worktree APIs accept a structured `GitApproval` with an action, approver identifier, reason, approval identifier, and timestamp. A local tag/worktree is therefore never created from a bare Boolean request.

### Durable telemetry, statistics, and trace reports

`telemetry.py` provides an SQLite event ledger under `<run-root>/.agent-telemetry/telemetry.sqlite3`. Events receive a per-run monotonic sequence and canonical SHA-256 hash chain. They include UTC and monotonic times, actor, authority, correlation IDs, status, severity, evidence links, and structured payload. The schema rejects hidden-reasoning fields (`chain_of_thought`, `hidden_reasoning`, `reasoning_trace`, and `scratchpad`).

The SDK instruments BaseAgent lifecycle events, agent-run creation/termination, controller lifecycle, graph result/lateral dependency, provenance check, and watchdog lifecycle. `MetricDefinition` requires a formula, aggregation, missing-data rule, and source description. `MetricObservation` records a measured value or an explicit unavailable reason; the implementation does not manufacture model, EDA, PPA, or human-review data. `create_telemetry_report` emits a JSON report linked to ordered event hashes and observed metric availability.

The TypeScript MCP client and `/api/agent-runtime` routes expose run lists, ordered events, metric definitions/observations, metrics, reports, Git repository state, version classification, specification locks, and worktree creation. The existing frontend `TelemetryPanel` now reads the newest Python runtime trace and displays event count, integrity-chain result, up to three metric observations, and the last five structured events. The legacy backend telemetry store remains separate; the new view explicitly consumes runtime-owned telemetry.

> The project proposal calls for a Python telemetry sidecar to log HCR, tokens, and latency, review-gate branch structure, diagnostic EDA telemetry, and evaluation metrics comprising PPA drift, WNS gap, DRC/LVS clean rate, interface mismatch count, HCR, FPAR, average reflexion iterations, and downstream rework cost.[5] [6] [7]

These metrics are represented as definitions/observations but remain unavailable until corresponding real model, EDA parser, and designer-review events are recorded. This preserves the proposal’s traceability/accountability goal without turning a planned metric into a fabricated result.

## Validation performed

| Validation | Result |
|---|---|
| Python compile, Ruff, formatting, and SDK tests | Passed: **41 tests**. |
| New unit coverage | Passed: telemetry ordering/hash chain/report, hidden-reasoning rejection, bounded output, watchdog timeout telemetry, model-turn timeout, approved Git soft lock, variant worktree, and unapproved Git rejection. |
| Focused TypeScript compile of MCP client, runtime routes, and integration tests | Passed. |
| Live Streamable HTTP MCP integration | Passed against a temporary loopback runtime. It listed 40 tools, completed a scripted BaseAgent task, retrieved integrity-verified telemetry, created a trace report, and exercised controller/lateral graph flow. |
| Frontend whole-project TypeScript check | Blocked by pre-existing React 18/19/Lucide type incompatibilities in unrelated `AgentManager.tsx` components. The command reported no error in either modified runtime-telemetry frontend file. |

## Deliberate boundaries and next prerequisites

The implementation is **local only**. It does not push, delete, force-update, merge, or modify the main project repository in tests. It does not execute Verilator, Yosys, OpenROAD, or OpenSTA; commands remain registered templates requiring explicit future executable/environment/manifest policy. A real model identifier is still required before provider token/cost/latency fields can be populated. A later EDA adapter must parse report artifacts into normalized metric observations for WNS/TNS, area, power, congestion, IR drop, DRC/LVS, PVT context, tool version, and PPA drift. A later review UI must submit designer-specific draft/final artifacts before HCR and FPAR become valid observations.

## References

[1]: [Agent-Assisted Design Framework Systems Design, updated](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf), p. 54, lines 8–12; p. 55, lines 5–14.

[2]: [Agent-Assisted Design Framework Systems Design, updated](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf), p. 45, lines 4–13.

[3]: [Agent-Assisted Design Framework Systems Design, updated](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf), p. 46, lines 2–13.

[4]: [Agent-Assisted Design Framework Systems Design, updated](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf), p. 47, lines 2–16.

[5]: [Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators](/home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf), pp. 30–32, lines 59–99.

[6]: [Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators](/home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf), p. 33, lines 101–120.

[7]: [Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators](/home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent%20Collaboration%20in%20Logical%20to%20Physical%20Design%20of%20Decoupled%20RISC-V%20Matrix%20Accelerators.pdf), pp. 34–35, lines 123–150.
