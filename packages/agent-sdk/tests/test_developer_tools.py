from __future__ import annotations

import json
from pathlib import Path

from conftest import sample_definition

from agent_sdk.audit_log import AuditTranscriptStore
from agent_sdk.developer_tools.catalog import build_public_api_catalog, write_public_api_catalog
from agent_sdk.developer_tools.cli import main
from agent_sdk.developer_tools.inspect import inspect_run
from agent_sdk.developer_tools.quality import check_source_quality
from agent_sdk.developer_tools.validate import validate_contract_file
from agent_sdk.telemetry import (
    TelemetryActor,
    TelemetryAuthority,
    TelemetryContext,
    TelemetryStore,
)


def test_public_catalog_is_explicit_and_writable(tmp_path: Path) -> None:
    catalog = build_public_api_catalog()

    assert catalog.package_name == "agent-design-agent-sdk"
    assert any(symbol.name == "BaseAgent" for symbol in catalog.symbols)
    assert catalog.symbols == sorted(catalog.symbols, key=lambda symbol: symbol.name)

    path = tmp_path / "api.json"
    written = write_public_api_catalog(path)
    assert path.is_file()
    assert (
        json.loads(path.read_text(encoding="utf-8"))["package_version"] == written.package_version
    )


def test_contract_validator_reports_structured_schema_errors(tmp_path: Path) -> None:
    valid_path = tmp_path / "definition.json"
    valid_path.write_text(sample_definition().model_dump_json(), encoding="utf-8")
    valid = validate_contract_file(valid_path, "agent-definition")
    assert valid.valid is True

    invalid_path = tmp_path / "invalid.yaml"
    invalid_path.write_text("identity: only-one-field\n", encoding="utf-8")
    invalid = validate_contract_file(invalid_path, "agent-definition")
    assert invalid.valid is False
    assert invalid.issues


def test_run_inspection_verifies_read_only_evidence(tmp_path: Path) -> None:
    telemetry = TelemetryStore(tmp_path)
    telemetry.emit(
        "agent.started",
        TelemetryContext(run_id="run-1"),
        actor=TelemetryActor(kind="system", identifier="test"),
        authority=TelemetryAuthority.DETERMINISTIC,
        status="started",
    )
    audit = AuditTranscriptStore(tmp_path)
    audit.append("run-1", "task-received", {"instruction": "Return a typed result."})

    inspection = inspect_run(tmp_path, "run-1")
    assert inspection.telemetry_chain_valid is True
    assert inspection.audit_chain_valid is True
    assert inspection.event_types == {"agent.started": 1}
    assert inspection.audit_entry_count == 1


def test_quality_tool_checks_the_sdk_checkout() -> None:
    package_root = Path(__file__).resolve().parents[1]
    report = check_source_quality(package_root)

    assert report.passed is True
    assert report.checked_paths == ["src", "tests", "examples", "scripts"]


def test_cli_returns_nonzero_for_invalid_contract(tmp_path: Path, capsys) -> None:
    invalid_path = tmp_path / "invalid.json"
    invalid_path.write_text("{}", encoding="utf-8")

    status = main(["validate", "agent-definition", str(invalid_path)])

    assert status == 1
    assert '"valid": false' in capsys.readouterr().out
