"""Run the frozen PCKP comparison cases from the package root.

Usage:
    uv run python scripts/run_pckp_benchmark.py
"""

from __future__ import annotations

from pathlib import Path

from agent_sdk.benchmarks import load_pckp_cases, run_pckp_benchmark, write_pckp_benchmark_report

root = Path(__file__).resolve().parents[1]
report = run_pckp_benchmark(load_pckp_cases(root / "benchmarks" / "pckp_cases.json"))
output = root / "benchmarks" / "results" / "pckp-report.json"
write_pckp_benchmark_report(report, output)
print(output)
