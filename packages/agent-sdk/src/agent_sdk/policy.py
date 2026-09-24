"""Deny-by-default capability policy for harness tools."""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import Field

from .approvals import ApprovalRequest, ApprovalStatus
from .contracts import StrictModel


class SideEffectClass(StrEnum):
    READ_ONLY = "read-only"
    MUTATING = "mutating"
    PROCESS = "process"
    DESTRUCTIVE = "destructive"


class CapabilityGrant(StrictModel):
    role: str = Field(min_length=1)
    capabilities: list[str] = Field(default_factory=list)
    allowed_paths: list[str] = Field(default_factory=list)


class PolicyDecision(StrictModel):
    allowed: bool
    reason: str
    approval_required: bool = False
    approval_request: ApprovalRequest | None = None


class CapabilityPolicy:
    """Check role, capability, path containment, and typed approval state."""

    def __init__(self, grants: list[CapabilityGrant]) -> None:
        self._grants = {grant.role: grant for grant in grants}

    def evaluate(
        self,
        *,
        role: str,
        capability: str,
        side_effect: SideEffectClass,
        run_root: Path,
        requested_paths: list[str] = (),
        approval: ApprovalRequest | None = None,
    ) -> PolicyDecision:
        grant = self._grants.get(role)
        if grant is None or capability not in grant.capabilities:
            return PolicyDecision(
                allowed=False,
                reason=f'Role "{role}" lacks capability "{capability}".',
            )
        for requested_path in requested_paths:
            if not self._path_is_allowed(requested_path, grant.allowed_paths, run_root):
                return PolicyDecision(
                    allowed=False,
                    reason=f'Path "{requested_path}" is outside the declared capability scope.',
                )
        if side_effect is SideEffectClass.READ_ONLY:
            return PolicyDecision(allowed=True, reason="Read-only capability is authorized.")
        if approval is None:
            return PolicyDecision(
                allowed=False,
                reason=f'Capability "{capability}" requires a typed approval decision.',
                approval_required=True,
            )
        if approval.capability != capability:
            return PolicyDecision(
                allowed=False,
                reason="Approval capability does not match the requested action.",
            )
        if approval.status is ApprovalStatus.APPROVED:
            return PolicyDecision(allowed=True, reason="Typed approval is present.")
        if approval.status is ApprovalStatus.REJECTED:
            return PolicyDecision(
                allowed=False,
                reason=approval.decision_reason or "Typed approval was rejected.",
            )
        return PolicyDecision(
            allowed=False,
            reason="Typed approval is still pending.",
            approval_required=True,
        )

    @staticmethod
    def _path_is_allowed(requested_path: str, allowed_paths: list[str], run_root: Path) -> bool:
        if not allowed_paths:
            return False
        root = run_root.resolve()
        candidate = (root / requested_path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return False
        for allowed_path in allowed_paths:
            allowed = (root / allowed_path).resolve()
            try:
                candidate.relative_to(allowed)
                return True
            except ValueError:
                continue
        return False
