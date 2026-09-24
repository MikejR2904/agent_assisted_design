from __future__ import annotations

from pathlib import Path

from agent_sdk.benchmarks import load_pckp_cases, run_pckp_benchmark, write_pckp_benchmark_report
from agent_sdk.optimization import PckpStatus


def test_frozen_pckp_benchmark_compares_identical_problem_inputs(tmp_path: Path):
    cases = load_pckp_cases(Path("benchmarks/pckp_cases.json"))

    report = run_pckp_benchmark(cases)

    trap = next(
        result for result in report.results if result.case_id == "shared-prerequisite-density-trap"
    )
    assert trap.exact.problem_hash == trap.greedy.problem_hash == trap.problem_hash
    assert trap.exact.status is PckpStatus.OPTIMAL
    assert trap.retained_utility_gap == 1

    report_path = tmp_path / "pckp-report.json"
    write_pckp_benchmark_report(report, report_path)
    assert '"schema_version": "pckp-benchmark-v1"' in report_path.read_text(encoding="utf-8")
