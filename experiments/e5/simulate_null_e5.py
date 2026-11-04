"""Shuffled-label null simulation for the E5 analysis (experiments/PLAN_E5.md r2, freeze-commit item).

Synthetic E5 inputs follow the E5 interface contract (edit_texts.jsonl, versions.jsonl,
applicability.jsonl and cells in E1's cells.jsonl schema) with the pre-run counts' shape: 80 E1, 72
E3 five-page and 108 E3 four-page main queries and 60 replication queries, every version's
applicability and validity drawn at about the pre-run rates, two judges, 8 answers per cell, and no
true effect. Each simulation permutes the version labels within each query (E1's
simulate_null.shuffle_labels: both judges' cells move together), then runs analyze_e5's planned code
path: resolve -> E1's sign-flip test (100,000 draws, grouped by n across simulations) -> the gate,
the Holm family, the retention reading, 12K vs P12K and step 5 (analyze_e5.apply_main), and the
replication family (apply_replication). Labels use E1's verdict rules without the per-judge p check
for "model-dependent" and without the confound note, so they can only overstate false positives.

Reported: the familywise false-positive rate of the gate-plus-Holm structure (any Holm-significant
planned test: the gate, or a family member when the gate passed), the same with E1's labels, the
family's rate if it were never gated, the replication family's rate, and the rates of the separate
tests and readings. A gate that passes is a significant gate, so the structure's rate equals the
gate's own rate; the family is tested by its rate if never gated and its rate after the gate.
Fixed seed, so the output is reproducible.

Usage: python3 -I experiments/e5/simulate_null_e5.py [--sims 1000] [--out experiments/e5/out/null_simulation_e5.json]
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E5_DIR = Path(__file__).resolve().parent
E1_DIR = E5_DIR.parent / "e1"
for p in (E5_DIR, E1_DIR):
    sys.path.insert(0, str(p))

import analyze as an  # noqa: E402
import analyze_e5 as a5  # noqa: E402
import simulate_null as sn  # noqa: E402
from e1_common import ALPHA, JUDGE_ORDER, SEEDS, write_json  # noqa: E402

# Pre-run shape (PLAN_E5 "Size and power"; feasibility recount): P(level) per stratum for |K(q)| = 2..7,
# arm 9 applicability, and validity given applicability.
KEY_TERMS = [2, 3, 4, 5, 6, 7]
LEVEL_P = {"e1": [0.12, 0.25, 0.33, 0.15, 0.10, 0.05], "e3": [0.10, 0.22, 0.30, 0.20, 0.12, 0.06],
           "e3-four": [0.08, 0.20, 0.28, 0.22, 0.14, 0.08], "replication": [0.15, 0.30, 0.30, 0.15, 0.07, 0.03]}
RATES = {
    "appl_9": {"e1": 0.69, "e3": 0.65, "e3-four": 0.65, "replication": 0.88},
    "valid_9": 0.98, "valid_9P": 0.97, "appl_guess": 0.99, "valid_9K": 0.97, "q_L": 0.95, "valid_9L": 0.97,
    "valid_9A": 0.95, "valid_9G": 0.86, "appl_12K": 0.51, "valid_12K": 0.79, "valid_P12K": 0.66,
    "appl_12": 0.79, "valid_12": 0.79, "valid_P12": 0.66, "kept_template": 0.89, "same_sentence": 0.57,
    "tool_gate": 0.88,
}
ARM9_FAMILY = ["9", "9P", "9K", "9L", "9A", "9G"]


def _effect(effects: dict, arm: str, info: dict, judge: str) -> float:
    e = effects.get(arm, 0.0)
    if callable(e):
        return float(e(info, judge))
    if isinstance(e, dict):
        return float(e.get(judge, 0.0))
    return float(e)


def _cell(set_name: str, q: str, arm: str, judge: str, answers: np.ndarray) -> dict:
    return {"set": set_name, "query_id": q, "version_id": f"{q}:{arm}", "arm": arm, "judge": judge,
            "n_answers": len(answers), "n_valid": len(answers), "valid_rate": 1.0, "score": float(answers.mean()),
            "cited": float((answers > 0).mean()), "pawc": float(answers.mean() * 0.6), "dropped": False}


MODEL_MADE = ("9L", "12K", "P12K", "12", "P12")  # built on the cluster after the freeze
TEXT_FIELDS = ("text", "title", "edit_text")


def structure_from_data(data: Path) -> dict:
    """E5's real edit-text table, versions and applicability (page text dropped), for a simulation on the
    real structure: the deterministic versions' validity is real; the model-made ones are drawn."""
    from e1_common import read_jsonl
    versions = [{k: v for k, v in r.items() if k not in TEXT_FIELDS} for r in read_jsonl(data / "versions.jsonl")]
    texts = [{k: r.get(k) for k in ("query_id", "set", "stratum", "n_key_terms", "template", "q_L_status")}
             for r in read_jsonl(data / "edit_texts.jsonl")]
    return {"edit_texts": texts, "versions": versions, "applicability": read_jsonl(data / "applicability.jsonl")}


