"""E1 analysis (PREREG_E1.md r2, "Analysis (fixed now)"), numpy only.

- Unit: the query. Cells are already means over seeds (score.py); d_q is the mean over judges of
  [cell(A) - cell(Ref)], with Ref from the arms table. A - original is reported for every arm.
- Test: two-sided paired sign-flip permutation test on the mean of {d_q}; exact over all 2^n sign
  patterns when n <= 12, otherwise 100,000 draws from numpy.random.default_rng(1) with
  p = (hits + 1) / (draws + 1). A twin of metrics.ts signFlipP with more draws.
- Intervals: 95% and 90% percentile bootstrap over queries, 10,000 resamples, seed 1 (unadjusted).
- Families: Holm at alpha 0.05 within A (arms 2-10), within B (11, 12, 14), and within ALL
  (ALL - P_ALL, ALL - original). A family holds only its arms that completed and have at least 30
  analyzable queries; the others are "insufficient n" or "not completed" and get no verdict. Arms 1
  and 13 are descriptive. The replication set is one family over its text arms.
- Verdicts in order: model-dependent, helps, hurts, no effect larger than δ (90% CI inside +-0.03),
  inconclusive. A "helps" whose confound-adjusted intercept CI includes 0 is reported as
  "helps, possibly through length or query-term overlap".
- Judges: if the second judge has not finished every tested arm, verdicts use the primary judge
  alone ("single-model") and the second judge's finished results are reported as secondary.
- Power: per-arm minimum detectable d from the realized SD of d_q, at the family's strictest Holm step.

Inputs: data/pages.jsonl, data/versions.jsonl, data/applicability.jsonl, data/prompt_build.json,
out/cells.jsonl, out/scores.jsonl, out/score_summary.json and (optional) out/retrieval.jsonl.
Output: out/analysis.json, {set: result}.

Usage: python3 -I experiments/e1/analyze.py [--data DIR] [--out DIR] [--set main,replication]
"""

from __future__ import annotations

import argparse
import functools
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import NormalDist
from urllib.parse import urlparse

import numpy as np

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

from e1_common import (  # noqa: E402
    ALL_CONTRASTS,
    ALPHA,
    ARMS,
    DELTA,
    DESCRIPTIVE,
    FAMILY_A,
    FAMILY_B,
    JUDGE_ORDER,
    MIN_N,
    MIN_VALID,
    PLACEBOS,
    REF,
    REPLICATION_ARMS,
    parent_arm,
    read_jsonl,
    write_json,
)

DRAWS = 100_000
RESAMPLES = 10_000
EXACT_MAX_N = 12
HELPS_CONFOUNDED = "helps, possibly through length or query-term overlap"
NO_EFFECT = "no effect larger than δ"

# ---------- statistics ----------


@functools.lru_cache(maxsize=2)
def _sign_matrix(n: int, draws: int, seed: int) -> np.ndarray:
    """+1/-1 per (pattern, query). Exact: every pattern, bit i of the pattern flips query i.
    Otherwise draws rows of rng.random() < 0.5 (flip), drawn row by row as metrics.ts does."""
    if n <= EXACT_MAX_N:
        bits = (np.arange(2**n)[:, None] >> np.arange(n)) & 1
        return np.where(bits == 1, -1.0, 1.0)
    flips = np.random.default_rng(seed).random((draws, n)) < 0.5
    return np.where(flips, -1.0, 1.0)


def sign_flip_ps(D, draws: int = DRAWS, seed: int = 1) -> list[float]:
    """Two-sided sign-flip p for each column of D (n queries x k contrasts), statistic |sum(d)|."""
    D = np.asarray(D, dtype=float)
    if D.ndim == 1:
        D = D[:, None]
    n, k = D.shape
    if n == 0:
        return [1.0] * k
    observed = np.abs(D.sum(axis=0))
    # Float slack so ties with the observed statistic count as "at least as extreme" (as metrics.ts).
    tol = 1e-9 * np.maximum(1.0, np.abs(D).sum(axis=0))
    signs = _sign_matrix(n, draws, seed)
    hits = (np.abs(signs @ D) >= observed - tol).sum(axis=0)
    if n <= EXACT_MAX_N:
        return [float(h) / 2**n for h in hits]
    return [(float(h) + 1) / (draws + 1) for h in hits]


