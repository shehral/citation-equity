"""E2 analysis (experiments/PLAN_E2.md), with E1's statistics (experiments/e1/analyze.py), numpy only.

E2a, per set (main, replication), reading E1's cells for the original and arm 9 and E2a's cells for
9W and 9P (E1's answers for the original and arm 9 are reused, not regenerated):
- Planned tests, one Holm family at alpha 0.05: 9 vs 9W (the heading markup) and 9 vs 9P (the
  query's words). d_q = mean over judges of cell(9) - cell(9W or 9P), the unit is the query, as in E1.
- Reported without a verdict: 9W vs original and 9P vs original.
- Labels are E1's verdict rules (helps, hurts, no effect larger than 0.03, inconclusive, and
  model-dependent), with E1's minimum of 30 queries. The length and key-term regression is reported
  next to each contrast; it does not change a label (in 9 vs 9P the key-term change is the very thing
  tested).
- The reading follows the plan's table: heading markup, query words, both, or neither.

E2b, on the main set: E1's arm 12 and ALL (with their placebos) edited again by Qwen3.8-27B, judged by
Gemma-4-12B and Qwen3.5-9B. For 12 vs P12 and ALL vs P_ALL the E1 label "stands" if d keeps the sign
E1's d had (E1's cells, E1's judges), and becomes "editor-dependent" otherwise. Every Qwen version is
also reported against the original, and the pages whose Qwen edits failed validation are listed.

Inputs: E1's data (pages, versions, applicability, prompt_build.json) and out (cells, scores,
score_summary.json, analysis.json if present); E2a's and E2b's data (versions, prompt_build.json)
and out (from score.py). A part whose cells are missing is "not run".
Output: <out>/analysis_e2.json.

Usage: python3 -I experiments/e2/analyze_e2.py [--e1-data DIR] [--e1-out DIR] [--e2a-data DIR]
           [--e2a-out DIR] [--e2b-data DIR] [--e2b-out DIR] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E2_DIR = Path(__file__).resolve().parent
E1_DIR = E2_DIR.parent / "e1"
sys.path.insert(0, str(E1_DIR))

import analyze as an  # noqa: E402
from e1_common import ALPHA, DELTA, E2_ARMS, JUDGE_ORDER, MIN_N, read_jsonl, write_json  # noqa: E402

E2A_FAMILY = [("9", "9W"), ("9", "9P")]
E2A_REPORTED = [("9W", "original"), ("9P", "original")]
E1_REUSED_ARMS = ("original", "9")  # E2a reads these from E1
E2B_JUDGES = ["gemma-4-12b", "qwen3.5-9b"]  # Qwen3.8-27B is E2b's editor, so it is not a judge
E2B_EDITOR = "Qwen/Qwen3.8-27B"
E2B_CONTRASTS = [("12", "P12"), ("ALL", "P_ALL")]
E2B_ARMS = ["12", "P12", "ALL", "P_ALL"]
REPORTED = "reported without a verdict"
STANDS, EDITOR_DEPENDENT = "stands", "editor-dependent"

# ---------- inputs ----------


def e2a_inputs(e1: an.Inputs, *, versions, cells, completion, scores=(), refused=()) -> an.Inputs:
    """E1's pages and applicability; the original and arm 9 from E1; 9W and 9P from E2a."""
    def from_e1(rows):
        return [r for r in rows if r["arm"] in E1_REUSED_ARMS]

    def from_e2(rows):
        return [r for r in rows if r["arm"] in E2_ARMS]

    return an.Inputs(
        pages=e1.pages, applicability=e1.applicability,
        versions=from_e1(e1.versions) + from_e2(versions),
        cells=from_e1(e1.cells) + from_e2(cells),
        scores=from_e1(e1.scores) + from_e2(list(scores)),
        completion=None if e1.completion is None else from_e1(e1.completion) + from_e2(completion),
        refused=sorted(set(e1.refused) | set(refused)),
    )


def _load(data: Path, out: Path, fallback: an.Inputs | None = None) -> an.Inputs | None:
    """One folder pair as Inputs, or None when it has no cells. Pages and applicability fall back to E1's."""
    if not (out / "cells.jsonl").exists() or not (data / "versions.jsonl").exists():
        return None

    def rows(path: Path, default):
        return read_jsonl(path) if path.exists() else default

    summary_path, build_path = out / "score_summary.json", data / "prompt_build.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
    build = json.loads(build_path.read_text(encoding="utf-8")) if build_path.exists() else {"refused": []}
    return an.Inputs(
        pages=rows(data / "pages.jsonl", fallback.pages if fallback else []),
        versions=read_jsonl(data / "versions.jsonl"),
        applicability=rows(data / "applicability.jsonl", fallback.applicability if fallback else []),
        cells=read_jsonl(out / "cells.jsonl"), scores=rows(out / "scores.jsonl", []),
        completion=summary["completion"] if summary else None,
        refused=[r["query_id"] for r in build["refused"]],
    )


