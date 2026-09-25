from __future__ import annotations

import base64
import hashlib
from collections.abc import Mapping
from typing import Any

import pytest
from conftest import sample_definition, sample_task

from agent_sdk.base_agent import BaseAgent
from agent_sdk.context import assemble_initial_context
from agent_sdk.contracts import ToolExecutionResult
from agent_sdk.errors import AgentSdkError
from agent_sdk.model import ModelContext
from agent_sdk.openai_compatible import (
    OpenAICompatibleAgentModel,
    OpenAICompatibleEmbeddingProvider,
    OpenAICompatibleEndpoint,
    OpenAICompatibleSemanticGapAnalyzer,
    OpenAICompatibleVisionAdapter,
    SourceVerifiedImageLoader,
    _NoRedirectHandler,
)
from agent_sdk.project_state import ProjectStateProjector, StageStateSchema, make_project_state
from agent_sdk.specification_gate import RequirementEntry, SpecificationGate, UnifiedSpecification
from agent_sdk.specifications import (
    DocumentFormat,
    DocumentNode,
    DocumentNodeKind,
    SourceRef,
    SpecificationCategory,
)
from agent_sdk.tools import ToolInvocationContext


class RecordingTransport:
    def __init__(self, responses: list[Mapping[str, Any]]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def post_json(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        payload: Mapping[str, Any],
        timeout_seconds: float,
    ) -> Mapping[str, Any]:
        self.calls.append(
            {
                "url": url,
                "headers": dict(headers),
                "payload": dict(payload),
                "timeout_seconds": timeout_seconds,
            }
        )
        return self._responses.pop(0)


class EchoToolExecutor:
    async def execute(self, _tool, context: ToolInvocationContext) -> ToolExecutionResult:
        return ToolExecutionResult(
            status="succeeded",
            output={"echoed": context.call.arguments["value"]},
        )


def test_endpoint_requires_explicit_opt_in_for_insecure_http():
    with pytest.raises(ValueError, match="HTTPS"):
        OpenAICompatibleEndpoint("http://provider.example/v1", "secret")

    endpoint = OpenAICompatibleEndpoint(
        "http://localhost:8000/v1",
        "local-secret",
        allow_insecure_http=True,
    )

    assert endpoint.url_for("/chat/completions") == "http://localhost:8000/v1/chat/completions"


def test_provider_transport_refuses_redirects_to_keep_credentials_endpoint_bound():
    handler = _NoRedirectHandler()

    assert handler.redirect_request(None, None, 302, "Found", None, "https://other.example") is None


def _context(*, provider: str = "openai-compatible", model: str = "test-model") -> ModelContext:
    definition = sample_definition(model_binding={"provider": provider, "model": model})
    task = sample_task()
    return ModelContext(
        task=task,
        prompt=assemble_initial_context(definition, task),
        iteration=1,
        project_state=ProjectStateProjector().project(
            make_project_state(
                project_id=task.id,
                revision=0,
                stage_schema=StageStateSchema(schema_id="test-v1", stage="test"),
            )
        ),
        observations=(),
        episodes=(),
        model_binding=definition.model_binding,
        output_schema=definition.output_schema,
    )


@pytest.mark.anyio
async def test_agent_adapter_maps_openai_function_calls_to_typed_tool_batch():
    transport = RecordingTransport(
        [
            {
                "id": "chatcmpl-1",
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "function": {
                                        "name": "echo",
                                        "arguments": '{"value":"ready"}',
                                    },
                                }
                            ]
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 11,
                    "completion_tokens": 7,
                    "prompt_tokens_details": {"cached_tokens": 2},
                    "completion_tokens_details": {"reasoning_tokens": 3},
                },
            }
        ]
    )
    adapter = OpenAICompatibleAgentModel(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        provider="openai-compatible",
        model="test-model",
        transport=transport,
    )

    response = await adapter.next_turn(_context())

    assert response.turn.type == "tool-batch"
    assert response.turn.calls[0].name == "echo"
    assert response.turn.calls[0].arguments == {"value": "ready"}
    assert response.usage and response.usage.reasoning_tokens == 3
    request = transport.calls[0]
    assert request["url"] == "https://provider.example/v1/chat/completions"
    assert request["headers"]["Authorization"] == "Bearer secret"
    assert request["payload"]["model"] == "test-model"
    assert request["payload"]["tools"][0]["function"]["name"] == "read_locked_interface"
    serialized_request = str(request["payload"])
    assert "secret" not in serialized_request


