"""E5 analysis (experiments/PLAN_E5.md r2), with E1's statistics (experiments/e1/analyze.py), numpy only.

What it computes (the plan's "Measurement and statistics", "Contrasts" and "What the results mean",
with amendments 1 and 2):
- Snapshot: the sha256 of every input file, logged at the start and written into the output, the
  answer files (data/answers/*.jsonl) and score.py's outputs included. It refuses when score.py's
  summary disagrees with the cells or with the answer files (cells scored before the last answers
  arrived), and when re-scoring every answer with E1's score.score_answer, and rebuilding the cells
  with score.make_cells, does not give scores.jsonl and cells.jsonl back exactly (an answer file
  replaced in place after scoring). The analysis runs once: if <out>/analysis_e5.json exists from a
  different snapshot, it refuses unless --secondary is given, which writes analysis_e5_secondary.json
  (secondary, changes no label). A dry run belongs in another --out folder.
- Unit, statistic and labels are E1's: d_q is the mean over judges of cell(A) - cell(Ref), cells are
  means over valid answers (dropped below 4), the paired sign-flip test (100,000 draws, seed 1),
  percentile bootstrap intervals (10,000 resamples, seed 1), Holm, E1's verdict rules (model-dependent,
  helps, hurts, no effect larger than 0.03, inconclusive; under 30 queries "insufficient n") and E1's
  confound note ("helps, possibly through length or query-term overlap").
- Judges, per contrast: both judges only if Qwen has complete cells for every query Gemma has;
  otherwise Gemma alone for all its queries, labelled single-model (Qwen's complete subset is secondary).
- Cross-run fallback, per query: both versions from E5 when E5's cells are complete; otherwise both
  from one earlier run (E1, E2a's 9P, E3's new-query originals) when that run answered both; only
  otherwise one version from each. An earlier cell is used only when the earlier run answered the
  same version text and the same prompts (sha256 per seed). The contrast is flagged "cross-run",
  with counts of pairs mixed with E5, from one earlier run and from two earlier runs.
- Main set, planned: the gate (9 vs original on E3's new queries); one Holm family over 9K vs
  original, 9K vs 9P, 9L vs original, 9L vs 9P (pooled), labelled "descriptive (gate failed)" when
  the gate does not pass; the retention reading for 9K and 9L (margin 0.015); 12K vs P12K as its own
  test with the tool's "missing words" rule; step 5, pooled 9 vs original, as the tool's label.
- Replication set: its own Holm family over the same four tests.
- Reported without a verdict: the ladder, 9G, the arm 12 contrasts, the share kept, query length,
  template and tool-gate splits, per judge, per stratum, the reweighted new-query estimate, the
  confound note and the detectable effect per contrast; the drift check; validity counts, with the
  number of versions that copy a different page sentence from arm 9's (validity.sentence_vs_9).
- Amendment 3's sensitivity rows (amendment_3_sensitivity): every 9G contrast, and every 9K or 9L
  contrast with a version whose edit text equals q (versions.jsonl edit_text_is_q), also without
  those queries: the Holm family (re-run over the four tests), retention, share kept, the 9G rows and
  the 9L splits, each beside its planned label; and the flagged 9L versions identical to arm 9's
  (identical prompts answered apart within the run: a measured noise floor). These rows were omitted
  from the first analysis and added on the same snapshot; they change no planned label or reading.
- Added analyses after the results (added_analyses): the gate without the new query whose pages
  overlap an E1 query's (NEAR_DUPLICATES). No label depends on them.

Inputs (defaults): experiments/e5/data/{edit_texts.jsonl, versions.jsonl, applicability.jsonl,
prompt_build.json, prompts.jsonl, answers/*.jsonl} and score.py's experiments/e5/out/{cells.jsonl,
score_summary.json, scores.jsonl} (--scored); earlier cells, versions and prompts from
experiments/e1 (data, out), experiments/e2 (data, out/a) and experiments/e3 (data, out/new).
Output: <out>/analysis_e5.json.

Usage: python3 -I experiments/e5/analyze_e5.py [--data DIR] [--scored DIR] [--out DIR] [--no-earlier] [--secondary]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.dont_write_bytecode = True
E5_DIR = Path(__file__).resolve().parent
EXP = E5_DIR.parent
E1_DIR = EXP / "e1"
sys.path.insert(0, str(E1_DIR))

import analyze as an  # noqa: E402
import score as e1_score  # noqa: E402
from e1_common import ALPHA, CAVEAT, DELTA, JUDGE_ORDER, MIN_N, MIN_VALID, SEEDS, TIMING, read_jsonl, write_json  # noqa: E402

VERSIONS = ["original", "9", "9P", "9K", "9L", "9A", "9G", "12", "P12", "12K", "P12K"]
PRIMARY = JUDGE_ORDER[0]
N_ANSWERS = len(SEEDS)
MAIN, REPLICATION = "main", "replication"
STRATA = ("e1", "e3", "e3-four")
NEW = ("e3", "e3-four")
GUESSES = ("9K", "9L")
MARGIN = 0.015
GATE = ("9", "original")
FAMILY = [("9K", "original"), ("9K", "9P"), ("9L", "original"), ("9L", "9P")]
ARM12 = ("12K", "P12K")
STEP5 = ("9", "original")
HELPS = ("helps", an.HELPS_CONFOUNDED)
REPORTED = "reported without a verdict"
GATE_FAILED = "descriptive (gate failed)"
CROSS_RUN = "cross-run"
# A version's applicability: its own row and its parent arm's (E1's default is True when a row is missing).
APPLICABILITY_PARENTS = {"9P": ("9",), "9K": ("9K", "9"), "9L": ("9L", "9"), "9A": ("9A", "9"),
                         "9G": ("9G", "9"), "P12": ("12",), "P12K": ("12K",)}
LEVELS = ("2 or fewer", "3", "4", "5 or more")
MERGE_BELOW = 10
SET_OF = {"main": MAIN, "e3": MAIN, "e3-four": MAIN, "replication": REPLICATION}  # page set -> E5 set
STRATUM_OF = {"main": "e1", "e3": "e3", "e3-four": "e3-four", "replication": "replication"}
EARLIER_RUNS = ("e1", "e2a", "e3")  # order in which a same-run earlier pair is looked for
# A pair's sources: both from E5; one from E5 and one earlier ("mixed"); both from one earlier run; from two.
PAIR_KINDS = ("within_e5", "mixed", "earlier_one_run", "earlier_two_runs")
E1_CAVEAT = ("E1's queries: arm 9 was followed up because it passed on these queries, so its gain here may be "
             "overstated and the share understated.")
STEP5_NOTE = "a cumulative estimate over every main query with a valid arm 9, E1's queries included"
G9_NOTE = "9G is a question-form placebo in the page's own words; it is never read as evidence about the tool's default."
INPUT_KIND = {"9K": "keywords", "9L": "local-model questions"}
PAPER_KEEPS = {"9K": "The gain held when the edit carried only a keyword's words.",
               "9L": "The gain held when the edit carried a question written from a keyword."}
TOOL_ACTION = {  # PREREG_E1.md, "What the tool does with the result"
    "helps": "measured label on the suggestion (effect, CI, models)",
    "hurts": "the advice is reworded with the finding",
    an.NO_EFFECT: "becomes an unscored note",
}
# PLAN_E5 amendment 3: a guess whose edit text equals q stays in, flagged (versions.jsonl edit_text_is_q, true for 9 and
# 12 by definition), and every 9G contrast, and every 9K or 9L contrast with such a version, is also reported without
# those queries.
FLAGGED_ARMS = ("9K", "9L", "9G")
A3_NOTE = ("PLAN_E5 amendment 3: versions whose edit text equals q (ignoring case, spaces and a final '?') stay in, "
           "flagged, and every 9G contrast, and every 9K or 9L contrast with such a version, is also reported without "
           "those queries. These rows were omitted from the first analysis and added afterwards on the same snapshot; "
           "they are sensitivity reports beside the planned results and change no planned label or reading.")
NOISE_NOTE = ("Flagged 9L versions whose title and text equal arm 9's: their prompts are the same, and they were "
              "answered in different batches of the one run (tier 1 and tier 2), so their cells differ only by the "
              "run's own noise. A measured within-run noise floor for identical prompts, without a verdict.")
# Added analysis after the results (the post-analysis audit of 2026-11-03): the one new query that shares pages with an
# E1 query, found by the sha256 of the page texts in data/pages.jsonl. The analysis does not read pages.jsonl (its input
# snapshot is the planned one), so the overlap is named here; no other new query shares a page with an E1 query.
NEAR_DUPLICATES = {
    "geo-test-325": {"e1_query": "geo-test-301", "pages": 4, "pages_shared_with_e1_query": 3,
                     "how": "its target is one of geo-test-301's competitors, and two of its three competitors are "
                            "geo-test-301's target and donor"},
}
ADDED_NOTE = ("Added after the results (the post-analysis audit of 2026-11-03), reported without a verdict; no label "
              "depends on it.")

# ---------- inputs ----------


@dataclass
class E5Inputs:
    edit_texts: list
    versions: list
    cells: list
    applicability: list = field(default_factory=list)
    earlier_cells: list = field(default_factory=list)  # each row carries "run" (e1, e2a, e3)
    earlier_versions: list = field(default_factory=list)
    e1_applicability: list = field(default_factory=list)  # E1's frozen table only, never E3's
    refused: list = field(default_factory=list)
    # (run, query, arm, judge) -> digest of the seeds' prompts; run "e5" for E5's own (prompt_digests()).
    prompt_digests: dict = field(default_factory=dict)


def level(n_key_terms) -> str | None:
    if n_key_terms is None:
        return None
    n = int(n_key_terms)
    return LEVELS[0] if n <= 2 else LEVELS[1] if n == 3 else LEVELS[2] if n == 4 else LEVELS[3]


def version_text_key(v: dict | None) -> str | None:
    """sha256 of a version's title and text, or None when the row carries neither."""
    if v is None or ("text" not in v and "title" not in v):
        return None
    return hashlib.sha256(f"{v.get('title') or ''}\n{v.get('text') or ''}".encode("utf-8")).hexdigest()


def complete(cell: dict | None) -> bool:
    """A cell with every seed's answer present (score.py counts the answers it found)."""
    return cell is not None and int(cell.get("n_answers", 0)) >= N_ANSWERS


