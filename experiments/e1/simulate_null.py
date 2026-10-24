"""Shuffled-label null simulation for the E1 analysis (PREREG_E1.md r2, freeze-commit item).

Synthetic cells are generated for every version of every query with no true effect. Each
simulation permutes the version labels within each query (the same permutation for both judges,
so judge agreement is kept), then runs analyze.primary_tests, the exact code path that produces
the pre-registered p-values and Holm adjustment. It reports, per Holm family, the share of
simulations with at least one Holm-significant contrast (the familywise false-positive rate,
which should be about 5% or a little below) and, for contrast, the share with an unadjusted p of
0.05 or less anywhere in the family.

Usage: python3 -I experiments/e1/simulate_null.py [--sims 1000] [--queries 80] [--out out/null_simulation.json]
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

import analyze as an  # noqa: E402
from e1_common import ALPHA, ARMS, JUDGE_ORDER, PLACEBOS, SEEDS, write_json  # noqa: E402

MAIN_VERSIONS = ["original"] + ARMS + PLACEBOS
REPLICATION_VERSIONS = ["original", "5", "P5", "6", "P6", "7", "P7", "9", "11", "12", "P12", "14", "ALL", "P_ALL"]


def synthetic_inputs(n_queries: int = 80, *, effects: dict | None = None, answer_sd: float = 0.3,
                     seed: int = 0, set_name: str = "main", arms: list[str] | None = None,
                     judges=JUDGE_ORDER, with_scores: bool = True) -> an.Inputs:
    """Inputs with every version valid and applicable. Each answer's score is
    clip(round4(mu_qj + effect + N(0, answer_sd))), so it takes the values 0, 0.25, ..., 1."""
    effects = effects or {}
    arms = arms or MAIN_VERSIONS
    rng = np.random.default_rng(seed)
    pages, versions, applicability, cells, scores, completion = [], [], [], [], [], []
    for i in range(n_queries):
        q = f"q{i:03d}"
        target_url = f"https://en.wikipedia.org/wiki/{q}" if i % 5 == 0 else f"https://example.org/{q}"
        for k, role in enumerate(["target", "competitor", "competitor", "competitor", "donor"]):
            pages.append({"page_id": f"{q}-p{k}", "query_id": q, "set": set_name, "query": f"question {q}?",
                          "url": target_url if role == "target" else f"https://example.org/{q}/{k}",
                          "source": "wayback" if role == "target" and i % 7 == 0 else "live",
                          "title": f"{q} page {k}", "text": "synthetic", "role": role})
        for arm in arms:
            versions.append({
                "version_id": f"{q}:{arm}", "query_id": q, "arm": arm, "title": "", "text": "", "valid": True,
                "attempts": 1, "excluded_reason": None, "edit_distance": 0 if arm == "original" else 25,
                "length_ratio": 1.0 if arm == "original" else float(math.exp(rng.normal(0, 0.03))),
                "key_terms_delta": 0 if arm == "original" else int(rng.integers(-1, 3)),
            })
        for arm in [str(a) for a in range(1, 15)]:
            applicability.append({"query_id": q, "arm": arm, "applicable": arm in arms, "reason": "synthetic"})
        for j in judges:
            mu = rng.uniform(0.25, 0.85)
            for arm in arms:
                effect = effects.get(arm, {}).get(j, 0.0)
                answers = np.clip(np.round(4 * (mu + effect + rng.normal(0, answer_sd, len(SEEDS)))) / 4, 0, 1)
                cells.append({"set": set_name, "query_id": q, "version_id": f"{q}:{arm}", "arm": arm, "judge": j,
                              "n_answers": len(SEEDS), "n_valid": len(SEEDS), "valid_rate": 1.0,
                              "score": float(answers.mean()), "cited": float((answers > 0).mean()),
                              "pawc": float(answers.mean() * 0.6), "dropped": False})
                if with_scores:
                    for seed_, value in zip(SEEDS, answers):
                        scores.append({"set": set_name, "query_id": q, "version_id": f"{q}:{arm}", "arm": arm,
                                       "judge": j, "seed": seed_, "slot": (seed_ - 1) % 4 + 1, "valid": True,
                                       "score": float(value)})
    for j in judges:
        for arm in arms:
            completion.append({"set": set_name, "judge": j, "arm": arm, "prompts": n_queries * len(SEEDS),
                               "answered": n_queries * len(SEEDS), "missing": 0})
    return an.Inputs(pages=pages, versions=versions, applicability=applicability, cells=cells, scores=scores,
                     completion=completion)


def shuffle_labels(cells: list[dict], rng: np.random.Generator) -> list[dict]:
    """Permutes version labels within each query; both judges' cells move together."""
    by_query: dict[str, list[str]] = {}
    for c in cells:
        arms = by_query.setdefault(c["query_id"], [])
        if c["arm"] not in arms:
            arms.append(c["arm"])
    mapping = {}
    for q, arms in by_query.items():
        perm = rng.permutation(len(arms))
        mapping[q] = {arm: arms[k] for arm, k in zip(arms, perm)}
    return [c | {"arm": mapping[c["query_id"]][c["arm"]]} for c in cells]


def simulate(sims: int = 1000, n_queries: int = 80, draws: int = an.DRAWS, seed: int = 1) -> dict:
    inp = synthetic_inputs(n_queries, seed=seed, with_scores=False)
    spec = an.family_spec("main")
    rng = np.random.default_rng(seed + 1)
    holm_any = {f: 0 for f in spec["families"]}
    raw_any = {f: 0 for f in spec["families"]}
    sizes = {}
    for _ in range(sims):
        ix = an.Index(replace(inp, cells=shuffle_labels(inp.cells, rng)), "main")
        tests = an.primary_tests(ix, spec, list(JUDGE_ORDER), draws)
        for family in spec["families"]:
            members = [t for t in tests if t["family"] == family and t["status"] == "ok"]
            sizes[family] = len(members)
            holm_any[family] += any(t["p_holm"] <= ALPHA for t in members)
            raw_any[family] += any(t["p"] <= ALPHA for t in members)
    families = {}
    for family in spec["families"]:
        rate = holm_any[family] / sims
        families[family] = {"m": sizes[family], "fwer": rate, "mc_se": math.sqrt(rate * (1 - rate) / sims),
                            "unadjusted_any": raw_any[family] / sims}
    return {"sims": sims, "n_queries": n_queries, "draws": draws, "seed": seed, "alpha": ALPHA,
            "families": families,
            "method": "synthetic null cells (2 judges, 8 answers per cell), version labels permuted within query"}


def main(argv: list[str] | None = None) -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sims", type=int, default=1000)
    ap.add_argument("--queries", type=int, default=80)
    ap.add_argument("--draws", type=int, default=an.DRAWS)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(here / "out" / "null_simulation.json"))
    args = ap.parse_args(argv)
    result = simulate(args.sims, args.queries, args.draws, args.seed)
    write_json(Path(args.out), result)


if __name__ == "__main__":
    main()
