from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest

from agent_sdk.git_versioning import (
    GitApproval,
    GitRepositoryAdapter,
    SpecificationVersionService,
    VersionBump,
)
from agent_sdk.specification_gate import (
    DependencyEdge,
    DependencyGraph,
    GapReport,
    RequirementEntry,
    UnifiedSpecification,
    VersionChangeKind,
    VersionMetadata,
)
from agent_sdk.specifications import DocumentFormat, SourceRef, SpecificationCategory


def _git(arguments: list[str], cwd: Path) -> None:
    subprocess.run(["git", *arguments], cwd=cwd, check=True, capture_output=True, text=True)


def _source() -> SourceRef:
    return SourceRef(
        document_id="REQ-FUNC-001",
        relative_path="functional/requirements.md",
        source_hash="source-hash",
        format=DocumentFormat.MD,
        location="line:1",
    )


def _specification(
    version: str,
    *,
    text: str = "The block exposes a ready signal.",
    fields: dict[str, object] | None = None,
    acceptance_checks: list[str] | None = None,
    include_second_requirement: bool = False,
) -> UnifiedSpecification:
    requirements = [
        RequirementEntry(
            id="REQ-READY",
            category=SpecificationCategory.INTERFACE,
            text=text,
            source_refs=[_source()],
            fields=fields or {"signals": [{"id": "ready", "width": 1}]},
            acceptance_checks=acceptance_checks or ["assert-ready"],
        )
    ]
    if include_second_requirement:
        requirements.append(
            RequirementEntry(
                id="REQ-LATENCY",
                category=SpecificationCategory.FUNCTIONAL,
                text="The block completes within two cycles.",
                source_refs=[_source()],
                acceptance_checks=["latency-test"],
            )
        )
    return UnifiedSpecification(version=version, documents=[], requirements=requirements)


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def _metadata(specification: UnifiedSpecification) -> VersionMetadata:
    return VersionMetadata(
        version=specification.version,
        change_kind=VersionChangeKind.MAJOR,
        unified_specification_hash=_digest(specification.model_dump(mode="json")),
        soft_locked=True,
    )


def _approval() -> GitApproval:
    return GitApproval(
        approved=True,
        approver_id="designer",
        reason="Approved for test.",
        action="create-specification-lock",
        approval_id="approval-1",
        at_utc=datetime.now(UTC).isoformat(),
    )


def _repository(root: Path) -> GitRepositoryAdapter:
    root.mkdir()
    _git(["init"], root)
    _git(["config", "user.name", "Test Designer"], root)
    _git(["config", "user.email", "designer@example.test"], root)
    (root / "specification.yaml").write_text("version: 1.0.0\n", encoding="utf-8")
    _git(["add", "specification.yaml"], root)
    _git(["commit", "-m", "initial specification"], root)
    return GitRepositoryAdapter(root)


def _create_baseline(
    service: SpecificationVersionService,
    repository: GitRepositoryAdapter,
) -> UnifiedSpecification:
    specification = _specification("1.0.0")
    service.create_lock(
        repository,
        specification,
        DependencyGraph(),
        GapReport(document_version="1.0.0"),
        _metadata(specification),
        _approval(),
    )
    return specification


