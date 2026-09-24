from __future__ import annotations

import subprocess

import pytest
from conftest import sample_definition, sample_task
from mcp import Client

from agent_sdk.mcp_server import create_mcp_server
from agent_sdk.planning import (
    DependencyProof,
    DependencyRule,
    ModelTier,
    Plan,
    PlanTask,
    SignalRole,
    TaskSignalUse,
)


@pytest.fixture
async def client(tmp_path):
    async with Client(create_mcp_server(tmp_path), raise_exceptions=True) as connected_client:
        yield connected_client


def _orchestration_payload() -> tuple[dict[str, object], dict[str, object]]:
    task = PlanTask(
        task_id="inspect-rtl",
        scope="REQ-RTL",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Inspect the bounded RTL request.",
        acceptance_criteria="gate:inspect-rtl",
        model_tier=ModelTier.STANDARD,
    )
    policy = {
        "policy_id": "mcp-orchestration-policy",
        "routing_rules": {
            "multi_agent_min_categories": 2,
            "multi_agent_min_blast_radius": 2,
            "multi_agent_gap_types": [],
        },
        "skills": [{"id": "rtl-review", "version": "1", "content": "Review RTL evidence."}],
        "models": [
            {
                "model_key": "deterministic-standard",
                "binding": {"provider": "host", "model": "scripted"},
                "allowed_tiers": ["standard"],
            }
        ],
        "profiles": [
            {
                "profile_id": "rtl-reviewer",
                "stage": "rtl-development",
                "role": "rtl-reviewer",
                "allowed_skill_ids": ["rtl-review"],
                "required_skill_ids": ["rtl-review"],
                "allowed_model_keys": ["deterministic-standard"],
                "allowed_tool_names": ["read_file"],
                "capability_grant": {
                    "role": "rtl-reviewer",
                    "capabilities": ["filesystem.read"],
                    "allowed_paths": ["."],
                },
            }
        ],
    }
    request = {
        "request_id": "mcp-orchestration-request",
        "stage": "rtl-development",
        "snapshot": {
            "snapshot_id": "rtl-snapshot",
            "version": "1",
            "content_hash": "sha256:rtl-snapshot",
            "artifact_ids": ["spec:rtl"],
            "read_only": True,
        },
        "gap_metadata": {"categories_touched": ["rtl"], "blast_radius": 1, "gap_types": []},
        "plan": Plan(plan_id="mcp-orchestration-plan", tasks=[task]).model_dump(mode="json"),
        "selected_skill_ids": ["rtl-review"],
        "profile_id_by_task_id": {"inspect-rtl": "rtl-reviewer"},
    }
    return policy, request


@pytest.mark.anyio
async def test_mcp_server_lists_the_declared_public_tools(client: Client):
    listed = await client.list_tools()
    assert {tool.name for tool in listed.tools} >= {
        "validate_agent_definition",
        "assemble_initial_context",
        "run_agent_task",
        "initialize_project_state",
        "get_project_state",
        "record_human_project_decision",
        "open_project_question",
        "validate_plan",
        "start_run",
        "prepare_orchestration",
        "submit_orchestration_for_approval",
        "approve_orchestration",
        "get_orchestration",
        "cancel_orchestration",
        "get_run_state",
        "cancel_run",
        "submit_approval",
        "resume_run",
        "create_controller",
        "submit_controller_plan",
        "approve_controller_plan",
        "dispatch_controller",
        "record_controller_node_result",
        "publish_exploratory_discovery",
        "request_lateral_dependency",
        "get_controller_state",
        "get_shared_state",
        "verify_provenance_contract",
        "record_controller_stage_failure",
        "complete_controller",
        "cancel_controller",
        "process_specification_manifest",
        "select_task_context",
        "validate_gate_one",
        "soft_lock_specification",
        "list_telemetry_runs",
        "get_telemetry_events",
        "register_metric_definition",
        "list_metric_definitions",
        "record_metric_observation",
        "get_telemetry_metrics",
        "create_telemetry_report",
        "get_git_repository_state",
        "classify_specification_version",
        "create_specification_git_lock",
        "create_variant_worktree",
    }