class E5Index:
    """Lookups over E5's inputs with the earlier runs as fallback; the timing set never enters."""

    def __init__(self, inp: E5Inputs):
        refused = set(inp.refused)
        self.info: dict[str, dict] = {}
        for r in inp.edit_texts:
            if r.get("set") == TIMING or r.get("stratum") == TIMING or r["query_id"] in refused:
                continue
            self.info[r["query_id"]] = {"set": r["set"], "stratum": r["stratum"], "n_key_terms": r.get("n_key_terms"),
                                        "level": level(r.get("n_key_terms")), "template": r.get("template"),
                                        "q_L_status": r.get("q_L_status")}
        for v in inp.versions:
            q = v["query_id"]
            if q not in self.info and q not in refused and v.get("set") in SET_OF:
                self.info[q] = {"set": SET_OF[v["set"]], "stratum": STRATUM_OF[v["set"]], "n_key_terms": None,
                                "level": None, "template": None, "q_L_status": None}
        self.version, self.version_source = {}, {}
        for v in inp.versions:
            key = (v["query_id"], v["arm"])
            if v["query_id"] in self.info and key not in self.version:
                self.version[key], self.version_source[key] = v, "e5"
        for v in inp.earlier_versions:
            key = (v["query_id"], v["arm"])
            if v["query_id"] in self.info and key not in self.version and v.get("set") in SET_OF:
                self.version[key], self.version_source[key] = v, v.get("run", "earlier")
        self.appl = {(a["query_id"], a["arm"]): bool(a["applicable"]) for a in inp.applicability}
        self.appl_reason = {(a["query_id"], a["arm"]): a.get("reason") for a in inp.applicability}
        for a in inp.e1_applicability:
            self.appl.setdefault((a["query_id"], a["arm"]), bool(a["applicable"]))
            self.appl_reason.setdefault((a["query_id"], a["arm"]), a.get("reason"))
        # Only the four scored page sets enter (never timing or smoke cells, whatever their query ids).
        self.e5 = {(c["query_id"], c["arm"], c["judge"]): c for c in inp.cells
                   if c.get("set") in SET_OF and c["query_id"] in self.info}
        # An earlier run's cell stands in for E5's only when it answered the same version: when E5 has its own
        # row for the version, the earlier run's title and text must be identical, and so must its prompts for
        # that version and judge (every seed's prompt and slot), each checked when both sides are known.
        earlier_text = {(v["query_id"], v["arm"], v.get("run")): version_text_key(v) for v in inp.earlier_versions
                        if v.get("set") in SET_OF}
        digests = self.digests = inp.prompt_digests
        self.earlier: dict = defaultdict(dict)  # (query, arm, judge) -> {run: cell}
        self.earlier_check: Counter = Counter()
        for c in inp.earlier_cells:
            q, arm, j, run = c["query_id"], c["arm"], c["judge"], c.get("run", "earlier")
            if c.get("set") not in SET_OF or q not in self.info:
                continue
            if self.version_source.get((q, arm)) == "e5":
                mine, theirs = version_text_key(self.version[(q, arm)]), earlier_text.get((q, arm, run))
                if mine is not None and theirs is not None and mine != theirs:
                    self.earlier_check["left out: the earlier run answered a different version text"] += 1
                    continue
                p5, p0 = digests.get(("e5", q, arm, j)), digests.get((run, q, arm, j))
                if p5 is not None and p0 is not None and p5 != p0:
                    self.earlier_check["left out: the earlier run's prompts differ from E5's"] += 1
                    continue
                self.earlier_check["same version text" if mine is not None and theirs is not None
                                   else "version text not compared"] += 1
                self.earlier_check["same prompts" if p5 is not None and p0 is not None
                                   else "prompts not compared"] += 1
            else:
                self.earlier_check["the earlier run's own version (E5 has no row)"] += 1
            self.earlier[(q, arm, j)].setdefault(run, c)
        runs = {run for by_run in self.earlier.values() for run in by_run}
        self.runs = [r for r in EARLIER_RUNS if r in runs] + sorted(runs - set(EARLIER_RUNS))
        self._with_cells = set(self.e5) | set(self.earlier)

    def queries(self, set_name: str, strata=None) -> list[str]:
        return sorted(q for q, i in self.info.items()
                      if i["set"] == set_name and (strata is None or i["stratum"] in strata))

    def applicable(self, q: str, arm: str) -> bool:
        return arm == "original" or all(self.appl.get((q, a), True) for a in APPLICABILITY_PARENTS.get(arm, (arm,)))

    def not_applicable_reason(self, q: str, arm: str) -> str | None:
        """The reason on the first row (the version's own, then its parent's) that makes it not applicable."""
        for a in APPLICABILITY_PARENTS.get(arm, (arm,)):
            if self.appl.get((q, a), True) is False:
                return self.appl_reason.get((q, a)) or f"arm {a} is not applicable"
        return None

    def usable(self, q: str, arm: str) -> bool:
        v = self.version.get((q, arm))
        return v is not None and bool(v["valid"]) and self.applicable(q, arm)

    def cell(self, q: str, arm: str, judge: str, source: str) -> dict | None:
        """A cell from E5 (source "e5") or from the earlier run named by source."""
        if source == "e5":
            return self.e5.get((q, arm, judge))
        return self.earlier.get((q, arm, judge), {}).get(source)

    def sources(self, q: str, arm: str, judges: list[str]) -> list[str]:
        """Every source with complete cells for all the judges: "e5" first, then the earlier runs in order."""
        return [s for s in ["e5", *self.runs] if all(complete(self.cell(q, arm, j, s)) for j in judges)]

    def pick(self, q: str, arm: str, ref: str, judges: list[str]) -> tuple[str, str] | None:
        """Per query: both versions from E5; else both from one earlier run; only else one from each (E5 first)."""
        sa, sr = self.sources(q, arm, judges), self.sources(q, ref, judges)
        if not sa or not sr:
            return None
        for s in ["e5", *self.runs]:
            if s in sa and s in sr:
                return s, s
        return sa[0], sr[0]

    def has_cells(self, queries, arm: str, judge: str) -> bool:
        return any((q, arm, judge) in self._with_cells for q in queries)

    def version_field(self, q: str, arm: str, name: str):
        v = self.version.get((q, arm))
        return None if v is None else v.get(name)


# ---------- contrasts ----------


def resolve(ix: E5Index, arm: str, ref: str, queries, judges=JUDGE_ORDER) -> dict:
    """d_q for one contrast with the plan's judge rule and the per-query cross-run fallback."""
    judges, queries = list(judges), list(queries)
    primary, others = judges[0], judges[1:]
    candidates = [q for q in queries if ix.usable(q, arm) and ix.usable(q, ref)]
    picked = {}
    for q in candidates:
        pair = ix.pick(q, arm, ref, [primary])
        if pair:
            picked[q] = pair
    two = bool(others) and bool(picked) and all(
        complete(ix.cell(q, x, j, s)) for q, (sa, sr) in picked.items() for x, s in ((arm, sa), (ref, sr))
        for j in others)
    vj = judges if two else [primary]
    d, per_judge, dropped, sources, src = {}, {j: {} for j in vj}, 0, Counter(), {}
    for q in sorted(picked):
        sa, sr = picked[q]
        pairs = [(ix.cell(q, arm, j, sa), ix.cell(q, ref, j, sr)) for j in vj]
        if any(a["dropped"] or r["dropped"] for a, r in pairs):
            dropped += 1
            continue
        diffs = [float(a["score"]) - float(r["score"]) for a, r in pairs]
        d[q] = float(np.mean(diffs))
        for j, x in zip(vj, diffs):
            per_judge[j][q] = x
        src[q] = pair_kind(sa, sr)
        sources[src[q]] += 1
    ran = ix.has_cells(queries, arm, primary) and ix.has_cells(queries, ref, primary)
    status = "not run" if not ran else ("ok" if len(d) >= MIN_N else "insufficient n")
    return {"arm": arm, "ref": ref, "d": d, "per_judge_d": per_judge, "judges": vj,
            "mode": "two-judge" if two else "single-model" if picked else "no query",
            "single_model": bool(picked) and not two, "status": status,
            "n_candidates": len(candidates), "n_incomplete": len(candidates) - len(picked), "dropped_cells": dropped,
            "_src": src} | source_counts(sources)


def pair_kind(sa: str, sr: str) -> str:
    if sa == sr == "e5":
        return "within_e5"
    if "e5" in (sa, sr):
        return "mixed"
    return "earlier_one_run" if sa == sr else "earlier_two_runs"


def source_counts(kinds: Counter) -> dict:
    """The pair counts by source and the cross-run flag (any pair not answered within E5)."""
    counts = {k: kinds[k] for k in PAIR_KINDS}
    return {"cross_run": any(counts[k] for k in PAIR_KINDS[1:]), "sources": counts}


class PBatch:
    """Collects d vectors and fills their sign-flip p-values with E1's sign_flip_ps, grouped by n as
    analyze.primary_tests does (the same p-values as one call per vector, computed faster)."""

    def __init__(self, draws: int, chunk: int = 64):
        self.draws, self.items, self.chunk = draws, [], chunk

    def add(self, values, target: dict, key: str = "p") -> None:
        self.items.append((np.asarray(values, dtype=float), target, key))

    def run(self) -> None:
        by_n = defaultdict(list)
        for item in self.items:
            by_n[len(item[0])].append(item)
        for n, group in sorted(by_n.items()):
            if n == 0:
                for _, target, key in group:
                    target[key] = None
                continue
            for start in range(0, len(group), self.chunk):  # columns in chunks: draws x chunk stays small
                part = group[start:start + self.chunk]
                ps = an.sign_flip_ps(np.column_stack([v for v, _, _ in part]), self.draws)
                for (_, target, key), p in zip(part, ps):
                    target[key] = p
        self.items = []


def _values(d: dict) -> list[float]:
    return [d[q] for q in sorted(d)]


