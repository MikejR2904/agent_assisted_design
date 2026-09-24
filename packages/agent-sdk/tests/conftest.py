from __future__ import annotations

from agent_sdk.contracts import AgentDefinition, ScopedAgentTask


def sample_definition(**overrides):
    payload = {
        "identity": "Validate one scoped RTL interface artifact.",
        "instructions": {
            "version": "1.0.0",
            "text": "Use only declared tools and return structured output.",
        },
        "input_schema": {
            "type": "object",
            "properties": {"artifact": {"type": "string"}},
            "required": ["artifact"],
            "additionalProperties": False,
        },
        "tools": [
            {
                "name": "read_locked_interface",
                "description": "Read the task's immutable locked interface.",
                "input_schema": {"type": "object", "additionalProperties": False},
                "episode_kind": "exploratory",
            },
            {
                "name": "echo",
                "description": "Return validated deterministic arguments.",
                "input_schema": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                    "required": ["value"],
                    "additionalProperties": False,
                },
                "episode_kind": "action",
            },
        ],
        "model_binding": {"provider": "unconfigured", "model": "pending-project-selection"},
        "output_schema": {
            "type": "object",
            "properties": {
                "status": {"const": "complete"},
                "findings": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["status", "findings"],
            "additionalProperties": False,
        },
        "memory_scope": "task-scoped",
        "termination_policy": {
            "max_iterations": 3,
            "status_field": "status",
            "escalation": "controller",
        },
        "verification_gate_id": "status-is-complete",
    }
    payload.update(overrides)
    return AgentDefinition.model_validate(payload)


def sample_task(**overrides):
    payload = {
        "id": "task-interface-1",
        "input": {"artifact": "rtl/accumulator.sv"},
        "scope": {"label": "accumulator", "boundaries": {"allowed_paths": ["rtl/accumulator.sv"]}},
        "locked_interface": {"signals": [{"id": "ready", "width": 1}]},
        "instructions": "Validate the selected artifact without changing locked signals.",
        "acceptance_criteria": ["Return a complete structured interface result."],
        "skills": [
            {
                "id": "rtl-interface-validation",
                "version": "1.0.0",
                "content": "Read the locked interface before acting.",
            }
        ],
    }
    payload.update(overrides)
    return ScopedAgentTask.model_validate(payload)