def _layout(n_e1, n_e3, n_four, n_rep):
    return ([("main", "e1", "main", f"geo-test-{i}") for i in range(n_e1)]
            + [("main", "e3", "e3", f"geo-test-{1000 + i}") for i in range(n_e3)]
            + [("main", "e3-four", "e3-four", f"geo-test-{2000 + i}") for i in range(n_four)]
            + [("replication", "replication", "replication", f"cseo-web-{i}") for i in range(n_rep)])


def synthetic_e5(n_e1: int = 80, n_e3: int = 72, n_four: int = 108, n_rep: int = 60, *, effects: dict | None = None,
                 seed: int = 0, answer_sd: float = 0.3, judges=JUDGE_ORDER, rates: dict | None = None,
                 with_earlier: bool = False, drift: float = 0.0, e1_arm12_earlier: bool = False,
                 all_valid: bool = False, structure: dict | None = None) -> a5.E5Inputs:
    """E5 inputs with no page text. Each answer's score is clip(round4(mu_qj + effect + N(0, answer_sd))), as in
    E1's simulate_null; `effects` maps an arm to a number, {judge: number} or f(query info, judge). With
    `with_earlier`, earlier-run cells (E1, E2a, E3) are added for original, 9 and 9P, shifted by `drift`; with
    `e1_arm12_earlier`, E1-stratum 12 and P12 exist only as earlier-run versions and cells (as in E5's design).
    With `structure` (structure_from_data), the queries, applicability and deterministic versions are E5's
    real ones and only the model-made versions' validity is drawn."""
    effects = effects or {}
    rates = RATES | (rates or {})
    rng = np.random.default_rng(seed)
    edit_texts, versions, applicability, cells = [], [], [], []
    earlier_cells, earlier_versions, e1_appl = [], [], []

    def chance(p):
        return all_valid or rng.random() < p

    real_v, real_a, layout = {}, {}, []
    if structure is not None:
        page_set = {}
        for v in structure["versions"]:
            real_v[(v["query_id"], v["arm"])] = v
            page_set.setdefault(v["query_id"], v.get("set"))
        for a in structure["applicability"]:
            real_a[(a["query_id"], a["arm"])] = bool(a["applicable"])
        for r in structure["edit_texts"]:
            layout.append((r["set"], r["stratum"], page_set.get(r["query_id"], r["stratum"]), r["query_id"]))
        texts = {r["query_id"]: r for r in structure["edit_texts"]}
    else:
        layout = _layout(n_e1, n_e3, n_four, n_rep)

    for set_name, stratum, page_set_name, q in layout:
        if structure is not None:
            t = texts[q]
            n_terms, template = t.get("n_key_terms"), t.get("template")
        else:
            n_terms = int(rng.choice(KEY_TERMS, p=LEVEL_P[stratum]))
            template = "kept" if rng.random() < rates["kept_template"] else "what-is"
        q_l_ok = chance(rates["q_L"])
        info = {"set": set_name, "stratum": stratum, "n_key_terms": n_terms, "template": template}
        edit_texts.append({"query_id": q, "set": set_name, "stratum": stratum, "query": f"question {q}?",
                           "key_terms": [f"t{k}" for k in range(n_terms or 0)], "n_key_terms": n_terms, "k": "t0 t1",
                           "q_prime": "t0 t1" if template == "kept" else "What is t0 t1?", "template": template,
                           "text_9A": " ".join(f"t{k}" for k in range(n_terms or 0)), "q_G": f"What is {q}?",
                           "q_L": "How does t0 t1 work?" if q_l_ok else None,
                           "q_L_status": "ok" if q_l_ok else "no question"})
        appl, valid, rows = {}, {"original": True}, {}
        if structure is not None:
            for (qq, arm), a in real_a.items():
                if qq == q and arm in a5.VERSIONS:
                    appl[arm] = a
            for arm in a5.VERSIONS:
                v = real_v.get((q, arm))
                if v is not None:
                    rows[arm] = v
                    valid[arm] = bool(v["valid"]) and (arm == "original" or all(
                        appl.get(x, True) for x in a5.APPLICABILITY_PARENTS.get(arm, (arm,))))
            appl.setdefault("9L", bool(appl.get("9K") and appl.get("9", True) and q_l_ok))
            if "9L" not in valid:
                valid["9L"] = appl["9L"] and chance(rates["valid_9L"])
            if set_name == "main":
                if "12K" not in valid:
                    valid["12K"] = bool(appl.get("12K")) and chance(rates["valid_12K"])
                if "P12K" not in valid:
                    valid["P12K"] = valid["12K"] and chance(rates["valid_P12K"])
                if "12" not in valid and stratum != "e1":
                    valid["12"] = bool(appl.get("12")) and chance(rates["valid_12"])
                if "P12" not in valid and stratum != "e1":
                    valid["P12"] = valid.get("12", False) and chance(rates["valid_P12"])
            applicability.append({"query_id": q, "arm": "9L", "applicable": appl["9L"], "reason": "simulated"})
            applicability += [{"query_id": q, "arm": arm, "applicable": a, "reason": None}
                              for arm, a in appl.items() if arm != "9L"]
        else:
            appl9 = chance(rates["appl_9"][stratum])
            appl["9"] = appl9
            valid["9"] = appl9 and chance(rates["valid_9"])
            valid["9P"] = valid["9"] and chance(rates["valid_9P"])
            for g, key in (("9K", "valid_9K"), ("9L", "valid_9L"), ("9A", "valid_9A"), ("9G", "valid_9G")):
                appl[g] = appl9 and chance(rates["appl_guess"]) and (g != "9L" or q_l_ok)
                valid[g] = appl[g] and chance(rates[key])
            if set_name == "main":
                appl["12K"] = chance(rates["appl_12K"])
                valid["12K"] = appl["12K"] and chance(rates["valid_12K"])
                valid["P12K"] = valid["12K"] and chance(rates["valid_P12K"])
                appl["12"] = chance(rates["appl_12"])
                valid["12"] = appl["12"] and chance(rates["valid_12"])
                valid["P12"] = valid["12"] and chance(rates["valid_P12"])
            for arm, a in appl.items():
                row = {"query_id": q, "arm": arm, "applicable": a, "reason": None if a else "synthetic"}
                (e1_appl if (stratum == "e1" and arm == "12" and e1_arm12_earlier) else applicability).append(row)
        same_sentence = bool(rng.random() < rates["same_sentence"])
        for arm in a5.VERSIONS:
            if arm in rows:
                versions.append(rows[arm])
                continue
            if arm not in valid or (arm != "original" and not appl.get(a5.APPLICABILITY_PARENTS.get(arm, (arm,))[0], False)):
                continue
            v = {"version_id": f"{q}:{arm}", "query_id": q, "set": page_set_name, "arm": arm, "title": "", "text": "",
                 "valid": bool(valid[arm]), "attempts": 1, "excluded_reason": None if valid[arm] else "invalid: synthetic",
                 "edit_distance": 0 if arm == "original" else 25,
                 "length_ratio": 1.0 if arm == "original" else float(math.exp(rng.normal(0.03, 0.02))),
                 "key_terms_delta": 0 if arm == "original" else int(rng.integers(0, 4)), "added_words": 0,
                 "skipped_steps": [], "edit_text": None if arm in ("original", "9P", "P12", "P12K") else "synthetic",
                 "same_sentence_as_9": same_sentence if arm in ("9K", "9L", "9A", "9G") else None,
                 "tool_gate": bool(rng.random() < rates["tool_gate"]) if arm in ("9K", "9L", "9A", "9G") else None}
            to_earlier = e1_arm12_earlier and stratum == "e1" and arm in ("12", "P12")
            (earlier_versions if to_earlier else versions).append(v | ({"run": "e1"} if to_earlier else {}))
        for j in judges:
            mu = rng.uniform(0.25, 0.85)
            for arm in a5.VERSIONS:
                if not valid.get(arm):
                    continue
                answers = np.clip(np.round(4 * (mu + _effect(effects, arm, info, j)
                                                + rng.normal(0, answer_sd, len(SEEDS)))) / 4, 0, 1)
                to_earlier = e1_arm12_earlier and stratum == "e1" and arm in ("12", "P12")
                c = _cell(page_set_name, q, arm, j, answers)
                (earlier_cells if to_earlier else cells).append(c | ({"run": "e1"} if to_earlier else {}))
                if with_earlier and not to_earlier:
                    run = ("e2a" if arm == "9P" else "e1") if stratum in ("e1", "replication") else "e3"
                    if arm in ("original", "9", "9P") and (run != "e3" or arm == "original"):
                        prior = np.clip(np.round(4 * (mu + _effect(effects, arm, info, j) - drift
                                                      + rng.normal(0, answer_sd, len(SEEDS)))) / 4, 0, 1)
                        earlier_cells.append(_cell(page_set_name, q, arm, j, prior) | {"run": run})
    return a5.E5Inputs(edit_texts=edit_texts, versions=versions, cells=cells, applicability=applicability,
                       earlier_cells=earlier_cells, earlier_versions=earlier_versions, e1_applicability=e1_appl)


