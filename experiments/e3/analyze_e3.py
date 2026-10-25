"""E3 analysis (experiments/PLAN_E3.md, Analysis), with E1's statistics (experiments/e1/analyze.py).

The E3 result is pooled. For each arm in {2, 4, 5, 6, 7, 8, 10} it takes every query with a valid
version of the arm and of its reference (the arm's placebo; the original for arm 4, tables):
- E1's main-set queries, with E1's versions and cells (experiments/e1/data and out) for the pairs
  that passed in E1, and the retried versions (E3's retry folder) where E3 gave E1's failed pairs
  one more attempt. A retried version replaces E1's row for the same version id, so a pair is
  E1's or E3's, never both;
- E3's new queries (sets "e3" and "e3-four").
d_q, the sign-flip test, the bootstrap intervals, the verdict rules (helps, hurts, no effect larger
than 0.03, inconclusive, model-dependent), the confound regression with its "possibly through length
or query-term overlap" note, the 30-query minimum and the single-model rule are E1's, from
analyze.py. One Holm family at alpha 0.05 holds the arms that reach 30 analyzable queries.

Reported beside it, without verdicts: each arm on the new queries alone, on E1's queries with the
extra attempt, and on E1's queries as E1 ran them (which matches E1's own analysis), so a reader
can see whether the added attempt or the added queries move the estimate.

Inputs (a part whose cells are missing is "not run" and left out):
- E1: --e1-data (pages, versions, applicability, prompt_build.json) and --e1-out (cells.jsonl;
  scores.jsonl, score_summary.json and analysis.json when present);
- E3 new queries: --new-data (pages, versions, applicability, prompt_build.json) and --new-out;
- E3 retries: --retry-data (versions, prompt_build.json; pages and applicability are E1's) and --retry-out.
Output: <out>/analysis_e3.json.

Usage: python3 -I experiments/e3/analyze_e3.py [--e1-data DIR] [--e1-out DIR] [--new-data DIR]
           [--new-out DIR] [--retry-data DIR] [--retry-out DIR] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E3_DIR = Path(__file__).resolve().parent
E1_DIR = E3_DIR.parent / "e1"
sys.path.insert(0, str(E1_DIR))

import analyze as an  # noqa: E402
from e1_common import ALPHA, DELTA, JUDGE_ORDER, MIN_N, REF, read_jsonl, write_json  # noqa: E402

E3_ARMS = ["2", "4", "5", "6", "7", "8", "10"]
CONTRASTS = [(a, REF[a]) for a in E3_ARMS]
VERSION_ARMS = {"original", *E3_ARMS, *(REF[a] for a in E3_ARMS)}
NEW_SETS = ("e3", "e3-four")
E1_SET = "main"
REPORTED = "reported without a verdict"
BREAKDOWNS = {
    "new_queries": "E3's new queries only",
    "e1_queries_with_retries": "E1's queries, with E3's extra attempt",
    "e1_as_run": "E1's queries as E1 ran them",
}

# ---------- inputs ----------


def _rows(path: Path, default=None) -> list:
    return read_jsonl(path) if path.exists() else (default if default is not None else [])


def load_part(data: Path, out: Path, fallback: an.Inputs | None = None) -> an.Inputs | None:
    """One folder pair as Inputs, or None when it has no cells or no versions. Pages and applicability
    fall back to `fallback`'s (the retry folder uses E1's); scores and the score summary are optional."""
    if not (out / "cells.jsonl").exists() or not (data / "versions.jsonl").exists():
        return None
    summary_path, build_path = out / "score_summary.json", data / "prompt_build.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
    build = json.loads(build_path.read_text(encoding="utf-8")) if build_path.exists() else {"refused": []}
    return an.Inputs(
        pages=_rows(data / "pages.jsonl", fallback.pages if fallback else []),
        versions=read_jsonl(data / "versions.jsonl"),
        applicability=_rows(data / "applicability.jsonl", fallback.applicability if fallback else []),
        cells=read_jsonl(out / "cells.jsonl"), scores=_rows(out / "scores.jsonl"),
        completion=summary["completion"] if summary else None,
        refused=[r["query_id"] for r in build["refused"]],
    )


def _keep(rows, sets, arms=VERSION_ARMS) -> list:
    return [r for r in rows if r["set"] in sets and r["arm"] in arms]


def e1_part(e1: an.Inputs) -> an.Inputs:
    """E1's main set, restricted to the versions E3's contrasts use."""
    return an.Inputs(
        pages=[p for p in e1.pages if p["set"] == E1_SET],
        versions=_keep(e1.versions, {E1_SET}), applicability=e1.applicability,
        cells=_keep(e1.cells, {E1_SET}), scores=_keep(e1.scores, {E1_SET}),
        completion=None if e1.completion is None else _keep(e1.completion, {E1_SET}),
        refused=list(e1.refused),
    )


def with_retries(e1: an.Inputs, retry: an.Inputs | None) -> an.Inputs:
    """E1's main-set inputs with each retried version (and its cells) in place of E1's row."""
    if retry is None:
        return e1
    redone = {(v["query_id"], v["arm"]) for v in retry.versions}

    def kept(rows):
        return [r for r in rows if (r["query_id"], r["arm"]) not in redone]

    completion = None if e1.completion is None or retry.completion is None else \
        e1.completion + _keep(retry.completion, {E1_SET})
    return an.Inputs(
        pages=e1.pages, applicability=e1.applicability,
        versions=kept(e1.versions) + _keep(retry.versions, {E1_SET}),
        cells=kept(e1.cells) + _keep(retry.cells, {E1_SET}),
        scores=kept(e1.scores) + _keep(retry.scores, {E1_SET}),
        # A query refused in the retry folder lost only its retried versions' prompts (E1's cells stand),
        # so it is not refused here: those versions simply have no cells.
        completion=completion, refused=list(e1.refused),
    )


def new_only(new: an.Inputs) -> an.Inputs:
    """E3's new queries (sets e3 and e3-four) alone."""
    sets = set(NEW_SETS)
    return an.Inputs(
        pages=[p for p in new.pages if p["set"] in sets], applicability=new.applicability,
        versions=_keep(new.versions, sets), cells=_keep(new.cells, sets), scores=_keep(new.scores, sets),
        completion=None if new.completion is None else _keep(new.completion, sets), refused=list(new.refused),
    )


