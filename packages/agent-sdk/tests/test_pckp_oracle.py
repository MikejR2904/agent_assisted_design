from __future__ import annotations

from itertools import chain, combinations

from agent_sdk.optimization import ExactPckpSolver, PckpItem, PckpProblem, PckpStatus


def _oracle(problem: PckpProblem) -> tuple[list[str], int]:
    items = {item.item_id: item for item in problem.items}
    item_ids = sorted(items)
    best_ids: list[str] = []
    best_utility = -1
    for subset in chain.from_iterable(
        combinations(item_ids, size) for size in range(len(item_ids) + 1)
    ):
        selected = set(subset)
        if any(item.mandatory and item.item_id not in selected for item in items.values()):
            continue
        if any(not set(items[item_id].prerequisites).issubset(selected) for item_id in selected):
            continue
        cost = sum(items[item_id].token_cost for item_id in selected)
        if cost > problem.token_budget:
            continue
        utility = sum(items[item_id].utility for item_id in selected)
        selected_ids = sorted(selected)
        if utility > best_utility or (utility == best_utility and selected_ids < best_ids):
            best_ids, best_utility = selected_ids, utility
    return best_ids, best_utility


def test_exact_pckp_matches_independent_exhaustive_oracle_on_small_cases():
    cases = [
        PckpProblem(
            token_budget=5,
            items=[
                PckpItem(item_id="a", token_cost=2, utility=2),
                PckpItem(item_id="b", token_cost=3, utility=4, prerequisites=["a"]),
                PckpItem(item_id="c", token_cost=3, utility=5),
            ],
        ),
        PckpProblem(
            token_budget=6,
            items=[
                PckpItem(item_id="root", token_cost=1, utility=0),
                PckpItem(item_id="left", token_cost=2, utility=2, prerequisites=["root"]),
                PckpItem(item_id="right", token_cost=2, utility=3, prerequisites=["root"]),
                PckpItem(
                    item_id="fan-in",
                    token_cost=1,
                    utility=7,
                    prerequisites=["left", "right"],
                ),
            ],
        ),
        PckpProblem(
            token_budget=4,
            items=[
                PckpItem(item_id="zero", token_cost=0, utility=1),
                PckpItem(item_id="a", token_cost=2, utility=3),
                PckpItem(item_id="b", token_cost=2, utility=3),
            ],
        ),
    ]

    solver = ExactPckpSolver(enable_tree_dynamic_program=False)
    for problem in cases:
        expected_ids, expected_utility = _oracle(problem)
        solution = solver.solve(problem)
        assert solution.status is PckpStatus.OPTIMAL
        assert solution.selected_item_ids == expected_ids
        assert solution.utility == expected_utility
        assert solution.upper_bound == str(expected_utility)
        assert solution.optimality_gap == "0"