def stats(d: dict, batch: PBatch | None, resamples: int, *, with_ci: bool = True) -> dict:
    """n, mean d, SD, E1's bootstrap intervals; the p-value is filled by the batch."""
    values = _values(d)
    n = len(values)
    out = {"n": n, "mean_d": float(np.mean(values)) if n else None,
           "sd": float(np.std(values, ddof=1)) if n > 1 else None, "p": None, "ci95": None, "ci90": None}
    if with_ci and n:
        ci = an.bootstrap_ci(values, resamples)
        out["ci95"], out["ci90"] = ci["ci95"], ci["ci90"]
    if batch is not None:
        batch.add(values, out)
    return out


def record(r: dict, batch: PBatch | None, resamples: int, *, alpha: float = ALPHA, with_ci: bool = True,
           confound_ix: E5Index | None = None, judge_p: bool = True) -> dict:
    """A resolved contrast with its statistics, per-judge results, MDE and (optionally) E1's confound regression."""
    c = {k: v for k, v in r.items() if k not in ("d", "per_judge_d", "_src")}
    c.update(stats(r["d"], None, resamples, with_ci=with_ci))
    if batch is not None:
        batch.add(_values(r["d"]), c)
    c["per_judge"] = {}
    for j in r["judges"]:
        jd = r["per_judge_d"][j]
        pj = {"n": len(jd), "mean_d": float(np.mean(_values(jd))) if jd else None, "p": None, "ci95": None}
        if with_ci and jd:
            pj["ci95"] = an.bootstrap_ci(_values(jd), resamples)["ci95"]
        if judge_p and batch is not None:
            batch.add(_values(jd), pj)
        c["per_judge"][j] = pj
    c["alpha"] = alpha
    c["mde"] = an.realized_mde(c["sd"], c["n"], alpha) if c["sd"] is not None else None
    c["confound"] = an._confound(SimpleNamespace(version=confound_ix.version), r["arm"], r["ref"], r["d"]) \
        if confound_ix is not None and r["d"] else None
    c["_d"] = r["d"]
    c["_per_judge_d"] = r["per_judge_d"]
    return c


def restrict(c: dict, queries, batch: PBatch | None, resamples: int) -> dict:
    """The contrast's d (same judges and sources) on a subset of its queries, without a verdict."""
    keep = set(queries)
    d = {q: x for q, x in c["_d"].items() if q in keep}
    out = stats(d, batch, resamples)
    out["per_judge"] = {}
    for j, jd in c["_per_judge_d"].items():
        kept = [jd[q] for q in sorted(jd) if q in keep]
        out["per_judge"][j] = {"n": len(kept), "mean_d": float(np.mean(kept)) if kept else None}
    out["mde"] = an.realized_mde(out["sd"], out["n"], ALPHA) if out["sd"] is not None else None
    return out


def is_helps(label: str | None) -> bool:
    return label in HELPS


def e1_label(c: dict) -> str:
    """E1's verdict rules and confound note (analyze.analyze_set) on a contrast with p_holm set."""
    if c["status"] != "ok":
        return c["status"]
    label = an.verdict(c["p_holm"], c["mean_d"], {j: v["mean_d"] for j, v in c["per_judge"].items()},
                       {j: v["p"] for j, v in c["per_judge"].items() if v.get("p") is not None}, c["ci90"])
    conf = c.get("confound")
    if label == "helps" and conf is not None and (
            not conf["identifiable"] or conf["ci95"] is None or conf["ci95"][0] <= 0 <= conf["ci95"][1]):
        return an.HELPS_CONFOUNDED
    return label


def confound_note(c: dict) -> str | None:
    conf = c.get("confound")
    if conf is None:
        return None
    if not conf["identifiable"] or conf["ci95"] is None:
        return "the length and key-term regression cannot separate the effect from its regressors"
    if conf["ci95"][0] <= 0 <= conf["ci95"][1]:
        return "after the length and key-term regression the remaining effect's 95% CI includes 0"
    return "the remaining effect after the length and key-term regression stays away from 0"


def holm_family(members: list[dict]) -> int:
    """Holm over the members with status ok; sets p_holm on each member and returns m."""
    ok = [c for c in members if c["status"] == "ok"]
    adjusted = an.holm({(c["arm"], c["ref"]): c["p"] for c in ok})
    for c in members:
        c["p_holm"] = adjusted.get((c["arm"], c["ref"])) if c["status"] == "ok" else None
    return len(ok)


def single_test(c: dict) -> None:
    c["p_holm"] = c["p"] if c["status"] == "ok" else None


def retention_reading(gate_passed: bool, vs_original: dict, vs_9p: dict, g_minus_9: dict) -> dict:
    """PLAN_E5 step 3, margin 0.015: keeps / loses / partly kept, in the plan's order."""
    out = {"margin": MARGIN, "n": g_minus_9["n"], "d_G_minus_9": g_minus_9["mean_d"], "ci90_G_minus_9": g_minus_9["ci90"],
           "d_9_minus_G": None if g_minus_9["mean_d"] is None else -g_minus_9["mean_d"],
           "ci95_9_minus_G": None if not g_minus_9["ci95"] else [-g_minus_9["ci95"][1], -g_minus_9["ci95"][0]],
           "keeps_rule": None, "loses_rule": None, "both_rules": None}
    if not gate_passed:
        return out | {"reading": GATE_FAILED}
    if g_minus_9["status"] != "ok":
        return out | {"reading": g_minus_9["status"]}
    keeps = (is_helps(vs_original["label"]) and is_helps(vs_9p["label"])
             and g_minus_9["ci90"] is not None and g_minus_9["ci90"][0] > -MARGIN)
    loses = out["d_9_minus_G"] > 0 and out["ci95_9_minus_G"] is not None and out["ci95_9_minus_G"][0] > 0
    reading = "keeps the gain" if keeps else "loses the gain" if loses else "partly kept, unclear"
    return out | {"reading": reading, "keeps_rule": keeps, "loses_rule": loses, "both_rules": keeps and loses}


def meaning(gate_label: str, readings: dict) -> dict:
    """PLAN_E5 "What the results mean": the tool and paper sentence for each guess."""
    out = {}
    for g, r in readings.items():
        if is_helps(gate_label):
            case = r["reading"]
            if case == "keeps the gain":
                tool = (f"\"Put your readers' words up top\" keeps its measured label for {INPUT_KIND[g]}; "
                        "other inputs stay \"a guess; untested\".")
                paper = PAPER_KEEPS[g]
                if r.get("both_rules"):  # amendment 2: keeps, and the report says the exact question did better
                    paper += f" The exact question still did better, by less than {MARGIN}."
            elif case == "loses the gain":
                tool = ("The label covers only full reader questions; keywords and questions made from them are "
                        "\"a guess; untested\".")
                paper = "Main limit: \"the gain needs most of the reader's words, which publishers rarely see\"."
            elif case == "partly kept, unclear":
                tool = ("The label covers full reader questions; keyword-based questions are labelled \"a guess; may "
                        "help less\".")
                paper = "Reported with the retention numbers."
            else:
                tool = paper = None
                case = None
        else:
            # The plan's last row (no effect or inconclusive), extended by amendment 2 to every gate label that
            # is not helps (hurts, model-dependent, insufficient n; also not run): no reading from the guesses,
            # and the reader's-words label follows step 5.
            case = "gate did not pass"
            tool = ("The reader's-words label follows the pooled estimate over the main queries with a valid arm 9 "
                    "(step 5); the Research page shows both.")
            paper = ("Reported plainly next to E1's result; the guess results are descriptive."
                     if gate_label in (an.NO_EFFECT, "inconclusive") else
                     f"No reading is drawn from the guesses (gate: {gate_label}); their results are descriptive.")
        if tool is None:
            tool = paper = (f"The plan gives no reading for this result (gate: {gate_label}; {g}: {r['reading']}), "
                            "so no reading is drawn.")
        out[g] = {"case": case, "tool": tool, "paper": paper}
    return out


def tool_action(label: str) -> str:
    if label == an.HELPS_CONFOUNDED:
        return TOOL_ACTION["helps"] + ", with E1's note on length or query-term overlap"
    return TOOL_ACTION.get(label, f"evidence grade kept, with \"E5: {label} (d, CI)\" added")


# ---------- planned tests (shared with the null simulation) ----------


def planned_main(ix: E5Index, batch: PBatch, resamples: int, *, with_ci: bool = True, confound: bool = True,
                 judge_p: bool = True) -> dict:
    """The main set's planned contrasts, resolved and summarized; p-values are pending in the batch."""
    pooled, new = ix.queries(MAIN), ix.queries(MAIN, NEW)
    cix = ix if confound else None

    def rec(arm, ref, queries, alpha=ALPHA, ci=with_ci):
        return record(resolve(ix, arm, ref, queries), batch, resamples, alpha=alpha, with_ci=ci,
                      confound_ix=cix, judge_p=judge_p)

    out = {"gate": rec(*GATE, new),
           "family": [rec(a, r, pooled) for a, r in FAMILY],
           "retention": {g: rec(g, "9", pooled, ci=True) for g in GUESSES},
           "arm12": rec(*ARM12, pooled),
           "arm12_vs_original": rec("12K", "original", pooled),
           "step5": rec(*STEP5, pooled)}
    for c in out["family"]:
        c["family"] = "main"
    return out


def planned_replication(ix: E5Index, batch: PBatch, resamples: int, *, with_ci: bool = True, confound: bool = True,
                        judge_p: bool = True) -> dict:
    queries = ix.queries(REPLICATION)
    fam = [record(resolve(ix, a, r, queries), batch, resamples, with_ci=with_ci, confound_ix=ix if confound else None,
                  judge_p=judge_p) for a, r in FAMILY]
    for c in fam:
        c["family"] = "replication"
    return {"family": fam}


MISSING_WORDS_RULE = ("12K vs P12K helps (E1's \"helps, possibly through length or query-term overlap\" counts as "
                      "helps) and 12K vs original above 0 (its mean d, no test)")