@pytest.mark.anyio
async def test_mcp_server_runs_a_structured_deterministic_agent_task(client: Client):
    response = await client.call_tool(
        "run_agent_task",
        {
            "definition": sample_definition().model_dump(mode="json"),
            "task": sample_task().model_dump(mode="json"),
            "runtime_options": {
                "mode": "deterministic",
                "scripted_turns": [
                    {
                        "type": "tool-call",
                        "call": {"id": "read-1", "name": "read_locked_interface", "arguments": {}},
                    },
                    {
                        "type": "final",
                        "output": {"status": "complete", "findings": ["ready is preserved"]},
                    },
                ],
            },
        },
    )

    assert response.is_error is False
    payload = response.structured_content
    assert payload["ok"] is True
    assert payload["result"]["status"] == "completed"
    assert payload["result"]["output"]["findings"] == ["ready is preserved"]
    assert payload["result"]["project_state"]["revision"] == 2
    assert payload["result"]["project_state"]["work_items"][0]["status"] == "completed"


@pytest.mark.anyio
async def test_mcp_server_records_a_human_decision_and_open_question_in_project_state(
    client: Client,
):
    initialized = await client.call_tool(
        "initialize_project_state",
        {
            "project_id": "state-mcp-project",
            "stage_schema": {"schema_id": "rtl-v1", "stage": "rtl-development"},
        },
    )
    decision = await client.call_tool(
        "record_human_project_decision",
        {
            "project_id": "state-mcp-project",
            "decision_id": "D-001",
            "content": "Use an active-low synchronous reset.",
            "status": "locked",
            "evidence_id": "REQ-RESET#line:2",
        },
    )
    question = await client.call_tool(
        "open_project_question",
        {
            "project_id": "state-mcp-project",
            "question_id": "Q-001",
            "content": "Which debug transport is required?",
            "owner": "human",
            "evidence_id": "REQ-DEBUG#line:7",
        },
    )
    state = await client.call_tool("get_project_state", {"project_id": "state-mcp-project"})

    assert initialized.structured_content["state"]["revision"] == 0
    assert decision.structured_content["state"]["decisions"][0]["status"] == "locked"
    assert question.structured_content["state"]["open_questions"][0]["owner"] == "human"
    assert state.structured_content["state"]["revision"] == 2


@pytest.mark.anyio
async def test_mcp_server_runs_batched_projected_agent_tool_calls(client: Client):
    response = await client.call_tool(
        "run_agent_task",
        {
            "definition": sample_definition().model_dump(mode="json"),
            "task": sample_task().model_dump(mode="json"),
            "runtime_options": {
                "mode": "deterministic",
                "context_token_budget": 4_000,
                "episode_token_budget": 2_000,
                "tool_result_preview_chars": 64,
                "scripted_turns": [
                    {
                        "type": "tool-batch",
                        "calls": [
                            {
                                "id": "read-a",
                                "name": "read_locked_interface",
                                "arguments": {},
                            },
                            {
                                "id": "echo-b",
                                "name": "echo",
                                "arguments": {"value": "checked"},
                                "depends_on_call_ids": ["read-a"],
                            },
                        ],
                    },
                    {
                        "type": "final",
                        "output": {"status": "complete", "findings": ["batched"]},
                    },
                ],
            },
        },
    )

    assert response.is_error is False
    result = response.structured_content["result"]
    assert result["status"] == "completed"
    assert result["projection_history"][1]["context_token_budget"] == 4_000
    assert any(event["type"] == "tool-batch-completed" for event in result["events"])


@pytest.mark.anyio
async def test_mcp_server_validates_and_starts_a_typed_plan(client: Client):
    producer = PlanTask(
        task_id="producer",
        scope="REQ-PRODUCER",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Produce ready.",
        acceptance_criteria="gate:producer",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="producer",
                signal_id="ready",
                role=SignalRole.PRODUCE,
                source_spans=["spec:1"],
                scope_pointer="REQ-PRODUCER",
            )
        ],
    )
    consumer = PlanTask(
        task_id="consumer",
        scope="REQ-CONSUMER",
        locked_interface={"signals": [{"id": "ready"}]},
        instructions="Consume ready.",
        dependencies=["producer"],
        acceptance_criteria="gate:consumer",
        model_tier=ModelTier.STANDARD,
        signal_uses=[
            TaskSignalUse(
                task_id="consumer",
                signal_id="ready",
                role=SignalRole.CONSUME,
                source_spans=["spec:2"],
                scope_pointer="REQ-CONSUMER",
            )
        ],
    )
    plan = Plan(
        plan_id="mcp-plan",
        tasks=[producer, consumer],
        dependency_proofs=[
            DependencyProof(
                parent_task_id="producer",
                child_task_id="consumer",
                shared_signal_ids=["ready"],
                applied_rule=DependencyRule.PRODUCER_TO_CONSUMER,
                source_spans=["spec:1", "spec:2"],
            )
        ],
    ).model_dump(mode="json")

    validation = await client.call_tool("validate_plan", {"plan": plan})
    started = await client.call_tool("start_run", {"plan": plan})

    assert validation.structured_content["report"]["valid"] is True
    assert started.structured_content["run"]["graph"]["statuses"]["node:producer"] == "runnable"