def test_structural_classification_ignores_interface_directory_name(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    _create_baseline(service, repository)
    interface_dir = repository.root / "interfaces"
    interface_dir.mkdir()
    (interface_dir / "clarification.md").write_text("Acceptance wording only.\n", encoding="utf-8")
    _git(["add", "interfaces/clarification.md"], repository.root)
    _git(["commit", "-m", "document acceptance clarification"], repository.root)

    current = _specification("1.0.1", acceptance_checks=["assert-ready-v2"])
    classification = service.classify(repository, "1.0.1", current, DependencyGraph())

    assert classification.recommended_bump is VersionBump.PATCH
    assert classification.structural_diff is not None
    assert classification.structural_diff.modified_requirement_ids == []
    assert classification.changed_paths == ["A\tinterfaces/clarification.md"]


def test_structural_classification_requires_major_for_existing_interface_change(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    _create_baseline(service, repository)
    (repository.root / "src").mkdir()
    (repository.root / "src/core.py").write_text("# unrelated path\n", encoding="utf-8")
    _git(["add", "src/core.py"], repository.root)
    _git(["commit", "-m", "change interface width"], repository.root)

    current = _specification("2.0.0", fields={"signals": [{"id": "ready", "width": 2}]})
    classification = service.classify(repository, "2.0.0", current, DependencyGraph())

    assert classification.recommended_bump is VersionBump.MAJOR
    assert classification.structural_diff is not None
    assert classification.structural_diff.modified_requirement_ids == ["REQ-READY"]
    assert classification.structural_diff.changed_requirement_fields == {"REQ-READY": ["fields"]}


def test_structural_classification_marks_new_requirement_minor(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    _create_baseline(service, repository)
    (repository.root / "specification.yaml").write_text("version: 1.1.0\n", encoding="utf-8")
    _git(["add", "specification.yaml"], repository.root)
    _git(["commit", "-m", "add latency requirement"], repository.root)

    current = _specification("1.1.0", include_second_requirement=True)
    classification = service.classify(repository, "1.1.0", current, DependencyGraph())

    assert classification.recommended_bump is VersionBump.MINOR
    assert classification.structural_diff is not None
    assert classification.structural_diff.added_requirement_ids == ["REQ-LATENCY"]


def test_structural_classification_rejects_legacy_tag_without_snapshot(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    _git(["tag", "-a", "v1.0.0", "-m", "legacy"], repository.root)
    service = SpecificationVersionService(tmp_path / "runtime")

    with pytest.raises(ValueError, match="no persisted structured specification snapshot"):
        service.classify(repository, "1.0.1", _specification("1.0.1"), DependencyGraph())


def test_structural_classification_rejects_tampered_persisted_snapshot(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    _create_baseline(service, repository)
    snapshot_path = (
        tmp_path / "runtime/.agent-git-locks/specification-snapshots/v1.0.0.snapshot.json"
    )
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    payload["specification"]["requirements"][0]["text"] = "Tampered requirement."
    snapshot_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="snapshot digest does not match"):
        service.classify(repository, "1.0.1", _specification("1.0.1"), DependencyGraph())


def test_version_lock_rejects_metadata_that_disagrees_with_structural_policy(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    specification = _specification("1.0.0")
    mismatched = _metadata(specification).model_copy(
        update={"change_kind": VersionChangeKind.PATCH}
    )

    with pytest.raises(
        ValueError, match="does not match the deterministic structural classification"
    ):
        service.create_lock(
            repository,
            specification,
            DependencyGraph(),
            GapReport(document_version="1.0.0"),
            mismatched,
            _approval(),
        )

    assert repository.tag_exists("v1.0.0") is False


def test_structural_diff_treats_dependency_edge_change_as_major(tmp_path: Path):
    repository = _repository(tmp_path / "repository")
    service = SpecificationVersionService(tmp_path / "runtime")
    _create_baseline(service, repository)
    (repository.root / "specification.yaml").write_text("version: 2.0.0\n", encoding="utf-8")
    _git(["add", "specification.yaml"], repository.root)
    _git(["commit", "-m", "change dependency graph"], repository.root)

    current_graph = DependencyGraph(
        edges=[DependencyEdge(source_id="REQ-READY", target_id="REQ-OTHER")]
    )
    classification = service.classify(repository, "2.0.0", _specification("2.0.0"), current_graph)

    assert classification.recommended_bump is VersionBump.MAJOR
    assert classification.structural_diff is not None
    assert classification.structural_diff.added_dependency_edges == [("REQ-READY", "REQ-OTHER")]