def missing_words(arm12: dict, vs_orig: dict) -> dict:
    """PLAN_E5 step 4, the tool's "missing words" rule, read as README-analysis choices 1 and 4 fix it. The rule is
    unchanged by the flag: rests_on_e1_note says the measured label holds only because the noted label counts as
    helps, so a reader can see where that reading decided it."""
    measured = is_helps(arm12["label"]) and vs_orig["mean_d"] is not None and vs_orig["mean_d"] > 0
    on_note = measured and arm12["label"] == an.HELPS_CONFOUNDED
    text = ("The \"missing words\" list gets a measured label for keywords." if measured else
            "The \"missing words\" list keeps its current label.")
    if on_note:
        text += (" The label rests on counting E1's note as helps: 12K beat its placebo, but the length and key-term "
                 "regression does not show an effect clearly above zero once those are accounted for.")
    return {"measured": measured, "rule": MISSING_WORDS_RULE, "label_12K_vs_P12K": arm12["label"],
            "d_12K_vs_original": vs_orig["mean_d"], "rests_on_e1_note": on_note, "text": text}


def apply_main(p: dict) -> dict:
    """The plan's decision structure on resolved main-set contrasts with p-values: gate, Holm family,
    retention, 12K vs P12K and step 5. Sets p_holm and label on each and returns the readings."""
    gate = p["gate"]
    single_test(gate)
    gate["label"] = e1_label(gate)
    passed = is_helps(gate["label"])
    gate["passed"] = passed
    m = holm_family(p["family"])
    for c in p["family"]:
        c["alpha"] = ALPHA / m if m else ALPHA
        c["mde"] = an.realized_mde(c["sd"], c["n"], c["alpha"]) if c["sd"] is not None else None
        if c["status"] != "ok":
            c["label"] = c["status"]
        else:
            c["_verdict_if_gated"] = e1_label(c)  # internal: the null simulation's ungated rate
            c["label"] = c["_verdict_if_gated"] if passed else GATE_FAILED
    fam = {(c["arm"], c["ref"]): c for c in p["family"]}
    for c in p["retention"].values():
        c["p_holm"] = None
        c["label"] = REPORTED if c["n"] and c["status"] in ("ok", "insufficient n") else c["status"]
    readings = {g: retention_reading(passed, fam[(g, "original")], fam[(g, "9P")], p["retention"][g]) for g in GUESSES}
    arm12, vs_orig = p["arm12"], p["arm12_vs_original"]
    single_test(arm12)
    arm12["label"] = e1_label(arm12)
    vs_orig["p_holm"] = None
    vs_orig["label"] = REPORTED if vs_orig["n"] and vs_orig["status"] in ("ok", "insufficient n") else vs_orig["status"]
    step5 = p["step5"]
    single_test(step5)
    step5["label"] = e1_label(step5)
    return {
        "gate_passed": passed, "gate_label": gate["label"], "family_m": m,
        "retention": readings, "meaning": meaning(gate["label"], readings),
        "missing_words": missing_words(arm12, vs_orig),
        "readers_words_label": {"label": step5["label"], "tool_action": tool_action(step5["label"]),
                                "note": STEP5_NOTE},
        "note_9G": G9_NOTE,
    }


def apply_replication(p: dict) -> dict:
    m = holm_family(p["family"])
    for c in p["family"]:
        c["alpha"] = ALPHA / m if m else ALPHA
        c["mde"] = an.realized_mde(c["sd"], c["n"], c["alpha"]) if c["sd"] is not None else None
        c["label"] = e1_label(c)
    return {"family_m": m}


# ---------- reported without a verdict ----------


def _reported(ix: E5Index, arm: str, ref: str, queries, batch: PBatch, resamples: int, *, scope: str,
              subset=None, judges=JUDGE_ORDER) -> dict:
    r = resolve(ix, arm, ref, queries, judges)
    if subset is not None:
        keep = set(subset)
        r = r | {"d": {q: x for q, x in r["d"].items() if q in keep},
                 "per_judge_d": {j: {q: x for q, x in jd.items() if q in keep} for j, jd in r["per_judge_d"].items()}}
        if r["status"] != "not run":
            r["status"] = "ok" if len(r["d"]) >= MIN_N else "insufficient n"
        r |= source_counts(Counter(k for q, k in r["_src"].items() if q in r["d"]))
    c = record(r, batch, resamples, confound_ix=ix)
    c["scope"] = scope
    c["p_holm"] = None
    c["label"] = REPORTED if c["n"] and c["status"] in ("ok", "insufficient n") else c["status"]
    return c


def merged_cells(levels_n: dict) -> list[list[str]]:
    """Key-term levels as cells, merging any cell under 10 queries: the first such cell (in level order)
    joins the next cell (the last joins the previous), until every cell has 10 or one cell is left."""
    cells = [[lv] for lv in LEVELS]
    count = lambda cell: sum(levels_n.get(lv, 0) for lv in cell)  # noqa: E731
    while len(cells) > 1:
        small = next((i for i, cell in enumerate(cells) if count(cell) < MERGE_BELOW), None)
        if small is None:
            break
        j = small + 1 if small + 1 < len(cells) else small - 1
        lo, hi = sorted((small, j))
        cells[lo:hi + 1] = [cells[lo] + cells[hi]]
    return cells


def length_breakdown(ix: E5Index, set_name: str, batch: PBatch, resamples: int) -> dict:
    """d(9K - 9) by the key-term count of q, with d(9 vs original) in the same cells."""
    queries = ix.queries(set_name)
    cost = record(resolve(ix, "9K", "9", queries), batch, resamples)
    gain = record(resolve(ix, "9", "original", queries), batch, resamples)
    counts = Counter(ix.info[q]["level"] for q in cost["_d"])
    cells = merged_cells(counts)
    rows = []
    for cell in cells:
        qs_cost = [q for q in cost["_d"] if ix.info[q]["level"] in cell]
        qs_gain = [q for q in gain["_d"] if ix.info[q]["level"] in cell]
        rows.append({"levels": cell, "d_9K_minus_9": restrict(cost, qs_cost, batch, resamples),
                     "d_9_vs_original": restrict(gain, qs_gain, batch, resamples)})
    unknown = [q for q in cost["_d"] if ix.info[q]["level"] is None]
    return {"cells": rows, "level_counts": {lv: counts.get(lv, 0) for lv in LEVELS}, "unknown_level": len(unknown),
            "keyword_share_of_reader_words": "min(1, 2/|K(q)|): set by query length, so this is not a dose",
            "mode_9K_minus_9": cost["mode"], "mode_9_vs_original": gain["mode"],
            "cross_run": cost["cross_run"] or gain["cross_run"]}


def splits(ix: E5Index, set_name: str, batch: PBatch, resamples: int, *, guesses=GUESSES,
           exclude: dict | None = None) -> dict:
    """9K and 9L vs original by template (kept keyword or a template question) and on the tool-gate subset.
    `exclude` maps a guess to queries left out of its rows (amendment 3's sensitivity rows)."""
    queries = ix.queries(set_name)
    out = {}
    for g in guesses:
        left_out = set((exclude or {}).get(g, ()))
        c = record(resolve(ix, g, "original", [q for q in queries if q not in left_out]), batch, resamples)
        kept = [q for q in c["_d"] if ix.info[q]["template"] == "kept"]
        templ = [q for q in c["_d"] if ix.info[q]["template"] not in (None, "kept")]
        gate_q = [q for q in c["_d"] if ix.version_field(q, "9K", "tool_gate") is True]
        row = {"mode": c["mode"], "cross_run": c["cross_run"], "all": restrict(c, list(c["_d"]), batch, resamples),
               "template_kept": restrict(c, kept, batch, resamples),
               "template_question": restrict(c, templ, batch, resamples),
               "tool_gate_given_q_prime": restrict(c, gate_q, batch, resamples)}
        if g == "9L":
            own = [q for q in c["_d"] if ix.version_field(q, "9L", "tool_gate") is True]
            row["tool_gate_given_q_L"] = restrict(c, own, batch, resamples)
        out[g] = row
    return out


def share_kept(ix: E5Index, strata, batch: PBatch, resamples: int, *, caveat: str | None = None,
               guesses=GUESSES, exclude: dict | None = None) -> dict:
    """(G - 9P) / (9 - 9P) on the queries with G, 9 and 9P, with a bootstrap 90% interval; "not estimable"
    when the denominator's 95% interval includes 0 or more than 2.5% of resamples give it at or below 0.
    `exclude` maps a guess to queries left out of its row (amendment 3's sensitivity rows)."""
    all_queries = ix.queries(MAIN, strata)
    out = {"strata": list(strata), "caveat": caveat}
    for g in guesses:
        left_out = set((exclude or {}).get(g, ()))
        queries = [q for q in all_queries if q not in left_out]
        num_r, den_r = resolve(ix, g, "9P", queries), resolve(ix, "9", "9P", queries)
        if num_r["single_model"] != den_r["single_model"]:
            num_r, den_r = resolve(ix, g, "9P", queries, [PRIMARY]), resolve(ix, "9", "9P", queries, [PRIMARY])
        common = sorted(set(num_r["d"]) & set(den_r["d"]))
        num = np.array([num_r["d"][q] for q in common], dtype=float)
        den = np.array([den_r["d"][q] for q in common], dtype=float)
        g9 = record(resolve(ix, g, "9", queries), batch, resamples)
        row = {"n": len(common), "single_model": num_r["single_model"],
               "cross_run": num_r["cross_run"] or den_r["cross_run"],
               "d_G_minus_9": {k: g9[k] for k in ("n", "mean_d", "ci95", "ci90", "mode", "cross_run")} | {"_p": g9},
               "share": None, "ci90": None, "estimable": False, "reason": None}
        if len(common) < 2:
            row["reason"] = "fewer than 2 queries with G, 9 and 9P"
        else:
            den_ci = an.bootstrap_ci(den, resamples)["ci95"]
            idx = np.random.default_rng(1).integers(0, len(common), size=(resamples, len(common)))
            num_m, den_m = num[idx].mean(axis=1), den[idx].mean(axis=1)
            at_or_below = float((den_m <= 0).mean())
            row |= {"numerator": float(num.mean()), "denominator": float(den.mean()), "denominator_ci95": den_ci,
                    "denominator_resamples_at_or_below_0": at_or_below}
            if den_ci[0] <= 0 <= den_ci[1]:
                row["reason"] = "the denominator's 95% interval includes 0"
            elif at_or_below > 0.025:
                row["reason"] = "more than 2.5% of resamples give a denominator at or below 0"
            else:
                # Up to 2.5% of resamples may still have a denominator of exactly 0 here. Their ratios are
                # +-inf, which stay in the tails beyond the 5% and 95% points, so numpy's division warning is
                # silenced; a 0/0 resample (nan) has no ratio and is left out of the quantiles (counted).
                with np.errstate(divide="ignore", invalid="ignore"):
                    ratios = num_m / den_m
                row["resamples_without_a_ratio"] = int(np.isnan(ratios).sum())
                q = np.nanquantile(ratios, [0.05, 0.95])
                row |= {"estimable": True, "share": float(num.mean() / den.mean()), "ci90": [float(q[0]), float(q[1])]}
        out[g] = row
    return out


