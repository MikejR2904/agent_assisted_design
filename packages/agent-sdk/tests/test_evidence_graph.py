from __future__ import annotations

from agent_sdk.evidence_graph import (
    EvidenceGraph,
    EvidenceNode,
    EvidenceNodeKind,
    EvidenceRelation,
    EvidenceRelationKind,
    EvidenceSelectionPolicy,
    EvidenceSelectionRequest,
    EvidenceSelectionStatus,
    StructuralContextSelector,
)
from agent_sdk.specifications import DocumentFormat, SourceRef


def _source(location: str) -> SourceRef:
    return SourceRef(
        document_id="REQ-1",
        relative_path="spec.md",
        source_hash="a" * 64,
        format=DocumentFormat.MD,
        location=location,
    )


def _graph() -> EvidenceGraph:
    return EvidenceGraph(
        snapshot_id="snapshot-1",
        nodes=[
            EvidenceNode(
                node_id="REQ-READY",
                kind=EvidenceNodeKind.REQUIREMENT,
                content="ready must assert when accumulator accepts input",
                source=_source("line:2"),
                token_cost=2,
                aliases=["ready-requirement"],
            ),
            EvidenceNode(
                node_id="SRC-READY",
                kind=EvidenceNodeKind.SOURCE_SPAN,
                content="The accumulator exposes ready.",
                source=_source("line:2"),
                token_cost=2,
            ),
            EvidenceNode(
                node_id="ACC-READY",
                kind=EvidenceNodeKind.ACCEPTANCE,
                content="ready shall assert after valid input",
                source=_source("line:3"),
                token_cost=2,
            ),
            EvidenceNode(
                node_id="TEST-READY",
                kind=EvidenceNodeKind.VERIFICATION,
                content="assert ready response in waveform test",
                source=_source("line:4"),
                token_cost=2,
            ),
            EvidenceNode(
                node_id="OPTIONAL-CLOCK",
                kind=EvidenceNodeKind.DEPENDENCY,
                content="clock is synchronous",
                source=_source("line:5"),
                token_cost=1,
            ),
        ],
        relations=[
            EvidenceRelation(
                from_node_id="REQ-READY",
                to_node_id="SRC-READY",
                kind=EvidenceRelationKind.ASSERTED_BY,
                source=_source("line:2"),
            ),
            EvidenceRelation(
                from_node_id="REQ-READY",
                to_node_id="ACC-READY",
                kind=EvidenceRelationKind.ACCEPTANCE_CRITERION,
                source=_source("line:3"),
            ),
            EvidenceRelation(
                from_node_id="ACC-READY",
                to_node_id="TEST-READY",
                kind=EvidenceRelationKind.VERIFIED_BY,
                source=_source("line:4"),
            ),
        ],
    )


def test_structural_selector_retains_full_mandatory_closure_then_packs_optional_evidence():
    graph = _graph()
    result = StructuralContextSelector().select(
        graph,
        EvidenceSelectionRequest(
            snapshot_id="snapshot-1",
            target_ids=["ready-requirement"],
            token_budget=9,
            task_text="implement synchronous ready behavior",
        ),
        EvidenceSelectionPolicy(policy_id="rtl-v1"),
    )

    assert result.status is EvidenceSelectionStatus.SELECTED
    assert result.mandatory_node_ids == ["ACC-READY", "REQ-READY", "SRC-READY", "TEST-READY"]
    assert result.selected_optional_node_ids == ["OPTIONAL-CLOCK"]
    assert result.token_cost == 9
    assert {witness.node_id for witness in result.witnesses} == set(result.mandatory_node_ids)
    assert result.diagnostics == ['Approved alias "ready-requirement" resolved to "REQ-READY".']


def test_structural_selector_refuses_to_truncate_required_closure():
    result = StructuralContextSelector().select(
        _graph(),
        EvidenceSelectionRequest(
            snapshot_id="snapshot-1",
            target_ids=["REQ-READY"],
            token_budget=7,
        ),
        EvidenceSelectionPolicy(policy_id="rtl-v1"),
    )

    assert result.status is EvidenceSelectionStatus.INFEASIBLE_REQUIRED_CLOSURE
    assert result.selected_nodes == []
    assert result.token_cost == 8
    assert all(
        omission.reason == "mandatory-closure-exceeds-budget" for omission in result.omissions
    )
