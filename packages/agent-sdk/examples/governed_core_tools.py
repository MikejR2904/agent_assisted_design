"""Run from package root: ``uv run python examples/governed_core_tools.py``.

This shows how a host opt-ins to the SDK's portable local tools. In an agent run,
``HarnessToolExecutor`` applies CapabilityPolicy before invoking the same dispatcher.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory

from agent_sdk import ArtifactStore, CoreToolDispatcher, CoreToolServices


async def main() -> None:
    with TemporaryDirectory(prefix="agent-sdk-core-tools-") as temporary:
        root = Path(temporary)
        (root / "interface.txt").write_text("ready: 1\nvalid: 1\n", encoding="utf-8")
        dispatcher = CoreToolDispatcher(
            CoreToolServices(
                root=root,
                artifacts=ArtifactStore(root),
                declared_output_paths=("drafts/notes.txt",),
            )
        )
        read = await dispatcher.execute("read_file", {"path": "interface.txt"})
        draft = await dispatcher.execute(
            "write_draft",
            {"path": "drafts/notes.txt", "content": "Keep ready/valid invariant."},
        )
        denied = await dispatcher.execute(
            "write_draft", {"path": "outside.txt", "content": "This is rejected."}
        )
        print(
            {"read": read.model_dump(), "draft": draft.model_dump(), "denied": denied.model_dump()}
        )


if __name__ == "__main__":
    asyncio.run(main())