def reweighted(ix: E5Index, c: dict, weights: dict, batch: PBatch | None, resamples: int) -> dict:
    """The contrast's new-query estimate reweighted to E1's key-term-level distribution (levels present
    renormalized), with a percentile bootstrap interval from E1's resampling indices."""
    qs = sorted(q for q in c["_d"] if ix.info[q]["stratum"] in NEW and ix.info[q]["level"] is not None)
    out = {"n": len(qs), "estimate": None, "ci95": None, "levels_missing": [], "weights": weights}
    if not qs or not weights:
        return out
    values = np.array([c["_d"][q] for q in qs], dtype=float)
    lv = np.array([LEVELS.index(ix.info[q]["level"]) for q in qs])
    w = np.array([weights.get(name, 0.0) for name in LEVELS], dtype=float)

    def estimate(vals, lvs):
        total, wsum = 0.0, 0.0
        for k in range(len(LEVELS)):
            mask = lvs == k
            if w[k] > 0 and mask.any():
                total += w[k] * vals[mask].mean()
                wsum += w[k]
        return total / wsum if wsum else float("nan")

    out["levels_missing"] = [LEVELS[k] for k in range(len(LEVELS)) if w[k] > 0 and not (lv == k).any()]
    out["estimate"] = float(estimate(values, lv))
    idx = np.random.default_rng(1).integers(0, len(qs), size=(resamples, len(qs)))
    boots = np.array([estimate(values[i], lv[i]) for i in idx])
    boots = boots[~np.isnan(boots)]
    if len(boots):
        q = np.quantile(boots, [0.025, 0.975])
        out["ci95"] = [float(q[0]), float(q[1])]
    out["unweighted"] = float(values.mean())
    return out


def e1_weights(ix: E5Index) -> dict:
    counts = Counter(ix.info[q]["level"] for q in ix.queries(MAIN, ("e1",)) if ix.info[q]["level"] is not None)
    total = sum(counts.values())
    return {lv: counts.get(lv, 0) / total for lv in LEVELS} if total else {}


def breakdowns(ix: E5Index, c: dict, batch: PBatch, resamples: int, weights: dict | None) -> None:
    """Per stratum and the reweighted new-query estimate for a main-set planned contrast (in place)."""
    c["by_stratum"] = {s: restrict(c, [q for q in c["_d"] if ix.info[q]["stratum"] == s], batch, resamples)
                       for s in STRATA}
    if weights is not None:
        c["reweighted_new"] = reweighted(ix, c, weights, batch, resamples)


def secondary_judges(ix: E5Index, c: dict, queries, batch: PBatch, resamples: int) -> None:
    """For a single-model contrast: each other judge alone on its complete queries, as secondary."""
    if not c["single_model"]:
        return
    c["secondary"] = {}
    for j in JUDGE_ORDER[1:]:
        r = resolve(ix, c["arm"], c["ref"], queries, [j])
        if r["d"]:
            s = record(r, batch, resamples, judge_p=False)
            c["secondary"][j] = {k: s[k] for k in ("n", "mean_d", "ci95", "ci90", "p", "status")} | {"_s": s}


def drift(ix: E5Index, batch: PBatch, resamples: int) -> dict:
    """E5's original and arm 9 cells minus the earlier run's cells for the same (query, version, judge)."""
    diffs = defaultdict(dict)  # (q) -> {(arm, judge, run): diff}
    for (q, arm, j), c5 in ix.e5.items():
        if arm not in ("original", "9"):
            continue
        for run, c0 in ix.earlier.get((q, arm, j), {}).items():
            if complete(c5) and complete(c0) and not c5["dropped"] and not c0["dropped"]:
                diffs[q][(arm, j, run)] = float(c5["score"]) - float(c0["score"])

    def summarize(select) -> dict:
        d = {}
        n_cells = 0
        for q, row in diffs.items():
            xs = [x for k, x in row.items() if select(q, *k)]
            if xs:
                d[q] = float(np.mean(xs))
                n_cells += len(xs)
        s = stats(d, batch, resamples)
        return {"n_queries": s["n"], "n_cells": n_cells, "mean": s["mean_d"], "ci95": s["ci95"], "_s": s}

    judges = sorted({j for row in diffs.values() for (_, j, _) in row}, key=lambda j: (j not in JUDGE_ORDER, j))
    runs = [r for r in ix.runs if any(k[2] == r for row in diffs.values() for k in row)]
    out = {"overall": summarize(lambda q, a, j, r: True),
           "per_judge": {j: summarize(lambda q, a, jj, r, j=j: jj == j) for j in judges},
           "per_version": {a: summarize(lambda q, aa, j, r, a=a: aa == a) for a in ("original", "9")},
           "per_set": {s: summarize(lambda q, a, j, r, s=s: ix.info[q]["set"] == s) for s in (MAIN, REPLICATION)},
           "per_run": {r: summarize(lambda q, a, j, rr, r=r: rr == r) for r in runs},
           "unit": "query: mean over its versions and judges of E5 cell minus earlier cell"}
    out["excludes_0"] = bool(out["overall"]["ci95"] and not (out["overall"]["ci95"][0] <= 0 <= out["overall"]["ci95"][1]))
    return out


def reason_key(reason: str | None) -> str | None:
    """An exclusion reason without page words: the validator message up to its first detail."""
    if not reason:
        return None
    first = reason.split(" | ")[0]
    head, _, rest = first.partition(": ")
    rest = re.split(r"[:(\"'“‘]", rest, maxsplit=1)[0].strip().rstrip(".;,")
    return f"{head}: {rest}"[:80] if rest else head[:80]


def grouped_reason(reason: str | None) -> str | None:
    """An exclusion reason grouped across queries: reason_key with its numbers replaced by #."""
    key = reason_key(reason)
    return None if key is None else re.sub(r"\d+(?:\.\d+)?", "#", key)


VALIDITY_ARMS = {MAIN: VERSIONS, REPLICATION: ("original", "9", "9P", "9K", "9L", "9A", "9G")}  # no arm 12 on C-SEO
PLACEBO_OF = {"P12": "12", "P12K": "12K"}  # built only where their edit is valid (E1's P12 rule)


def validity(ix: E5Index, inp: E5Inputs) -> dict:
    """Per version: queries, not applicable (from the applicability rows, by reason, and versions the editor
    marked not applicable), applicable, valid, failed validation (by reason), mean length ratio and key-term
    change of the valid versions, and the share of valid versions each tool flag marks True."""
    out = {}
    for set_name, strata in ((MAIN, STRATA), (REPLICATION, ("replication",))):
        groups = {"all": ix.queries(set_name)} | ({s: ix.queries(set_name, (s,)) for s in strata} if set_name == MAIN else {})
        out[set_name] = {}
        for gname, qs in groups.items():
            rows = {}
            for arm in VALIDITY_ARMS[set_name]:
                built = {q: ix.version[(q, arm)] for q in qs if (q, arm) in ix.version}
                tabled = any((q, a) in ix.appl for q in qs for a in APPLICABILITY_PARENTS.get(arm, (arm,)))
                if not built and not tabled:
                    continue
                by_table = [q for q in qs if not ix.applicable(q, arm)]
                by_editor = [v for q, v in built.items() if ix.applicable(q, arm) and an.not_applicable(v)]
                appl = [v for q, v in built.items() if ix.applicable(q, arm) and not an.not_applicable(v)]
                valid = [v for v in appl if v["valid"]]
                failed = [v for v in appl if not v["valid"]]
                reasons = Counter(grouped_reason(ix.not_applicable_reason(q, arm)) for q in by_table)
                reasons.update(grouped_reason(v.get("excluded_reason")) for v in by_editor)
                # Applicable but not built (yet): for a placebo, only where its edit is valid.
                pending = [q for q in qs if ix.applicable(q, arm) and q not in built
                           and (arm not in PLACEBO_OF or ix.usable(q, PLACEBO_OF[arm]))]

                def mean(name, vs=valid):
                    xs = [float(v[name]) for v in vs if v.get(name) is not None]
                    return float(np.mean(xs)) if xs else None

                flags = sorted({k for v in valid for k, x in v.items() if k.startswith("tool_") and isinstance(x, bool)})
                tool = {}
                for k in flags:
                    known = [v[k] for v in valid if isinstance(v.get(k), bool)]
                    tool[k] = {"true": sum(known), "of": len(known), "share": sum(known) / len(known)}
                rows[arm] = {
                    "queries": len(qs), "rows": len(built),
                    "from_earlier_run": sum(1 for q in built if ix.version_source[(q, arm)] != "e5"),
                    "not_applicable": len(by_table) + len(by_editor),
                    "not_applicable_by_reason": dict(reasons.most_common()),
                    "applicable": len(appl), "valid": len(valid), "failed_validation": len(failed),
                    "applicable_without_a_version": len(pending),
                    "failed_by_reason": dict(Counter(grouped_reason(v.get("excluded_reason")) for v in failed).most_common()),
                    "mean_length_ratio": mean("length_ratio"), "mean_key_terms_delta": mean("key_terms_delta"),
                    "same_sentence_as_9": sum(1 for v in valid if v.get("same_sentence_as_9") is True),
                    "tool_flags": tool,
                }
            out[set_name][gname] = rows
    texts = defaultdict(lambda: {"queries": 0, "template": Counter(), "q_L_status": Counter(), "q_G_missing": 0,
                                 "levels": Counter()})
    for r in inp.edit_texts:
        if r["query_id"] not in ix.info:
            continue
        t = texts[r["stratum"]]
        t["queries"] += 1
        t["template"][str(r.get("template"))] += 1
        t["q_L_status"][str(r.get("q_L_status"))] += 1
        t["q_G_missing"] += r.get("q_G") in (None, "")
        t["levels"][str(level(r.get("n_key_terms")))] += 1
    out["edit_texts"] = {s: {k: (dict(v) if isinstance(v, Counter) else v) for k, v in t.items()} for s, t in texts.items()}
    return out