# ---------- contrasts ----------


def _contrast(ix: an.Index, t: dict, judges: list[str], m: int, draws: int, resamples: int) -> dict:
    """One contrast with E1's statistics: d, intervals, p, per-judge means, MDE, confound regression."""
    stats = an._summary(t["d"], draws, resamples, p=t["p"])
    per_judge = {}
    for j in judges:
        jd = t["info"]["per_judge"][j]
        per_judge[j] = {"mean_d": float(np.mean(list(jd.values()))) if jd else None,
                        "p": an.sign_flip_p([jd[q] for q in sorted(jd)], draws) if jd else None}
    alpha = ALPHA / m if m else ALPHA
    return {"arm": t["arm"], "ref": t["ref"], "status": t["status"], "dropped_cells": t["info"]["dropped_cells"],
            **stats, "p_holm": t["p_holm"], "mde": an.realized_mde(stats["sd"], stats["n"], alpha),
            "mde_alpha": alpha, "per_judge": per_judge, "confound": an._confound(ix, t["arm"], t["ref"], t["d"]),
            "secondary": {metric: an._summary(an.query_differences(ix, t["arm"], t["ref"], judges, metric)[0],
                                              draws, resamples)
                          for metric in ("cited", "pawc", "valid_rate")}}


def reading(label_w: str, label_p: str) -> dict:
    """The plan's reading of the two planned labels (9 vs 9W, 9 vs 9P)."""
    helps, none = "helps", an.NO_EFFECT
    table = {
        (helps, none): ("heading markup", "The heading markup carries the gain; the tool keeps \"use question "
                                          "headings\" as written."),
        (none, helps): ("query words", "The query's words carry the gain; the tool's advice becomes \"use your "
                                       "reader's words near the top\", and question headings stay mixed evidence."),
        (helps, helps): ("both", "Both the heading markup and the query's words matter."),
        (none, none): ("neither", "Neither the heading markup nor the query's words carries the gain: it comes from "
                                  "the position or the added length, and the tool says so."),
    }
    if (label_w, label_p) in table:
        case, text = table[(label_w, label_p)]
        return {"case": case, "text": text}
    return {"case": None, "text": f"The plan gives no reading for this pair of labels (9 vs 9W: {label_w}; "
                                  f"9 vs 9P: {label_p}), so no reading is drawn."}


def _version_stats(ix: an.Index, arms: list[str]) -> dict:
    out = {}
    for arm in arms:
        rows = [ix.version[(q, arm)] for q in ix.queries if (q, arm) in ix.version and ix.applicable(q, arm)]
        valid = [v for v in rows if v["valid"]]

        def mean(name, valid=valid):
            xs = [float(v[name]) for v in valid if v.get(name) is not None]
            return float(np.mean(xs)) if xs else None

        out[arm] = {"applicable": len(rows), "valid": len(valid), "invalid": len(rows) - len(valid),
                    "mean_edit_distance": mean("edit_distance"), "mean_length_ratio": mean("length_ratio"),
                    "mean_key_terms_delta": mean("key_terms_delta"),
                    "failed": [{"query_id": v["query_id"], "reason": v.get("excluded_reason")}
                               for v in rows if not v["valid"]]}
    return out


# ---------- E2a ----------


def analyze_e2a(inp: an.Inputs, set_name: str, *, judges=JUDGE_ORDER, draws: int = an.DRAWS,
                resamples: int = an.RESAMPLES) -> dict:
    ix = an.Index(inp, set_name)
    mode, vj, secondary = an.decide_mode(ix, list(judges))
    spec = {"families": {"E2a": list(E2A_FAMILY)}, "descriptive": list(E2A_REPORTED)}
    tests = an.primary_tests(ix, spec, vj, draws)
    ok = [t for t in tests if t["family"] == "E2a" and t["status"] == "ok"]
    m = len(ok)
    planned, reported = [], []
    for t in tests:
        c = _contrast(ix, t, vj, m if t["family"] else 0, draws, resamples)
        if t["family"]:
            c["label"] = t["status"] if t["status"] != "ok" else an.verdict(
                t["p_holm"], c["mean_d"], {j: v["mean_d"] for j, v in c["per_judge"].items()},
                {j: v["p"] for j, v in c["per_judge"].items()}, c["ci90"])
            planned.append(c)
        else:
            c["label"] = REPORTED if c["n"] and t["status"] in ("ok", "insufficient n") else t["status"]
            reported.append(c)
    labels = {(c["arm"], c["ref"]): c["label"] for c in planned}
    return {
        "set": set_name, "mode": mode, "judges": vj, "secondary_judges": secondary,
        "n_queries": len(ix.queries), "refused_queries": sorted(set(inp.refused)),
        "family": {"m": m, "alpha": ALPHA, "contrasts": [[t["arm"], t["ref"]] for t in ok]},
        "planned": planned, "reported": reported,
        "reading": reading(labels[("9", "9W")], labels[("9", "9P")]),
        "versions": _version_stats(ix, ["9", *E2_ARMS]),
    }


