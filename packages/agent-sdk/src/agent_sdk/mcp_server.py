"""MCP server exposing the Python BaseAgent and deterministic harness to TypeScript."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

if TYPE_CHECKING:
    from mcp.server import MCPServer

from .audit_log import AuditTranscriptStore
from .base_agent import AgentWatchdogPolicy, BaseAgent
from .context import assemble_initial_context
from .context_projection import ContextProjectionPolicy
from .context_selection import DesignStage, TaskAwareContextSelector
from .contracts import AgentDefinition, RuntimeOptions, ScopedAgentTask
from .controller_runtime import ControllerRuntime
from .coordination import HarnessCoordinator
from .git_versioning import (
    GitApproval,
    GitRepositoryAdapter,
    SpecificationVersionService,
)
from .graph import GraphNodeResult
from .metrics import register_standard_metric_definitions
from .model import ScriptedModel
from .orchestration import ComplexityRoutingRules, GapMetadata, SkillToolProfile
from .orchestrator import OrchestrationPolicy, OrchestrationRequest, Orchestrator
from .planning import Plan, PlanValidator
from .project_state import (
    FileProjectStateStore,
    ProjectStateProjectionPolicy,
    QuestionOwner,
    StageStateSchema,
    StateAuthority,
    StateEvidence,
    StateTransition,
    StateTransitionKind,
)
from .shared_state import (
    ExploratoryDiscovery,
    LateralDependencyRequest,
    ProvenanceRecord,
    SharedSubstrateSnapshot,
)
from .specification_gate import (
    DependencyGraph,
    GapReport,
    Gate1ArtifactStore,
    SpecificationGate,
    UnifiedSpecification,
    VersionMetadata,
)
from .specifications import (
    DocumentTree,
    SpecificationCategory,
    SpecificationPreprocessor,
)
from .telemetry import (
    MetricDefinition,
    MetricObservation,
    TelemetryActor,
    TelemetryAuthority,
    TelemetryContext,
    TelemetryStore,
)
from .tools import InMemoryTaskToolExecutor

SERVER_NAME = "agent-design-python-runtime"
SERVER_VERSION = "0.16.1"


def _validation_errors(error: ValidationError) -> list[dict[str, Any]]:
    return [
        {
            "location": list(issue["loc"]),
            "message": issue["msg"],
            "type": issue["type"],
        }
        for issue in error.errors()
    ]


def create_mcp_server(run_root: Path | None = None) -> MCPServer:
    """Build the BaseAgent and typed harness MCP surface without a network listener."""

    # Defer MCP initialization so ordinary SDK imports do not create runtime
    # stores or require the optional server implementation.
    from mcp.server import MCPServer

    resolved_run_root = run_root or Path(os.environ.get("AGENT_RUNTIME_RUN_ROOT", ".agent-runtime"))
    coordinator = HarnessCoordinator(resolved_run_root)
    telemetry = TelemetryStore(resolved_run_root)
    register_standard_metric_definitions(telemetry)
    audit_logs = AuditTranscriptStore(resolved_run_root)
    project_states = FileProjectStateStore(resolved_run_root)
    controller_runtime = ControllerRuntime(resolved_run_root, telemetry=telemetry)
    orchestrators: dict[str, Orchestrator] = {}
    specification_root = Path(
        os.environ.get("AGENT_SPECIFICATION_ROOT", str(resolved_run_root / "specifications"))
    )
    preprocessor = SpecificationPreprocessor(specification_root)
    specification_gate = SpecificationGate()
    gate_store = Gate1ArtifactStore(specification_root)
    plan_validator = PlanValidator()
    versioning = SpecificationVersionService(resolved_run_root)

    def repository_for(relative_path: str) -> GitRepositoryAdapter:
        candidate = Path(relative_path)
        if candidate.is_absolute() or not relative_path.strip():
            raise ValueError(
                "Git repository paths must be non-empty and relative to the runtime root."
            )
        target = (resolved_run_root / candidate).resolve()
        try:
            target.relative_to(resolved_run_root.resolve())
        except ValueError as error:
            raise ValueError("Git repository path escapes the runtime root.") from error
        return GitRepositoryAdapter(target)

    def orchestration_for(orchestration_id: str) -> Orchestrator:
        """Recover a policy shell; executable worker bindings remain host-local."""

        if orchestration_id not in orchestrators:
            orchestrators[orchestration_id] = Orchestrator.resume(
                resolved_run_root,
                orchestration_id,
                controller_runtime=controller_runtime,
                telemetry=telemetry,
            )
        return orchestrators[orchestration_id]

    server = MCPServer(
        name=SERVER_NAME,
        version=SERVER_VERSION,
        instructions=(
            "Python implementation of the Agent-Assisted Design BaseAgent and deterministic "
            "typed-DAG harness. Agent coordination occurs only through typed graph state."
        ),
    )

    @server.tool(name="validate_agent_definition", structured_output=True)
    async def validate_agent_definition(definition: dict[str, Any]) -> dict[str, Any]:
        """Validate the serializable BaseAgent contract and return field-level errors."""

        try:
            parsed = AgentDefinition.model_validate(definition)
        except ValidationError as error:
            return {"ok": True, "valid": False, "errors": _validation_errors(error)}
        return {
            "ok": True,
            "valid": True,
            "definition": parsed.model_dump(mode="json"),
            "tool_names": [tool.name for tool in parsed.tools],
        }

    @server.tool(name="assemble_initial_context", structured_output=True)
    async def assemble_initial_context_tool(
        definition: dict[str, Any],
        task: dict[str, Any],
    ) -> dict[str, Any]:
        """Assemble context in deterministic BaseAgent order without model judgment."""

        try:
            parsed_definition = AgentDefinition.model_validate(definition)
            parsed_task = ScopedAgentTask.model_validate(task)
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        context = assemble_initial_context(parsed_definition, parsed_task)
        return {"ok": True, "context": context.model_dump(mode="json")}

    @server.tool(name="run_agent_task", structured_output=True)
    async def run_agent_task(
        definition: dict[str, Any],
        task: dict[str, Any],
        runtime_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Run one scoped BaseAgent task and return its typed result.

        Until the project owner supplies a real model identifier, runtime options
        accept only deterministic scripted turns. This does not claim model reasoning.
        """

        try:
            parsed_definition = AgentDefinition.model_validate(definition)
            parsed_task = ScopedAgentTask.model_validate(task)
            options = RuntimeOptions.model_validate(runtime_options or {})
            telemetry_context = TelemetryContext(
                run_id=parsed_task.id,
                task_id=parsed_task.id,
                agent_id=parsed_definition.identity,
            )
            telemetry.emit(
                "run.created",
                telemetry_context,
                actor=TelemetryActor(kind="system", identifier="mcp-runtime", role="runtime"),
                authority=TelemetryAuthority.DETERMINISTIC,
                status="started",
                payload={
                    "mode": options.mode,
                    "model_binding": parsed_definition.model_binding.model_dump(mode="json"),
                },
            )
            agent = BaseAgent(
                definition=parsed_definition,
                model=ScriptedModel(options.scripted_turns),
                tool_executor=InMemoryTaskToolExecutor(),
                watchdog_policy=AgentWatchdogPolicy(
                    run_deadline_seconds=options.run_deadline_seconds,
                    model_turn_timeout_seconds=options.model_turn_timeout_seconds,
                    tool_call_timeout_seconds=options.tool_call_timeout_seconds,
                    verification_timeout_seconds=options.verification_timeout_seconds,
                ),
                context_projection_policy=ContextProjectionPolicy(
                    **{
                        key: value
                        for key, value in {
                            "context_token_budget": options.context_token_budget,
                            "episode_token_budget": options.episode_token_budget,
                            "tool_result_preview_chars": options.tool_result_preview_chars,
                        }.items()
                        if value is not None
                    }
                ),
                project_state_projection_policy=ProjectStateProjectionPolicy(
                    **(
                        {"token_budget": options.project_state_token_budget}
                        if options.project_state_token_budget is not None
                        else {}
                    )
                ),
                project_state_store=project_states,
                telemetry=telemetry,
                telemetry_context=telemetry_context,
                audit_logs=audit_logs,
            )
            result = await agent.run(parsed_task)
            telemetry.emit(
                "run.completed" if result.status.value == "completed" else "run.terminated",
                telemetry_context,
                actor=TelemetryActor(kind="system", identifier="mcp-runtime", role="runtime"),
                authority=TelemetryAuthority.DETERMINISTIC,
                status=result.status.value,
                payload={"iterations": result.iterations, "reason": result.reason},
            )
            return {"ok": True, "result": result.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="initialize_project_state", structured_output=True)
    async def initialize_project_state(
        project_id: str,
        stage_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Create or load a bounded state-first working-memory object for one project."""

        try:
            state = project_states.ensure(project_id, StageStateSchema.model_validate(stage_schema))
            return {"ok": True, "state": state.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_project_state", structured_output=True)
    async def get_project_state(project_id: str) -> dict[str, Any]:
        """Return current project state; history remains separate audit evidence."""

        try:
            return {"ok": True, "state": project_states.load(project_id).model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="record_human_project_decision", structured_output=True)
    async def record_human_project_decision(
        project_id: str,
        decision_id: str,
        content: str,
        status: str,
        evidence_id: str,
        source_spans: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record a human-owned decision with explicit source evidence, never a model claim."""

        try:
            state = project_states.apply(
                project_id,
                StateTransition(
                    kind=StateTransitionKind.HUMAN_DECISION,
                    actor=StateAuthority.HUMAN,
                    action_id=f"human-decision:{decision_id}",
                    payload={"decision_id": decision_id, "content": content, "status": status},
                    evidence=[
                        StateEvidence(
                            evidence_id=evidence_id,
                            kind="human-decision-source",
                            source_spans=source_spans or [],
                        )
                    ],
                ),
            )
            return {"ok": True, "state": state.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="open_project_question", structured_output=True)
    async def open_project_question(
        project_id: str,
        question_id: str,
        content: str,
        owner: str,
        evidence_id: str,
        source_spans: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record an explicit unresolved question instead of permitting an inferred state claim."""

        try:
            parsed_owner = QuestionOwner(owner)
            state = project_states.apply(
                project_id,
                StateTransition(
                    kind=StateTransitionKind.QUESTION_OPENED,
                    actor=StateAuthority.HARNESS,
                    action_id=f"question:{question_id}",
                    payload={
                        "question_id": question_id,
                        "content": content,
                        "owner": parsed_owner.value,
                    },
                    evidence=[
                        StateEvidence(
                            evidence_id=evidence_id,
                            kind="unresolved-question-source",
                            source_spans=source_spans or [],
                        )
                    ],
                ),
            )
            return {"ok": True, "state": state.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="validate_plan", structured_output=True)
    async def validate_plan(plan: dict[str, Any]) -> dict[str, Any]:
        """Validate a PlanTask DAG by recomputing signal-derived dependencies."""

        try:
            parsed = Plan.model_validate(plan)
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        report = plan_validator.validate(parsed)
        return {"ok": True, "report": report.model_dump(mode="json")}

    @server.tool(name="start_run", structured_output=True)
    async def start_run(plan: dict[str, Any]) -> dict[str, Any]:
        """Create and persist a validated typed-DAG run in the pending/runnable state."""

        try:
            parsed = Plan.model_validate(plan)
            record = coordinator.start_run(parsed)
            return {"ok": True, "run": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="prepare_orchestration", structured_output=True)
    async def prepare_orchestration(
        policy: dict[str, Any],
        request: dict[str, Any],
    ) -> dict[str, Any]:
        """Compile selected skills, models, tools, and capabilities into an approval-gated run.

        This MCP surface intentionally accepts only durable data-only user policy.
        Real model adapters, tool callbacks, and optional Jev evaluator credentials
        remain host-local and must be registered by the embedding application.
        """

        try:
            orchestrator = Orchestrator(
                resolved_run_root,
                OrchestrationPolicy.model_validate(policy),
                controller_runtime=controller_runtime,
                telemetry=telemetry,
            )
            record = await orchestrator.prepare(OrchestrationRequest.model_validate(request))
            orchestrators[record.orchestration_id] = orchestrator
            return {"ok": True, "orchestration": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="submit_orchestration_for_approval", structured_output=True)
    async def submit_orchestration_for_approval(orchestration_id: str) -> dict[str, Any]:
        """Bind a compiled orchestration to a controller and present it for approval."""

        try:
            record = orchestration_for(orchestration_id).submit_for_approval(orchestration_id)
            return {"ok": True, "orchestration": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="approve_orchestration", structured_output=True)
    async def approve_orchestration(
        orchestration_id: str,
        approved: bool,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Record the designer's plan decision for a policy-bound orchestration."""

        try:
            record = orchestration_for(orchestration_id).approve(orchestration_id, approved, reason)
            return {"ok": True, "orchestration": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_orchestration", structured_output=True)
    async def get_orchestration(orchestration_id: str) -> dict[str, Any]:
        """Return a persisted policy, routing, assignment, and approval record."""

        try:
            record = orchestration_for(orchestration_id).get(orchestration_id)
            return {"ok": True, "orchestration": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="cancel_orchestration", structured_output=True)
    async def cancel_orchestration(orchestration_id: str, reason: str) -> dict[str, Any]:
        """Cancel a submitted orchestration and its bound controller/graph when present."""

        try:
            record = orchestration_for(orchestration_id).cancel(orchestration_id, reason)
            return {"ok": True, "orchestration": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_run_state", structured_output=True)
    async def get_run_state(run_id: str) -> dict[str, Any]:
        """Return a hash-verified run record and current graph status."""

        try:
            return {"ok": True, "run": coordinator.get_run_state(run_id).model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="cancel_run", structured_output=True)
    async def cancel_run(run_id: str) -> dict[str, Any]:
        """Cancel runnable nodes through deterministic typed terminal states."""

        try:
            return {"ok": True, "run": coordinator.cancel_run(run_id).model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="submit_approval", structured_output=True)
    async def submit_approval(
        run_id: str,
        approval_id: str,
        approved: bool,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Record a typed approval decision for a pending governed action."""

        try:
            approval = coordinator.submit_approval(run_id, approval_id, approved, reason)
            return {"ok": True, "approval": approval.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="resume_run", structured_output=True)
    async def resume_run(run_id: str) -> dict[str, Any]:
        """Integrity-check persisted graph state before returning it for scheduler resumption."""

        try:
            return {"ok": True, "run": coordinator.resume_run(run_id).model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="create_controller", structured_output=True)
    async def create_controller(
        snapshot: dict[str, Any],
        profile: dict[str, Any],
        routing_rules: dict[str, Any],
        gap_metadata: dict[str, Any],
        max_repair_attempts: int = 1,
    ) -> dict[str, Any]:
        """Create a deterministic vertical controller bound to a read-only source snapshot."""

        try:
            record = controller_runtime.create_controller(
                SharedSubstrateSnapshot.model_validate(snapshot),
                SkillToolProfile.model_validate(profile),
                ComplexityRoutingRules.model_validate(routing_rules),
                GapMetadata.model_validate(gap_metadata),
                max_repair_attempts=max_repair_attempts,
            )
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="submit_controller_plan", structured_output=True)
    async def submit_controller_plan(controller_id: str, plan: dict[str, Any]) -> dict[str, Any]:
        """Present a deterministically validated plan upward for designer approval."""

        try:
            record = controller_runtime.submit_plan(controller_id, Plan.model_validate(plan))
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="approve_controller_plan", structured_output=True)
    async def approve_controller_plan(
        controller_id: str,
        approved: bool,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Record the designer's explicit plan decision before downward dispatch."""

        try:
            record = controller_runtime.approve_plan(controller_id, approved, reason)
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="dispatch_controller", structured_output=True)
    async def dispatch_controller(controller_id: str) -> dict[str, Any]:
        """Create the approved graph run and immutable lateral shared substrate."""

        try:
            controller, run = controller_runtime.dispatch(controller_id)
            return {
                "ok": True,
                "controller": controller.model_dump(mode="json"),
                "run": run.model_dump(mode="json"),
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="record_controller_node_result", structured_output=True)
    async def record_controller_node_result(
        controller_id: str,
        node_id: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """Commit a typed worker result into the controller-owned graph state."""

        try:
            run = controller_runtime.record_node_result(
                controller_id, node_id, GraphNodeResult.model_validate(result)
            )
            return {"ok": True, "run": run.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="publish_exploratory_discovery", structured_output=True)
    async def publish_exploratory_discovery(
        controller_id: str,
        discovery: dict[str, Any],
    ) -> dict[str, Any]:
        """Publish one closed exploratory discovery to the run-scoped substrate."""

        try:
            record = controller_runtime.publish_discovery(
                controller_id, ExploratoryDiscovery.model_validate(discovery)
            )
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="request_lateral_dependency", structured_output=True)
    async def request_lateral_dependency(
        controller_id: str,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        """Attach a consumer action to a producer's closed exploratory discovery."""

        try:
            run = controller_runtime.request_lateral_dependency(
                controller_id, LateralDependencyRequest.model_validate(request)
            )
            return {"ok": True, "run": run.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_controller_state", structured_output=True)
    async def get_controller_state(controller_id: str) -> dict[str, Any]:
        """Return the durable user-visible vertical controller state and event log."""

        try:
            return {
                "ok": True,
                "controller": controller_runtime.get_controller(controller_id).model_dump(
                    mode="json"
                ),
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_shared_state", structured_output=True)
    async def get_shared_state(controller_id: str) -> dict[str, Any]:
        """Return typed lateral discoveries and writes without worker transcripts."""

        try:
            return {"ok": True, "shared_state": controller_runtime.shared_state(controller_id)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="verify_provenance_contract", structured_output=True)
    async def verify_provenance_contract(
        controller_id: str,
        records: list[dict[str, Any]],
        required_schema_version: str,
    ) -> dict[str, Any]:
        """Mechanically check typed producer provenance at a graph fan-in boundary."""

        try:
            decision = controller_runtime.verify_provenance_contract(
                controller_id,
                [ProvenanceRecord.model_validate(record) for record in records],
                required_schema_version,
            )
            return {"ok": True, "decision": decision.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="record_controller_stage_failure", structured_output=True)
    async def record_controller_stage_failure(
        controller_id: str,
        reason: str,
    ) -> dict[str, Any]:
        """Request one bounded repair or escalate after the configured repair cap."""

        try:
            record = controller_runtime.record_stage_failure(controller_id, reason)
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="complete_controller", structured_output=True)
    async def complete_controller(controller_id: str) -> dict[str, Any]:
        """Record the typed completion of a vertical controller run."""

        try:
            record = controller_runtime.complete(controller_id)
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="cancel_controller", structured_output=True)
    async def cancel_controller(controller_id: str, reason: str) -> dict[str, Any]:
        """Cancel the active graph run and its vertical controller record."""

        try:
            record = controller_runtime.cancel(controller_id, reason)
            return {"ok": True, "controller": record.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="process_specification_manifest", structured_output=True)
    async def process_specification_manifest(
        manifest_path: str = "specification-manifest.yaml",
    ) -> dict[str, Any]:
        """Parse manifest sources into persisted ordered source-referenced document trees."""

        try:
            manifest = preprocessor.load_manifest(manifest_path)
            trees = preprocessor.process_manifest(manifest)
            paths = [
                str(preprocessor.persist_tree(tree).relative_to(specification_root))
                for tree in trees
            ]
            return {
                "ok": True,
                "manifest": manifest.model_dump(mode="json"),
                "trees": [tree.model_dump(mode="json") for tree in trees],
                "processed_paths": paths,
            }
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="select_task_context", structured_output=True)
    async def select_task_context(
        trees: list[dict[str, Any]],
        stage: str,
        task_text: str,
        scope_pointers: list[str] | None = None,
    ) -> dict[str, Any]:
        """Prune source trees by design stage before matching task scope and keywords."""

        try:
            selected = TaskAwareContextSelector().select(
                [DocumentTree.model_validate(tree) for tree in trees],
                DesignStage(stage),
                task_text,
                scope_pointers or (),
            )
            return {"ok": True, "selection": selected.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="validate_gate_one", structured_output=True)
    async def validate_gate_one(
        specification: dict[str, Any],
        required_categories: list[str],
    ) -> dict[str, Any]:
        """Run deterministic Gate 1 absence, traceability, and verifiability checks."""

        try:
            graph, report = specification_gate.validate(
                UnifiedSpecification.model_validate(specification),
                required_categories={SpecificationCategory(item) for item in required_categories},
            )
            return {
                "ok": True,
                "dependency_graph": graph.model_dump(mode="json"),
                "gap_report": report.model_dump(mode="json"),
                "summary": report.summary(),
            }
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="soft_lock_specification", structured_output=True)
    async def soft_lock_specification(
        specification: dict[str, Any],
        dependency_graph: dict[str, Any],
        gap_report: dict[str, Any],
        metadata: dict[str, Any],
        user_approved: bool,
        proceed_with_gaps: bool = False,
        plans: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Persist Gate 1 handover artifacts only after explicit designer approval."""

        try:
            parsed_spec = UnifiedSpecification.model_validate(specification)
            parsed_graph = DependencyGraph.model_validate(dependency_graph)
            parsed_report = GapReport.model_validate(gap_report)
            parsed_metadata = VersionMetadata.model_validate(metadata)
            decision = specification_gate.soft_lock(
                parsed_spec,
                parsed_report,
                parsed_metadata,
                user_approved=user_approved,
                proceed_with_gaps=proceed_with_gaps,
            )
            if decision.accepted and decision.metadata is not None:
                gate_store.persist(
                    parsed_spec, parsed_graph, parsed_report, decision.metadata, plans or []
                )
            return {"ok": True, "decision": decision.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="list_telemetry_runs", structured_output=True)
    async def list_telemetry_runs(limit: int = 100) -> dict[str, Any]:
        """List durable Python runtime telemetry runs without exposing hidden reasoning."""

        try:
            return {
                "ok": True,
                "runs": [item.model_dump(mode="json") for item in telemetry.list_runs(limit=limit)],
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_telemetry_events", structured_output=True)
    async def get_telemetry_events(
        run_id: str,
        after_sequence: int = 0,
        limit: int = 250,
    ) -> dict[str, Any]:
        """Read an ordered, integrity-linked page of runtime telemetry events."""

        try:
            events = telemetry.list_events(run_id, after_sequence=after_sequence, limit=limit)
            return {
                "ok": True,
                "events": [item.model_dump(mode="json") for item in events],
                "integrity_chain_valid": telemetry.verify_run_chain(run_id),
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_audit_log", structured_output=True)
    async def get_audit_log(run_id: str, limit: int = 1_000) -> dict[str, Any]:
        """Read bounded, redacted public interaction logs outside model working memory."""

        try:
            entries = audit_logs.list_entries(run_id, limit=limit)
            return {
                "ok": True,
                "events": [entry.model_dump(mode="json") for entry in entries],
                "integrity_chain_valid": audit_logs.verify(run_id),
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="render_audit_transcript", structured_output=True)
    async def render_audit_transcript(run_id: str) -> dict[str, Any]:
        """Render a readable Markdown review transcript from hash-linked audit entries."""

        try:
            path = audit_logs.render_markdown(run_id)
            return {
                "ok": True,
                "report": {
                    "transcript_path": str(path.relative_to(resolved_run_root.resolve())),
                    "integrity_chain_valid": audit_logs.verify(run_id),
                },
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="register_metric_definition", structured_output=True)
    async def register_metric_definition(definition: dict[str, Any]) -> dict[str, Any]:
        """Register a versioned metric formula before observations are interpreted."""

        try:
            value = telemetry.register_metric_definition(
                MetricDefinition.model_validate(definition)
            )
            return {"ok": True, "definition": value.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="list_metric_definitions", structured_output=True)
    async def list_metric_definitions() -> dict[str, Any]:
        """List metric formulas and missing-data rules known to the telemetry store."""

        return {
            "ok": True,
            "definitions": [
                item.model_dump(mode="json") for item in telemetry.list_metric_definitions()
            ],
        }

    @server.tool(name="record_metric_observation", structured_output=True)
    async def record_metric_observation(observation: dict[str, Any]) -> dict[str, Any]:
        """Record an observed or explicitly unavailable metric; values are never synthesized."""

        try:
            value = telemetry.record_metric(MetricObservation.model_validate(observation))
            return {"ok": True, "observation": value.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_telemetry_metrics", structured_output=True)
    async def get_telemetry_metrics(run_id: str) -> dict[str, Any]:
        """Return recorded metric observations and their explicit availability states."""

        try:
            return {
                "ok": True,
                "metrics": [
                    item.model_dump(mode="json") for item in telemetry.list_metrics(run_id)
                ],
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="create_telemetry_report", structured_output=True)
    async def create_telemetry_report(run_id: str) -> dict[str, Any]:
        """Create a reproducible trace and metric-completeness report from observed facts."""

        try:
            return {"ok": True, "report": telemetry.create_run_report(run_id)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="get_git_repository_state", structured_output=True)
    async def get_git_repository_state(repository_path: str) -> dict[str, Any]:
        """Inspect a runtime-root-contained local Git repository without mutation."""

        try:
            return {
                "ok": True,
                "repository": repository_for(repository_path).state().model_dump(mode="json"),
            }
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="classify_specification_version", structured_output=True)
    async def classify_specification_version(
        repository_path: str,
        version: str,
        specification: dict[str, Any],
        dependency_graph: dict[str, Any],
    ) -> dict[str, Any]:
        """Classify from persisted structured snapshots, not changed path names."""

        try:
            classification = versioning.classify(
                repository_for(repository_path),
                version,
                UnifiedSpecification.model_validate(specification),
                DependencyGraph.model_validate(dependency_graph),
            )
            return {"ok": True, "classification": classification.model_dump(mode="json")}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="create_specification_git_lock", structured_output=True)
    async def create_specification_git_lock(
        repository_path: str,
        specification: dict[str, Any],
        dependency_graph: dict[str, Any],
        gap_report: dict[str, Any],
        metadata: dict[str, Any],
        approval: dict[str, Any],
    ) -> dict[str, Any]:
        """Create an approval-gated annotated local specification tag and lock record."""

        try:
            record = versioning.create_lock(
                repository_for(repository_path),
                UnifiedSpecification.model_validate(specification),
                DependencyGraph.model_validate(dependency_graph),
                GapReport.model_validate(gap_report),
                VersionMetadata.model_validate(metadata),
                GitApproval.model_validate(approval),
            )
            return {"ok": True, "lock": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    @server.tool(name="create_variant_worktree", structured_output=True)
    async def create_variant_worktree(
        repository_path: str,
        name: str,
        branch: str,
        base_ref: str,
        specification_tag: str,
        purpose: str,
        approval: dict[str, Any],
    ) -> dict[str, Any]:
        """Create an approved local variant worktree rooted under the runtime ledger."""

        try:
            record = versioning.create_variant_worktree(
                repository_for(repository_path),
                name=name,
                branch=branch,
                base_ref=base_ref,
                specification_tag=specification_tag,
                purpose=purpose,
                approval=GitApproval.model_validate(approval),
            )
            return {"ok": True, "worktree": record.model_dump(mode="json")}
        except ValidationError as error:
            return {"ok": False, "errors": _validation_errors(error)}
        except Exception as error:
            return {"ok": False, "errors": [{"message": str(error), "type": type(error).__name__}]}

    return server


_default_server: MCPServer | None = None


def __getattr__(name: str) -> Any:
    """Construct the default MCP server on explicit attribute access only."""

    global _default_server
    if name == "mcp":
        if _default_server is None:
            _default_server = create_mcp_server()
        return _default_server
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    """Advertise the lazy ``mcp`` export without constructing its runtime stores."""

    return sorted({*globals(), "mcp"})


def main() -> None:
    """Run the Python agent runtime as a loopback-only Streamable HTTP service."""

    host = os.environ.get("AGENT_RUNTIME_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENT_RUNTIME_PORT", "8001"))
    create_mcp_server().run(
        transport="streamable-http",
        host=host,
        port=port,
        streamable_http_path="/mcp",
        json_response=True,
        stateless_http=True,
    )


if __name__ == "__main__":
    main()