def sign_flip_p(d, draws: int = DRAWS, seed: int = 1) -> float:
    return sign_flip_ps(np.asarray(d, dtype=float)[:, None], draws, seed)[0]


def bootstrap_ci(d, resamples: int = RESAMPLES, seed: int = 1) -> dict | None:
    """Percentile bootstrap of the mean over queries: 95% and 90% intervals from one set of resamples."""
    d = np.asarray(d, dtype=float)
    n = len(d)
    if n == 0:
        return None
    means = d[np.random.default_rng(seed).integers(0, n, size=(resamples, n))].mean(axis=1)
    q = np.quantile(means, [0.025, 0.975, 0.05, 0.95])
    return {"ci95": [float(q[0]), float(q[1])], "ci90": [float(q[2]), float(q[3])]}


def holm(pvals: dict) -> dict:
    """Holm-Bonferroni adjusted p-values (step-down, monotone, capped at 1)."""
    items = sorted(pvals.items(), key=lambda kv: (kv[1], str(kv[0])))
    m, running, out = len(items), 0.0, {}
    for i, (key, p) in enumerate(items):
        running = max(running, min(1.0, (m - i) * p))
        out[key] = running
    return out


def verdict(p_holm, mean_d, judge_means: dict, judge_p: dict, ci90, *, alpha=ALPHA, delta=DELTA) -> str:
    """The pre-registered verdict rules, applied in order."""
    if len(judge_means) >= 2:
        signs = {np.sign(m) for m in judge_means.values()}
        if 1 in signs and -1 in signs and any(p < 0.01 for p in judge_p.values()):
            return "model-dependent"
    significant = p_holm is not None and p_holm <= alpha
    if significant and mean_d > 0 and all(m > 0 for m in judge_means.values()):
        return "helps"
    if significant and mean_d < 0 and all(m < 0 for m in judge_means.values()):
        return "hurts"
    if ci90 is not None and -delta <= ci90[0] and ci90[1] <= delta:
        return NO_EFFECT
    return "inconclusive"


def _z(p: float) -> float:
    return NormalDist().inv_cdf(p)


def planning_mde(n, sd_answer=0.17, hetero=0.7, efficiency=0.95, answers_per_query=16,
                 alpha=ALPHA / len(FAMILY_A), power=0.8) -> float:
    """The pre-registration's power assumption: d_q has variance sd_answer^2 / (8 seeds x 2 judges)
    plus (hetero x d)^2; solve d = (z_alpha + z_power) x SD(d_q) / sqrt(efficiency x n) for d."""
    k2 = (_z(1 - alpha / 2) + _z(power)) ** 2 / (efficiency * n)
    return math.sqrt(k2 * sd_answer**2 / answers_per_query / (1 - k2 * hetero**2))


