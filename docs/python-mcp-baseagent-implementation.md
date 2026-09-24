# Python MCP BaseAgent Implementation Record

**Status:** Implemented and validated with a deterministic model adapter.
**Repository baseline:** `dc466362d97c659293a587d511de1f174f2818ae`
**Implementation boundary:** Python owns the BaseAgent runtime. The existing TypeScript backend owns its HTTP/UI-facing boundary and forwards agent-runtime requests through a standard MCP client. The legacy backend `Agent` class remains unchanged.

## Result

The former uncommitted TypeScript BaseAgent prototype was removed and `packages/agent-sdk` was recreated as a Python package. The new Python runtime implements the project’s BaseAgent contract. Each invocation accepts one typed scoped task, deterministically creates initial context, permits only declared tools, records task-local episode memory, stops under a bounded policy, validates untrusted candidate output, and runs an optional deterministic verification gate before returning `completed`.[1] [2]

The Python package serves three MCP tools at `http://127.0.0.1:8001/mcp` by default. `packages/backend/src/agent-runtime/PythonAgentRuntimeClient.ts` connects through the official TypeScript MCP SDK using Streamable HTTP. The backend mounts the corresponding deterministic HTTP façade at `/api/agent-runtime`. This fulfills the requested TypeScript-server-to-Python-server route without recreating the agent loop in TypeScript.[6] [7]

## Source-to-implementation traceability

| Framework or protocol requirement | Implemented artifact | Verified behaviour |
|---|---|---|
| Reasoning agents share BaseAgent contract; orchestration and contract-level gates are deterministic modules. | `packages/agent-sdk/src/agent_sdk/base_agent.py`, `packages/backend/src/agent-runtime/PythonAgentRuntimeClient.ts` | Python owns BaseAgent execution. TypeScript is an MCP client and HTTP façade, not a duplicate agent runtime. [1] |
| One task per BaseAgent invocation; identity, versioned instructions, typed input/output, narrow tools, model binding, memory, termination, and verification fields. | `contracts.py` Pydantic models | Contract construction rejects invalid identity, invalid JSON Schema, duplicate tools, invalid caps, and cross-session memory without a reason. [2] |
| Deterministic context assembly orders identity/instructions, scoped locked task fields, skills, and only declared tools. | `context.py` | Tests assert the exact five-section order and verify that subsequent mutation of the task’s locked interface cannot mutate context. [3] |
| Pre/post hooks cover policy/audit/result handling; tool wrappers own resource limits and process cancellation. | `base_agent.py`, `tools.py` | Tests prove ordered hooks and policy blocking before dispatch. No unsupported EDA-supervision claim is made. [5] |
| Task-scoped memory is a typed episode graph of exploratory/action nodes with action-to-exploratory dependencies only. | `episodes.py` | Tests reject action-to-action dependencies and unknown references. [4] |
| Output is accepted only after the loop, output schema validation, and deterministic gate. | `base_agent.py`, `verification.py` | Tests show that malformed output exhausts its bounded retry budget and that gate rejection never becomes success. [2] |
| MCP semantics are independent of transport; Streamable HTTP carries MCP JSON-RPC over one endpoint. | `mcp_server.py`, `PythonAgentRuntimeClient.ts` | Live Python service and TypeScript client passed tool discovery, definition validation, and task execution over `http://127.0.0.1:8011/mcp`. [7] |

## MCP public surface

| MCP tool | Contract | Runtime scope |
|---|---|---|
| `validate_agent_definition` | Validates the Python-owned Pydantic BaseAgent definition. | Stateless validation only. |
| `assemble_initial_context` | Produces the specified deterministic context view. | No model call or tool side effect. |
| `run_agent_task` | Runs one scoped task and returns `AgentResult`. | The initial mode accepts only deterministic scripted turns. |

The service uses the official Python SDK’s typed tool decorator. The SDK derives the MCP tool schema from the Python function signatures and provides an in-memory `Client` for server tests.[8] [9]

## Validation evidence

| Layer | Command | Result |
|---|---|---|
| Python static compilation | `uv run python -m compileall -q src` | Passed. |
| Python lint | `uv run ruff check src tests` | Passed. |
| Python unit and in-memory MCP tests | `uv run pytest` | Passed: **11 tests**. |
| TypeScript client compilation | Isolated TypeScript harness `tsc -p tsconfig.json` against the new client and integration script | Passed. |
| Live cross-language MCP | Started Python server at `127.0.0.1:8011`; ran TypeScript integration script through `tsx` | Passed: it discovered all three tools and returned `completed` with `{"status":"complete","findings":["ready is preserved"]}`. |

The deterministic MCP integration does **not** claim an LLM solved the task. It establishes that a typed task and typed outcome traverse the real TypeScript → MCP → Python → MCP → TypeScript boundary. The only current model adapter is `ScriptedModel`, which intentionally returns supplied deterministic turns.

## Known workspace limitation

A full backend project compile remains blocked by pre-existing workspace setup. The clone initially lacked the ignored Kiota workspace required by a `workspace:*` backend dependency. Restoring the matching Kiota source exposed stale lockfile metadata. A non-lockfile installation then reached the backend’s native `better-sqlite3` build, which fails in this sandbox because no C compiler (`cc`) is installed. Direct backend compilation also lacks built output for `@agent_design/shared` and the Kiota fetch package. These baseline failures are independent of the Python MCP changes. The new TypeScript MCP client itself was compiled in an isolated harness and executed successfully against the Python runtime.

## Real-model integration: pending model identifier

The project owner selected a real-model integration but will provide the model identifier. The implementation deliberately does not guess a provider or issue a billable request. Once the identifier is supplied, the next patch will add a Python-owned OpenAI-compatible adapter driven by `model_binding`. Its opt-in integration test will record the exact model identifier, task hash, structured task, tool trace, candidate output, deterministic gate decision, and terminal result. A failed model response will remain an auditable failed result rather than being silently converted to success.

## Remaining deliberate non-goals

This increment does not add a persistent cross-session episode store, real EDA tool wrapper, public MCP exposure, MCP authorization, graph-level orchestrator, human approval UI, or migration of the legacy TypeScript `Agent`. Each would change a different boundary and needs independently scoped approval. The framework explicitly assigns inter-agent transfer to typed state via a graph rather than shared conversation and assigns EDA watchdog responsibilities to the execution layer.[5] [10]

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 50, lines 4–14"
[2]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 51, lines 2–20"
[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 61, lines 2–13"
[4]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 62, lines 2–14"
[5]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 55, lines 2–14"
[6]: https://modelcontextprotocol.io/docs/2026-07-28/sdk "Model Context Protocol: official SDKs"
[7]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports "Model Context Protocol specification: transports"
[8]: https://py.sdk.modelcontextprotocol.io/ "MCP Python SDK v2: typed MCP server tools"
[9]: https://py.sdk.modelcontextprotocol.io/get-started/testing/ "MCP Python SDK: in-memory server testing"
[10]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 60, lines 2–19"
