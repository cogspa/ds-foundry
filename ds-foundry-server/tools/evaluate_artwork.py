"""Real-image naming regression; run from ds-foundry-server (see dataset README)."""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "evaluations/artwork/manifest.json"


def load_dataset(path=DATASET):
    data = json.loads(path.read_text())
    ids, reference_hashes = set(), set()
    for row in data["items"]:
        if row["id"] in ids:
            raise ValueError("Duplicate case ID")
        ids.add(row["id"])
        digest = hashlib.sha256((path.parent / row["image"]).read_bytes()).hexdigest()
        if digest != row["sha256"]:
            raise ValueError(f"Image changed: {row['id']}; review its label first")
        if row["split"] == "reference":
            reference_hashes.add(digest)
    if any(r["sha256"] in reference_hashes for r in data["items"] if r["split"] == "test"):
        raise ValueError("Reference image leaked into test set")
    return data


def score(dataset, predictions):
    tests = [r for r in dataset["items"] if r["split"] == "test"]
    expected = {r["id"] for r in tests}
    if len({p["key"] for p in predictions}) != len(predictions):
        raise ValueError("Duplicate prediction IDs")
    if {p["key"] for p in predictions} - expected:
        raise ValueError("Unknown prediction IDs")
    by_id = {p["key"]: p for p in predictions}
    counts, matches, groups, rows = Counter(), Counter(), {}, []
    for case in tests:
        p = by_id.get(case["id"], {})
        name = p.get("name", "").lower()
        tokens = set(re.findall(r"[a-z0-9]+", name))
        abstain = (not name or p.get("kind") == "abstract"
                   or p.get("note", "").startswith("unresolved")
                   or p.get("confidence", 0) < .5)
        reasons = []
        if not all(tokens.intersection(options) for options in case["required_terms"]):
            reasons.append("missing required subject/action terms")
        if case["accepted_kinds"] and p.get("kind") not in case["accepted_kinds"]:
            reasons.append("wrong whole-artwork/part category")
        status = "missed_identification" if abstain else "incorrect_identification" if reasons else "correct_identification"
        counts[status] += 1
        groups.setdefault(case["group"], Counter())[status] += 1
        # This measures name-based whole-character identity transfer, not vector retrieval.
        partial = bool(tokens & {"part", "fragment", "wing", "beak", "eye", "eyes", "face", "mask", "body"})
        predicted_match = not abstain and "ollie" in tokens and not partial and p.get("kind") in {"character", "illustration"}
        match_status = "not_scored"
        if case["expected_ollie_match"] is not None:
            wanted = case["expected_ollie_match"]
            match_status = ("correct_match" if predicted_match else "missed_match") if wanted else ("incorrect_match" if predicted_match else "correct_nonmatch")
            matches[match_status] += 1
        rows.append(dict(id=case["id"],expected=case["label"],prediction=p,status=status,reasons=reasons,match_status=match_status))
    total = len(tests)
    tp, fp, fn = matches["correct_match"], matches["incorrect_match"], matches["missed_match"]
    return dict(total=total,identifications=dict(counts),accuracy=counts["correct_identification"]/total if total else None,
                matches=dict(matches),match_precision=tp/(tp+fp) if tp+fp else None,
                match_recall=tp/(tp+fn) if tp+fn else None,groups=groups,cases=rows,
                missing_coverage=dataset["missing_coverage"])


def live_predictions(dataset, provider, model, critic):
    # Import only after configuring an isolated disposable data directory.
    sys.path.insert(0, str(ROOT))
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)
    with tempfile.TemporaryDirectory(prefix="dsf-artwork-eval-") as tmp:
        os.environ["DSF_DATA_DIR"] = tmp
        from app import glossary as storage
        from app.graph import run_naming
        from app.providers import get_chat_model, get_critic_model, DEFAULT_MODELS
        from app.schemas import Item, Reference
        storage.DATA_DIR = Path(tmp)
        encoded = lambda r: base64.b64encode((DATASET.parent/r["image"]).read_bytes()).decode()
        refs = [Reference(name="ollie", what="Ollie, a blue owl mascot waving. Other colors and poses may exist.", kind="character", image=encoded(r)) for r in dataset["items"] if r["split"] == "reference"]
        namer = get_chat_model(provider, model)
        judge = get_critic_model(provider, model, None) if critic else None
        predictions, calls = [], 0
        # One held-out image per call prevents other test images becoming references.
        for r in dataset["items"]:
            if r["split"] != "test":
                continue
            print(f"Evaluating {r['id']}…", flush=True)
            results, usage = run_naming([Item(key=r["id"],category="image",name="",image=encoded(r))],
                namer,judge,storage.Glossary(r["id"]),storage.Cache(r["id"]),critic,False,False,
                storage.Refs(r["id"]),refs)
            predictions.extend(p.model_dump() for p in results)
            calls += usage.calls
        return predictions, dict(provider=provider,model=model or DEFAULT_MODELS[provider],critic=critic,calls=calls)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Calls the configured provider; incurs normal API usage")
    parser.add_argument("--predictions", type=Path, help="Score saved predictions without API calls")
    parser.add_argument("--provider", choices=["anthropic","gemini","ollama"], default="gemini")
    parser.add_argument("--model")
    parser.add_argument("--no-critic", action="store_true")
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    dataset = load_dataset()
    if not args.live and not args.predictions:
        print(f"Validated {len(dataset['items'])} real images; coverage gaps: {dataset['missing_coverage']}")
        return
    if args.live and args.predictions:
        parser.error("Choose --live or --predictions")
    try:
        predictions, config = live_predictions(dataset,args.provider,args.model,not args.no_critic) if args.live else (json.loads(args.predictions.read_text())["predictions"], {"mode":"replay"})
    except Exception as error:
        # Avoid dumping provider payloads or credentials; a failed run is not a score.
        print(f"Evaluation stopped ({type(error).__name__}). Check provider credentials/model/connectivity. No score recorded.", file=sys.stderr)
        raise SystemExit(2)
    report = score(dataset,predictions)
    report.update(config=config,predictions=predictions,timestamp=datetime.now(timezone.utc).isoformat(),
                  dataset_sha256=hashlib.sha256(DATASET.read_bytes()).hexdigest(),
                  code_sha256=hashlib.sha256(b"".join(p.read_bytes() for p in sorted((ROOT/"app").glob("*.py")))).hexdigest())
    report["regressions"] = []
    if args.baseline:
        before = json.loads(args.baseline.read_text())
        if before["dataset_sha256"] != report["dataset_sha256"]:
            raise ValueError("Baseline uses different labels/images; create a new baseline")
        previous = {r["id"]:r for r in before["cases"]}
        for row in report["cases"]:
            old = previous[row["id"]]
            if (old["status"] == "correct_identification" and row["status"] != old["status"]) or (old["match_status"] in {"correct_match","correct_nonmatch"} and row["match_status"] != old["match_status"]):
                report["regressions"].append(row["id"])
    target = args.output or ROOT/"evaluations/artwork/runs"/(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".json")
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({k:report[k] for k in ["total","identifications","matches","accuracy","regressions"]},indent=2))
    print(f"Report: {target}")
    if report["regressions"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