def _common_prefix_len(a: str, b: str) -> int:
    lo, hi = 0, min(len(a), len(b))
    while lo < hi:  # binary search on slice equality (each comparison runs in C)
        mid = (lo + hi + 1) // 2
        if a[:mid] == b[:mid]:
            lo = mid
        else:
            hi = mid - 1
    return lo


def same_sentence_by_text(text_9: str | None, text_x: str | None) -> bool | None:
    """Two arm 9 family versions of one page (a heading and a copied sentence inserted at the same place): True when
    they copy the same sentence. After their common prefix and suffix, what differs must lie within one line (the
    heading); a different sentence makes it reach across the blank line between heading and sentence. None when a
    text is missing."""
    if not text_9 or not text_x:
        return None
    i = _common_prefix_len(text_9, text_x)
    j = min(_common_prefix_len(text_9[::-1], text_x[::-1]), min(len(text_9), len(text_x)) - i)
    return "\n" not in text_9[i:len(text_9) - j] and "\n" not in text_x[i:len(text_x) - j]


SENTENCE_ARMS = ("9K", "9L", "9A", "9G", "9P")


def sentence_vs_9(ix: E5Index) -> dict:
    """Per set and version, on the queries where it and arm 9 are usable: how many copy the same page sentence as arm
    9 (make_versions' same_sentence_as_9 where it exists, else the version texts) and how often the two agree."""
    out = {"rule": "same_sentence_as_9 where make_versions sets it (9K, 9L, 9A, 9G); else, and as a check, the version "
                   "texts: after their common prefix and suffix, the parts that differ lie within one line"}
    for set_name in (MAIN, REPLICATION):
        rows = {}
        for arm in SENTENCE_ARMS:
            n = same = unknown = compared = agree = 0
            for q in ix.queries(set_name):
                if not (ix.usable(q, arm) and ix.usable(q, "9")):
                    continue
                n += 1
                flag = ix.version_field(q, arm, "same_sentence_as_9")
                by_text = same_sentence_by_text(ix.version_field(q, "9", "text"), ix.version_field(q, arm, "text"))
                if isinstance(flag, bool) and by_text is not None:
                    compared += 1
                    agree += flag == by_text
                s = flag if isinstance(flag, bool) else by_text
                if s is None:
                    unknown += 1
                else:
                    same += bool(s)
            if n:
                rows[arm] = {"n": n, "same_sentence": same, "different_sentence": n - same - unknown,
                             "unknown": unknown, "flag_vs_text": {"compared": compared, "agree": agree}}
        out[set_name] = rows
    return out


def flagged_queries(ix: E5Index) -> dict:
    """PLAN_E5 amendment 3: per set and guess (9K, 9L, 9G), the queries whose usable version's edit text equals q."""
    out = {s: {arm: [] for arm in FLAGGED_ARMS} for s in (MAIN, REPLICATION)}
    for (q, arm), v in ix.version.items():
        if arm in FLAGGED_ARMS and v.get("edit_text_is_q") is True and ix.usable(q, arm):
            out[ix.info[q]["set"]][arm].append(q)
    return {s: {arm: sorted(qs) for arm, qs in by.items()} for s, by in out.items()}


def identical_prompts(ix: E5Index, flagged_9l, batch: PBatch, resamples: int) -> dict:
    """NOISE_NOTE: the flagged 9L versions identical to arm 9's, their prompts and their cell differences (9L - 9)."""
    rows = []
    for q in sorted(flagged_9l):
        key_9, key_l = version_text_key(ix.version.get((q, "9"))), version_text_key(ix.version.get((q, "9L")))
        if not ix.usable(q, "9") or not ix.version_field(q, "9L", "text") or key_9 is None or key_9 != key_l:
            continue
        same_prompts, diffs = {}, {}
        for j in JUDGE_ORDER:
            a, b = ix.digests.get(("e5", q, "9L", j)), ix.digests.get(("e5", q, "9", j))
            same_prompts[j] = None if a is None or b is None else a == b
            cl, c9 = ix.e5.get((q, "9L", j)), ix.e5.get((q, "9", j))
            if complete(cl) and complete(c9) and not cl["dropped"] and not c9["dropped"]:
                diffs[j] = float(cl["score"]) - float(c9["score"])
        rows.append({"query_id": q, "stratum": ix.info[q]["stratum"], "same_prompts": same_prompts,
                     "cell_diff_9L_minus_9": diffs, "d": float(np.mean(list(diffs.values()))) if diffs else None})
    cells = [x for r in rows for x in r["cell_diff_9L_minus_9"].values()]
    differ = [x for x in cells if abs(x) > 1e-12]
    prompts = [x for r in rows for x in r["same_prompts"].values() if x is not None]
    out = {"note": NOISE_NOTE, "flagged_9L": len(flagged_9l), "identical_versions": len(rows),
           "queries": [r["query_id"] for r in rows], "prompt_sets_compared": len(prompts),
           "prompt_sets_identical": sum(prompts), "cells": len(cells), "cells_differ": len(differ),
           "differing_lower_on_9L": sum(x < 0 for x in differ), "differing_higher_on_9L": sum(x > 0 for x in differ),
           "mean_abs_cell_diff": float(np.mean(np.abs(cells))) if cells else None,
           "max_abs_cell_diff": float(np.max(np.abs(cells))) if cells else None,
           "per_judge": {j: {"cells": len(xs), "differ": sum(abs(x) > 1e-12 for x in xs),
                             "mean": float(np.mean(xs)) if xs else None}
                         for j in JUDGE_ORDER
                         for xs in [[r["cell_diff_9L_minus_9"][j] for r in rows if j in r["cell_diff_9L_minus_9"]]]},
           "rows": rows}
    # Exact sign-flip p (n <= 12 enumerates every sign pattern); no bootstrap interval for so few queries.
    out["d_9L_minus_9"] = stats({r["query_id"]: r["d"] for r in rows if r["d"] is not None}, batch, resamples,
                                with_ci=False)
    return out


def amendment3(ix: E5Index, main_p: dict, rep_p: dict, batch: PBatch, resamples: int, weights: dict) -> dict:
    """A3_NOTE: the sensitivity rows, resolved, with p-values pending in the batch (labels: apply_amendment3)."""
    flagged = flagged_queries(ix)
    out = {"note": A3_NOTE, "arms": list(FLAGGED_ARMS), "flagged": {}}
    for set_name, planned_fam in ((MAIN, main_p["family"]), (REPLICATION, rep_p["family"])):
        fl = flagged[set_name]
        out["flagged"][set_name] = {arm: {"n": len(qs), "queries": qs,
                                          "by_stratum": dict(Counter(ix.info[q]["stratum"] for q in qs))}
                                    for arm, qs in fl.items()}
        queries = ix.queries(set_name)

        def without(arms, qs=queries, fl=fl):
            drop = {q for a in arms for q in fl.get(a, ())}
            return [q for q in qs if q not in drop]

        if not any(fl.values()):
            out[set_name] = {"any_flagged": False,
                             "unchanged": "no 9K, 9L or 9G version here has an edit text equal to q, so its rows are "
                                          "the planned and reported ones"}
            continue
        block = {"any_flagged": True}
        planned = {(c["arm"], c["ref"]): c for c in planned_fam}
        fam = []
        for arm, ref in FAMILY:
            c = record(resolve(ix, arm, ref, without((arm,))), batch, resamples, confound_ix=ix)
            c["family"] = set_name
            c["left_out"] = sorted(set(fl.get(arm, ())) & set(planned[(arm, ref)]["_d"]))
            if set_name == MAIN:
                breakdowns(ix, c, batch, resamples, weights)
            fam.append(c)
        block["family"] = fam
        if set_name == MAIN:
            block["retention"] = {}
            for g in GUESSES:
                c = record(resolve(ix, g, "9", without((g,))), batch, resamples, confound_ix=ix)
                c["left_out"] = sorted(set(fl.get(g, ())) & set(main_p["retention"][g]["_d"]))
                breakdowns(ix, c, batch, resamples, weights)
                block["retention"][g] = c
            guesses = tuple(g for g in GUESSES if fl.get(g))
            block["share_kept_new"] = share_kept(ix, NEW, batch, resamples, guesses=guesses, exclude=fl)
            block["share_kept_e1"] = share_kept(ix, ("e1",), batch, resamples, caveat=E1_CAVEAT, guesses=guesses,
                                                exclude=fl)
            block["splits"] = splits(ix, MAIN, batch, resamples, guesses=guesses, exclude=fl)
            block["identical_prompts"] = identical_prompts(ix, fl.get("9L", ()), batch, resamples)
        scope = lambda arms: "pooled, without the flagged " + " and ".join(arms) + " queries"  # noqa: E731
        block["reported"] = [
            _reported(ix, "9G", "original", without(("9G",)), batch, resamples, scope=scope(("9G",))),
            _reported(ix, "9K", "9G", without(("9K", "9G")), batch, resamples, scope=scope(("9K", "9G"))),
        ]
        out[set_name] = block
    return out


def apply_amendment3(a3: dict, main_p: dict, rep_p: dict, readings: dict) -> None:
    """Holm over the four sensitivity tests per set, E1's label each would get (beside the planned label), and the
    retention reading without the flagged queries; the rows themselves stay without a verdict."""
    changed = []
    for set_name, planned_fam in ((MAIN, main_p["family"]), (REPLICATION, rep_p["family"])):
        block = a3.get(set_name) or {}
        if "family" not in block:
            continue
        m = holm_family(block["family"])
        gate_passed = readings["gate_passed"] if set_name == MAIN else True  # the replication family has no gate
        planned = {(c["arm"], c["ref"]): c for c in planned_fam}
        for c in block["family"]:
            c["alpha"] = ALPHA / m if m else ALPHA
            c["mde"] = an.realized_mde(c["sd"], c["n"], c["alpha"]) if c["sd"] is not None else None
            by_rules = c["status"] if c["status"] != "ok" else (e1_label(c) if gate_passed else GATE_FAILED)
            p = planned[(c["arm"], c["ref"])]
            c.update({"label": REPORTED, "label_by_e1_rules": by_rules, "planned_label": p["label"],
                      "label_unchanged": by_rules == p["label"], "n_planned": p["n"], "confound_note": confound_note(c)})
            if not c["label_unchanged"]:
                changed.append(f"{set_name} {c['arm']} vs {c['ref']}")
        if set_name != MAIN:
            continue
        fam = {(c["arm"], c["ref"]): c | {"label": c["label_by_e1_rules"]} for c in block["family"]}
        block["readings"] = {}
        for g, c in block["retention"].items():
            c["p_holm"] = None
            c["label"] = REPORTED if c["n"] and c["status"] in ("ok", "insufficient n") else c["status"]
            c["n_planned"] = main_p["retention"][g]["n"]
            r = retention_reading(readings["gate_passed"], fam[(g, "original")], fam[(g, "9P")], c)
            planned_reading = readings["retention"][g]["reading"]
            block["readings"][g] = r | {"planned_reading": planned_reading,
                                        "reading_unchanged": r["reading"] == planned_reading}
            if r["reading"] != planned_reading:
                changed.append(f"retention {g}")
    a3["changed"] = changed
    a3["every_label_unchanged"] = not changed


