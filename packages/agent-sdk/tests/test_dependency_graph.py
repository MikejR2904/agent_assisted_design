from __future__ import annotations

from agent_sdk.dependency_graph import deterministic_cycles, reverse_reachable_nodes


def test_reverse_reachability_counts_transitive_known_dependents_from_missing_root():
    affected = reverse_reachable_nodes(
        ["REQ-A", "REQ-B", "REQ-C"],
        [
            ("REQ-A", "REQ-MISSING"),
            ("REQ-B", "REQ-A"),
            ("REQ-C", "REQ-B"),
            ("REQ-UNKNOWN", "REQ-MISSING"),
        ],
        "REQ-MISSING",
    )

    assert affected == ["REQ-A", "REQ-B", "REQ-C"]


def test_cycle_traversal_is_stable_and_ignores_unknown_endpoint():
    cycles = deterministic_cycles(
        ["REQ-A", "REQ-B", "REQ-C"],
        [
            ("REQ-C", "REQ-A"),
            ("REQ-A", "REQ-B"),
            ("REQ-B", "REQ-C"),
            ("REQ-A", "REQ-MISSING"),
        ],
    )

    assert cycles == [["REQ-A", "REQ-B", "REQ-C", "REQ-A"]]
