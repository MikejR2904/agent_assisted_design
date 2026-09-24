"""Narrow, local-only Git adapter for specification versions and variant worktrees."""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import Field

from .contracts import StrictModel
from .specification_gate import DependencyGraph, GapReport, UnifiedSpecification, VersionMetadata

_SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_SAFE_BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$")


class VersionBump(StrEnum):
    MAJOR = "major"
    MINOR = "minor"
    PATCH = "patch"


class GitApproval(StrictModel):
    approved: bool
    approver_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    action: str = Field(min_length=1)
    approval_id: str = Field(min_length=1)
    at_utc: str


class GitRepositoryState(StrictModel):
    repository_root: str
    head_commit: str
    tree_id: str
    branch: str | None = None
    clean: bool
    tags: list[str] = Field(default_factory=list)


class VersionClassification(StrictModel):
    recommended_bump: VersionBump
    rationale: list[str] = Field(default_factory=list)
    changed_paths: list[str] = Field(default_factory=list)
    previous_tag: str | None = None


class SpecificationLockRecord(StrictModel):
    schema_version: str = "specification-git-lock-v1"
    version: str
    tag_name: str
    repository_root: str
    head_commit: str
    tree_id: str
    tag_object_id: str
    specification_digest: str
    version_metadata: VersionMetadata
    classification: VersionClassification
    approval: GitApproval
    created_at_utc: str
    gap_report_hash: str
    dependency_graph_hash: str


class VariantWorktreeRecord(StrictModel):
    schema_version: str = "variant-worktree-v1"
    name: str
    path: str
    branch: str
    head_commit: str
    specification_tag: str
    purpose: str
    approval: GitApproval
    created_at_utc: str


@dataclass(frozen=True)
class GitCommandError(RuntimeError):
    command: tuple[str, ...]
    stdout: str
    stderr: str

    def __str__(self) -> str:
        detail = self.stderr.strip() or self.stdout.strip()
        return f"Git command failed: git {' '.join(self.command)}: {detail}"


