"""Markdown results for E2 (experiments/PLAN_E2.md) from out/analysis_e2.json, in plain language.

Usage: python3 -I experiments/e2/report_e2.py [--out DIR]   (reads DIR/analysis_e2.json, writes DIR/RESULTS_E2.md)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E2_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(E2_DIR.parent / "e1"))

from e1_common import CAVEAT  # noqa: E402
from report import _ci, _num, _p, _table  # noqa: E402

NAMES = {"original": "original", "9": "9 (query as a heading)", "9W": "9W (query as plain text)",
         "9P": "9P (a heading without the query's words)", "12": "12", "P12": "P12", "ALL": "ALL",
         "P_ALL": "P_ALL"}
MEANING = {("9", "9W"): "the heading markup", ("9", "9P"): "the query's words"}


def _pair(c: dict) -> str:
    return f"{c['arm']} vs {c['ref']}"


def _versions(stats: dict) -> list[str]:
    rows = [[NAMES.get(arm, arm), str(s["applicable"]), str(s["valid"]), str(s["invalid"]),
             _num(s["mean_length_ratio"], False), _num(s["mean_key_terms_delta"]),
             _num(s["mean_edit_distance"], False)] for arm, s in stats.items()]
    return _table(["Version", "Queries", "Valid", "Invalid", "Length ratio", "Key-term change", "Edit distance"], rows)


def _e2a_set(res: dict) -> list[str]:
    out = [f"### {res['set'].capitalize()} set", ""]
    out.append(f"Judges: {', '.join(res['judges'])} ({res['mode']}). Queries: {res['n_queries']}. "
               f"Planned tests with enough queries to test: {res['family']['m']} of {len(res['planned'])} "
               f"(Holm over those, alpha {res['family']['alpha']}).")
    if res["mode"] == "single-model":
        out.append("The second judge has not finished every version, so the results use the first judge alone.")
    out.append("")
    rows = []
    for c in res["planned"]:
        rows.append([_pair(c), MEANING.get((c["arm"], c["ref"]), ""), str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]),
                     _ci(c["ci90"]), _p(c["p"]), _p(c["p_holm"]), _num(c["mde"], False), c["label"]])
    out.append("Planned tests (d is the score of arm 9 minus the score of the other version):")
    out.append("")
    out += _table(["Contrast", "What it isolates", "n", "d", "95% CI", "90% CI", "p", "p (Holm)",
                   "Smallest detectable d", "Label"], rows)
    rows = [[_pair(c), str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]), _p(c["p"]), c["label"]]
            for c in res["reported"]]
    out.append("Reported without a verdict (each new version against the unedited page):")
    out.append("")
    out += _table(["Contrast", "n", "d", "95% CI", "p", "Label"], rows)
    out.append(f"**Reading.** {res['reading']['text']}")
    out.append("")
    rows = []
    for c in res["planned"]:
        conf = c["confound"]
        if conf is None:
            continue
        held = ", ".join(f"{k} constant at {v:+.3f}" for k, v in conf["dropped"].items()) or "none"
        rows.append([_pair(c), _num(conf["intercept"]), _ci(conf["ci95"]), held])
    if rows:
        out.append("Length and key-term regression (reported only; it does not change a label):")
        out.append("")
        out += _table(["Contrast", "Intercept", "95% CI", "Regressors without variance"], rows)
    out.append("Versions:")
    out.append("")
    out += _versions(res["versions"])
    return out


def _e2b(res: dict) -> list[str]:
    out = [f"Editor: {res['editor']}. Judges: {', '.join(res['judges'])} ({res['mode']}). "
           f"Queries: {res['n_queries']} (main set).", ""]
    rows = []
    for c in res["contrasts"]:
        n = f"{c['n']}" + (" (fewer than 30)" if c.get("few_queries") else "")
        rows.append([_pair(c), n, _num(c["mean_d"]), _ci(c["ci95"]), _p(c["p"]), _num(c["e1_mean_d"]),
                     c.get("e1_label") or "n/a", c["label"]])
    out += _table(["Contrast", "n", "d (Qwen edits)", "95% CI", "p", "d in E1 (Gemma edits)", "E1 label", "E2b label"],
                  rows)
    out.append("A label stands when d keeps the sign it had in E1; otherwise it becomes editor-dependent. "
               "The p-values are shown for reference; the rule is the sign.")
    out.append("")
    rows = [[_pair(c), str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]), c["label"]] for c in res["reported"]]
    out.append("Each Qwen-edited version against the unedited page, reported without a verdict:")
    out.append("")
    out += _table(["Contrast", "n", "d", "95% CI", "Label"], rows)
    out.append("Versions (pages whose Qwen edit failed validation are listed, not replaced):")
    out.append("")
    out += _versions(res["versions"])
    for arm, s in res["versions"].items():
        if s["failed"]:
            ids = ", ".join(f["query_id"] for f in s["failed"])
            out += [f"- {arm} failed on {len(s['failed'])} pages: {ids}.", ""]
    return out


def render(result: dict) -> str:
    out = ["# E2 results: why does the question-as-heading edit help?", "",
           f"_{CAVEAT}_", "",
           "Plan: experiments/PLAN_E2.md (written before any E2 version or answer existed). Statistics as in E1: "
           "the unit is the query, d is averaged over 8 seeds and then over the two judges, a two-sided "
           "sign-flip test, 95% and 90% bootstrap intervals over queries. Labels: helps, hurts, no effect "
           f"larger than δ = {result['settings']['delta']}, inconclusive, model-dependent; fewer than "
           f"{result['settings']['min_n']} queries gives no label (insufficient n).", ""]
    out += ["## E2a: heading markup or the query's words?", "",
            "Each set has two planned tests, one Holm family at alpha 0.05: 9 vs 9W (the effect of the heading "
            "markup) and 9 vs 9P (the effect of the query's words, with position, markup and length held). "
            "9W and 9P against the original are reported without a verdict. The original's and arm 9's answers "
            "are E1's.", ""]
    e2a = result["e2a"]
    if e2a.get("status") == "not run":
        out += ["E2a has not run yet: its cells are missing.", ""]
    else:
        for set_name in ("main", "replication"):
            if set_name in e2a:
                out += _e2a_set(e2a[set_name])
        out += ["The smallest detectable d is the difference the test would find 80% of the time at the "
                "planned alpha; smaller effects cannot be ruled out.", ""]
    out += ["## E2b: the editor check", ""]
    e2b = result["e2b"]
    if e2b.get("status") == "not run":
        out += ["E2b has not run yet: its cells are missing.", ""]
    else:
        out += _e2b(e2b)
    return "\n".join(out).rstrip() + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(E2_DIR / "out"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    result = json.loads((out / "analysis_e2.json").read_text(encoding="utf-8"))
    (out / "RESULTS_E2.md").write_text(render(result), encoding="utf-8")


if __name__ == "__main__":
    main()