def pooled(e1r: an.Inputs, new: an.Inputs | None) -> an.Inputs:
    """E1's queries (with retries) and E3's new queries in one set of inputs."""
    if new is None:
        return e1r
    sets = set(NEW_SETS)
    completion = None if e1r.completion is None or new.completion is None else \
        e1r.completion + _keep(new.completion, sets)
    return an.Inputs(
        pages=e1r.pages + [p for p in new.pages if p["set"] in sets],
        applicability=e1r.applicability + new.applicability,
        versions=e1r.versions + _keep(new.versions, sets), cells=e1r.cells + _keep(new.cells, sets),
        scores=e1r.scores + _keep(new.scores, sets), completion=completion,
        refused=sorted(set(e1r.refused) | set(new.refused)),
    )


# ---------- contrasts ----------


def _per_judge(t: dict, judges: list[str], draws: int) -> dict:
    out = {}
    for j in judges:
        jd = t["info"]["per_judge"][j]
        out[j] = {"mean_d": float(np.mean(list(jd.values()))) if jd else None,
                  "p": an.sign_flip_p([jd[q] for q in sorted(jd)], draws) if jd else None}
    return out


def _label(t: dict, c: dict) -> str:
    """E1's verdict rules and confound note (analyze.analyze_set), for a contrast in the family."""
    if t["status"] != "ok":
        return t["status"]
    label = an.verdict(t["p_holm"], c["mean_d"], {j: v["mean_d"] for j, v in c["per_judge"].items()},
                       {j: v["p"] for j, v in c["per_judge"].items()}, c["ci90"])
    conf = c["confound"]
    if label == "helps" and conf is not None and (
            not conf["identifiable"] or conf["ci95"] is None or conf["ci95"][0] <= 0 <= conf["ci95"][1]):
        return an.HELPS_CONFOUNDED
    return label


def contrasts(ix: an.Index, judges: list[str], *, verdicts: bool, draws: int, resamples: int) -> tuple[list, dict]:
    """Every E3 contrast on `ix`. With verdicts, one Holm family over the arms with status "ok"."""
    spec = {"families": {"E3": list(CONTRASTS)} if verdicts else {}, "descriptive": [] if verdicts else list(CONTRASTS)}
    tests = an.primary_tests(ix, spec, judges, draws)
    ok = [t for t in tests if t["family"] == "E3" and t["status"] == "ok"]
    m = len(ok)
    out = []
    for t in tests:
        stats = an._summary(t["d"], draws, resamples, p=t["p"])
        alpha = ALPHA / m if verdicts and m else ALPHA
        c = {"arm": t["arm"], "ref": t["ref"], "status": t["status"], "dropped_cells": t["info"]["dropped_cells"],
             **stats, "p_holm": t["p_holm"] if verdicts else None,
             "mde": an.realized_mde(stats["sd"], stats["n"], alpha), "mde_alpha": alpha,
             "per_judge": _per_judge(t, judges, draws), "confound": an._confound(ix, t["arm"], t["ref"], t["d"])}
        if verdicts:
            c["label"] = _label(t, c)
            c["secondary"] = {metric: an._summary(an.query_differences(ix, t["arm"], t["ref"], judges, metric)[0],
                                                  draws, resamples)
                              for metric in ("cited", "pawc", "valid_rate")}
        else:
            c["label"] = REPORTED if stats["n"] and t["status"] in ("ok", "insufficient n") else t["status"]
        out.append(c)
    family = {"m": m, "alpha": ALPHA, "arms": [t["arm"] for t in ok]} if verdicts else None
    return out, family


def vs_original(ix: an.Index, judges: list[str], draws: int, resamples: int) -> list[dict]:
    rows = []
    for arm in E3_ARMS:
        d, _ = an.query_differences(ix, arm, "original", judges, "score")
        rows.append({"arm": arm, "ref": "original", **an._summary(d, draws, resamples)})
    return rows