# ---------- E2b ----------


def analyze_e2b(inp: an.Inputs, e1: an.Inputs, *, judges=E2B_JUDGES, e1_labels: dict | None = None,
                draws: int = an.DRAWS, resamples: int = an.RESAMPLES) -> dict:
    ix, ix1 = an.Index(inp, "main"), an.Index(e1, "main")
    mode, vj, secondary = an.decide_mode(ix, list(judges))
    spec = {"families": {"E2b": list(E2B_CONTRASTS)}, "descriptive": [(a, "original") for a in E2B_ARMS]}
    tests = an.primary_tests(ix, spec, vj, draws)
    contrasts, reported = [], []
    for t in tests:
        c = _contrast(ix, t, vj, 0, draws, resamples)
        c["p_holm"] = None  # E2b's rule is the sign of d, not a test
        if t["family"]:
            d1, _ = an.query_differences(ix1, t["arm"], t["ref"], list(JUDGE_ORDER), "score")
            e1_d = float(np.mean(list(d1.values()))) if d1 else None
            c |= {"e1_mean_d": e1_d, "e1_n": len(d1),
                  "e1_label": (e1_labels or {}).get((t["arm"], t["ref"])),
                  "few_queries": c["n"] < MIN_N}
            if t["status"] not in ("ok", "insufficient n"):
                c["label"] = t["status"]
            elif not c["n"] or e1_d is None:
                c["label"] = "no analyzable query"
            else:
                c["label"] = STANDS if np.sign(c["mean_d"]) == np.sign(e1_d) != 0 else EDITOR_DEPENDENT
            contrasts.append(c)
        else:
            c["label"] = REPORTED if c["n"] and t["status"] in ("ok", "insufficient n") else t["status"]
            reported.append(c)
    return {"set": "main", "editor": E2B_EDITOR, "mode": mode, "judges": vj, "secondary_judges": secondary,
            "n_queries": len(ix.queries), "refused_queries": sorted(set(inp.refused)),
            "contrasts": contrasts, "reported": reported, "versions": _version_stats(ix, E2B_ARMS)}


# ---------- main ----------


def _e1_labels(e1_out: Path) -> dict:
    path = e1_out / "analysis.json"
    if not path.exists():
        return {}
    main = json.loads(path.read_text(encoding="utf-8")).get("main", {})
    return {(c["arm"], c["ref"]): c["label"] for c in main.get("contrasts", [])}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--e1-data", default=str(E1_DIR / "data"))
    ap.add_argument("--e1-out", default=str(E1_DIR / "out"))
    ap.add_argument("--e2a-data", default=str(E2_DIR / "data"))
    ap.add_argument("--e2a-out", default=str(E2_DIR / "out" / "a"))
    ap.add_argument("--e2b-data", default=str(E2_DIR / "data" / "b"))
    ap.add_argument("--e2b-out", default=str(E2_DIR / "out" / "b"))
    ap.add_argument("--out", default=str(E2_DIR / "out"))
    ap.add_argument("--draws", type=int, default=an.DRAWS, help=argparse.SUPPRESS)
    ap.add_argument("--resamples", type=int, default=an.RESAMPLES, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    fast = {"draws": args.draws, "resamples": args.resamples}

    e1 = an.load_inputs(Path(args.e1_data), Path(args.e1_out))
    result: dict = {"settings": {"alpha": ALPHA, "delta": DELTA, "min_n": MIN_N, "draws": args.draws,
                                 "resamples": args.resamples, "bootstrap_seed": 1, "sign_flip_seed": 1}}
    a = _load(Path(args.e2a_data), Path(args.e2a_out), e1)
    if a is None:
        result["e2a"] = {"status": "not run", "missing": f"{args.e2a_out}/cells.jsonl or {args.e2a_data}/versions.jsonl"}
    else:
        inp = e2a_inputs(e1, versions=a.versions, cells=a.cells, completion=a.completion or [], scores=a.scores,
                         refused=a.refused)
        present = {p["set"] for p in inp.pages}
        result["e2a"] = {s: analyze_e2a(inp, s, **fast) for s in ("main", "replication") if s in present}
    b = _load(Path(args.e2b_data), Path(args.e2b_out), e1)
    if b is None:
        result["e2b"] = {"status": "not run", "missing": f"{args.e2b_out}/cells.jsonl or {args.e2b_data}/versions.jsonl"}
    else:
        result["e2b"] = analyze_e2b(b, e1, e1_labels=_e1_labels(Path(args.e1_out)), **fast)
    write_json(Path(args.out) / "analysis_e2.json", result)
    print(f"analyze_e2: wrote {Path(args.out) / 'analysis_e2.json'}")


if __name__ == "__main__":
    main()
