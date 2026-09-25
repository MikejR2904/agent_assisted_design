from __future__ import annotations

from pathlib import Path

import pytest

import agent_sdk.atomic_io as atomic_io


def test_replace_atomic_retries_transient_permission_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "target.txt"
    temporary = tmp_path / ".target.txt.tmp"
    temporary.write_text("published", encoding="utf-8")
    real_replace = atomic_io.os.replace
    calls = 0

    def fail_once(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise PermissionError("transient destination lock")
        real_replace(source, destination)

    monkeypatch.setattr(atomic_io.os, "replace", fail_once)

    atomic_io.replace_atomic(temporary, target)

    assert calls == 2
    assert target.read_text(encoding="utf-8") == "published"


def test_replace_atomic_preserves_terminal_permission_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    temporary = tmp_path / ".target.txt.tmp"
    temporary.write_text("unpublished", encoding="utf-8")

    def always_fail(_source: Path, _destination: Path) -> None:
        raise PermissionError("persistent destination lock")

    monkeypatch.setattr(atomic_io.os, "replace", always_fail)

    with pytest.raises(PermissionError, match="persistent destination lock"):
        atomic_io.replace_atomic(temporary, tmp_path / "target.txt", attempts=2)