def realized_mde(sd: float, n: int, alpha: float, efficiency=0.95, power=0.8) -> float | None:
    """Minimum detectable mean d from the realized SD of d_q."""
    if n < 2 or sd is None:
        return None
    return (_z(1 - alpha / 2) + _z(power)) * sd / math.sqrt(efficiency * n)


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz)."""
    tiny, qab, qap, qam = 1e-300, a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        for aa in (m * (b - m) * x / ((qam + m2) * (a + m2)), -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))):
            d = 1 + aa * d
            d = 1 / (d if abs(d) > tiny else tiny)
            c = 1 + aa / c
            c = c if abs(c) > tiny else tiny
            h *= d * c
        if abs(d * c - 1) < 1e-15:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def t_cdf(t: float, df: float) -> float:
    tail = 0.5 * _betainc(df / 2, 0.5, df / (df + t * t))
    return 1 - tail if t > 0 else tail


def t_ppf(p: float, df: float) -> float:
    """Student t quantile by bisection on t_cdf."""
    lo, hi = -1e4, 1e4
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def ols_intercept(y, regressors: dict) -> dict:
    """OLS of y on an intercept and `regressors`; the intercept with its 95% t interval.

    A regressor with no variance cannot be separated from the intercept, so it is dropped and its
    constant value recorded; when that value is not 0 the intercept is not the effect at zero
    change, and `identifiable` is False."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    used, dropped = [], {}
    for name, x in regressors.items():
        x = np.asarray(x, dtype=float)
        if n == 0 or np.ptp(x) == 0:
            dropped[name] = float(x[0]) if n else 0.0
        else:
            used.append((name, x))
    identifiable = all(abs(v) < 1e-12 for v in dropped.values())
    p = 1 + len(used)
    base = {"n": n, "regressors": [u[0] for u in used], "dropped": dropped, "identifiable": identifiable}
    if n <= p:
        return base | {"intercept": None, "se": None, "ci95": None, "slopes": None, "identifiable": False}
    X = np.column_stack([np.ones(n)] + [u[1] for u in used])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    df = n - p
    sigma2 = float(resid @ resid) / df
    cov = sigma2 * np.linalg.inv(X.T @ X)
    se = math.sqrt(max(cov[0, 0], 0.0))
    half = t_ppf(0.975, df) * se
    return base | {"intercept": float(beta[0]), "se": se, "ci95": [float(beta[0]) - half, float(beta[0]) + half],
                   "slopes": {name: float(b) for (name, _), b in zip(used, beta[1:])}}


# ---------- inputs ----------


@dataclass
class Inputs:
    pages: list
    versions: list
    applicability: list
    cells: list
    scores: list = field(default_factory=list)
    retrieval: list = field(default_factory=list)
    # score_summary.json "completion" rows; None means every cell present is complete.
    completion: list | None = None
    # Query ids the prompt builder refused (over 31,000 tokens).
    refused: list = field(default_factory=list)


class Index:
    """Lookups over one set's inputs."""

    def __init__(self, inp: Inputs, set_name: str | None = None):
        pages = [p for p in inp.pages if set_name is None or p["set"] == set_name]
        refused = set(inp.refused)
        self.queries = sorted({p["query_id"] for p in pages} - refused)
        qs = set(self.queries)
        self.target = {p["query_id"]: p for p in pages if p["role"] == "target"}
        self.wayback = {p["query_id"] for p in pages if p["role"] != "donor" and p.get("source") == "wayback"}
        self.version = {(v["query_id"], v["arm"]): v for v in inp.versions if v["query_id"] in qs}
        self.appl = {(a["query_id"], a["arm"]): bool(a["applicable"]) for a in inp.applicability
                     if a["query_id"] in qs}
        self.cell = {(c["query_id"], c["arm"], c["judge"]): c for c in inp.cells if c["query_id"] in qs}
        self.retrieval = {(r["query_id"], r["arm"]): r for r in inp.retrieval if r["query_id"] in qs}
        self.slot_scores = defaultdict(list)
        for s in inp.scores:
            if s["query_id"] in qs and s["valid"]:
                self.slot_scores[(s["query_id"], s["arm"], s["judge"], s["slot"])].append(s["score"])
        self.completion = {}
        if inp.completion is None:
            for (_, arm, judge) in self.cell:
                self.completion[(judge, arm)] = (1, 0)
        else:
            for row in inp.completion:
                if set_name is None or row["set"] == set_name:
                    prompts, missing = self.completion.get((row["judge"], row["arm"]), (0, 0))
                    self.completion[(row["judge"], row["arm"])] = (prompts + row["prompts"], missing + row["missing"])
        self.judges = sorted({j for (j, _) in self.completion})

    def applicable(self, q: str, arm: str) -> bool:
        return arm == "original" or self.appl.get((q, parent_arm(arm)), True)

    def usable_version(self, q: str, arm: str) -> bool:
        v = self.version.get((q, arm))
        return v is not None and bool(v["valid"]) and self.applicable(q, arm)

    def prompts(self, judge: str, arm: str) -> int:
        return self.completion.get((judge, arm), (0, 0))[0]

    def complete(self, judge: str, arm: str) -> bool:
        prompts, missing = self.completion.get((judge, arm), (0, 0))
        return prompts > 0 and missing == 0


