"""Provider-neutral model interfaces and deterministic test adapter."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import TypeAdapter

from .contracts import (
    AgentPrompt,
    AgentTurn,
    ContextProjectionMetadata,
    EpisodeSummary,
    ModelObservation,
    ScopedAgentTask,
)
from .errors import AgentSdkError
from .project_state import ProjectStateView

# Built once: see base_agent.py's identical rationale for caching this adapter.
_AGENT_TURN_ADAPTER: TypeAdapter[AgentTurn] = TypeAdapter(AgentTurn)


@dataclass(frozen=True)
class ProviderUsage:
    """Provider-reported token counters for one response, never estimated by the SDK."""

    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    context_window_tokens: int | None = None
    request_id: str | None = None

    def __post_init__(self) -> None:
        for name in (
            "input_tokens",
            "output_tokens",
            "cached_input_tokens",
            "reasoning_tokens",
            "context_window_tokens",
        ):
            value = getattr(self, name)
            if value is not None and value < 0:
                raise ValueError(f"{name} must be non-negative when reported.")


@dataclass(frozen=True)
class ProviderContinuation:
    """Opaque provider-owned conversation state required for a later model turn.

    The BaseAgent persists and forwards this state without interpreting it. A
    selected provider adapter owns validation and serialization semantics.
    """

    provider: str
    state: dict[str, Any]


@dataclass(frozen=True)
class ModelTurnResponse:
    """Untrusted provider response with optional opaque continuation material."""

    turn: AgentTurn
    continuation: ProviderContinuation | None = None
    usage: ProviderUsage | None = None


@dataclass(frozen=True)
class ModelContext:
    task: ScopedAgentTask
    prompt: AgentPrompt
    iteration: int
    project_state: ProjectStateView
    observations: Sequence[ModelObservation]
    episodes: Sequence[EpisodeSummary]
    continuation: ProviderContinuation | None = None
    projection: ContextProjectionMetadata | None = None


class AgentModel(Protocol):
    """An injected model adapter; it returns untrusted output for runtime validation."""

    async def next_turn(self, context: ModelContext) -> AgentTurn | ModelTurnResponse: ...


class ScriptedModel:
    """Deterministic test adapter; never calls an external model provider."""

    def __init__(self, turns: Sequence[AgentTurn | dict[str, Any]]) -> None:
        self._turns = [_AGENT_TURN_ADAPTER.validate_python(turn) for turn in turns]
        self.calls: list[ModelContext] = []

    async def next_turn(self, context: ModelContext) -> AgentTurn:
        self.calls.append(context)
        index = context.iteration - 1
        if index >= len(self._turns):
            raise AgentSdkError(
                "SCRIPTED_MODEL_EXHAUSTED",
                "No deterministic scripted turn was supplied for this iteration.",
            )
        return self._turns[index]


@dataclass(frozen=True)
class ModelFailoverAttempt:
    index: int
    error: str


class FailoverAgentModel:
    """Try injected provider adapters in declared primary-to-fallback order.

    The class does not select models by itself. Its caller supplies adapters in
    the exact order of the agent definition's model binding and fallback list.
    When all adapters fail, the BaseAgent's bounded termination policy records
    the failure and performs its configured controller or human escalation.
    """

    def __init__(self, models: Sequence[AgentModel]) -> None:
        if not models:
            raise ValueError("FailoverAgentModel requires a primary adapter.")
        self._models = tuple(models)
        self.attempts: list[ModelFailoverAttempt] = []

    async def next_turn(self, context: ModelContext) -> AgentTurn:
        errors: list[ModelFailoverAttempt] = []
        for index, model in enumerate(self._models):
            try:
                return await model.next_turn(context)
            except Exception as error:
                attempt = ModelFailoverAttempt(index=index, error=str(error))
                errors.append(attempt)
                self.attempts.append(attempt)
        raise AgentSdkError(
            "MODEL_FALLBACK_EXHAUSTED",
            "Primary model and all configured fallback adapters failed.",
            {"attempts": [{"index": attempt.index, "error": attempt.error} for attempt in errors]},
        )
