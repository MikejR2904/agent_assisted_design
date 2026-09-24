"""Stable error categories for the Python BaseAgent runtime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(eq=False)
class AgentSdkError(Exception):
    """A contract or runtime failure that can be returned as typed agent state."""

    code: str
    message: str
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message