def _index(source, set_name=None) -> Index:
    return source if isinstance(source, Index) else Index(source, set_name)


def query_differences(source, arm: str, ref: str, judges: list[str], metric: str) -> tuple[dict, dict]:
    """d_q = mean over judges of cell(arm) - cell(ref), for each analyzable query.

    A query is analyzable when both versions are applicable and valid and every judge has both
    cells. A cell below 4 valid answers drops the query (counted), except for the valid-answer rate,
    which is defined on every cell."""
    ix = _index(source)
    d, per_judge = {}, {j: {} for j in judges}
    dropped = 0
    for q in ix.queries:
        if not (ix.usable_version(q, arm) and ix.usable_version(q, ref)):
            continue
        pairs = [(ix.cell.get((q, arm, j)), ix.cell.get((q, ref, j))) for j in judges]
        if any(a is None or r is None for a, r in pairs):
            continue
        if metric != "valid_rate" and any(a["dropped"] or r["dropped"] for a, r in pairs):
            dropped += 1
            continue
        diffs = [float(a[metric]) - float(r[metric]) for a, r in pairs]
        d[q] = float(np.mean(diffs))
        for j, x in zip(judges, diffs):
            per_judge[j][q] = x
    return d, {"dropped_cells": dropped, "per_judge": per_judge}


def retrieval_differences(ix: Index, arm: str, ref: str, metric: str) -> dict:
    d = {}
    for q in ix.queries:
        a, r = ix.retrieval.get((q, arm)), ix.retrieval.get((q, ref))
        if a is not None and r is not None and ix.usable_version(q, arm) and ix.usable_version(q, ref):
            d[q] = float(a[metric]) - float(r[metric])
    return d


def _summary(d: dict, draws: int, resamples: int, p: float | None = None) -> dict:
    values = np.array([d[q] for q in sorted(d)], dtype=float)
    n = len(values)
    out = {"n": n, "mean_d": float(values.mean()) if n else None,
           "sd": float(values.std(ddof=1)) if n > 1 else None}
    out["p"] = p if p is not None else (sign_flip_p(values, draws) if n else None)
    ci = bootstrap_ci(values, resamples)
    out["ci95"] = ci["ci95"] if ci else None
    out["ci90"] = ci["ci90"] if ci else None
    return out


# ---------- the analysis ----------


def family_spec(set_name: str) -> dict:
    if set_name == "replication":
        return {"families": {"R": [(a, REF[a]) for a in REPLICATION_ARMS]}, "descriptive": []}
    return {
        "families": {"A": [(a, REF[a]) for a in FAMILY_A], "B": [(a, REF[a]) for a in FAMILY_B],
                     "ALL": list(ALL_CONTRASTS)},
        "descriptive": [(a, REF[a]) for a in DESCRIPTIVE],
    }


def decide_mode(ix: Index, judges: list[str]) -> tuple[str, list[str], list[str]]:
    """Two-judge verdicts only when the second judge finished every arm the primary judge was run on."""
    primary, others = judges[0], judges[1:]
    tested = {arm for (j, arm) in ix.completion if j == primary and ix.prompts(primary, arm) > 0}
    finished = [j for j in others if tested and all(ix.complete(j, arm) for arm in tested)]
    if len(finished) == len(others) and others:
        return "two-judge", list(judges), []
    present = [j for j in others if any(jj == j for (jj, _) in ix.completion)]
    return "single-model", [primary], present


