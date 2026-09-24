from __future__ import annotations

import pytest
from conftest import sample_definition, sample_task
from pydantic import ValidationError

from agent_sdk.base_agent import BaseAgent
from agent_sdk.context import assemble_initial_context
from agent_sdk.model import ScriptedModel


def test_definition_rejects_cross_session_memory_without_rationale():
    with pytest.raises(ValidationError, match="cross-session memory requires memory_rationale"):
        sample_definition(memory_scope="cross-session", memory_rationale=None)


def test_runtime_rejects_cross_session_memory_without_persistent_store():
    definition = sample_definition(
        memory_scope="cross-session",
        memory_rationale="A durable evidence store will be supplied in a later integration.",
    )
    with pytest.raises(Exception, match="persistent episode store"):
        BaseAgent(definition, ScriptedModel([]))


def test_context_is_deterministic_and_preserves_locked_interface_by_value():
    task = sample_task()
    context = assemble_initial_context(sample_definition(), task)

    assert [section.kind for section in context.sections] == [
        "identity",
        "instructions",
        "task",
        "skills",
        "tools",
    ]
    task.locked_interface["signals"][0]["width"] = 32
    assert context.sections[2].value["locked_interface"]["signals"][0]["width"] == 1
    assert [tool["name"] for tool in context.sections[4].value] == [
        "read_locked_interface",
        "echo",
    ]


def test_task_requires_acceptance_criteria():
    with pytest.raises(ValidationError, match="at least 1 item"):
        sample_task(acceptance_criteria=[])
