from __future__ import annotations

from pathlib import Path

from agent_sdk.context_selection import DesignStage, TaskAwareContextSelector
from agent_sdk.retrieval import (
    DeterministicLexicalRetrievalIndex,
    GroundedRetrievalService,
    InMemoryRetrievalCache,
    QdrantRetrievalIndex,
    RetrievalCandidate,
    RetrievalQuery,
    RetrievalStatus,
    RetrievalTelemetrySink,
    specification_retrieval_documents,
)
from agent_sdk.specifications import (
    DocumentFormat,
    DocumentNode,
    DocumentNodeKind,
    DocumentTree,
    SourceRef,
    SpecificationCategory,
)
from agent_sdk.telemetry import TelemetryContext, TelemetryStore


def _tree() -> DocumentTree:
    source = SourceRef(
        document_id="REQ-FUNC-001",
        relative_path="functional/requirements.md",
        source_hash="source-hash",
        format=DocumentFormat.MD,
        location="line:2",
    )
    return DocumentTree(
        document_id="REQ-FUNC-001",
        category=SpecificationCategory.FUNCTIONAL,
        title="Functional requirements",
        format=DocumentFormat.MD,
        relative_path="functional/requirements.md",
        source_hash="source-hash",
        nodes=[
            DocumentNode(
                node_id="line-2",
                kind=DocumentNodeKind.TEXT,
                source=source,
                content="Accumulator exposes ready and valid handshake signals.",
            ),
            DocumentNode(
                node_id="line-3",
                kind=DocumentNodeKind.TEXT,
                source=source.model_copy(update={"location": "line:3"}),
                content="The implementation has a synchronous reset.",
            ),
        ],
    )


def _query() -> RetrievalQuery:
    return RetrievalQuery(
        snapshot_id="spec-lock-v1",
        query_text="ready handshake",
        allowed_categories=[SpecificationCategory.FUNCTIONAL],
    )


def test_lexical_retrieval_is_snapshot_and_category_scoped():
    index = DeterministicLexicalRetrievalIndex()
    service = GroundedRetrievalService(index)
    assert service.index_snapshot("spec-lock-v1", [_tree()]) == 2

    result = service.retrieve(_query())
    resolved = service.resolve(result, [_tree()])

    assert result.status is RetrievalStatus.RETRIEVED
    assert [candidate.node_id for candidate in result.candidates] == ["line-2"]
    assert [node.node_id for node in resolved.nodes] == ["line-2"]
    assert resolved.rejected_candidate_ids == []
    admitted = TaskAwareContextSelector().select_verified_retrieval_nodes(
        [_tree()],
        DesignStage.RTL_DEVELOPMENT,
        resolved.nodes,
    )
    assert admitted.selection_reasons == {"REQ-FUNC-001": ["verified-retrieval-reference"]}


def test_retrieval_cache_avoids_second_backend_search():
    class CountingIndex(DeterministicLexicalRetrievalIndex):
        searches = 0

        def search(self, query: RetrievalQuery) -> list[RetrievalCandidate]:
            self.searches += 1
            return super().search(query)

    index = CountingIndex()
    service = GroundedRetrievalService(index, cache=InMemoryRetrievalCache())
    service.index_snapshot("spec-lock-v1", [_tree()])

    first = service.retrieve(_query())
    second = service.retrieve(_query())

    assert first.status is RetrievalStatus.RETRIEVED
    assert second.status is RetrievalStatus.CACHE_HIT
    assert index.searches == 1


def test_retrieval_discards_backend_candidates_outside_query_scope():
    class UntrustedIndex:
        backend_name = "untrusted-test"

        def upsert(self, documents):
            del documents

        def search(self, query: RetrievalQuery) -> list[RetrievalCandidate]:
            del query
            return [
                RetrievalCandidate(
                    snapshot_id="other-snapshot",
                    category=SpecificationCategory.PDK,
                    document_id="REQ-PDK-001",
                    node_id="line-1",
                    source=SourceRef(
                        document_id="REQ-PDK-001",
                        relative_path="pdk/assumptions.md",
                        source_hash="other-hash",
                        format=DocumentFormat.MD,
                        location="line:1",
                    ),
                    score=1.0,
                    backend_id="untrusted-point",
                )
            ]

    result = GroundedRetrievalService(UntrustedIndex()).retrieve(_query())

    assert result.status is RetrievalStatus.RETRIEVED
    assert result.candidates == []