def added_analyses(ix: E5Index, main_p: dict, batch: PBatch, resamples: int) -> dict:
    """ADDED_NOTE: the gate without the new queries that share pages with an E1 query (NEAR_DUPLICATES)."""
    gate = main_p["gate"]
    left = sorted(q for q in NEAR_DUPLICATES if q in gate["_d"])
    row = restrict(gate, [q for q in gate["_d"] if q not in NEAR_DUPLICATES], batch, resamples)
    # In place: the batch fills row["p"] later, so row must be the object that goes into the output.
    row.update({"left_out": [{"query_id": q} | NEAR_DUPLICATES[q] for q in left], "n_planned": gate["n"],
                "label": REPORTED})
    return {"note": ADDED_NOTE, "gate_without_near_duplicates": row}


# ---------- the analysis ----------


def _strip(x):
    """Drop the private _d / _s fields (and recurse) for the JSON output."""
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if not k.startswith("_")}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


def analyze(inp: E5Inputs, *, draws: int = an.DRAWS, resamples: int = an.RESAMPLES, snapshot: dict | None = None) -> dict:
    ix = E5Index(inp)
    batch = PBatch(draws)
    weights = e1_weights(ix)
    main_p = planned_main(ix, batch, resamples)
    rep_p = planned_replication(ix, batch, resamples)
    pooled, new, e1q = ix.queries(MAIN), ix.queries(MAIN, NEW), ix.queries(MAIN, ("e1",))
    rep_q = ix.queries(REPLICATION)

    planned = [main_p["gate"], *main_p["family"], *main_p["retention"].values(), main_p["arm12"],
               main_p["arm12_vs_original"], main_p["step5"]]
    for c in planned:
        breakdowns(ix, c, batch, resamples, weights)
        secondary_judges(ix, c, new if c is main_p["gate"] else pooled, batch, resamples)
    for c in rep_p["family"]:
        secondary_judges(ix, c, rep_q, batch, resamples)

    def rep(arm, ref, queries, scope, **kw):
        return _reported(ix, arm, ref, queries, batch, resamples, scope=scope, **kw)

    same_sentence = lambda qs: [q for q in qs if ix.version_field(q, "9K", "same_sentence_as_9") is True]  # noqa: E731
    reported = {MAIN: [], REPLICATION: []}
    for set_name, qs in ((MAIN, pooled), (REPLICATION, rep_q)):
        reported[set_name] += [
            rep("9A", "9K", qs, "pooled"), rep("9", "9A", qs, "pooled"),
            rep("9", "9K", qs, "same-sentence subset", subset=same_sentence(qs)),
            rep("9G", "original", qs, "pooled"), rep("9K", "9G", qs, "pooled"),
        ]
    reported[REPLICATION] += [rep("9K", "9", rep_q, "pooled"), rep("9L", "9", rep_q, "pooled")]
    for scope, qs in (("new queries", new), ("pooled", pooled)):
        reported[MAIN] += [rep("12K", "original", qs, scope), rep("P12K", "original", qs, scope),
                           rep("12K", "12", qs, scope), rep("12", "P12", qs, scope)]

    extras = {
        MAIN: {"share_kept_new": share_kept(ix, NEW, batch, resamples),
               "share_kept_e1": share_kept(ix, ("e1",), batch, resamples, caveat=E1_CAVEAT),
               "query_length": length_breakdown(ix, MAIN, batch, resamples),
               "splits": splits(ix, MAIN, batch, resamples)},
        REPLICATION: {"query_length": length_breakdown(ix, REPLICATION, batch, resamples),
                      "splits": splits(ix, REPLICATION, batch, resamples)},
    }
    drift_out = drift(ix, batch, resamples)
    a3 = amendment3(ix, main_p, rep_p, batch, resamples, weights)
    added = added_analyses(ix, main_p, batch, resamples)

    batch.run()  # every p-value, grouped by n
    readings = apply_main(main_p)
    rep_readings = apply_replication(rep_p)
    for c in planned + rep_p["family"]:
        c["confound_note"] = confound_note(c)
    apply_amendment3(a3, main_p, rep_p, readings)

    result = {
        "experiment": "E5", "plan": "experiments/PLAN_E5.md r2",
        "snapshot": snapshot or {},
        "settings": {"alpha": ALPHA, "delta": DELTA, "min_n": MIN_N, "min_valid_answers": MIN_VALID,
                     "answers_per_cell": N_ANSWERS, "draws": draws, "resamples": resamples, "bootstrap_seed": 1,
                     "sign_flip_seed": 1, "margin": MARGIN, "merge_below": MERGE_BELOW, "judges": list(JUDGE_ORDER)},
        "queries": {"main": len(pooled), "new": len(new), "e1": len(e1q), "replication": len(rep_q),
                    "by_stratum": {s: len(ix.queries(MAIN, (s,))) for s in STRATA},
                    "refused": sorted(set(inp.refused))},
        "e1_level_weights": weights,
        "earlier_cells_check": dict(ix.earlier_check),
        "main": {"planned": {"gate": main_p["gate"], "family": main_p["family"], "retention": main_p["retention"],
                             "arm12": main_p["arm12"], "arm12_vs_original": main_p["arm12_vs_original"],
                             "step5": main_p["step5"]},
                 "readings": readings, "reported": reported[MAIN], **extras[MAIN]},
        "replication": {"planned": {"family": rep_p["family"]}, "readings": rep_readings,
                        "reported": reported[REPLICATION], **extras[REPLICATION]},
        "drift": drift_out,
        "validity": validity(ix, inp) | {"sentence_vs_9": sentence_vs_9(ix)},
        "amendment_3_sensitivity": a3,
        "added_analyses": added,
        "caveat": CAVEAT,
    }
    return _resolve_private(result)


def _resolve_private(result: dict) -> dict:
    """Copy p-values filled into private sub-records (share_kept's d_G_minus_9, secondary judges, drift)
    to their public fields, then strip the private fields."""
    def walk(x):
        if isinstance(x, dict):
            for key in ("_p", "_s"):
                if key in x:
                    x["p"] = x[key].get("p")
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(result)
    return _strip(result)


# ---------- files ----------


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_PROMPT_KEY = re.compile(rb'^\{"key": "([^"\\]*)"')


class Snapshot:
    """Every input file read, with its sha256, size and the time the analysis started; a warning for each
    optional file that is missing; the scoring check (check_scoring)."""

    def __init__(self):
        self.started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.files: dict[str, dict] = {}
        self.warnings: list[str] = []
        self.scoring: dict = {}

    def record(self, path: Path, digest: str | None = None) -> None:
        path = Path(path)
        self.files[_rel(path)] = {"sha256": digest or sha256(path), "bytes": path.stat().st_size}

    def warn(self, text: str) -> None:
        self.warnings.append(text)
        print(f"analyze_e5: warning: {text}", file=sys.stderr)

    def rows(self, path: Path, default=None, *, missing: str | None = None) -> list:
        """A JSONL file's rows; a missing file stops the analysis unless a default is given (then `missing`,
        when given, is the warning)."""
        path = Path(path)
        if not path.exists():
            if default is None:
                raise SystemExit(f"analyze_e5: {path} is missing")
            if missing:
                self.warn(f"{_rel(path)} is missing: {missing}")
            return default
        self.record(path)
        return read_jsonl(path)

    def json(self, path: Path, *, required: bool = False):
        path = Path(path)
        if not path.exists():
            if required:
                raise SystemExit(f"analyze_e5: {path} is missing")
            return None
        self.record(path)
        return json.loads(path.read_text(encoding="utf-8"))

    def prompt_digests(self, path: Path, run: str, arms, *, missing: str | None = None) -> dict:
        """(run, query, arm, judge) -> sha256 over the sorted (seed, slot, sha256 of the prompt) of that
        version's prompts in the four scored sets, for the arms named; one pass that also hashes the file.
        A missing file stops the analysis unless `missing` (the warning) is given."""
        path = Path(path)
        if not path.exists():
            if missing is None:
                raise SystemExit(f"analyze_e5: {path} is missing")
            self.warn(f"{_rel(path)} is missing: {missing}")
            return {}
        whole, per = hashlib.sha256(), defaultdict(list)
        with open(path, "rb") as f:
            for line in f:
                whole.update(line)
                m = _PROMPT_KEY.match(line)
                if m:  # skip the other arms without parsing the prompt (key: [...|]judge|version_id|seed)
                    parts = m.group(1).decode("utf-8").rsplit("|", 2)
                    if len(parts) == 3 and parts[1].rpartition(":")[2] not in arms:
                        continue
                if not line.strip():
                    continue
                r = json.loads(line)
                if r["arm"] in arms and r.get("set") in SET_OF:
                    per[(run, r["query_id"], r["arm"], r["judge"])].append(
                        (int(r["seed"]), int(r["slot"]), hashlib.sha256(r["prompt"].encode("utf-8")).hexdigest()))
        self.record(path, whole.hexdigest())
        return {k: hashlib.sha256(json.dumps(sorted(v)).encode("utf-8")).hexdigest() for k, v in per.items()}

    def as_dict(self) -> dict:
        return {"started_at": self.started, "files": dict(sorted(self.files.items())),
                "warnings": list(self.warnings), "scoring": self.scoring}


