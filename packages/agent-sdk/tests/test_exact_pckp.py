from __future__ import annotations

from agent_sdk.optimization import (
    ExactPckpSolver,
    GreedyPckpBaseline,
    PckpItem,
    PckpProblem,
    PckpStatus,
)


def test_exact_pckp_handles_shared_and_multiple_prerequisites_once():
    problem = PckpProblem(
        token_budget=9,
        items=[
            PckpItem(item_id="root", token_cost=2, utility=0),
            PckpItem(item_id="left", token_cost=3, utility=1, prerequisites=["root"]),
            PckpItem(item_id="right", token_cost=3, utility=1, prerequisites=["root"]),
            PckpItem(
                item_id="joint",
                token_cost=1,
                utility=10,
                prerequisites=["left", "right"],
            ),
            PckpItem(item_id="alternative", token_cost=6, utility=11),
        ],
    )

    solution = ExactPckpSolver().solve(problem)

    assert solution.status is PckpStatus.OPTIMAL
    assert solution.solver == "branch-and-bound"
    assert solution.selected_item_ids == ["joint", "left", "right", "root"]
    assert solution.token_cost == 9
    assert solution.utility == 12
    assert solution.upper_bound == "12"
    assert solution.optimality_gap == "0"


def test_greedy_baseline_uses_same_objective_but_can_lose_to_exact_selection():
    problem = PckpProblem(
        token_budget=9,
        items=[
            PckpItem(item_id="root", token_cost=2, utility=0),
            PckpItem(item_id="left", token_cost=3, utility=1, prerequisites=["root"]),
            PckpItem(item_id="right", token_cost=3, utility=1, prerequisites=["root"]),
            PckpItem(
                item_id="joint",
                token_cost=1,
                utility=10,
                prerequisites=["left", "right"],
            ),
            PckpItem(item_id="alternative", token_cost=6, utility=11),
        ],
    )

    exact = ExactPckpSolver().solve(problem)
    greedy = GreedyPckpBaseline().solve(problem)

    assert exact.utility == 12
    assert greedy.utility == 11
    assert greedy.selected_item_ids == ["alternative"]
    assert greedy.problem_hash == exact.problem_hash


def test_exact_pckp_reports_infeasible_mandatory_closure_without_truncation():
    problem = PckpProblem(
        token_budget=4,
        items=[
            PckpItem(item_id="source", token_cost=3, utility=1, mandatory=True),
            PckpItem(
                item_id="active-action",
                token_cost=3,
                utility=2,
                prerequisites=["source"],
                mandatory=True,
            ),
        ],
    )

    solution = ExactPckpSolver().solve(problem)

    assert solution.status is PckpStatus.INFEASIBLE_MANDATORY
    assert solution.mandatory_item_ids == ["active-action", "source"]
    assert solution.token_cost == 6
    assert "exceeds" in solution.diagnostics[0]


def test_exact_pckp_uses_lexicographic_tie_breaking():
    problem = PckpProblem(
        token_budget=2,
        items=[
            PckpItem(item_id="alpha", token_cost=2, utility=5),
            PckpItem(item_id="beta", token_cost=2, utility=5),
        ],
    )

    solution = ExactPckpSolver().solve(problem)

    assert solution.status is PckpStatus.OPTIMAL
    assert solution.selected_item_ids == ["alpha"]


def test_verified_rooted_forest_uses_tree_dynamic_program():
    problem = PckpProblem(
        token_budget=4,
        items=[
            PckpItem(item_id="root", token_cost=1, utility=1),
            PckpItem(item_id="child-a", token_cost=2, utility=4, prerequisites=["root"]),
            PckpItem(item_id="child-b", token_cost=3, utility=5, prerequisites=["root"]),
        ],
    )

    solution = ExactPckpSolver().solve(problem)

    assert solution.status is PckpStatus.OPTIMAL
    assert solution.solver == "tree-dynamic-program"
    assert solution.selected_item_ids == ["child-b", "root"]
    assert solution.utility == 6
