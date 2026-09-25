"""Optional TypeSafe Jev advisory evaluation integration.

Jev is a typed System One evaluator, not a generative model, tool executor, or
policy authority.  This module consequently exposes only read-only decisions
that local deterministic policy may accept, reject, or escalate.  It never
receives an SDK capability, approval, callback, or raw audit transcript.

Primary interfaces: https://docs.typesafe.ai/api and
https://docs.typesafe.ai/concepts/system-one
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import Field, TypeAdapter, field_validator

from ..contracts import StrictModel
from ..telemetry import (
    TelemetryActor,
    TelemetryAuthority,
    TelemetryContext,
    TelemetrySeverity,
    TelemetryStore,
)
from ..verification import (
    VerificationContext,
    VerificationDecision,
    VerificationGate,
    VerificationReturn,
)
from ._utils import canonical_digest, require_optional_module
from .contracts import (
    ExternalDecisionProvider,
    ExternalDecisionResult,
    InteropFailureMode,
    InteropOperationStatus,
    InteropReceipt,
    assert_sanitized_interop_value,
)


class JevQuestionKind(StrEnum):
    NOUL = "noul"
    CHOICE = "choice"
    SCORE = "score"


class JevNoulQuestion(StrictModel):
    type: Literal[JevQuestionKind.NOUL] = JevQuestionKind.NOUL
    instructions: str | dict[str, Any] | list[Any]
    criteria: dict[Literal[True, False], str | dict[str, Any] | list[Any]] | None = None


class JevChoiceQuestion(StrictModel):
    type: Literal[JevQuestionKind.CHOICE] = JevQuestionKind.CHOICE
    instructions: str | dict[str, Any] | list[Any]
    criteria: dict[str, str | dict[str, Any] | list[Any] | None] = Field(
        min_length=2,
        max_length=255,
    )


class JevScoreQuestion(StrictModel):
    type: Literal[JevQuestionKind.SCORE] = JevQuestionKind.SCORE
    instructions: str | dict[str, Any] | list[Any]
    criteria: list[str | dict[str, Any] | list[Any]] = Field(min_length=2, max_length=10)


JevQuestion = Annotated[
    JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion,
    Field(discriminator="type"),
]


class JevQuestionSpec(StrictModel):
    """Host-owned, versioned questions permitted for one Jev purpose."""

    spec_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    questions: dict[str, JevQuestion] = Field(min_length=1, max_length=64)

    @field_validator("questions")
    @classmethod
    def question_ids_are_nonempty(cls, questions: dict[str, JevQuestion]) -> dict[str, JevQuestion]:
        if any(not question_id.strip() for question_id in questions):
            raise ValueError("Jev question identifiers must be non-empty.")
        return questions

    @property
    def digest(self) -> str:
        return canonical_digest(self.model_dump(mode="json"))


class JevDecisionRequest(StrictModel):
    """One bounded, redacted Jev evaluation request."""

    schema_version: str = "agent-sdk-jev-request-v1"
    purpose: Literal["verification", "exploration", "routing"]
    run_id: str = Field(min_length=1)
    state: dict[str, Any]
    question_spec: JevQuestionSpec
    model: str = Field(min_length=1)
    deadline_seconds: float = Field(default=20, gt=0, le=300)
    max_attempts: int = Field(default=1, ge=1, le=3)

    @field_validator("state")
    @classmethod
    def state_is_redacted_json(cls, state: dict[str, Any]) -> dict[str, Any]:
        assert_sanitized_interop_value(state)
        return state

    @property
    def state_digest(self) -> str:
        return canonical_digest(self.state)


class JevNoulAnswer(StrictModel):
    type: Literal[JevQuestionKind.NOUL] = JevQuestionKind.NOUL
    noul: float = Field(ge=0, le=1)


class JevChoiceAnswer(StrictModel):
    type: Literal[JevQuestionKind.CHOICE] = JevQuestionKind.CHOICE
    choice: str = Field(min_length=1)
    probabilities: dict[str, float] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class JevScoreAnswer(StrictModel):
    type: Literal[JevQuestionKind.SCORE] = JevQuestionKind.SCORE
    score: float
    legend: dict[str, str] = Field(min_length=1)
    probabilities: dict[str, float] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


JevAnswer = Annotated[
    JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer,
    Field(discriminator="type"),
]
_JEV_ANSWER_ADAPTER: TypeAdapter[JevAnswer] = TypeAdapter(JevAnswer)


class JevDecisionResult(StrictModel):
    """Typed, remote-evaluator result without its submitted state or question text."""

    schema_version: str = "agent-sdk-jev-result-v1"
    status: InteropOperationStatus
    model: str | None = None
    provider_request_id: str | None = None
    answers: dict[str, JevAnswer] = Field(default_factory=dict)
    state_digest: str = Field(min_length=64, max_length=64)
    question_spec_digest: str = Field(min_length=64, max_length=64)
    response_digest: str | None = Field(default=None, min_length=64, max_length=64)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    duration_ms: float | None = Field(default=None, ge=0)
    retry_count: int = Field(default=0, ge=0)
    unavailable_reason: str | None = None

    @classmethod
    def unavailable(
        cls,
        request: JevDecisionRequest,
        reason: str,
        *,
        duration_ms: float,
    ) -> JevDecisionResult:
        return cls(
            status=InteropOperationStatus.UNAVAILABLE,
            state_digest=request.state_digest,
            question_spec_digest=request.question_spec.digest,
            duration_ms=duration_ms,
            unavailable_reason=reason,
        )


class JevDecisionReceipt(InteropReceipt):
    """Receipt that binds a Jev evaluation to an SDK hash-ledger event externally."""

    schema_version: str = "agent-sdk-jev-receipt-v1"
    question_spec_id: str = Field(min_length=1)
    question_spec_version: str = Field(min_length=1)
    question_spec_digest: str = Field(min_length=64, max_length=64)
    policy_version: str = Field(min_length=1)
    policy_outcome: str = Field(min_length=1)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


JevReceiptSink = Callable[[JevDecisionReceipt], Awaitable[None] | None]


@dataclass
class InMemoryJevReceiptStore:
    """Test/development sink; production hosts should bind receipts to a durable ledger."""

    receipts: list[JevDecisionReceipt] = field(default_factory=list)

    def __call__(self, receipt: JevDecisionReceipt) -> None:
        self.receipts.append(receipt)


class TelemetryJevReceiptSink:
    """Emit receipt metadata only; submitted state and questions never enter telemetry."""

    def __init__(
        self,
        telemetry: TelemetryStore,
        context_factory: Callable[[JevDecisionReceipt], TelemetryContext],
    ) -> None:
        self._telemetry = telemetry
        self._context_factory = context_factory

    def __call__(self, receipt: JevDecisionReceipt) -> None:
        self._telemetry.emit(
            "interop.jev.decision",
            self._context_factory(receipt),
            actor=TelemetryActor(kind="evaluator", identifier="typesafe-jev", role="advisory"),
            authority=TelemetryAuthority.TOOL,
            status=receipt.status.value,
            severity=(
                TelemetrySeverity.INFO
                if receipt.status is InteropOperationStatus.SUCCEEDED
                else TelemetrySeverity.WARNING
            ),
            payload=receipt.model_dump(mode="json"),
        )


class TypeSafeJevDecisionEvaluator:
    """Concrete optional provider using ``typesafe-sdk`` only when explicitly selected.

    This class does not infer credentials or perform an evaluation during construction.
    Its caller controls a pinned model identifier, redacted state, and fixed question spec.
    """

    def __init__(
        self,
        *,
        receipt_sink: JevReceiptSink,
        policy_version: str = "jev-advisory-v1",
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._receipt_sink = receipt_sink
        self._policy_version = policy_version
        self._client_factory = client_factory

    async def evaluate(self, request: JevDecisionRequest) -> JevDecisionResult:
        started = time.perf_counter()
        result: JevDecisionResult
        try:
            result = await self._evaluate_with_bounded_attempts(request)
            result = result.model_copy(update={"duration_ms": _duration_ms(started)})
        except Exception as error:
            result = JevDecisionResult.unavailable(
                request,
                _safe_provider_error(error),
                duration_ms=_duration_ms(started),
            )
        await self._record_receipt(request, result, policy_outcome=result.status.value)
        return result

    async def _evaluate_with_bounded_attempts(
        self,
        request: JevDecisionRequest,
    ) -> JevDecisionResult:
        last_error: Exception | None = None
        for attempt in range(request.max_attempts):
            try:
                raw_response = await asyncio.wait_for(
                    self._request_once(request), timeout=request.deadline_seconds
                )
                return _normalize_jev_response(
                    raw_response,
                    request,
                    duration_ms=0.0,
                    retry_count=attempt,
                )
            except Exception as error:
                last_error = error
                if attempt + 1 >= request.max_attempts:
                    break
        assert last_error is not None
        raise last_error

    async def _request_once(self, request: JevDecisionRequest) -> Any:
        sdk = require_optional_module("typesafe_sdk", "jev")
        client_factory = self._client_factory or getattr(sdk, "AsyncTypeSafeClient")
        client = client_factory()
        questions = _make_typesafe_questions(sdk, request.question_spec)
        if hasattr(client, "__aenter__"):
            async with client as managed_client:
                return await managed_client.system_one(
                    state=request.state,
                    questions=questions,
                    model=request.model,
                )
        return await client.system_one(
            state=request.state,
            questions=questions,
            model=request.model,
        )

    async def _record_receipt(
        self,
        request: JevDecisionRequest,
        result: JevDecisionResult,
        *,
        policy_outcome: str,
    ) -> None:
        receipt = JevDecisionReceipt(
            provider="typesafe-jev",
            operation=f"jev-{request.purpose}",
            status=result.status,
            run_id=request.run_id,
            projection_digest=result.state_digest,
            result_digest=result.response_digest,
            provider_model=result.model,
            provider_request_id=result.provider_request_id,
            duration_ms=result.duration_ms,
            retry_count=result.retry_count,
            detail_code=result.unavailable_reason,
            question_spec_id=request.question_spec.spec_id,
            question_spec_version=request.question_spec.version,
            question_spec_digest=result.question_spec_digest,
            policy_version=self._policy_version,
            policy_outcome=policy_outcome,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
        emitted = self._receipt_sink(receipt)
        if inspect.isawaitable(emitted):
            await emitted


class JevAdvisoryPolicy(StrictModel):
    """Fixed local policy for converting one Jev probability into a gate outcome."""

    question_id: str = Field(min_length=1)
    minimum_noul: float = Field(ge=0, le=1)
    on_unavailable: InteropFailureMode = InteropFailureMode.ESCALATE
    policy_version: str = "jev-advisory-v1"


JevRequestFactory = Callable[[VerificationContext], JevDecisionRequest]


class JevAdvisoryVerificationGate:
    """Compose deterministic verification with an optional non-authoritative Jev signal.

    The local deterministic gate runs first.  Jev is queried only after that gate accepts.
    A provider decision may lower confidence and request rejection/escalation; it can never
    turn a failed local verification decision into an accepted result.
    """

    def __init__(
        self,
        deterministic_gate: VerificationGate,
        evaluator: ExternalDecisionProvider,
        request_factory: JevRequestFactory,
        policy: JevAdvisoryPolicy,
    ) -> None:
        self._deterministic_gate = deterministic_gate
        self._evaluator = evaluator
        self._request_factory = request_factory
        self._policy = policy

    async def verify(self, context: VerificationContext) -> VerificationReturn:
        local = self._deterministic_gate.verify(context)
        if inspect.isawaitable(local):
            local = await local
        normalized = _normalize_verification(local)
        if not normalized.passed:
            return normalized
        request = self._request_factory(context)
        result = await self._evaluator.evaluate(request)
        return self._apply_policy(result)

    def _apply_policy(self, result: ExternalDecisionResult) -> VerificationDecision:
        if result.status is not InteropOperationStatus.SUCCEEDED:
            return _unavailable_decision(self._policy.on_unavailable, result.unavailable_reason)
        answer = result.answers.get(self._policy.question_id)
        if isinstance(answer, JevNoulAnswer):
            parsed: JevAnswer = answer
        elif isinstance(answer, Mapping):
            parsed = _JEV_ANSWER_ADAPTER.validate_python(answer)
        else:
            return _unavailable_decision(
                self._policy.on_unavailable,
                f'Jev result lacks question "{self._policy.question_id}".',
            )
        if not isinstance(parsed, JevNoulAnswer):
            return _unavailable_decision(
                self._policy.on_unavailable,
                f'Jev question "{self._policy.question_id}" must return a noul answer.',
            )
        if parsed.noul >= self._policy.minimum_noul:
            return VerificationDecision(
                True,
                f"Jev advisory probability {parsed.noul:.3f} met policy.",
            )
        return VerificationDecision(
            False,
            f"Jev advisory probability {parsed.noul:.3f} is below {self._policy.minimum_noul:.3f}.",
        )


class ExplorationCandidate(StrictModel):
    """A redacted, already-authorized candidate for optional exploration prioritization."""

    candidate_id: str = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=2_000)
    deterministic_rank: int = Field(ge=0)
    provenance_ref: str = Field(min_length=1)


class JevExplorationAdvice(StrictModel):
    """A non-binding triage result; it cannot create graph nodes or mutate state."""

    selected_candidate_id: str | None = None
    used_deterministic_fallback: bool
    result: JevDecisionResult


class JevExplorationAdvisor:
    """Use Jev only to prioritize an already bounded, host-approved candidate set."""

    def __init__(
        self,
        evaluator: ExternalDecisionProvider,
        *,
        model: str,
        max_candidates: int = 64,
        on_unavailable: InteropFailureMode = InteropFailureMode.FALLBACK_DETERMINISTIC,
    ) -> None:
        self._evaluator = evaluator
        self._model = model
        self._max_candidates = max_candidates
        self._on_unavailable = on_unavailable

    async def prioritize(
        self,
        run_id: str,
        candidates: Sequence[ExplorationCandidate],
        *,
        instructions: str,
        deadline_seconds: float = 20,
    ) -> JevExplorationAdvice:
        if not candidates:
            raise ValueError("At least one exploration candidate is required.")
        if len(candidates) > self._max_candidates:
            raise ValueError("Exploration candidate count exceeds the declared Jev bound.")
        ordered = sorted(
            candidates,
            key=lambda candidate: (candidate.deterministic_rank, candidate.candidate_id),
        )
        spec = JevQuestionSpec(
            spec_id="agent-sdk-exploration-priority",
            version="v1",
            questions={
                "priority": JevChoiceQuestion(
                    instructions=instructions,
                    criteria={candidate.candidate_id: candidate.summary for candidate in ordered},
                )
            },
        )
        state = {
            "candidates": [
                {
                    "candidate_id": candidate.candidate_id,
                    "summary": candidate.summary,
                    "provenance_ref": candidate.provenance_ref,
                }
                for candidate in ordered
            ]
        }
        request = JevDecisionRequest(
            purpose="exploration",
            run_id=run_id,
            state=state,
            question_spec=spec,
            model=self._model,
            deadline_seconds=deadline_seconds,
        )
        result = await self._evaluator.evaluate(request)
        answer = (
            result.answers.get("priority")
            if result.status is InteropOperationStatus.SUCCEEDED
            else None
        )
        if isinstance(answer, JevChoiceAnswer):
            parsed_choice: JevAnswer | None = answer
        elif isinstance(answer, Mapping):
            parsed_choice = _JEV_ANSWER_ADAPTER.validate_python(answer)
        else:
            parsed_choice = None
        if parsed_choice is not None:
            if isinstance(parsed_choice, JevChoiceAnswer) and parsed_choice.choice in {
                item.candidate_id for item in ordered
            }:
                return JevExplorationAdvice(
                    selected_candidate_id=parsed_choice.choice,
                    used_deterministic_fallback=False,
                    result=result,
                )
        if self._on_unavailable is InteropFailureMode.REJECT:
            return JevExplorationAdvice(
                selected_candidate_id=None,
                used_deterministic_fallback=False,
                result=result,
            )
        return JevExplorationAdvice(
            selected_candidate_id=ordered[0].candidate_id,
            used_deterministic_fallback=True,
            result=result,
        )


class JevArchitectureRoutingPolicy(StrictModel):
    """Conservative local policy for an optional architecture-routing advisory.

    The deterministic complexity route is authoritative.  Jev may only lift a
    deterministic ``single-agent`` result to ``multi-agent`` when its bounded
    choice response has sufficient confidence.  It may never reduce a
    deterministic multi-agent route.
    """

    model: str = Field(min_length=1)
    minimum_confidence: float = Field(default=0.8, ge=0, le=1)
    on_unavailable: InteropFailureMode = InteropFailureMode.FALLBACK_DETERMINISTIC
    policy_version: str = "jev-architecture-routing-v1"


class JevArchitectureAdvice(StrictModel):
    """Receipt-backed, non-authoritative single/multi-agent route advice."""

    deterministic_architecture: Literal["single-agent", "multi-agent"]
    architecture: Literal["single-agent", "multi-agent"]
    used_deterministic_fallback: bool
    reason: str = Field(min_length=1)
    result: JevDecisionResult | None = None


class JevArchitectureRouter:
    """Use Jev for a bounded, conservative architecture-routing signal.

    The input is a caller-sanitized summary of plan and gap metadata.  The
    evaluator owns receipt persistence; this router owns only the local,
    monotonic policy which maps a typed answer to a route.
    """

    def __init__(
        self,
        evaluator: ExternalDecisionProvider,
        policy: JevArchitectureRoutingPolicy,
    ) -> None:
        self._evaluator = evaluator
        self._policy = policy

    async def advise(
        self,
        *,
        run_id: str,
        deterministic_architecture: Literal["single-agent", "multi-agent"],
        state: dict[str, Any],
        deadline_seconds: float = 20,
    ) -> JevArchitectureAdvice:
        if deterministic_architecture == "multi-agent":
            return JevArchitectureAdvice(
                deterministic_architecture=deterministic_architecture,
                architecture="multi-agent",
                used_deterministic_fallback=True,
                reason="Deterministic route already requires multi-agent execution.",
            )
        request = JevDecisionRequest(
            purpose="routing",
            run_id=run_id,
            state=state,
            question_spec=JevQuestionSpec(
                spec_id="agent-sdk-architecture-routing",
                version="v1",
                questions={
                    "architecture": JevChoiceQuestion(
                        instructions=(
                            "Select the workflow architecture warranted by the provided "
                            "bounded task metadata."
                        ),
                        criteria={
                            "single-agent": "One bounded worker can execute the approved plan.",
                            "multi-agent": (
                                "Parallel or separately scoped workers are warranted by the "
                                "approved plan metadata."
                            ),
                        },
                    )
                },
            ),
            model=self._policy.model,
            deadline_seconds=deadline_seconds,
        )
        result = await self._evaluator.evaluate(request)
        if result.status is not InteropOperationStatus.SUCCEEDED:
            return self._unavailable_advice(result)
        answer = result.answers.get("architecture")
        if isinstance(answer, JevChoiceAnswer):
            parsed: JevAnswer | None = answer
        elif isinstance(answer, Mapping):
            parsed = _JEV_ANSWER_ADAPTER.validate_python(answer)
        else:
            parsed = None
        if not isinstance(parsed, JevChoiceAnswer):
            return self._unavailable_advice(result, "Jev routing response lacks a choice answer.")
        if parsed.choice == "multi-agent" and parsed.confidence >= self._policy.minimum_confidence:
            return JevArchitectureAdvice(
                deterministic_architecture=deterministic_architecture,
                architecture="multi-agent",
                used_deterministic_fallback=False,
                reason=(f"Jev advisory lifted architecture at confidence {parsed.confidence:.3f}."),
                result=result,
            )
        return JevArchitectureAdvice(
            deterministic_architecture=deterministic_architecture,
            architecture="single-agent",
            used_deterministic_fallback=True,
            reason=(
                "Deterministic single-agent route retained because Jev did not provide a "
                "high-confidence multi-agent lift."
            ),
            result=result,
        )

    def _unavailable_advice(
        self,
        result: JevDecisionResult,
        detail: str | None = None,
    ) -> JevArchitectureAdvice:
        if self._policy.on_unavailable is InteropFailureMode.REJECT:
            raise RuntimeError(detail or result.unavailable_reason or "Jev routing is unavailable.")
        return JevArchitectureAdvice(
            deterministic_architecture="single-agent",
            architecture="single-agent",
            used_deterministic_fallback=True,
            reason=detail or result.unavailable_reason or "Jev routing is unavailable.",
            result=result,
        )


def _make_typesafe_questions(sdk: Any, spec: JevQuestionSpec) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for question_id, question in spec.questions.items():
        if isinstance(question, JevNoulQuestion):
            values[question_id] = sdk.Noul(
                instructions=question.instructions,
                criteria=(
                    {str(key).lower(): value for key, value in question.criteria.items()}
                    if question.criteria is not None
                    else None
                ),
            )
        elif isinstance(question, JevChoiceQuestion):
            values[question_id] = sdk.Choice(
                instructions=question.instructions,
                criteria=question.criteria,
            )
        else:
            values[question_id] = sdk.Score(
                instructions=question.instructions,
                criteria=question.criteria,
            )
    return values


def _normalize_jev_response(
    response: Any,
    request: JevDecisionRequest,
    *,
    duration_ms: float,
    retry_count: int,
) -> JevDecisionResult:
    payload = _to_mapping(response)
    answer_payload = payload.get("answers")
    if not isinstance(answer_payload, Mapping):
        answer_payload = _grouped_answers(payload)
    answers = {
        str(question_id): _JEV_ANSWER_ADAPTER.validate_python(answer)
        for question_id, answer in dict(answer_payload).items()
    }
    _validate_answers_match_spec(answers, request.question_spec)
    usage = _to_mapping(payload.get("usage", {}))
    canonical_answers = {
        question_id: answer.model_dump(mode="json") for question_id, answer in answers.items()
    }
    return JevDecisionResult(
        status=InteropOperationStatus.SUCCEEDED,
        model=_string_or_none(payload.get("model")),
        provider_request_id=_string_or_none(payload.get("request_id")),
        answers=answers,
        state_digest=request.state_digest,
        question_spec_digest=request.question_spec.digest,
        response_digest=canonical_digest(
            {
                "model": payload.get("model"),
                "answers": canonical_answers,
                "usage": usage,
                "request_id": payload.get("request_id"),
            }
        ),
        input_tokens=_nonnegative_int_or_none(usage.get("input_tokens")),
        output_tokens=_nonnegative_int_or_none(usage.get("output_tokens")),
        duration_ms=duration_ms,
        retry_count=retry_count,
    )


def _to_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(mode="json")
        if isinstance(dumped, Mapping):
            return dumped
    if hasattr(value, "dict"):
        dumped = value.dict()
        if isinstance(dumped, Mapping):
            return dumped
    if hasattr(value, "__dict__"):
        return vars(value)
    raise TypeError("TypeSafe SDK response is not mapping-compatible.")


def _grouped_answers(payload: Mapping[str, Any]) -> dict[str, Any]:
    answers: dict[str, Any] = {}
    for collection_name, answer_type in (
        ("nouls", JevQuestionKind.NOUL),
        ("choices", JevQuestionKind.CHOICE),
        ("scores", JevQuestionKind.SCORE),
    ):
        collection = payload.get(collection_name, {})
        if not isinstance(collection, Mapping):
            continue
        for question_id, raw_answer in collection.items():
            normalized = dict(_to_mapping(raw_answer))
            normalized.setdefault("type", answer_type.value)
            answers[str(question_id)] = normalized
    return answers


def _validate_answers_match_spec(answers: Mapping[str, JevAnswer], spec: JevQuestionSpec) -> None:
    if set(answers) != set(spec.questions):
        raise ValueError(
            "TypeSafe response question IDs do not match the registered question spec."
        )
    for question_id, question in spec.questions.items():
        answer = answers[question_id]
        if answer.type != question.type:
            raise ValueError(f'Jev answer type mismatch for question "{question_id}".')
        if isinstance(question, JevChoiceQuestion) and isinstance(answer, JevChoiceAnswer):
            if answer.choice not in question.criteria or set(answer.probabilities) != set(
                question.criteria
            ):
                raise ValueError(
                    f'Jev choice answer does not match registered options for "{question_id}".'
                )


def _normalize_verification(value: VerificationReturn) -> VerificationDecision:
    if isinstance(value, VerificationDecision):
        return value
    if isinstance(value, bool):
        return VerificationDecision(value)
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[0], bool):
        return VerificationDecision(value[0], value[1])
    raise TypeError("Deterministic verification gate returned an invalid value.")


def _unavailable_decision(mode: InteropFailureMode, reason: str | None) -> VerificationDecision:
    detail = reason or "Jev advisory evaluation is unavailable."
    if mode is InteropFailureMode.FALLBACK_DETERMINISTIC:
        return VerificationDecision(True, f"Deterministic gate accepted; Jev fallback: {detail}")
    if mode is InteropFailureMode.ESCALATE:
        return VerificationDecision(False, f"Escalation required: {detail}")
    return VerificationDecision(False, f"Rejected because Jev is unavailable: {detail}")


def _safe_provider_error(error: Exception) -> str:
    return f"provider-{type(error).__name__.lower()}"


def _duration_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1_000


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _nonnegative_int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None
