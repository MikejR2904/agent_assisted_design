# SDK Extensibility and Runtime Profiler Implementation Record

**Status:** Implemented in `agent-design-agent-sdk` v0.7.0.
**Scope:** This increment turns the existing source-distributed package into a clearer reusable Python SDK surface. It adds local callback-based verification gates, a structured runtime profiler, consumer package metadata, a runnable example, and public exports. It does **not** publish to PyPI, supply a real model adapter, or permit arbitrary Python callbacks through MCP/HTTP.

## Audit conclusion

The prior package was technically buildable and exported `BaseAgent`, but it was only **partly usable by an external consumer**. Its `VerificationGateRegistry` contained two hard-coded gates and no registration API. The existing telemetry ledger recorded events and metrics, but no public object profiled the SDK-side duration of context construction, a model turn, a tool call, and a verification gate as one coherent run. The README also lacked an installation command and a minimal extension example.

The new extension APIs preserve the harness-owned control boundary. This matters because the system design places lifecycle policy, auditing, post-result handling, and watchdog enforcement in deterministic harness components rather than in model-selected code.[1] A state entry and its result must remain attributable to a tool, a human decision, or a deterministic controller action.[2]

## Public API additions

| Public type or method | Purpose | Boundary |
|---|---|---|
| `VerificationGateRegistry.register()` | Registers a named gate object implementing `verify(context)`. | Host process only. |
| `VerificationGateRegistry.register_callable()` | Registers a sync or async local callback with fixed `*args` and `**kwargs`. | Host process only; not MCP serializable. |
| `VerificationContext` | Read-only candidate output, definition, and scoped task passed to a gate. | Callback input. |
| `VerificationDecision` | Explicit acceptance/rejection with optional reason. | Callback output. |
| `AgentWatchdogPolicy.verification_timeout_seconds` | Bounds an async or sync-wrapped verification callback through the BaseAgent watchdog path. | Runtime policy. |
| `AgentRunProfiler` | Produces a hash-identified profile for one invocation. | Consumer-owned optional dependency. |
| `AgentResult.profile` | Returns the completed profile as a serializable dictionary. | Result reporting. |
| `AgentRunProfiler.write_json()` | Atomically writes a completed profile to a consumer-selected path. | Consumer storage. |

A callback receives `VerificationContext` as its first positional value. It may return `VerificationDecision`, `bool`, or `(bool, reason)`. The registry normalizes that value, and BaseAgent treats an invalid return, raised exception, unknown gate ID, or watchdog timeout as terminal verification failure. JSON-schema output validation still occurs before any custom gate invocation.

> A model only names `verification_gate_id` in the static agent definition. It cannot register, replace, configure, or invoke arbitrary host Python functions.

This separation is intentional. The callback’s code and arguments are local process configuration. They are not placed in the agent definition, MCP payload, model context, telemetry payload, or profiler record.

## Profiler contract

`AgentRunProfiler` records observable SDK phases only. Its profile contains monotonic wall duration, process CPU duration, phase summaries, and bounded spans for the overall run, context projection, model turn, tool call, and verification. Each span has a status (`completed`, `failed`, `blocked`, `cancelled`, or `timed-out`) and a bounded identifier/outcome attribute map.

The profiler rejects hidden-reasoning field names and does not accept prompts, raw tool results, model responses, or provider internal traces as profile attributes. BaseAgent emits a compact `agent.profile-completed` telemetry event with the profile integrity hash, durations, and phase counts. This is compatible with the project proposal’s requirement to gather traceable observed facts for later analysis without claiming unavailable model, PPA, or human-correction measurements.[3] [4]

## Consumer installation and example

The package now identifies its MIT license, author, Python version, project URLs, classifiers, and source-distribution intent in `pyproject.toml`. A package-local `LICENSE` is included for distribution. It remains unpublished to PyPI. Consumers may install `./packages/agent-sdk` from a checkout or install the Git subdirectory.

The runnable [`custom_verification_and_profiling.py`](../packages/agent-sdk/examples/custom_verification_and_profiling.py) example creates a named callback gate, supplies a local argument, injects `AgentRunProfiler`, runs one deterministic demonstration, and atomically writes `agent-run-profile.json`. It uses `ScriptedModel` solely for reproducibility; an external deployment must supply its own `AgentModel` provider adapter.

## Validation

The implementation adds tests for a consumer async callback with fixed arguments, terminal rejection, watchdog timeout, duplicate/invalid registry configuration, profile-span integrity, profile JSON export, hidden-reasoning rejection, and telemetry profile-summary emission. The final Python suite contains **62 passing tests**. Existing BaseAgent, MCP, controller, tool, state-memory, and telemetry tests remain part of the full suite.

## Deliberate limitations

Custom callback gates execute in the host Python process and are therefore trusted local code. They are not sandboxed and cannot be registered through MCP/HTTP. A future network extension would require authenticated gate packages or signed manifests, a restricted execution environment, deterministic configuration serialization, and an explicit approval/policy model. Those mechanisms are not claimed here.

The profiler measures SDK process time and elapsed time. It cannot infer provider token counts, remote model queue time, external EDA CPU/memory consumption, PPA quality, or design correctness. Those remain unavailable until their corresponding tools, parsers, and observations are integrated.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 55, lines 2–14"

[2]: /home/ubuntu/upload/pasted_content.txt "State update ownership and provenance rationale, lines 93–113"

[3]: /home/ubuntu/projects/agent-assisted-design-172ab82b/Human-Agent Collaboration in Logical to Physical Design of Decoupled RISC-V Matrix Accelerators.pdf "Human-Agent Collaboration proposal, pp. 30–35, telemetry and evaluation-measurement commitments"

[4]: /home/ubuntu/work/agent_assisted_design/packages/agent-sdk/src/agent_sdk/telemetry.py "Telemetry event privacy, integrity-chain, metric, and report contract"