def test_local_resolution_rejects_source_hash_mismatch():
    tree = _tree()
    index = DeterministicLexicalRetrievalIndex()
    service = GroundedRetrievalService(index)
    service.index_snapshot("spec-lock-v1", [tree])
    result = service.retrieve(_query())
    tampered = result.model_copy(
        update={
            "candidates": [
                result.candidates[0].model_copy(
                    update={
                        "source": result.candidates[0].source.model_copy(
                            update={"source_hash": "bad"}
                        )
                    }
                )
            ]
        }
    )

    resolved = service.resolve(tampered, [tree])

    assert resolved.nodes == []
    assert resolved.rejected_candidate_ids == [result.candidates[0].backend_id]


def test_retrieval_telemetry_records_digest_without_query_text(tmp_path: Path):
    telemetry = TelemetryStore(tmp_path)
    index = DeterministicLexicalRetrievalIndex()
    service = GroundedRetrievalService(
        index,
        telemetry_sink=RetrievalTelemetrySink(
            telemetry,
            lambda _query: TelemetryContext(run_id="retrieval-run", stage="rtl-development"),
        ),
    )
    service.index_snapshot("spec-lock-v1", [_tree()])

    result = service.retrieve(_query())
    event = telemetry.list_events("retrieval-run")[0]
    metrics = telemetry.list_metrics("retrieval-run")

    assert event.event_type == "retrieval.completed"
    assert event.payload["query_digest"] == result.query_digest
    assert "ready handshake" not in event.model_dump_json()
    assert {metric.metric_id for metric in metrics} == {
        "retrieval.cache_hit_count",
        "retrieval.candidate_count",
    }


def test_qdrant_adapter_writes_provenance_payload_and_filters_queries(monkeypatch):
    class FixedEmbedding:
        def embed(self, text: str) -> list[float]:
            assert text
            return [0.25, 0.75]

    index = QdrantRetrievalIndex(
        "http://qdrant.example.test",
        "agent-specifications",
        FixedEmbedding(),
        embedding_dimensions=2,
    )
    calls: list[tuple[str, str, dict[str, object] | None]] = []

    def fake_request(method: str, path: str, payload: dict[str, object] | None = None):
        calls.append((method, path, payload))
        if method == "POST" and path.endswith("/points/search"):
            assert payload is not None
            return {
                "status": "ok",
                "result": [
                    {
                        "score": 0.9,
                        "payload": payload_for_document,
                    }
                ],
            }
        return {"status": "ok"}

    document = specification_retrieval_documents("spec-lock-v1", [_tree()])[0]
    payload_for_document = {
        "snapshot_id": document.snapshot_id,
        "category": document.category.value,
        "document_id": document.document_id,
        "node_id": document.node_id,
        "source": document.source.model_dump(mode="json"),
        "stable_id": document.stable_id,
    }
    monkeypatch.setattr(index, "_request", fake_request)

    index.upsert([document])
    candidates = index.search(_query())

    upsert_payload = next(
        payload
        for _method, path, payload in calls
        if path.startswith("/collections/agent-specifications/points?")
    )
    search_payload = next(
        payload
        for method, path, payload in calls
        if method == "POST" and path.endswith("/points/search")
    )
    assert upsert_payload is not None
    assert upsert_payload["points"][0]["payload"]["snapshot_id"] == "spec-lock-v1"
    assert upsert_payload["points"][0]["payload"]["source"]["source_hash"] == "source-hash"
    assert search_payload is not None
    assert search_payload["filter"]["must"] == [
        {"key": "snapshot_id", "match": {"value": "spec-lock-v1"}},
        {"key": "category", "match": {"any": ["functional"]}},
    ]
    assert candidates[0].source.source_hash == "source-hash"