def _status(ix: Index, arm: str, ref: str, judges: list[str], n: int) -> str:
    if ix.prompts(judges[0], arm) == 0 or ix.prompts(judges[0], ref) == 0:
        return "not run"
    if not all(ix.complete(j, a) for j in judges for a in (arm, ref)):
        return "not completed"
    return "ok" if n >= MIN_N else "insufficient n"


def primary_tests(ix: Index, spec: dict, judges: list[str], draws: int = DRAWS) -> list[dict]:
    """Every primary and descriptive contrast with its d_q, status, sign-flip p and Holm p.
    The simulation of the null runs exactly this."""
    out = []
    for family, pairs in list(spec["families"].items()) + [(None, spec["descriptive"])]:
        for arm, ref in pairs:
            d, info = query_differences(ix, arm, ref, judges, "score")
            out.append({"arm": arm, "ref": ref, "family": family, "d": d, "info": info,
                        "status": _status(ix, arm, ref, judges, len(d))})
    by_n = defaultdict(list)
    for c in out:
        by_n[len(c["d"])].append(c)
    for n, group in by_n.items():
        D = np.array([[c["d"][q] for q in sorted(c["d"])] for c in group]).T.reshape(n, len(group))
        for c, p in zip(group, sign_flip_ps(D, draws)):
            c["p"] = p if n else None
    for family in spec["families"]:
        members = [c for c in out if c["family"] == family and c["status"] == "ok"]
        adjusted = holm({(c["arm"], c["ref"]): c["p"] for c in members})
        for c in out:
            if c["family"] == family:
                c["p_holm"] = adjusted.get((c["arm"], c["ref"]))
    for c in out:
        c.setdefault("p_holm", None)
    return out


def _confound(ix: Index, arm: str, ref: str, d: dict) -> dict | None:
    def features(q, a):
        if a == "original" and (q, a) not in ix.version:
            return 1.0, 0.0
        v = ix.version[(q, a)]
        if v.get("length_ratio") is None or v.get("key_terms_delta") is None:
            return None
        return float(v["length_ratio"]), float(v["key_terms_delta"])

    ys, dlog, dkey = [], [], []
    for q in sorted(d):
        fa, fr = features(q, arm), features(q, ref)
        if fa is None or fr is None or fa[0] <= 0 or fr[0] <= 0:
            continue
        ys.append(d[q])
        dlog.append(math.log(fa[0]) - math.log(fr[0]))
        dkey.append(fa[1] - fr[1])
    if not ys:
        return None
    return ols_intercept(ys, {"dlog_length": dlog, "dkey_terms": dkey})


def _slots(ix: Index, arm: str, ref: str, judges: list[str], queries) -> dict:
    out = {}
    for slot in range(1, 5):
        ds = []
        for q in queries:
            diffs = []
            for j in judges:
                a, r = ix.slot_scores.get((q, arm, j, slot)), ix.slot_scores.get((q, ref, j, slot))
                if not a or not r:
                    break
                diffs.append(np.mean(a) - np.mean(r))
            if len(diffs) == len(judges):
                ds.append(float(np.mean(diffs)))
        out[str(slot)] = {"n": len(ds), "mean_d": float(np.mean(ds)) if ds else None}
    return out


def _subgroups(ix: Index, d: dict, resamples: int) -> dict:
    def host(q):
        url = ix.target.get(q, {}).get("url")
        return urlparse(url).hostname if url else None

    groups = {"wikipedia_target": [q for q in d if host(q) == "en.wikipedia.org"],
              "wayback_target": [q for q in d if ix.target.get(q, {}).get("source") == "wayback"],
              "wayback_any": [q for q in d if q in ix.wayback]}
    out = {}
    for name, qs in groups.items():
        values = [d[q] for q in sorted(qs)]
        ci = bootstrap_ci(values, resamples)
        out[name] = {"n": len(values), "mean_d": float(np.mean(values)) if values else None,
                     "ci95": ci["ci95"] if ci else None}
    return out