@pytest.mark.anyio
async def test_agent_adapter_rejects_model_binding_mismatch_without_transport_call():
    transport = RecordingTransport([])
    adapter = OpenAICompatibleAgentModel(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        provider="openai-compatible",
        model="different-model",
        transport=transport,
    )

    with pytest.raises(AgentSdkError, match="does not match") as raised:
        await adapter.next_turn(_context())

    assert raised.value.code == "MODEL_BINDING_MISMATCH"
    assert transport.calls == []


@pytest.mark.anyio
async def test_agent_adapter_maps_final_json_turn():
    transport = RecordingTransport(
        [
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"type":"final","output":{"status":"complete","findings":[]}}'
                            )
                        }
                    }
                ]
            }
        ]
    )
    adapter = OpenAICompatibleAgentModel(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        provider="openai-compatible",
        model="test-model",
        transport=transport,
    )

    response = await adapter.next_turn(_context())

    assert response.turn.type == "final"
    assert response.turn.output == {"status": "complete", "findings": []}


@pytest.mark.anyio
async def test_base_agent_resolves_openai_compatible_tool_call_through_bounded_continuation():
    transport = RecordingTransport(
        [
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "function": {
                                        "name": "echo",
                                        "arguments": '{"value":"ready"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"type":"final","output":{"status":"complete",'
                                '"findings":["ready is preserved"]}}'
                            )
                        }
                    }
                ]
            },
        ]
    )
    definition = sample_definition(
        model_binding={"provider": "openai-compatible", "model": "test-model"},
        termination_policy={"max_iterations": 2, "status_field": "status"},
    )
    adapter = OpenAICompatibleAgentModel(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        provider="openai-compatible",
        model="test-model",
        transport=transport,
    )

    result = await BaseAgent(definition, adapter, EchoToolExecutor()).run(sample_task())

    assert result.status.value == "completed"
    assert result.output == {"status": "complete", "findings": ["ready is preserved"]}
    continuation_messages = transport.calls[1]["payload"]["messages"]
    assert continuation_messages[-2]["role"] == "assistant"
    assert continuation_messages[-1] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "content": '{"error":null,"failure":null,"output":{"echoed":"ready"},"status":"succeeded"}',
    }
    assert any(event.type == "provider-tool-results-forwarded" for event in result.events)


def test_embedding_adapter_returns_only_valid_numeric_vectors():
    transport = RecordingTransport([{"data": [{"embedding": [0.25, 0.75]}]}])
    adapter = OpenAICompatibleEmbeddingProvider(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        model="embedding-test-model",
        transport=transport,
    )

    vector = adapter.embed("clock domain crossing")

    assert vector == [0.25, 0.75]
    assert transport.calls[0]["url"] == "https://provider.example/v1/embeddings"
    assert transport.calls[0]["payload"] == {
        "model": "embedding-test-model",
        "input": "clock domain crossing",
    }


@pytest.mark.anyio
async def test_vision_adapter_uses_host_image_loader_and_validates_typed_response():
    source = SourceRef(
        document_id="REQ-IFACE-001",
        relative_path="interfaces/ready.png",
        source_hash="source-hash",
        format=DocumentFormat.PNG,
        location="image:1",
    )
    node = DocumentNode(
        node_id="ready-waveform",
        kind=DocumentNodeKind.IMAGE,
        source=source,
        content={"name": "ready.png"},
    )
    transport = RecordingTransport(
        [
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"confidence":0.92,"structure":{"kind":"waveform",'
                                '"signals":["ready"]},"errors":[]}'
                            )
                        }
                    }
                ]
            }
        ]
    )
    adapter = OpenAICompatibleVisionAdapter(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        model="vision-test-model",
        image_loader=lambda received: b"image-bytes" if received == node else b"",
        transport=transport,
    )

    proposal = await adapter.extract(node)

    assert proposal.confidence == 0.92
    assert proposal.structure == {"kind": "waveform", "signals": ["ready"]}
    image_url = transport.calls[0]["payload"]["messages"][1]["content"][1]["image_url"]["url"]
    assert image_url == f"data:image/png;base64,{base64.b64encode(b'image-bytes').decode()}"


