from __future__ import annotations

from pathlib import Path

import pytest

from agent_sdk.approvals import ApprovalRequest, ApprovalStatus
from agent_sdk.policy import CapabilityGrant, CapabilityPolicy, SideEffectClass


def _policy() -> CapabilityPolicy:
    return CapabilityPolicy(
        [
            CapabilityGrant(
                role="rtl",
                capabilities=["spec.read", "draft.write"],
                allowed_paths=["rtl"],
            )
        ]
    )


def _approval(
    *, capability: str = "draft.write", status: ApprovalStatus = ApprovalStatus.PENDING
) -> ApprovalRequest:
    return ApprovalRequest(
        approval_id="approval-1",
        run_id="run-1",
        node_id="node-1",
        capability=capability,
        reason="Write a declared draft.",
        status=status,
        decision_reason="reviewed" if status is ApprovalStatus.REJECTED else None,
    )


def test_capability_policy_denies_unknown_role_and_capability(tmp_path: Path) -> None:
    policy = _policy()

    unknown_role = policy.evaluate(
        role="verification",
        capability="spec.read",
        side_effect=SideEffectClass.READ_ONLY,
        run_root=tmp_path,
    )
    unknown_capability = policy.evaluate(
        role="rtl",
        capability="shell.execute",
        side_effect=SideEffectClass.READ_ONLY,
        run_root=tmp_path,
    )

    assert unknown_role.allowed is False
    assert unknown_capability.allowed is False


def test_capability_policy_enforces_path_containment_and_read_only_access(tmp_path: Path) -> None:
    policy = _policy()

    allowed = policy.evaluate(
        role="rtl",
        capability="spec.read",
        side_effect=SideEffectClass.READ_ONLY,
        run_root=tmp_path,
        requested_paths=["rtl/top.sv"],
    )
    escaped = policy.evaluate(
        role="rtl",
        capability="spec.read",
        side_effect=SideEffectClass.READ_ONLY,
        run_root=tmp_path,
        requested_paths=["../outside.sv"],
    )

    assert allowed.allowed is True
    assert escaped.allowed is False


@pytest.mark.parametrize(
    ("approval", "expected_allowed", "expected_required"),
    [
        (None, False, True),
        (_approval(capability="other.write"), False, False),
        (_approval(status=ApprovalStatus.PENDING), False, True),
        (_approval(status=ApprovalStatus.REJECTED), False, False),
        (_approval(status=ApprovalStatus.APPROVED), True, False),
    ],
)
def test_capability_policy_requires_matching_approved_mutation(
    tmp_path: Path,
    approval: ApprovalRequest | None,
    expected_allowed: bool,
    expected_required: bool,
) -> None:
    decision = _policy().evaluate(
        role="rtl",
        capability="draft.write",
        side_effect=SideEffectClass.MUTATING,
        run_root=tmp_path,
        requested_paths=["rtl/top.sv"],
        approval=approval,
    )

    assert decision.allowed is expected_allowed
    assert decision.approval_required is expected_required