def _exclusions(ix: Index, arms: list[str]) -> dict:
    out = {}
    for arm in arms:
        rows = [ix.version[(q, arm)] for q in ix.queries if (q, arm) in ix.version]
        if arm == "ALL" or arm in PLACEBOS:
            applicable = sum(1 for q in ix.queries if (q, arm) in ix.version and ix.applicable(q, arm))
        else:
            applicable = sum(1 for q in ix.queries if ix.appl.get((q, arm)) is True)
        if not rows and not applicable:
            continue
        valid = [v for v in rows if v["valid"] and ix.applicable(v["query_id"], arm)]
        excluded = sum(1 for v in rows if not v["valid"] and ix.applicable(v["query_id"], arm))

        def mean(name):
            xs = [float(v[name]) for v in valid if v.get(name) is not None]
            return float(np.mean(xs)) if xs else None

        out[arm] = {
            "applicable": applicable, "valid": len(valid), "validity_exclusions": excluded,
            "exclusion_rate": excluded / applicable if applicable else None,
            "flagged": bool(applicable) and excluded / applicable > 0.20,
            "dropped_cells": sum(1 for (q, a, _), c in ix.cell.items() if a == arm and c["dropped"]),
            "mean_edit_distance": mean("edit_distance"), "mean_length_ratio": mean("length_ratio"),
            "mean_key_terms_delta": mean("key_terms_delta"),
        }
    return out


def analyze_set(inp: Inputs, set_name: str, *, judges=JUDGE_ORDER, draws: int = DRAWS,
                resamples: int = RESAMPLES) -> dict:
    ix = Index(inp, set_name)
    spec = family_spec(set_name)
    mode, vj, secondary = decide_mode(ix, list(judges))
    tests = primary_tests(ix, spec, vj, draws)

    families = {}
    for family in spec["families"]:
        ok = [c for c in tests if c["family"] == family and c["status"] == "ok"]
        families[family] = {"m": len(ok), "arms": sorted({c["arm"] for c in ok}, key=ARMS.index),
                            "contrasts": [[c["arm"], c["ref"]] for c in ok]}

    contrasts = []
    for t in tests:
        arm, ref, family = t["arm"], t["ref"], t["family"]
        stats = _summary(t["d"], draws, resamples, p=t["p"])
        per_judge = {}
        for j in vj:
            jd = t["info"]["per_judge"][j]
            per_judge[j] = {"mean_d": float(np.mean(list(jd.values()))) if jd else None,
                            "p": sign_flip_p([jd[q] for q in sorted(jd)], draws) if jd else None}
        m = families[family]["m"] if family else 0
        alpha = ALPHA / m if m else ALPHA
        c = {"arm": arm, "ref": ref, "family": family, "status": t["status"],
             "dropped_cells": t["info"]["dropped_cells"], **stats, "p_holm": t["p_holm"],
             "mde": realized_mde(stats["sd"], stats["n"], alpha), "mde_alpha": alpha, "per_judge": per_judge}
        c["confound"] = _confound(ix, arm, ref, t["d"])
        if family is None:
            c["label"] = "descriptive" if stats["n"] and t["status"] in ("ok", "insufficient n") else t["status"]
        elif t["status"] != "ok":
            c["label"] = t["status"]
        else:
            c["label"] = verdict(t["p_holm"], stats["mean_d"], {j: v["mean_d"] for j, v in per_judge.items()},
                                 {j: v["p"] for j, v in per_judge.items()}, stats["ci90"])
            conf = c["confound"]
            if c["label"] == "helps" and conf is not None and (
                    not conf["identifiable"] or conf["ci95"] is None or conf["ci95"][0] <= 0 <= conf["ci95"][1]):
                c["label"] = HELPS_CONFOUNDED
        c["secondary"] = {
            metric: _summary(query_differences(ix, arm, ref, vj, metric)[0], draws, resamples)
            for metric in ("cited", "pawc", "valid_rate")
        }
        if ix.retrieval:
            c["secondary"]["retrieval"] = {
                metric: _summary(retrieval_differences(ix, arm, ref, metric), draws, resamples)
                for metric in ("rank_pool", "rank_own", "top8")
            }
        c["slots"] = _slots(ix, arm, ref, vj, sorted(t["d"]))
        c["subgroups"] = _subgroups(ix, t["d"], resamples)
        if set_name == "replication":
            # PREREG_E1.md: a check stays scored unless the replication of that arm has run in full and
            # shows d < 0 with unadjusted p < 0.05; any status other than "ok" keeps it scored.
            c["replication_supports_removal"] = bool(
                t["status"] == "ok" and stats["n"] and t["p"] is not None
                and stats["mean_d"] < 0 and t["p"] < 0.05)
        contrasts.append(c)

    tested_arms = [a for a in ARMS if any(t["arm"] == a for t in tests)]
    vs_original = []
    for arm in tested_arms:
        d, _ = query_differences(ix, arm, "original", vj, "score")
        vs_original.append({"arm": arm, "ref": "original", **_summary(d, draws, resamples)})

    secondary_judges = {}
    for j in secondary:
        rows = []
        for t in tests:
            if not (ix.complete(j, t["arm"]) and ix.complete(j, t["ref"])):
                continue
            d, _ = query_differences(ix, t["arm"], t["ref"], [j], "score")
            rows.append({"arm": t["arm"], "ref": t["ref"], **_summary(d, draws, resamples)})
        secondary_judges[j] = rows

    tags = ["Gemma-edited"] + (["single-model"] if mode == "single-model" else [])
    return {
        "set": set_name, "mode": mode, "tags": tags, "judges": vj, "secondary_judges": secondary_judges,
        "n_queries": len(ix.queries), "refused_queries": sorted(set(inp.refused)),
        "settings": {"alpha": ALPHA, "delta": DELTA, "min_n": MIN_N, "min_valid_answers": MIN_VALID,
                     "draws": draws, "resamples": resamples, "bootstrap_seed": 1, "sign_flip_seed": 1},
        "families": families, "contrasts": contrasts, "vs_original": vs_original,
        "exclusions": _exclusions(ix, ARMS + PLACEBOS),
        "power": {"planning_mde_n60": planning_mde(60), "planning_mde_n80": planning_mde(80),
                  "note": "Effects below about 0.02 score units (0.08 rank positions) cannot be ruled out."},
    }