@pytest.mark.anyio
async def test_vision_adapter_rejects_image_bytes_beyond_host_limit():
    node = DocumentNode(
        node_id="large-image",
        kind=DocumentNodeKind.IMAGE,
        source=SourceRef(
            document_id="REQ-IFACE-001",
            relative_path="interfaces/ready.png",
            source_hash="source-hash",
            format=DocumentFormat.PNG,
            location="image:1",
        ),
        content={"name": "ready.png"},
    )
    transport = RecordingTransport([])
    adapter = OpenAICompatibleVisionAdapter(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        model="vision-test-model",
        image_loader=lambda _node: b"12345",
        transport=transport,
        max_image_bytes=4,
    )

    with pytest.raises(ValueError, match="byte limit"):
        await adapter.extract(node)

    assert transport.calls == []


def test_source_verified_image_loader_rejects_changed_standalone_source(tmp_path):
    source_path = tmp_path / "interfaces" / "ready.png"
    source_path.parent.mkdir()
    source_path.write_bytes(b"frozen-image")
    node = DocumentNode(
        node_id="ready-waveform",
        kind=DocumentNodeKind.IMAGE,
        source=SourceRef(
            document_id="REQ-IFACE-001",
            relative_path="interfaces/ready.png",
            source_hash=hashlib.sha256(b"frozen-image").hexdigest(),
            format=DocumentFormat.PNG,
            location="image:1",
        ),
        content={"name": "ready.png"},
    )
    loader = SourceVerifiedImageLoader(str(tmp_path))

    assert loader(node) == b"frozen-image"

    source_path.write_bytes(b"changed-image")
    with pytest.raises(ValueError, match="hash"):
        loader(node)


@pytest.mark.anyio
async def test_semantic_analyzer_returns_receipt_bound_proposals_for_gate_admission():
    source = SourceRef(
        document_id="REQ-READY",
        relative_path="functional/requirements.md",
        source_hash="source-hash",
        format=DocumentFormat.MD,
        location="line:1",
    )
    specification = UnifiedSpecification(
        version="1.0.0",
        documents=[],
        requirements=[
            RequirementEntry(
                id="REQ-READY",
                category=SpecificationCategory.FUNCTIONAL,
                text="The interface shall assert ready.",
                source_refs=[source],
                acceptance_checks=["test-ready"],
            )
        ],
    )
    transport = RecordingTransport(
        [
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"findings":[{"finding_id":"ready-condition",'
                                '"type":"ambiguity","requirement_ids":["REQ-READY"],'
                                '"source_refs":[{"document_id":"REQ-READY",'
                                '"relative_path":"functional/requirements.md",'
                                '"source_hash":"source-hash","format":"md",'
                                '"location":"line:1"}],"description":"Condition missing.",'
                                '"suggested_fix":"Declare it.","severity":"IMPORTANT"}]}'
                            )
                        }
                    }
                ]
            }
        ]
    )
    analyzer = OpenAICompatibleSemanticGapAnalyzer(
        OpenAICompatibleEndpoint("https://provider.example/v1", "secret"),
        provider="selected-provider",
        model="semantic-model",
        transport=transport,
    )

    analysis = await analyzer.analyze(specification)
    _graph, report = SpecificationGate().validate(
        specification,
        required_categories=set(),
        semantic_findings=analysis.findings,
    )

    assert analysis.findings[0].analysis_provider == "selected-provider"
    assert analysis.findings[0].analysis_model == "semantic-model"
    assert len(analysis.findings[0].analysis_receipt_digest) == 64
    assert report.summary()["semantic_findings_accepted"] == 1
    assert transport.calls[0]["payload"]["model"] == "semantic-model"
