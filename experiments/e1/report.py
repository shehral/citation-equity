"""Markdown results for E1 (PREREG_E1.md r2) from out/analysis.json and out/null_simulation.json.

Usage: python3 -I experiments/e1/report.py [--out DIR]   (writes DIR/RESULTS_E1.md)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

from e1_common import CAVEAT  # noqa: E402

FAMILY_NAMES = {"A": "A (tool checks)", "B": "B (candidate checks)", "ALL": "ALL", "R": "replication"}


def _num(x, signed=True) -> str:
    if x is None:
        return "n/a"
    return f"{x:+.3f}" if signed else f"{x:.3f}"


def _p(p) -> str:
    if p is None:
        return "n/a"
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def _ci(ci) -> str:
    return "n/a" if not ci else f"[{ci[0]:+.3f}, {ci[1]:+.3f}]"


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return lines + [""]


def _removal(c: dict) -> str:
    """Replication support for removing a check; a contrast that is not 'ok' says why it gives none."""
    if c["replication_supports_removal"]:
        return "yes"
    return "no" if c["status"] == "ok" else f"no ({c['status']})"


def _set_section(res: dict) -> list[str]:
    out = [f"## Set: {res['set']}", ""]
    judges = ", ".join(res["judges"])
    out.append(f"Mode: {res['mode']} (verdict judges: {judges}). Labels carry: {', '.join(res['tags'])}. "
               f"Queries analyzed: {res['n_queries']}; refused for prompt length: {len(res['refused_queries'])}.")
    out.append("")
    fams = "; ".join(f"{FAMILY_NAMES.get(f, f)}: m = {v['m']}" for f, v in res["families"].items())
    out.append(f"Holm families (alpha {res['settings']['alpha']}): {fams}. "
               f"Arms with fewer than {res['settings']['min_n']} analyzable queries are 'insufficient n'.")
    out.append("")
    out.append("### Primary contrasts")
    out.append("")
    rows = []
    for c in res["contrasts"]:
        rows.append([c["arm"], c["ref"], FAMILY_NAMES.get(c["family"], "descriptive") if c["family"] else "descriptive",
                     str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]), _ci(c["ci90"]), _p(c["p"]), _p(c["p_holm"]),
                     _num(c["mde"], signed=False), c["label"]])
    out += _table(["Arm", "Ref", "Family", "n", "d", "95% CI", "90% CI", "p", "p (Holm)", "MDE", "Label"], rows)

    out.append("### Exclusions and edit statistics")
    out.append("")
    rows = []
    for arm, e in res["exclusions"].items():
        rows.append([arm, str(e["applicable"]), str(e["valid"]), str(e["validity_exclusions"]),
                     "yes" if e["flagged"] else "no", str(e["dropped_cells"]), _num(e["mean_edit_distance"], False),
                     _num(e["mean_length_ratio"], False), _num(e["mean_key_terms_delta"])])
    out += _table(["Arm", "Applicable", "Valid", "Validity exclusions", "Over 20%", "Dropped cells",
                   "Edit distance", "Length ratio", "Key-term change"], rows)
    if res["refused_queries"]:
        out += [f"Queries refused (a prompt over 31,000 tokens): {', '.join(res['refused_queries'])}.", ""]

    out.append("### Secondary (reported, no verdicts)")
    out.append("")
    out.append("Arm minus original:")
    out.append("")
    out += _table(["Arm", "n", "d", "95% CI", "p"],
                  [[x["arm"], str(x["n"]), _num(x["mean_d"]), _ci(x["ci95"]), _p(x["p"])] for x in res["vs_original"]])
    out.append("Per judge, cited at all, PAWC share and valid-answer rate (each arm against its Ref):")
    out.append("")
    rows = []
    for c in res["contrasts"]:
        judge = "; ".join(f"{j} {_num(v['mean_d'])} (p {_p(v['p'])})" for j, v in c["per_judge"].items())
        s = c["secondary"]
        rows.append([c["arm"], c["ref"], judge or "n/a", _num(s["cited"]["mean_d"]), _num(s["pawc"]["mean_d"]),
                     _num(s["valid_rate"]["mean_d"])])
    out += _table(["Arm", "Ref", "Per-judge d", "Cited at all", "PAWC share", "Valid rate"], rows)
    if any("retrieval" in c["secondary"] for c in res["contrasts"]):
        out.append("Retrieval (BM25 over the pool; a negative rank change is better):")
        out.append("")
        rows = []
        for c in res["contrasts"]:
            r = c["secondary"].get("retrieval")
            if r:
                rows.append([c["arm"], c["ref"], str(r["rank_pool"]["n"]), _num(r["rank_pool"]["mean_d"]),
                             _p(r["rank_pool"]["p"]), _num(r["rank_own"]["mean_d"]), _num(r["top8"]["mean_d"])])
        out += _table(["Arm", "Ref", "n", "Pool rank change", "p", "Own-4 rank change", "Top-8 change"], rows)
    out.append("d by target slot, and subgroups:")
    out.append("")
    rows = []
    for c in res["contrasts"]:
        slots = " / ".join(_num(c["slots"][s]["mean_d"]) for s in ("1", "2", "3", "4"))
        sub = c["subgroups"]
        rows.append([c["arm"], c["ref"], slots,
                     f"{_num(sub['wikipedia_target']['mean_d'])} (n {sub['wikipedia_target']['n']})",
                     f"{_num(sub['wayback_target']['mean_d'])} (n {sub['wayback_target']['n']})",
                     f"{_num(sub['wayback_any']['mean_d'])} (n {sub['wayback_any']['n']})"])
    out += _table(["Arm", "Ref", "Slot 1 / 2 / 3 / 4", "Wikipedia target", "Wayback target",
                   "Any Wayback page in the prompt"], rows)
    out.append("Confound regression (d on change in log length and in query key-term count; intercept with 95% CI):")
    out.append("")
    rows = []
    for c in res["contrasts"]:
        conf = c["confound"]
        if conf is None:
            rows.append([c["arm"], c["ref"], "n/a", "n/a", "no length data"])
            continue
        note = "" if conf["identifiable"] else "not separable from a constant change"
        rows.append([c["arm"], c["ref"], _num(conf["intercept"]), _ci(conf["ci95"]),
                     note or ", ".join(conf["regressors"]) or "intercept only"])
    out += _table(["Arm", "Ref", "Adjusted intercept", "95% CI", "Regressors"], rows)
    for judge, rows_j in res["secondary_judges"].items():
        out.append(f"Second judge {judge} (finished arms only; no verdicts):")
        out.append("")
        out += _table(["Arm", "Ref", "n", "d", "95% CI", "p"],
                      [[r["arm"], r["ref"], str(r["n"]), _num(r["mean_d"]), _ci(r["ci95"]), _p(r["p"])] for r in rows_j])
    if res["set"] == "replication":
        out.append("Replication support for removing a check from the score (d < 0 with unadjusted p < 0.05): "
                   + ", ".join(f"{c['arm']} {_removal(c)}" for c in res["contrasts"]) + ".")
        out.append("")
    return out


def render(results: dict, null_sim: dict | None) -> str:
    out = ["# E1 results: which suggestions change citation?", "", f"> {CAVEAT}", "",
           "Protocol: experiments/PREREG_E1.md (r2). Citation score (5 - r) / 4: 1 when the target is cited first, "
           "0 when it is uncited, 0.25 per rank position. d is the arm minus its reference version, averaged over "
           "seeds and then judges within each query. Tests: two-sided sign-flip over queries (exact when n <= 12, "
           "otherwise 100,000 draws), Holm within each family; intervals are 95% and 90% percentile bootstraps "
           "(10,000 resamples) and are not adjusted. 'no effect larger than δ' means the 90% CI lies within "
           "+-0.03.", ""]
    for res in results.values():
        out += _set_section(res)
    power = next(iter(results.values()))["power"] if results else None
    out.append("## Power")
    out.append("")
    if power:
        out.append(f"Planned minimum detectable d at the strictest family-A Holm step: "
                   f"{power['planning_mde_n60']:.3f} at n = 60 and {power['planning_mde_n80']:.3f} at n = 80. "
                   "The MDE column above is recomputed from each arm's realized SD of d. "
                   f"{power['note']}")
        out.append("")
    out.append("## Null simulation")
    out.append("")
    if null_sim:
        out.append(f"{null_sim['sims']} simulations, {null_sim['n_queries']} queries, {null_sim['draws']} sign-flip "
                   f"draws ({null_sim['method']}). The familywise false-positive rate per Holm family should be "
                   "about 5% or a little below:")
        out.append("")
        out += _table(["Family", "m", "Familywise rate (Holm)", "MC SE", "Any unadjusted p <= 0.05"],
                      [[FAMILY_NAMES.get(f, f), str(v["m"]), f"{v['fwer']:.3f}", f"{v['mc_se']:.3f}",
                        f"{v['unadjusted_any']:.3f}"] for f, v in null_sim["families"].items()])
    else:
        out += ["Not run (out/null_simulation.json missing).", ""]
    out += ["## Limits", "",
            "Open models in a fixed context of 4 pre-selected sources; not ChatGPT, Perplexity or Google. "
            "The editor and the primary judge are both Gemma models. Arms 1 and 13 need passage-level "
            "retrieval and get no verdict. The optional mixed model was not run.", ""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(here / "out"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    results = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    sim_path = out / "null_simulation.json"
    null_sim = json.loads(sim_path.read_text(encoding="utf-8")) if sim_path.exists() else None
    (out / "RESULTS_E1.md").write_text(render(results, null_sim), encoding="utf-8")


if __name__ == "__main__":
    main()