class GitRepositoryAdapter:
    """Repository-scoped Git commands only; no generic shell, remote, or destructive APIs."""

    def __init__(self, repository_root: Path) -> None:
        self._root = repository_root.resolve()

    @property
    def root(self) -> Path:
        return self._root

    def state(self) -> GitRepositoryState:
        top_level = Path(self._git("rev-parse", "--show-toplevel").strip()).resolve()
        if top_level != self._root:
            raise ValueError(
                "Configured Git repository root must be the actual repository top-level."
            )
        head = self._git("rev-parse", "HEAD").strip()
        tree = self._git("rev-parse", "HEAD^{tree}").strip()
        branch = self._git("symbolic-ref", "--short", "-q", "HEAD", check=False).strip() or None
        clean = not bool(self._git("status", "--porcelain").strip())
        tags = [
            item
            for item in self._git("tag", "--list", "v*", "--sort=v:refname").splitlines()
            if item
        ]
        return GitRepositoryState(
            repository_root=str(self._root),
            head_commit=head,
            tree_id=tree,
            branch=branch,
            clean=clean,
            tags=tags,
        )

    def diff_names(self, base_ref: str | None = None) -> list[str]:
        arguments = ["diff", "--name-status"]
        if base_ref:
            arguments.append(f"{base_ref}..HEAD")
        output = self._git(*arguments).strip()
        return [line for line in output.splitlines() if line]

    def tag_exists(self, tag_name: str) -> bool:
        return bool(self._git("tag", "--list", tag_name).strip())

    def create_annotated_tag(self, tag_name: str, message: str) -> None:
        self._git("tag", "-a", tag_name, "-m", message)

    def delete_tag(self, tag_name: str) -> None:
        self._git("tag", "-d", tag_name)

    def tag_object_id(self, tag_name: str) -> str:
        return self._git("rev-parse", f"{tag_name}^{{tag}}").strip()

    def create_worktree(self, path: Path, branch: str, base_ref: str) -> None:
        self._git("worktree", "add", "-b", branch, str(path), base_ref)

    def worktrees(self) -> list[dict[str, str]]:
        output = self._git("worktree", "list", "--porcelain")
        values: list[dict[str, str]] = []
        current: dict[str, str] = {}
        for line in output.splitlines():
            if not line:
                if current:
                    values.append(current)
                    current = {}
                continue
            key, _, value = line.partition(" ")
            current[key] = value
        if current:
            values.append(current)
        return values

    def _git(self, *arguments: str, check: bool = True) -> str:
        completed = subprocess.run(
            ["git", *arguments],
            cwd=self._root,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        if check and completed.returncode != 0:
            raise GitCommandError(tuple(arguments), completed.stdout, completed.stderr)
        return completed.stdout


class SpecificationVersionService:
    """Classify, verify, and locally tag a complete approved specification state."""

    def __init__(self, lock_root: Path) -> None:
        self._lock_root = lock_root.resolve() / ".agent-git-locks"
        self._lock_root.mkdir(parents=True, exist_ok=True)

    def classify(self, repository: GitRepositoryAdapter, version: str) -> VersionClassification:
        _parse_semver(version)
        state = repository.state()
        previous_tag = state.tags[-1] if state.tags else None
        changed = repository.diff_names(previous_tag) if previous_tag else repository.diff_names()
        lowered = "\n".join(changed).lower()
        major_terms = ("architecture", "interface", "schema", "process", "objective")
        minor_terms = ("requirement", "feature", "block", "capability")
        if any(term in lowered for term in major_terms):
            return VersionClassification(
                recommended_bump=VersionBump.MAJOR,
                rationale=["Git diff contains a major-change keyword in a specification path."],
                changed_paths=changed,
                previous_tag=previous_tag,
            )
        if any(term in lowered for term in minor_terms):
            return VersionClassification(
                recommended_bump=VersionBump.MINOR,
                rationale=["Git diff contains an additive-change keyword in a specification path."],
                changed_paths=changed,
                previous_tag=previous_tag,
            )
        return VersionClassification(
            recommended_bump=VersionBump.PATCH,
            rationale=["No configured major/minor Git-diff keyword was observed."],
            changed_paths=changed,
            previous_tag=previous_tag,
        )

    def create_lock(
        self,
        repository: GitRepositoryAdapter,
        specification: UnifiedSpecification,
        dependency_graph: DependencyGraph,
        gap_report: GapReport,
        metadata: VersionMetadata,
        approval: GitApproval,
    ) -> SpecificationLockRecord:
        if not approval.approved or approval.action != "create-specification-lock":
            raise ValueError("An approved create-specification-lock decision is required.")
        if not metadata.soft_locked:
            raise ValueError(
                "Git version locks require an accepted Gate 1 soft-lock metadata record."
            )
        if metadata.version != specification.version:
            raise ValueError("Version metadata must match the unified specification version.")
        requested = _parse_semver(metadata.version)
        state = repository.state()
        if not state.clean:
            raise ValueError(
                "Specification repository must be clean before creating a version tag."
            )
        tag_name = f"v{metadata.version}"
        if repository.tag_exists(tag_name):
            raise ValueError(f'Specification tag "{tag_name}" already exists.')
        classification = self.classify(repository, metadata.version)
        previous = (
            _parse_semver(classification.previous_tag[1:]) if classification.previous_tag else None
        )
        if previous is not None and not _satisfies_bump(
            previous, requested, classification.recommended_bump
        ):
            raise ValueError(
                f"Version {metadata.version} does not satisfy the required "
                f"{classification.recommended_bump.value} bump."
            )
        specification_digest = _sha256(specification.model_dump(mode="json"))
        if metadata.unified_specification_hash != specification_digest:
            raise ValueError(
                "Version metadata unified_specification_hash does not match supplied specification."
            )
        repository.create_annotated_tag(
            tag_name,
            f"Gate 1 soft-lock specification {metadata.version}; approval {approval.approval_id}",
        )
        try:
            record = SpecificationLockRecord(
                version=metadata.version,
                tag_name=tag_name,
                repository_root=state.repository_root,
                head_commit=state.head_commit,
                tree_id=state.tree_id,
                tag_object_id=repository.tag_object_id(tag_name),
                specification_digest=specification_digest,
                version_metadata=metadata,
                classification=classification,
                approval=approval,
                created_at_utc=datetime.now(UTC).isoformat(),
                gap_report_hash=_sha256(gap_report.model_dump(mode="json")),
                dependency_graph_hash=_sha256(dependency_graph.model_dump(mode="json")),
            )
            _atomic_json(
                self._lock_root / f"{metadata.version}.lock.json", record.model_dump(mode="json")
            )
            return record
        except Exception:
            repository.delete_tag(tag_name)
            raise

    def create_variant_worktree(
        self,
        repository: GitRepositoryAdapter,
        *,
        name: str,
        branch: str,
        base_ref: str,
        specification_tag: str,
        purpose: str,
        approval: GitApproval,
    ) -> VariantWorktreeRecord:
        if not approval.approved or approval.action != "create-variant-worktree":
            raise ValueError("An approved create-variant-worktree decision is required.")
        if not _SAFE_BRANCH.fullmatch(branch) or branch.startswith("-") or ".." in branch:
            raise ValueError("Variant branch name is invalid.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", name):
            raise ValueError("Variant name is invalid.")
        if not repository.tag_exists(specification_tag):
            raise ValueError("Variant worktrees must reference an existing specification tag.")
        worktree_root = self._lock_root / "worktrees"
        worktree_root.mkdir(exist_ok=True)
        target = (worktree_root / name).resolve()
        if target.exists():
            raise ValueError("Variant worktree path already exists.")
        repository.create_worktree(target, branch, base_ref)
        state = GitRepositoryAdapter(target).state()
        record = VariantWorktreeRecord(
            name=name,
            path=str(target),
            branch=branch,
            head_commit=state.head_commit,
            specification_tag=specification_tag,
            purpose=purpose,
            approval=approval,
            created_at_utc=datetime.now(UTC).isoformat(),
        )
        _atomic_json(self._lock_root / "worktrees" / f"{name}.json", record.model_dump(mode="json"))
        return record


def _parse_semver(value: str) -> tuple[int, int, int]:
    match = _SEMVER.fullmatch(value)
    if match is None:
        raise ValueError(
            "Specification versions must use MAJOR.MINOR.PATCH without prerelease suffixes."
        )
    return tuple(int(group) for group in match.groups())


def _satisfies_bump(
    previous: tuple[int, int, int],
    requested: tuple[int, int, int],
    required: VersionBump,
) -> bool:
    if requested <= previous:
        return False
    major, minor, patch = previous
    if required is VersionBump.MAJOR:
        return requested[0] > major and requested[1:] == (0, 0)
    if required is VersionBump.MINOR:
        return requested[0] == major and requested[1] > minor and requested[2] == 0
    return requested[0] == major and requested[1] == minor and requested[2] > patch


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    import hashlib

    return hashlib.sha256(encoded).hexdigest()


def _atomic_json(target: Path, value: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, target)