def _rel(path: Path) -> str:
    path = Path(path).resolve()
    try:
        return str(path.relative_to(EXP.parent))
    except ValueError:
        return str(path)


EARLIER = {  # run: (data dir, out dir, arms E5 can take from it)
    "e1": (E1_DIR / "data", E1_DIR / "out", {"original", "9", "12", "P12"}),
    "e2a": (EXP / "e2" / "data", EXP / "e2" / "out" / "a", {"9P"}),
    "e3": (EXP / "e3" / "data", EXP / "e3" / "out" / "new", {"original"}),
}


def load_inputs(data: Path, scored: Path, *, earlier: dict | None = EARLIER, snap: Snapshot | None = None,
                prompts: bool = True) -> tuple[E5Inputs, Snapshot]:
    """E5's files (applicability.jsonl required), score.py's cells, and each earlier run's cells, versions and
    prompts (missing earlier files are warned about, never silent). Earlier cells and versions are limited to
    the arms E5 takes from the run and to the four scored sets. With earlier runs and `prompts`, the prompts of
    the arms an earlier run can stand in for are digested on both sides (E5's prompts.jsonl is then required)."""
    snap = snap or Snapshot()
    build = snap.json(data / "prompt_build.json") or {"refused": []}
    inp = E5Inputs(edit_texts=snap.rows(data / "edit_texts.jsonl"), versions=snap.rows(data / "versions.jsonl"),
                   applicability=snap.rows(data / "applicability.jsonl"), cells=snap.rows(scored / "cells.jsonl"),
                   refused=[r["query_id"] for r in build.get("refused", [])])
    arms_used = set()
    for run, (d, o, arms) in (earlier or {}).items():
        lost = f"run {run} gives no cross-run fallback and no drift check"
        cells = [c | {"run": run} for c in snap.rows(o / "cells.jsonl", [], missing=lost)
                 if c["arm"] in arms and c.get("set") in SET_OF]
        versions = [v | {"run": run} for v in snap.rows(d / "versions.jsonl", [], missing=f"run {run}'s version texts "
                                                        "are not compared and its own versions are unavailable")
                    if v["arm"] in arms and v.get("set") in SET_OF]
        inp.earlier_cells += cells
        inp.earlier_versions += versions
        if run == "e1":
            inp.e1_applicability = snap.rows(d / "applicability.jsonl", [],
                                             missing="no fallback applicability table for E1's queries")
        if prompts:
            inp.prompt_digests |= snap.prompt_digests(d / "prompts.jsonl", run, arms,
                                                      missing=f"run {run}'s cells are used without the prompt check")
        arms_used |= arms
    if earlier and prompts:  # 9L too, for amendment 3's identical-prompt check (identical_prompts)
        inp.prompt_digests |= snap.prompt_digests(data / "prompts.jsonl", "e5", arms_used | {"9L"})
    return inp, snap


SCORE_FIELDS = ("valid", "rank", "score", "cited", "pawc")
CELL_FIELDS = ("n_answers", "n_valid", "valid_rate", "score", "cited", "pawc", "dropped")


def _cell_key(c: dict) -> tuple:
    return c["set"], c["query_id"], c["version_id"], c["arm"], c["judge"]


def _examples(keys: list) -> str:
    keys = sorted(map(str, keys))
    return ", ".join(keys[:3]) + (f" and {len(keys) - 3} more" if len(keys) > 3 else "")


def check_scoring(snap: Snapshot, data: Path, scored: Path, cells: list) -> list[str]:
    """The answers behind the cells. Every data/answers/*.jsonl and score.py's score_summary.json and scores.jsonl
    (both required) go into the snapshot. Returns the problems that stop the analysis: the summary's answered
    counts per (set, judge, version) differ from the cells' answer counts; the answer files hold keys the summary
    did not count (answers that arrived after score.py ran, or sets left out of --sets); one key holds two
    different answers; or the scores and cells are not what E1's score.py gives on these answer files now (each
    scores.jsonl row re-scored from its answer with score.score_answer at its slot, and the cells rebuilt from
    the scores with score.make_cells), which catches an answer file replaced in place after scoring."""
    summary = snap.json(scored / "score_summary.json", required=True)
    scores = snap.rows(scored / "scores.jsonl")
    files = sorted((data / "answers").glob("*.jsonl"))
    if not files:
        raise SystemExit(f"analyze_e5: no answer files in {data / 'answers'}")
    answers, conflicting = {}, set()
    for path in files:
        for r in snap.rows(path):
            if r["key"] in answers and answers[r["key"]] != r["answer"]:
                conflicting.add(r["key"])
            answers.setdefault(r["key"], r["answer"])
    keys = set(answers)
    unanswered, rescored_off = [], []
    for r in scores:
        if r["key"] not in answers:
            unanswered.append(r["key"])
            continue
        now = e1_score.score_answer(answers[r["key"]], int(r["slot"]))
        if any(now[f] != r.get(f) for f in SCORE_FIELDS):
            rescored_off.append(r["key"])
    rebuilt = {_cell_key(c): c for c in e1_score.make_cells(scores)}
    given = {_cell_key(c): c for c in cells}
    cells_off = [k for k in set(rebuilt) | set(given)
                 if k not in rebuilt or k not in given or any(rebuilt[k][f] != given[k].get(f) for f in CELL_FIELDS)]
    in_cells = Counter()
    for c in cells:
        in_cells[(c["set"], c["judge"], c["arm"])] += int(c["n_answers"])
    completion = summary.get("completion", [])
    answered = {(r["set"], r["judge"], r["arm"]): int(r["answered"]) for r in completion}
    problems = [f"{'/'.join(k)}: {in_cells.get(k, 0)} answers in cells.jsonl, {answered.get(k, 0)} in score_summary.json"
                for k in sorted(set(in_cells) | {k for k, n in answered.items() if n})
                if in_cells.get(k, 0) != answered.get(k, 0)]
    counted = int(summary.get("answers", 0)) + int(summary.get("unknown_answer_keys", 0))
    if len(keys) != counted:
        problems.append(f"the answer files hold {len(keys)} distinct keys; score_summary.json counted "
                        f"{summary.get('answers', 0)} scored and {summary.get('unknown_answer_keys', 0)} unknown")
    if len(scores) != int(summary.get("answers", 0)):
        problems.append(f"scores.jsonl has {len(scores)} rows; score_summary.json counted {summary.get('answers', 0)}")
    if conflicting:
        problems.append(f"{len(conflicting)} keys have two different answers in the answer files: "
                        f"{_examples(conflicting)}")
    if unanswered:
        problems.append(f"{len(unanswered)} scored answers are no longer in the answer files: {_examples(unanswered)}")
    if rescored_off:
        problems.append(f"{len(rescored_off)} answers re-scored now differ from scores.jsonl (an answer file changed "
                        f"after score.py ran): {_examples(rescored_off)}")
    if cells_off:
        problems.append(f"{len(cells_off)} cells in cells.jsonl differ from the cells rebuilt from scores.jsonl: "
                        f"{_examples(cells_off)}")
    snap.scoring = {"answer_files": len(files), "answer_keys": len(keys), "scored_answers": summary.get("answers"),
                    "unknown_answer_keys": summary.get("unknown_answer_keys"),
                    "missing_answers": sum(int(r.get("missing", 0)) for r in completion),
                    "dropped_cells": summary.get("dropped_cells"), "rescored_answers": len(scores) - len(unanswered),
                    "rescored_differ": len(rescored_off), "conflicting_keys": len(conflicting),
                    "cells_rebuilt": len(rebuilt), "cells_differ": len(cells_off), "consistent": not problems}
    return problems


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(E5_DIR / "data"), help="E5's data folder (with answers/)")
    ap.add_argument("--scored", default=str(E5_DIR / "out"),
                    help="score.py's output folder: cells.jsonl, score_summary.json, scores.jsonl")
    ap.add_argument("--out", default=str(E5_DIR / "out"),
                    help="where analysis_e5.json goes; any run into experiments/e5/out fixes the planned snapshot, "
                         "so a dry run must point --out elsewhere")
    ap.add_argument("--no-earlier", action="store_true", help="do not read E1/E2a/E3 cells (no drift check, no fallback)")
    ap.add_argument("--secondary", action="store_true",
                    help="the planned analysis already ran on another snapshot: write analysis_e5_secondary.json")
    ap.add_argument("--draws", type=int, default=an.DRAWS, help=argparse.SUPPRESS)
    ap.add_argument("--resamples", type=int, default=an.RESAMPLES, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    data, scored, out = Path(args.data), Path(args.scored), Path(args.out)
    inp, snap = load_inputs(data, scored, earlier=None if args.no_earlier else EARLIER)
    problems = check_scoring(snap, data, scored, inp.cells)
    snapshot = snap.as_dict()
    print(f"analyze_e5: snapshot at {snapshot['started_at']}:", file=sys.stderr)
    for name, f in snapshot["files"].items():
        print(f"  {f['sha256']}  {name}", file=sys.stderr)
    if problems:
        raise SystemExit("analyze_e5: the cells do not match the answer files; rerun experiments/e1/score.py "
                         "(--sets main,e3,e3-four,replication) on this snapshot:\n  " + "\n  ".join(problems[:10]))
    target = out / "analysis_e5.json"
    if target.exists() and not args.secondary:
        prior = json.loads(target.read_text(encoding="utf-8")).get("snapshot", {}).get("files")
        if prior != snapshot["files"]:
            raise SystemExit("analyze_e5: analysis_e5.json exists from another snapshot; the planned analysis runs "
                             "once (PLAN_E5, Runs and compute). Use --secondary for later results.")
    result = analyze(inp, draws=args.draws, resamples=args.resamples, snapshot=snapshot)
    if args.secondary:
        result["secondary"] = True
        result["secondary_note"] = "Results that arrived after the planned snapshot: secondary, they change no label."
        target = out / "analysis_e5_secondary.json"
    write_json(target, result)
    r = result["main"]["readings"]
    print(f"analyze_e5: wrote {target} (gate: {r['gate_label']}; 9K: {r['retention']['9K']['reading']}; "
          f"9L: {r['retention']['9L']['reading']})")


if __name__ == "__main__":
    main()
