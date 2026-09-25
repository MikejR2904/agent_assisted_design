"""Gate 1 deterministic checks, soft-lock decision, and version metadata.

The gate validates absence, traceability, and verifiability without pretending
that model-only ambiguity and semantic analysis are deterministic (systems-design
framework, updated PDF, pp. 38–39 and 48).
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field, model_validator

from .atomic_io import replace_atomic
from .contracts import StrictModel
from .dependency_graph import deterministic_cycles, reverse_reachable_count
from .specifications import DocumentTree, SourceRef, SpecificationCategory


class GapType(StrEnum):
    ABSENCE = "absence"
    TRACEABILITY = "traceability"
    INCONSISTENCY = "inconsistency"
    AMBIGUITY = "ambiguity"
    VERIFIABILITY = "verifiability"
    UNSTATED_ASSUMPTION = "unstated_assumption"


class GapSeverity(StrEnum):
    CRITICAL = "CRITICAL"
    IMPORTANT = "IMPORTANT"
    OPTIONAL = "OPTIONAL"


class RequirementEntry(StrictModel):
    id: str = Field(min_length=1)
    category: SpecificationCategory
    text: str = Field(min_length=1)
    source_refs: list[SourceRef] = Field(min_length=1)
    dependencies: list[str] = Field(default_factory=list)
    acceptance_checks: list[str] = Field(default_factory=list)
    fields: dict[str, Any] = Field(default_factory=dict)


class UnifiedSpecification(StrictModel):
    schema_version: str = "unified-specification-v1"
    version: str = Field(min_length=1)
    documents: list[DocumentTree]
    requirements: list[RequirementEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def requirement_ids_are_unique(self) -> UnifiedSpecification:
        ids = [requirement.id for requirement in self.requirements]
        if len(ids) != len(set(ids)):
            raise ValueError("unified specification requirement IDs must be unique")
        return self


class DependencyEdge(StrictModel):
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)


class DependencyGraph(StrictModel):
    schema_version: str = "specification-dependency-graph-v1"
    nodes: list[str] = Field(default_factory=list)
    edges: list[DependencyEdge] = Field(default_factory=list)


class Gap(StrictModel):
    type: GapType
    locations: list[str] = Field(min_length=1)
    description: str = Field(min_length=1)
    categories_touched: list[SpecificationCategory] = Field(default_factory=list)
    suggested_fix: str = Field(min_length=1)
    severity: GapSeverity
    source: str = Field(min_length=1)
    blast_radius: int | None = Field(default=None, ge=0)
    model_analysis_required: bool = False


class GapReport(StrictModel):
    schema_version: str = "gap-report-v1"
    document_version: str = Field(min_length=1)
    gaps: list[Gap] = Field(default_factory=list)

    def summary(self) -> dict[str, int]:
        return {
            "total_gaps": len(self.gaps),
            "critical": sum(item.severity is GapSeverity.CRITICAL for item in self.gaps),
            "important": sum(item.severity is GapSeverity.IMPORTANT for item in self.gaps),
            "optional": sum(item.severity is GapSeverity.OPTIONAL for item in self.gaps),
        }


class VersionChangeKind(StrEnum):
    MAJOR = "major"
    MINOR = "minor"
    PATCH = "patch"


class VersionMetadata(StrictModel):
    schema_version: str = "specification-version-v1"
    version: str = Field(min_length=1)
    change_kind: VersionChangeKind
    rationale: list[str] = Field(default_factory=list)
    unified_specification_hash: str = Field(min_length=1)
    soft_locked: bool = False
    user_override_with_gaps: bool = False


class SoftLockDecision(StrictModel):
    accepted: bool
    warnings: list[str] = Field(default_factory=list)
    metadata: VersionMetadata | None = None


class SpecificationGate:
    """Perform only deterministic Gate 1 checks and retain model-needed flags."""

    def validate(
        self,
        specification: UnifiedSpecification,
        *,
        required_categories: set[SpecificationCategory],
    ) -> tuple[DependencyGraph, GapReport]:
        requirement_ids = {requirement.id for requirement in specification.requirements}
        present_categories = {document.category for document in specification.documents}
        gaps: list[Gap] = []
        for category in sorted(required_categories - present_categories, key=str):
            gaps.append(
                Gap(
                    type=GapType.ABSENCE,
                    locations=[f"category:{category.value}"],
                    description=(
                        f'Required specification category "{category.value}" has no document.'
                    ),
                    categories_touched=[category],
                    suggested_fix="Add a source document to the specification manifest.",
                    severity=GapSeverity.CRITICAL,
                    source="manifest-category-presence",
                )
            )
        edges: list[DependencyEdge] = []
        for requirement in specification.requirements:
            if not requirement.text.strip():
                gaps.append(
                    Gap(
                        type=GapType.ABSENCE,
                        locations=[requirement.id],
                        description="Requirement text is empty.",
                        categories_touched=[requirement.category],
                        suggested_fix="Provide a concrete requirement statement.",
                        severity=GapSeverity.CRITICAL,
                        source="required-field-presence",
                    )
                )
            if not requirement.acceptance_checks:
                gaps.append(
                    Gap(
                        type=GapType.VERIFIABILITY,
                        locations=[requirement.id],
                        description="Requirement has no declared acceptance check.",
                        categories_touched=[requirement.category],
                        suggested_fix="Link a test, assertion, report, or other acceptance method.",
                        severity=GapSeverity.IMPORTANT,
                        source="acceptance-check-presence",
                    )
                )
            for dependency in requirement.dependencies:
                edges.append(DependencyEdge(source_id=requirement.id, target_id=dependency))
                if dependency not in requirement_ids:
                    gaps.append(
                        Gap(
                            type=GapType.TRACEABILITY,
                            locations=[requirement.id, dependency],
                            description=(
                                "Requirement dependency references a missing requirement node."
                            ),
                            categories_touched=[requirement.category],
                            suggested_fix=(
                                "Define the referenced requirement or correct the reference."
                            ),
                            severity=GapSeverity.CRITICAL,
                            source="dependency-graph-traversal",
                        )
                    )
        graph = DependencyGraph(nodes=sorted(requirement_ids), edges=edges)
        graph_edges = [(edge.source_id, edge.target_id) for edge in graph.edges]
        gaps = [
            gap.model_copy(
                update={
                    "blast_radius": reverse_reachable_count(
                        graph.nodes,
                        graph_edges,
                        gap.locations[-1],
                    )
                }
            )
            if gap.source == "dependency-graph-traversal"
            and len(gap.locations) == 2
            and gap.locations[-1] not in requirement_ids
            else gap
            for gap in gaps
        ]
        cycles = deterministic_cycles(graph.nodes, graph_edges)
        for cycle in cycles:
            gaps.append(
                Gap(
                    type=GapType.TRACEABILITY,
                    locations=cycle,
                    description="Requirement dependency graph contains a circular dependency.",
                    categories_touched=[],
                    suggested_fix="Break the circular dependency and retain a directed trace.",
                    severity=GapSeverity.IMPORTANT,
                    source="dependency-graph-traversal",
                    blast_radius=len(cycle),
                )
            )
        return graph, GapReport(document_version=specification.version, gaps=gaps)

    def soft_lock(
        self,
        specification: UnifiedSpecification,
        report: GapReport,
        metadata: VersionMetadata,
        *,
        user_approved: bool,
        proceed_with_gaps: bool = False,
    ) -> SoftLockDecision:
        if not user_approved:
            return SoftLockDecision(
                accepted=False, warnings=["Designer approval is required to soft-lock."]
            )
        warnings = [f"{gap.severity.value}: {gap.description}" for gap in report.gaps]
        if report.gaps and not proceed_with_gaps:
            return SoftLockDecision(
                accepted=False,
                warnings=[
                    *warnings,
                    "Soft-lock requires explicit proceed_with_gaps when gaps remain.",
                ],
            )
        return SoftLockDecision(
            accepted=True,
            warnings=warnings,
            metadata=metadata.model_copy(
                update={"soft_locked": True, "user_override_with_gaps": bool(report.gaps)}
            ),
        )


def classify_version_change(
    previous: UnifiedSpecification | None,
    current: UnifiedSpecification,
) -> tuple[VersionChangeKind, list[str]]:
    """Preview structural requirement-ID changes before a graph-aware Git lock check.

    ``SpecificationVersionService`` additionally compares dependency edges against
    the prior persisted lock snapshot. This Gate 1 helper has no prior graph
    parameter, so it deliberately classifies only requirement-level structure.
    """

    if previous is None:
        return VersionChangeKind.MAJOR, ["Initial soft-locked specification baseline."]
    previous_requirements = {item.id: item for item in previous.requirements}
    current_requirements = {item.id: item for item in current.requirements}
    removed = sorted(set(previous_requirements) - set(current_requirements))
    if removed:
        return VersionChangeKind.MAJOR, [f"Requirements removed: {', '.join(removed)}."]
    for requirement_id in sorted(set(previous_requirements) & set(current_requirements)):
        prior = previous_requirements[requirement_id]
        present = current_requirements[requirement_id]
        changed_fields = [
            field_name
            for field_name in ("text", "category", "fields")
            if getattr(prior, field_name) != getattr(present, field_name)
        ]
        if changed_fields:
            return VersionChangeKind.MAJOR, [
                f"Existing requirement changed: {requirement_id} ({', '.join(changed_fields)})."
            ]
    added = sorted(set(current_requirements) - set(previous_requirements))
    if added:
        return VersionChangeKind.MINOR, [f"New requirements added: {', '.join(added)}."]
    return VersionChangeKind.PATCH, [
        "Constraint, clarification, or feasibility-level changes only."
    ]


class Gate1ArtifactStore:
    """Persist Gate 1 outputs under the approved `specifications/` root."""

    def __init__(self, specification_root: Path) -> None:
        self._root = specification_root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def persist(
        self,
        specification: UnifiedSpecification,
        dependency_graph: DependencyGraph,
        gap_report: GapReport,
        metadata: VersionMetadata,
        plans: list[dict[str, Any]] = (),
    ) -> None:
        self._write("unified-specification.yaml", specification.model_dump(mode="json"))
        self._write("dependency-graph.yaml", dependency_graph.model_dump(mode="json"))
        self._write(
            "gap-report.yaml",
            {**gap_report.model_dump(mode="json"), "summary": gap_report.summary()},
        )
        self._write("version-metadata.yaml", metadata.model_dump(mode="json"))
        for index, plan in enumerate(plans, start=1):
            self._write(f"plans/plan-{index}.yaml", plan)

    def _write(self, relative: str, payload: dict[str, Any]) -> None:
        target = self._root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.tmp")
        temporary.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
        replace_atomic(temporary, target)
