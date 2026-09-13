import copy
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("artwork_eval", Path(__file__).resolve().parents[1]/"tools/evaluate_artwork.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_real_images_and_labels_are_intact():
    data = evaluation.load_dataset()
    assert len([r for r in data["items"] if r["split"] == "test"]) == 11
    assert data["missing_coverage"]  # Do not silently claim logo/debris coverage.


def test_missing_predictions_count_as_misses_not_excluded_cases():
    result = evaluation.score(evaluation.load_dataset(), [])
    assert result["total"] == 11
    assert result["identifications"] == {"missed_identification":11}
    assert result["matches"]["missed_match"] == 3
    assert result["accuracy"] == 0


def test_correct_missed_and_false_identity_transfers():
    result = evaluation.score(evaluation.load_dataset(), [
        dict(key="blue-running",name="ollie-blue-running",kind="character",confidence=.9),
        dict(key="cloud-screenshot",name="ollie-cloud",kind="character",confidence=.9),
        dict(key="wing-part",name="ollie-wing",kind="symbol",confidence=.9),
    ])
    rows = {r["id"]:r for r in result["cases"]}
    assert rows["blue-running"]["match_status"] == "correct_match"
    assert rows["cloud-screenshot"]["match_status"] == "incorrect_match"
    assert rows["cloud-screenshot"]["status"] == "incorrect_identification"
    assert rows["wing-part"]["match_status"] == "correct_nonmatch"
    assert rows["wing-part"]["status"] == "correct_identification"
    assert result["match_precision"] == .5
    assert result["match_recall"] == pytest.approx(1/3)


def test_low_confidence_correct_name_is_still_unresolved():
    result = evaluation.score(evaluation.load_dataset(), [dict(key="blue-running",name="ollie",kind="character",confidence=.2)])
    assert result["cases"][0]["status"] == "missed_identification"


def test_unknown_and_duplicate_predictions_rejected():
    data = evaluation.load_dataset()
    with pytest.raises(ValueError,match="Unknown"):
        evaluation.score(data,[dict(key="invented")])
    with pytest.raises(ValueError,match="Duplicate"):
        evaluation.score(data,[dict(key="blue-running")]*2)


def test_reference_leakage_is_rejected(tmp_path):
    import json
    data = copy.deepcopy(evaluation.load_dataset())
    for row in data["items"]:
        row["image"] = str(evaluation.DATASET.parent/row["image"])
    data["items"][1]["image"] = data["items"][0]["image"]
    data["items"][1]["sha256"] = data["items"][0]["sha256"]
    manifest = tmp_path/"manifest.json"
    manifest.write_text(json.dumps(data))
    with pytest.raises(ValueError,match="leaked"):
        evaluation.load_dataset(manifest)


def test_cli_writes_regression_report_and_fails(tmp_path):
    import json
    import subprocess
    import sys
    baseline = evaluation.DATASET.parent/"baseline.json"
    saved = json.loads(baseline.read_text())
    next(p for p in saved["predictions"] if p["key"] == "blue-running")["name"] = ""
    predictions, report = tmp_path/"predictions.json", tmp_path/"report.json"
    predictions.write_text(json.dumps(saved))
    run = subprocess.run([sys.executable,str(evaluation.ROOT/"tools/evaluate_artwork.py"),
        "--predictions",str(predictions),"--baseline",str(baseline),"--output",str(report)],capture_output=True,text=True)
    assert run.returncode == 1, run.stderr
    assert json.loads(report.read_text())["regressions"] == ["blue-running"]
