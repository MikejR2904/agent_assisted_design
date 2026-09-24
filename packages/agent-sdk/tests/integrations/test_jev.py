from __future__ import annotations

from dataclasses import dataclass

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.integrations import (
    ExplorationCandidate,
    InMemoryJevReceiptStore,
    InteropFailureMode,
    JevAdvisoryPolicy,
    JevAdvisoryVerificationGate,
    JevChoiceQuestion,
    JevDecisionRequest,
    JevExplorationAdvisor,
    JevNoulQuestion,
    JevQuestionSpec,
    TypeSafeJevDecisionEvaluator,
)
from agent_sdk.verification import StatusIsCompleteGate, VerificationContext


@dataclass
class FakeTypeSafeClient:
    response: dict
    received_questions: dict | None = None

    async def __aenter__(self) -> FakeTypeSafeClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def system_one(self, *, state: dict, questions: dict, model: str) -> dict:
        del state, model
        self.received_questions = questions
        return self.response


def verification_request() -> JevDecisionRequest:
    return JevDecisionRequest(
        purpose="verification",
        run_id="run-jev-1",
        state={"candidate": {"status": "complete"}, "artifact_ref": "sha256:abc"},
        question_spec=JevQuestionSpec(
            spec_id="verification-quality",
            version="v1",
            questions={
                "accept": JevNoulQuestion(
                    instructions="The candidate satisfies the review constraints.",
                    criteria={
                        True: "All required evidence is present.",
                        False: "Evidence is missing.",
                    },
                )
            },
        ),
        model="jev-test",
    )


@pytest.mark.anyio
async def test_typesafe_evaluator_normalizes_bounded_answer_and_writes_receipt() -> None:
    fake_client = FakeTypeSafeClient(
        {
            "model": "jev-test-pinned",
            "usage": {"input_tokens": 9, "output_tokens": 2},
            "answers": {"accept": {"type": "noul", "noul": 0.94}},
        }
    )
    receipts = InMemoryJevReceiptStore()
    evaluator = TypeSafeJevDecisionEvaluator(
        client_factory=lambda: fake_client,
        receipt_sink=receipts,
    )

    result = await evaluator.evaluate(verification_request())

    assert result.status.value == "succeeded"
    assert result.answers["accept"].noul == pytest.approx(0.94)
    assert result.input_tokens == 9
    assert result.output_tokens == 2
    assert result.duration_ms is not None
    assert fake_client.received_questions is not None
    assert len(receipts.receipts) == 1
    assert receipts.receipts[0].projection_digest == verification_request().state_digest


@pytest.mark.anyio
async def test_typesafe_evaluator_reports_provider_failure_without_message_leakage() -> None:
    class FailingClient:
        async def __aenter__(self) -> FailingClient:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def system_one(self, **_: object) -> object:
            raise RuntimeError("secret key and raw payload must never be persisted")

    result = await TypeSafeJevDecisionEvaluator(
        client_factory=FailingClient,
        receipt_sink=InMemoryJevReceiptStore(),
    ).evaluate(verification_request())

    assert result.status.value == "unavailable"
    assert result.unavailable_reason == "provider-runtimeerror"
    assert "secret" not in result.unavailable_reason


@pytest.mark.anyio
async def test_jev_advisory_cannot_overrule_failed_local_verification() -> None:
    class UnexpectedEvaluator:
        async def evaluate(self, _: JevDecisionRequest) -> object:
            raise AssertionError("Jev must not run after deterministic verification failure")

    gate = JevAdvisoryVerificationGate(
        StatusIsCompleteGate(),
        UnexpectedEvaluator(),  # type: ignore[arg-type]
        lambda _: verification_request(),
        JevAdvisoryPolicy(question_id="accept", minimum_noul=0.9),
    )
    context = VerificationContext(
        output={"status": "not-complete"},
        definition=sample_definition(),
        task=sample_task(),
    )

    decision = await gate.verify(context)

    assert decision.passed is False


@pytest.mark.anyio
async def test_jev_exploration_falls_back_to_deterministic_rank_on_unavailability() -> None:
    class UnavailableEvaluator:
        async def evaluate(self, request: JevDecisionRequest):
            from agent_sdk.integrations.jev import JevDecisionResult

            return JevDecisionResult.unavailable(request, "provider-unavailable", duration_ms=1)

    advisor = JevExplorationAdvisor(
        UnavailableEvaluator(),  # type: ignore[arg-type]
        model="jev-test",
        on_unavailable=InteropFailureMode.FALLBACK_DETERMINISTIC,
    )

    advice = await advisor.prioritize(
        "run-explore-1",
        [
            ExplorationCandidate(
                candidate_id="later",
                summary="later candidate",
                deterministic_rank=4,
                provenance_ref="p4",
            ),
            ExplorationCandidate(
                candidate_id="first",
                summary="first candidate",
                deterministic_rank=1,
                provenance_ref="p1",
            ),
        ],
        instructions="Choose the candidate most likely to resolve the declared gap.",
    )

    assert advice.selected_candidate_id == "first"
    assert advice.used_deterministic_fallback is True


def test_jev_choice_spec_supports_registered_bounded_exploration_options() -> None:
    question = JevChoiceQuestion(
        instructions="Select a candidate.",
        criteria={"candidate-a": "first", "candidate-b": "second"},
    )

    assert question.type.value == "choice"
