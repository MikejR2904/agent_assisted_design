"""Run provenance-grounded retrieval without an embedding provider or external service."""

from __future__ import annotations

from agent_sdk import (
    DesignStage,
    DeterministicLexicalRetrievalIndex,
    DocumentFormat,
    DocumentNode,
    DocumentNodeKind,
    DocumentTree,
    GroundedRetrievalService,
    RetrievalQuery,
    SourceRef,
    SpecificationCategory,
    TaskAwareContextSelector,
)


def main() -> None:
    source = SourceRef(
        document_id="REQ-FUNC-001",
        relative_path="functional/requirements.md",
        source_hash="demo-source-hash",
        format=DocumentFormat.MD,
        location="line:2",
    )
    trees = [
        DocumentTree(
            document_id="REQ-FUNC-001",
            category=SpecificationCategory.FUNCTIONAL,
            title="Functional requirements",
            format=DocumentFormat.MD,
            relative_path="functional/requirements.md",
            source_hash="demo-source-hash",
            nodes=[
                DocumentNode(
                    node_id="line-2",
                    kind=DocumentNodeKind.TEXT,
                    source=source,
                    content="The accumulator exposes ready and valid handshake signals.",
                )
            ],
        )
    ]
    retrieval = GroundedRetrievalService(DeterministicLexicalRetrievalIndex())
    retrieval.index_snapshot("demo-spec-lock-v1", trees)
    result = retrieval.retrieve(
        RetrievalQuery(
            snapshot_id="demo-spec-lock-v1",
            query_text="ready handshake",
            allowed_categories=[SpecificationCategory.FUNCTIONAL],
        )
    )
    verified = retrieval.resolve(result, trees)
    selected = TaskAwareContextSelector().select_verified_retrieval_nodes(
        trees,
        DesignStage.RTL_DEVELOPMENT,
        verified.nodes,
    )

    print(
        {
            "status": result.status,
            "candidate_node_ids": [candidate.node_id for candidate in result.candidates],
            "selected_node_ids": [node.node_id for node in selected.nodes],
            "selection_reasons": selected.selection_reasons,
        }
    )


if __name__ == "__main__":
    main()
