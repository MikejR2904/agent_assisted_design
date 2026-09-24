# State-Based Working Memory Implementation Record

**Status:** Implemented and validated in `agent-design-agent-sdk` v0.6.0.
**Scope:** This increment adopts the attached state-based-memory proposal as the **normal BaseAgent working-memory model**. It does not select a real model provider, execute an EDA tool, expose raw result retrieval to an agent, or add Sandbox, Desktop, or SSH execution.

## Architectural decision

`ProjectState` is now the bounded working memory supplied to a model on every normal BaseAgent invocation. It records the current declared stage/schema, stage fields, artifacts, decisions, open questions, blockers, work items, last deterministic action, and step count. Every nontrivial state entry includes one or more bounded evidence references. The model context retains the immutable scoped task, declared tool contract, and provider continuation metadata, but it no longer receives prior `ModelObservation` payloads or episode summaries as normal working memory.

> Episodes, complete tool results, graph records, and telemetry are retained as **audit and recovery evidence**, not replayed as the model’s task memory.

This implements the proposal’s distinction between a current, explicit project state and a growing transcript. It is consistent with the systems design’s requirement that workers share typed graph state rather than conversations, and that episode state/compaction retain structural metadata rather than raw transcript replay.[1] [2] [3]

## Implemented state contract

| Element | Implemented representation | Update authority | Provenance requirement |
|---|---|---|---|
| Current stage | `StageStateSchema` and typed `StageStateField` entries | Controller or human for a stage change | Every declared stage field has `StateEvidence`; required field IDs are validated. |
| Artifact state | `ProjectArtifactState` | Harness reducer only, from an explicit `write_draft` result carrying `artifact_id` and `relative_path` | Tool-result journal handle. |
| Work status | `ProjectWorkItem` | Harness after terminal BaseAgent task; controller after graph-node terminal result | Agent-result or graph-result hash. |
| Decisions | `ProjectDecision` | Human transition only | Human-provided evidence ID and optional source spans. |
| Open questions | `OpenQuestion` | Harness-controlled question transition | Requirement/gap evidence. |
| Blockers | `ProjectBlocker` | Harness reducer for blocked tool outcomes | Tool-result journal handle. |
| Last action | `StateAction` | Harness reducer | Bounded status/error/output classification plus journal handle; no raw log. |
| Audit history | `ProjectStateEvent` | `FileProjectStateStore` | Hash chain over prior/current state hashes and transition evidence. |

`ProjectState` is bounded by typed collection limits, maximum decision/question content lengths, and a 4,096-character action-summary limit. `ProjectStateProjector` additionally applies an explicit per-turn `project_state_token_budget`: it retains mandatory current state plus newest artifacts/work items that fit, records omission counts in `ProjectStateView`, and returns an explicit `PROJECT_STATE_BUDGET_EXCEEDED` result when mandatory state alone cannot fit. A large tool payload is reduced to a 256-character deterministic state summary and an opaque evidence handle; the full payload remains in `ToolResultJournal`.

## Runtime behavior

1. BaseAgent derives a project ID from `task.scope.boundaries.project_id`, falling back to the scoped task ID, and loads/initializes current state with a declared stage from `task.scope.boundaries.stage` or `unclassified`.
2. Before each model call, `ContextProjector` still performs manifest-safe episode compaction for durable audit evidence and budget enforcement.
3. The `ModelContext` receives the immutable prompt, bounded `ProjectStateView`, budget metadata, and opaque provider continuation. Its normal `observations` and `episodes` sequences are empty by design.
4. Every executed or blocked tool call is journaled first, then mechanically reduced into a `StateTransition` by the harness. The model does not choose the state update.
5. A terminal agent result creates a work-item state update. Controller graph-node terminal results create an equivalent controller-owned work-item update.
6. `FileProjectStateStore` atomically persists current state plus revision-ordered events below `.agent-project-state/`; load verifies contiguous revisions, state-hash linkage, and event hashes.

The model still needs a later inference if the current state changes a decision. State-first memory removes historical replay from that inference; it does not remove the information dependency between an observation and a later judgment.[4]

## Public surfaces

The Python MCP server and TypeScript façade now expose the following project-state operations:

| Surface | Operations |
|---|---|
| Python MCP | `initialize_project_state`, `get_project_state`, `record_human_project_decision`, `open_project_question` |
| TypeScript client | `initializeProjectState`, `getProjectState`, `recordHumanProjectDecision`, `openProjectQuestion` |
| HTTP façade | `POST /api/agent-runtime/project-state`, `GET /api/agent-runtime/project-state/:projectId`, and decision/question subresources |

The HTTP/MCP identity boundary is not yet authenticated. Therefore `record_human_project_decision` is a semantic API contract, not proof that a caller is a verified human. Authentication and authorization must be added before exposing this surface outside the current trusted local runtime.

## Validation

Validation completed with:

```bash
cd packages/agent-sdk
uv lock
uv sync --all-groups
uv run ruff format src tests
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest

cd /tmp/agent-sdk-ts-interop
./node_modules/.bin/tsc -p tsconfig.json
AGENT_RUNTIME_MCP_URL=http://127.0.0.1:8011/mcp \
  ./node_modules/.bin/tsx \
  /home/ubuntu/work/agent_assisted_design/packages/backend/tests/integration/batchedContextProjection.mcp.e2e.ts
```

The result was **56 passing Python tests**, clean Ruff formatting/linting, a focused TypeScript compile, and a live TypeScript-to-Python MCP test. Added coverage verifies state-only model contexts after tool calls, bounded large-output state summaries with complete journal retention, token-bounded state views and explicit state-budget exhaustion, human decision/question evidence requirements, stage-required fields, persistence across store reload, tamper detection for the state event chain, controller graph-result projection, MCP state tools, and the TypeScript client boundary.

## Explicit limitations and next work

This is a generic state kernel, not a claim that the minimal sufficient state schema for every ASIC stage has been discovered. Its `StageStateSchema` permits a caller to declare required fields, but it does not yet impose versioned minimum schemas for RTL, synthesis, placement, routing, STA, DRC/LVS, or signoff. It also does not yet resolve concurrent state revisions across multiple controller processes, provide authentication for human authority, or expose a governed `get_execution_result(handle, range)` tool for selective evidence access.

The most relevant next experiment is the proposal’s Q12: run controlled work with transcript-visible observations versus state-only contexts and measure output consistency, context tokens, tool-result repetition, drift/reconciliation findings, and attribution completeness. Those measurements are not claimed here because no real provider/model has been selected or run.

## References

[1]: /home/ubuntu/upload/pasted_content.txt "State-based working-memory proposal, lines 23–72"

[2]: /home/ubuntu/upload/pasted_content.txt "State update ownership and provenance rationale, lines 93–113"

[3]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 60, lines 2–19; p. 64, lines 2–21"

[4]: /home/ubuntu/work/agent_assisted_design/docs/execution-backends-and-tool-loop-assessment.md "Tool-loop information dependency and bounded execution assessment, lines 8–14"