def _queries_by_part(ix: an.Index) -> dict:
    sets = {p["query_id"]: p["set"] for p in ix.target.values()}
    return {"e1": sum(1 for q in ix.queries if sets.get(q) == E1_SET),
            "new": sum(1 for q in ix.queries if sets.get(q) in NEW_SETS)}


def analyze(e1: an.Inputs, new: an.Inputs | None, retry: an.Inputs | None, *, judges=JUDGE_ORDER,
            e1_labels: dict | None = None, draws: int = an.DRAWS, resamples: int = an.RESAMPLES) -> dict:
    base = e1_part(e1)
    e1r = with_retries(base, retry)
    pool = pooled(e1r, new)
    ix = an.Index(pool)
    mode, vj, secondary = an.decide_mode(ix, list(judges))
    main, family = contrasts(ix, vj, verdicts=True, draws=draws, resamples=resamples)
    for c in main:
        c["e1"] = (e1_labels or {}).get((c["arm"], c["ref"]))

    parts = {"new_queries": new_only(new) if new is not None else None,
             "e1_queries_with_retries": e1r if retry is not None else None,
             "e1_as_run": base}
    breakdowns = {}
    for name, inp in parts.items():
        if inp is None:
            breakdowns[name] = {"status": "not run", "title": BREAKDOWNS[name]}
            continue
        bix = an.Index(inp)
        rows, _ = contrasts(bix, vj, verdicts=False, draws=draws, resamples=resamples)
        breakdowns[name] = {"status": "ok", "title": BREAKDOWNS[name], "n_queries": len(bix.queries),
                            "contrasts": rows}

    tags = ["Gemma-edited"] + (["single-model"] if mode == "single-model" else [])
    return {
        "parts": {"e1": "ok", "new": "ok" if new is not None else "not run",
                  "retry": "ok" if retry is not None else "not run"},
        "mode": mode, "tags": tags, "judges": vj, "secondary_judges": secondary,
        "n_queries": len(ix.queries), "queries_by_part": _queries_by_part(ix),
        "refused_queries": sorted(set(pool.refused)),
        "retry_refused_queries": sorted(set(retry.refused)) if retry is not None else [],
        "settings": {"alpha": ALPHA, "delta": DELTA, "min_n": MIN_N, "draws": draws, "resamples": resamples,
                     "bootstrap_seed": 1, "sign_flip_seed": 1},
        "family": family, "contrasts": main, "vs_original": vs_original(ix, vj, draws, resamples),
        "exclusions": an._exclusions(ix, E3_ARMS + [REF[a] for a in E3_ARMS if REF[a] != "original"]),
        "breakdowns": breakdowns,
    }


# ---------- main ----------


def e1_labels(e1_out: Path) -> dict:
    """E1's published label and n for each E3 contrast (E1's out/analysis.json, main set)."""
    path = e1_out / "analysis.json"
    if not path.exists():
        return {}
    res = json.loads(path.read_text(encoding="utf-8")).get(E1_SET, {})
    return {(c["arm"], c["ref"]): {"label": c["label"], "n": c["n"], "mean_d": c["mean_d"]}
            for c in res.get("contrasts", []) if (c["arm"], c["ref"]) in CONTRASTS}


def load_e1(data: Path, out: Path) -> an.Inputs:
    part = load_part(data, out)
    if part is None:
        raise SystemExit(f"analyze_e3: E1's {out}/cells.jsonl or {data}/versions.jsonl is missing")
    return part


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--e1-data", default=str(E1_DIR / "data"))
    ap.add_argument("--e1-out", default=str(E1_DIR / "out"))
    ap.add_argument("--new-data", default=str(E3_DIR / "data"))
    ap.add_argument("--new-out", default=str(E3_DIR / "out" / "new"))
    ap.add_argument("--retry-data", default=str(E3_DIR / "data" / "retry"))
    ap.add_argument("--retry-out", default=str(E3_DIR / "out" / "retry"))
    ap.add_argument("--out", default=str(E3_DIR / "out"))
    ap.add_argument("--draws", type=int, default=an.DRAWS, help=argparse.SUPPRESS)
    ap.add_argument("--resamples", type=int, default=an.RESAMPLES, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    e1 = load_e1(Path(args.e1_data), Path(args.e1_out))
    new = load_part(Path(args.new_data), Path(args.new_out))
    retry = load_part(Path(args.retry_data), Path(args.retry_out), fallback=e1)
    result = analyze(e1, new, retry, e1_labels=e1_labels(Path(args.e1_out)), draws=args.draws,
                     resamples=args.resamples)
    write_json(Path(args.out) / "analysis_e3.json", result)
    print(f"analyze_e3: wrote {Path(args.out) / 'analysis_e3.json'} (new queries: {result['parts']['new']}, "
          f"retries: {result['parts']['retry']}; {result['n_queries']} queries)")


if __name__ == "__main__":
    main()
