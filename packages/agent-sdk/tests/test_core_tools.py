from __future__ import annotations

from pathlib import Path

import pytest

from agent_sdk.artifacts import ArtifactStore
from agent_sdk.context_projection import InMemoryToolResultJournal
from agent_sdk.contracts import ToolCall, ToolExecutionResult
from agent_sdk.core_tools import CoreToolDispatcher, CoreToolServices, SearchResult


class StubSearch:
    async def search(self, query: str, limit: int) -> list[SearchResult]:
        assert query == "OpenROAD timing"
        return [SearchResult(title="result", url="https://example.com", snippet="untrusted")][
            :limit
        ]


@pytest.mark.anyio
async def test_core_tools_bound_paths_write_only_declared_outputs_and_mark_web_untrusted(
    tmp_path: Path,
) -> None:
    (tmp_path / "input.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    artifacts = ArtifactStore(tmp_path)
    journal = InMemoryToolResultJournal()
    handle = journal.record(
        ToolCall(id="call-1", name="echo", arguments={}),
        ToolExecutionResult(status="succeeded", output={"message": "evidence"}),
    )
    tools = CoreToolDispatcher(
        CoreToolServices(
            root=tmp_path,
            artifacts=artifacts,
            declared_output_paths=("draft.txt",),
            result_journal=journal,
            search_client=StubSearch(),
        )
    )

    read = await tools.execute("read_file", {"path": "input.txt"})
    assert read.status == "succeeded"
    assert read.output["lines"][0]["text"] == "alpha"
    assert (await tools.execute("read_file", {"path": "../outside.txt"})).status == "failed"

    globbed = await tools.execute("glob", {"pattern": "*.txt"})
    assert globbed.output["matches"] == ["input.txt"]
    grep = await tools.execute("grep", {"pattern": "beta"})
    assert grep.output["matches"][0]["line"] == 2

    written = await tools.execute("write_draft", {"path": "draft.txt", "content": "v1"})
    assert written.status == "succeeded"
    edited = await tools.execute(
        "edit_draft", {"path": "draft.txt", "old_text": "v1", "new_text": "v2"}
    )
    assert edited.output["replacements"] == 1
    assert (
        await tools.execute("write_draft", {"path": "undeclared.txt", "content": "x"})
    ).status == "failed"

    result = await tools.execute("get_tool_result", {"handle_id": handle.handle_id})
    assert result.status == "succeeded"
    assert result.output["handle_id"] == handle.handle_id

    search = await tools.execute("web_search", {"query": "OpenROAD timing"})
    assert search.output["untrusted_content"] is True
    assert (await tools.execute("web_fetch", {"url": "http://127.0.0.1/"})).status == "failed"


@pytest.mark.anyio
async def test_exact_edit_rejects_ambiguous_replacement(tmp_path: Path) -> None:
    artifacts = ArtifactStore(tmp_path)
    tools = CoreToolDispatcher(
        CoreToolServices(root=tmp_path, artifacts=artifacts, declared_output_paths=("draft.txt",))
    )
    await tools.execute("write_draft", {"path": "draft.txt", "content": "same same"})
    result = await tools.execute(
        "edit_draft", {"path": "draft.txt", "old_text": "same", "new_text": "new"}
    )
    assert result.status == "failed"
    assert "ambiguous" in (result.error or "")


@pytest.mark.anyio
async def test_grep_enforces_regex_deadline_and_aggregate_scan_budget(tmp_path: Path) -> None:
    (tmp_path / "catastrophic.txt").write_text("a" * 40 + "!", encoding="utf-8")
    (tmp_path / "second.txt").write_text("beta", encoding="utf-8")
    tools = CoreToolDispatcher(
        CoreToolServices(
            root=tmp_path,
            artifacts=ArtifactStore(tmp_path),
            declared_output_paths=(),
            max_grep_seconds=0.5,
            max_grep_total_bytes=44,
        )
    )

    timed_out = await tools.execute("grep", {"pattern": "(a+)+$", "file_glob": "*.txt"})
    assert timed_out.status == "failed"
    assert "GREP_REGEX_TIMEOUT" in (timed_out.error or "")

    normal_tools = CoreToolDispatcher(
        CoreToolServices(
            root=tmp_path,
            artifacts=ArtifactStore(tmp_path),
            declared_output_paths=(),
            max_grep_total_bytes=44,
        )
    )
    bounded = await normal_tools.execute("grep", {"pattern": "beta", "file_glob": "*.txt"})
    assert bounded.status == "succeeded"
    assert bounded.output["scan_truncated"] is True