def _rate(k: int, sims: int) -> dict:
    r = k / sims
    return {"rate": r, "mc_se": math.sqrt(r * (1 - r) / sims), "count": k}


def simulate(sims: int = 1000, draws: int = an.DRAWS, resamples: int = an.RESAMPLES, seed: int = 1,
             structure: dict | None = None, **synthetic) -> dict:
    inp = synthetic_e5(seed=seed, structure=structure, **synthetic)
    rng = np.random.default_rng(seed + 1)
    batch = a5.PBatch(draws)
    runs = []
    for _ in range(sims):
        ix = a5.E5Index(replace(inp, cells=sn.shuffle_labels(inp.cells, rng)))
        main_p = a5.planned_main(ix, batch, resamples, with_ci=False, confound=False, judge_p=False)
        rep_p = a5.planned_replication(ix, batch, resamples, with_ci=False, confound=False, judge_p=False)
        runs.append((main_p, rep_p))
    batch.run()  # one sign matrix per n, shared by every simulation (E1's sign_flip_ps)

    rejected = ("helps", an.HELPS_CONFOUNDED, "hurts")
    tally = {k: 0 for k in ("gate_p", "gate_passed", "gate_label", "structure_p", "structure_label",
                            "family_ungated_p", "family_ungated_label", "family_unadjusted", "family_given_gate_p",
                            "rep_p", "rep_label", "rep_unadjusted", "arm12_p", "arm12_label", "missing_words",
                            "step5_p", "step5_label", "any_main_p")}
    readings = {g: {} for g in a5.GUESSES}
    loses_rule = {g: 0 for g in a5.GUESSES}
    sizes = {}
    for main_p, rep_p in runs:
        r = a5.apply_main(main_p)
        a5.apply_replication(rep_p)
        gate, fam = main_p["gate"], main_p["family"]
        ok = [c for c in fam if c["status"] == "ok"]
        gate_p = gate["status"] == "ok" and gate["p"] <= ALPHA
        fam_p = any(c["p_holm"] <= ALPHA for c in ok)
        fam_label = any(c.get("_verdict_if_gated") in rejected for c in ok)
        tally["gate_p"] += gate_p
        tally["gate_passed"] += r["gate_passed"]
        tally["gate_label"] += gate["label"] in rejected
        tally["structure_p"] += gate_p or (r["gate_passed"] and fam_p)
        tally["structure_label"] += gate["label"] in rejected or (r["gate_passed"] and fam_label)
        tally["family_ungated_p"] += fam_p
        tally["family_ungated_label"] += fam_label
        tally["family_unadjusted"] += any(c["p"] <= ALPHA for c in ok)
        tally["family_given_gate_p"] += r["gate_passed"] and fam_p
        rep_ok = [c for c in rep_p["family"] if c["status"] == "ok"]
        tally["rep_p"] += any(c["p_holm"] <= ALPHA for c in rep_ok)
        tally["rep_label"] += any(c["label"] in rejected for c in rep_ok)
        tally["rep_unadjusted"] += any(c["p"] <= ALPHA for c in rep_ok)
        a12 = main_p["arm12"]
        tally["arm12_p"] += a12["status"] == "ok" and a12["p"] <= ALPHA
        tally["arm12_label"] += a12["label"] in rejected
        tally["missing_words"] += r["missing_words"]["measured"]
        s5 = main_p["step5"]
        tally["step5_p"] += s5["status"] == "ok" and s5["p"] <= ALPHA
        tally["step5_label"] += s5["label"] in rejected
        tally["any_main_p"] += (gate_p or (r["gate_passed"] and fam_p) or (a12["status"] == "ok" and a12["p"] <= ALPHA)
                                or (s5["status"] == "ok" and s5["p"] <= ALPHA))
        for g in a5.GUESSES:
            name = r["retention"][g]["reading"]
            readings[g][name] = readings[g].get(name, 0) + 1
            ci = r["retention"][g]["ci95_9_minus_G"]
            loses_rule[g] += bool(ci and ci[0] > 0)
        sizes = {"gate": gate["n"], **{f"{c['arm']} vs {c['ref']}": c["n"] for c in fam},
                 **{f"{g} vs 9": main_p["retention"][g]["n"] for g in a5.GUESSES}, "12K vs P12K": a12["n"],
                 "step5 (9 vs original, pooled)": s5["n"],
                 **{f"replication {c['arm']} vs {c['ref']}": c["n"] for c in rep_p["family"]}}

    t = {k: _rate(v, sims) for k, v in tally.items()}
    return {
        "sims": sims, "draws": draws, "resamples": resamples, "seed": seed, "alpha": ALPHA, "margin": a5.MARGIN,
        "structure_source": "E5's real queries, applicability and deterministic versions; model-made versions drawn"
                            if structure is not None else "synthetic layout at the pre-run rates",
        "n_per_contrast": sizes,
        "structure": {
            "familywise_false_positive_rate": t["structure_p"]["rate"],
            "definition": "share of simulations with the gate Holm-significant (p <= 0.05), or the gate passed "
                          "(helps) and any family member Holm-significant",
            "mc_se": t["structure_p"]["mc_se"],
            "with_e1_labels": t["structure_label"],
            "gate_significant": t["gate_p"], "gate_passed": t["gate_passed"],
            "family_significant_after_gate": t["family_given_gate_p"],
            "note": "a gate that passes is a significant gate, so this rate is the gate's own rate under the global "
                    "null; the numbers that test the family are family_if_never_gated and "
                    "family_significant_after_gate",
        },
        "family_if_never_gated": {"holm": t["family_ungated_p"], "e1_labels": t["family_ungated_label"],
                                  "unadjusted_any": t["family_unadjusted"]},
        "replication_family": {"holm": t["rep_p"], "e1_labels": t["rep_label"], "unadjusted_any": t["rep_unadjusted"]},
        "arm12": {"significant": t["arm12_p"], "e1_labels": t["arm12_label"], "missing_words_measured": t["missing_words"]},
        "step5": {"significant": t["step5_p"], "e1_labels": t["step5_label"]},
        "any_main_planned_test": t["any_main_p"],
        "retention": {g: {"readings": readings[g], "loses_rule_ungated": _rate(loses_rule[g], sims)}
                      for g in a5.GUESSES},
        "method": ("synthetic null E5 cells in E1's schema (2 judges, 8 answers per cell, pre-run validity rates), "
                   "version labels permuted within query (E1's shuffle_labels), analyze_e5's planned code path with "
                   "E1's sign-flip test; labels without the per-judge model-dependent check or the confound note"),
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sims", type=int, default=1000)
    ap.add_argument("--draws", type=int, default=an.DRAWS)
    ap.add_argument("--resamples", type=int, default=an.RESAMPLES)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--data", default=str(E5_DIR / "data"),
                    help="E5 data folder; its versions/edit_texts/applicability give the structure when present")
    ap.add_argument("--synthetic", action="store_true", help="use the synthetic layout even when E5 data exists")
    ap.add_argument("--out", default=str(E5_DIR / "out" / "null_simulation_e5.json"))
    args = ap.parse_args(argv)
    data = Path(args.data)
    use_data = not args.synthetic and all((data / f).exists() for f in ("versions.jsonl", "edit_texts.jsonl",
                                                                         "applicability.jsonl"))
    structure = structure_from_data(data) if use_data else None
    result = simulate(args.sims, args.draws, args.resamples, args.seed, structure=structure)
    if use_data:
        result["structure_files"] = {f: a5.sha256(data / f) for f in ("edit_texts.jsonl", "versions.jsonl",
                                                                     "applicability.jsonl")}
    write_json(Path(args.out), result)
    s = result["structure"]
    print(f"simulate_null_e5: wrote {args.out} (familywise false-positive rate {s['familywise_false_positive_rate']:.3f}, "
          f"MC SE {s['mc_se']:.3f}, {args.sims} simulations)")


if __name__ == "__main__":
    main()