def load_inputs(data: Path, out: Path) -> Inputs:
    summary_path = out / "score_summary.json"
    build_path = data / "prompt_build.json"
    retrieval_path = out / "retrieval.jsonl"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
    build = json.loads(build_path.read_text(encoding="utf-8")) if build_path.exists() else {"refused": []}
    return Inputs(
        pages=read_jsonl(data / "pages.jsonl"), versions=read_jsonl(data / "versions.jsonl"),
        applicability=read_jsonl(data / "applicability.jsonl"), cells=read_jsonl(out / "cells.jsonl"),
        scores=read_jsonl(out / "scores.jsonl"),
        retrieval=read_jsonl(retrieval_path) if retrieval_path.exists() else [],
        completion=summary["completion"] if summary else None,
        refused=[r["query_id"] for r in build["refused"]],
    )


def main(argv: list[str] | None = None) -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(here / "data"))
    ap.add_argument("--out", default=str(here / "out"))
    ap.add_argument("--set", default="main,replication", help="comma-separated sets; sets without pages are skipped")
    ap.add_argument("--draws", type=int, default=DRAWS, help=argparse.SUPPRESS)
    ap.add_argument("--resamples", type=int, default=RESAMPLES, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    data, out = Path(args.data), Path(args.out)
    inp = load_inputs(data, out)
    present = {p["set"] for p in inp.pages}
    result = {s: analyze_set(inp, s, draws=args.draws, resamples=args.resamples)
              for s in args.set.split(",") if s in present}
    write_json(out / "analysis.json", result)


if __name__ == "__main__":
    main()
