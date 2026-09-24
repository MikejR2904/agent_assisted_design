"""Stable error categories and safe failure-detail handling for the Python runtime."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

_SECRET_KEY = re.compile(
    r"(authorization|api[_-]?key|password|secret|token|cookie|credential|private[_-]?key)",
    re.IGNORECASE,
)
_HIDDEN_REASONING_KEYS = {"chain_of_thought", "hidden_reasoning", "reasoning_trace", "scratchpad"}
_MAX_FAILURE_DETAIL_CHARS = 2_048


@dataclass(eq=False)
class AgentSdkError(Exception):
    """A contract or runtime failure that can be returned as typed agent state."""

    code: str
    message: str
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


def sanitize_failure_details(details: dict[str, Any] | None) -> dict[str, Any]:
    """Redact, bound, and remove private reasoning before durable result exposure."""

    redacted = _redact_failure_value(details or {})
    encoded = json.dumps(redacted, sort_keys=True, separators=(",", ":"), default=str)
    if len(encoded) <= _MAX_FAILURE_DETAIL_CHARS:
        return redacted if isinstance(redacted, dict) else {"value": redacted}
    return {
        "truncated": True,
        "content_hash": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "original_chars": len(encoded),
        "preview": encoded[:_MAX_FAILURE_DETAIL_CHARS],
    }


def _redact_failure_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): (
                "[REDACTED]"
                if _SECRET_KEY.search(str(key)) or str(key).lower() in _HIDDEN_REASONING_KEYS
                else _redact_failure_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_failure_value(item) for item in value]
    return value