@pytest.mark.anyio
async def test_mcp_server_persists_data_only_orchestration_lifecycle(client: Client):
    policy, request = _orchestration_payload()

    prepared = await client.call_tool(
        "prepare_orchestration", {"policy": policy, "request": request}
    )
    orchestration = prepared.structured_content["orchestration"]
    orchestration_id = orchestration["orchestration_id"]
    fetched = await client.call_tool("get_orchestration", {"orchestration_id": orchestration_id})
    submitted = await client.call_tool(
        "submit_orchestration_for_approval", {"orchestration_id": orchestration_id}
    )
    approved = await client.call_tool(
        "approve_orchestration",
        {"orchestration_id": orchestration_id, "approved": True, "reason": "reviewed"},
    )
    cancelled = await client.call_tool(
        "cancel_orchestration",
        {"orchestration_id": orchestration_id, "reason": "host bindings not installed"},
    )

    assert prepared.structured_content["ok"] is True
    assert fetched.structured_content["orchestration"]["policy_id"] == policy["policy_id"]
    assert submitted.structured_content["orchestration"]["status"] == "awaiting-plan-approval"
    assert approved.structured_content["orchestration"]["status"] == "approved"
    assert cancelled.structured_content["orchestration"]["status"] == "cancelled"


@pytest.mark.anyio
async def test_mcp_server_recovers_orchestration_policy_after_restart(tmp_path):
    policy, request = _orchestration_payload()
    async with Client(create_mcp_server(tmp_path), raise_exceptions=True) as first_client:
        prepared = await first_client.call_tool(
            "prepare_orchestration", {"policy": policy, "request": request}
        )
        orchestration_id = prepared.structured_content["orchestration"]["orchestration_id"]

    async with Client(create_mcp_server(tmp_path), raise_exceptions=True) as recovered_client:
        fetched = await recovered_client.call_tool(
            "get_orchestration", {"orchestration_id": orchestration_id}
        )
        submitted = await recovered_client.call_tool(
            "submit_orchestration_for_approval", {"orchestration_id": orchestration_id}
        )

    async with Client(create_mcp_server(tmp_path), raise_exceptions=True) as final_client:
        approved = await final_client.call_tool(
            "approve_orchestration",
            {"orchestration_id": orchestration_id, "approved": True, "reason": "recovered"},
        )

    assert (
        fetched.structured_content["orchestration"]["request"]["request_id"]
        == request["request_id"]
    )
    assert submitted.structured_content["orchestration"]["controller_id"] is not None
    assert approved.structured_content["orchestration"]["status"] == "approved"


@pytest.mark.anyio
async def test_mcp_server_classifies_version_from_structured_specification(
    client: Client, tmp_path
):
    repository = tmp_path / "versioned-specification"
    repository.mkdir()
    for arguments in (
        ["init"],
        ["config", "user.name", "Test Designer"],
        ["config", "user.email", "designer@example.test"],
    ):
        subprocess.run(["git", *arguments], cwd=repository, check=True, capture_output=True)
    (repository / "specification.yaml").write_text("version: 1.0.0\n", encoding="utf-8")
    subprocess.run(
        ["git", "add", "specification.yaml"], cwd=repository, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "commit", "-m", "initial specification"],
        cwd=repository,
        check=True,
        capture_output=True,
    )
    specification = {
        "version": "1.0.0",
        "documents": [],
        "requirements": [
            {
                "id": "REQ-READY",
                "category": "interface",
                "text": "Expose a ready signal.",
                "source_refs": [
                    {
                        "document_id": "REQ-READY",
                        "relative_path": "functional/requirements.md",
                        "source_hash": "source-hash",
                        "format": "md",
                        "location": "line:1",
                    }
                ],
            }
        ],
    }

    response = await client.call_tool(
        "classify_specification_version",
        {
            "repository_path": "versioned-specification",
            "version": "1.0.0",
            "specification": specification,
            "dependency_graph": {"nodes": ["REQ-READY"], "edges": []},
        },
    )

    assert response.structured_content["ok"] is True
    assert response.structured_content["classification"]["recommended_bump"] == "major"
