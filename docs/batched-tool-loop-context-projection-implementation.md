# Batched Tool Loop and Context Projection Implementation Record

**Status:** Implemented in `agent-design-agent-sdk` v0.5.0; the model-context behavior was superseded by state-first working memory in v0.6.0.
**Scope:** This increment corrects the BaseAgent tool-loop context-growth gap. It does not add a real model provider, Sandbox, Desktop, SSH, credentials, or arbitrary shell execution.

> **v0.6.0 update:** Batching, journals, compaction, protected evidence, and provider-continuation interfaces remain implemented. Normal BaseAgent model calls now receive `ProjectState` rather than projected tool observations or episode summaries. See the [state-based memory implementation record](state-based-memory-implementation.md).

## Result

The BaseAgent now accepts either its backward-compatible single `tool-call` response or a new `tool-batch` response. A batch contains correlated call identifiers and explicit `depends_on_call_ids`. The contract validates unique call identifiers, known dependencies, self-dependency rejection, and acyclicity before the runtime schedules anything. Calls whose prerequisites have not completed do not become runnable. Calls that depend on a non-successful prerequisite become blocked without execution.

The scheduler enforces each declared tool’s `concurrency` setting. A ready `parallel-safe` set is executed concurrently. Any ready `serial` call runs alone. Returned observations preserve the original model-request order even when the executor completes concurrent calls in another order. This provides deterministic correlation while avoiding unnecessary sequential latency for independent read-only operations. The model still needs a later inference only when a result changes the next decision; a fixed probe may remain one deterministic tool operation.[1] [2]

The runtime no longer places a complete `ToolExecutionResult` directly into every later model context. It writes the full typed request/result payload to `ToolResultJournal`, then provides the model a `ProjectedToolResult`. The projected form contains the status, a bounded preview, a truncated error summary, and an opaque handle with content hash and byte count. `FileToolResultJournal` persists full results atomically below `.agent-tool-results/`; the default in-memory journal supports one task invocation and controlled tests. The handle is evidence metadata, not a secret or a model instruction.

Before every model invocation, `ContextProjector` compacts the typed episode store and produces a bounded view. The model context contains the original immutable prompt, non-compacted episode summaries, selected recent projected observations, a `ContextProjectionMetadata` record, and optional opaque provider continuation. The projection counts serialized data with a conservative deterministic estimate. It omits observations whose associated episodes were compacted and omits older observations that would exceed the configured context budget. A fresh batch’s episode identifiers are protected through the immediately following model call, so the agent retains causal evidence needed to decide its next action.

The existing compaction behavior was corrected so a compacted tombstone does not consume active-context token budget. The store now distinguishes `protected-over-budget` from `context-deadlock`. The former means only fresh protected evidence exceeds the configured episode budget, and the runtime retains it for the next decision. The latter means required retained evidence cannot be safely evicted. BaseAgent terminates with `CONTEXT_DEADLOCK` rather than discard that evidence. EDA action episodes remain protected by the pre-existing manifest-completeness rule.[3]

`ProviderContinuation` and `ModelTurnResponse` are now part of the model interface. A provider adapter may return opaque continuation state, such as provider-native response/session/compaction material. BaseAgent forwards it unchanged to the next model context and does not interpret it. This is intentionally an interface only until the project owner selects a real provider/model.

## Changed interfaces

| Component | Change | Deterministic boundary |
|---|---|---|
| `ToolDefinition` | Added `concurrency`: `serial` or `parallel-safe`; defaults to `serial`. | The developer/agent definition, not a model, states whether a tool may overlap other ready calls. |
| `ToolCall` | Added `depends_on_call_ids`. | The model may state dependencies, but the contract validates them before scheduling. |
| `ToolBatchTurn` | Added typed multi-call model turn. | Unknown/cyclic dependencies fail validation before execution. |
| `ToolResultJournal` | Added full-result persistence interface and in-memory/file implementations. | Complete evidence is retained outside the provider prompt. |
| `ProjectedToolResult` | Added bounded observation payload and opaque `ToolResultHandle`. | Preview size is controlled by policy; full result is addressable through a handle. |
| `ContextProjector` | Added pre-turn compaction and context budgeting. | The context view is assembled deterministically; it is not LLM-generated. |
| `ModelContext` | Added `projection` and `continuation`. | Provider continuation remains opaque to BaseAgent. |
| `RuntimeOptions` | Added `context_token_budget`, `episode_token_budget`, and `tool_result_preview_chars`. | The MCP deterministic test path accepts these bounds. |

## Validation

The Python SDK was locked, synchronized, formatted, linted, and tested with:

```bash
uv lock
uv sync --all-groups
uv run ruff format src tests
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
```

The result was **49 passing tests**. New coverage verifies concurrent `parallel-safe` calls, serial dependency fan-in, contract rejection of unknown/cyclic dependencies, bounded large-result previews with retrievable full journal evidence, removal of compacted old observations while retaining fresh protected evidence, opaque continuation forwarding, protected-over-budget handling, and MCP execution with projected batch runtime options.

## Scope limits

This increment does not select or call a model. `ScriptedModel` remains the only model used in tests. It also does not expose journal retrieval as an agent tool, and it does not implement a provider-specific continuation protocol. A real provider adapter must map this neutral interface to the provider’s required tool-call/result messages or response lineage. The planned Sandbox, Desktop, and SSH backends must use this result-journal/projection boundary rather than introduce raw shell output into the active model context.

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 61, lines 2–16"

[2]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use "Parallel tool use — Claude Platform"

[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, pp. 62–64, lines 2–14 and 2–21"

[4]: https://developers.openai.com/api/docs/guides/function-calling "Function calling — OpenAI API"
