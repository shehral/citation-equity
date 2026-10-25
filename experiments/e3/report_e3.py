"""Markdown results for E3 (experiments/PLAN_E3.md) from out/analysis_e3.json, in plain language.

Usage: python3 -I experiments/e3/report_e3.py [--out DIR]   (reads DIR/analysis_e3.json, writes DIR/RESULTS_E3.md)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E3_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(E3_DIR.parent / "e1"))

from e1_common import CAVEAT  # noqa: E402
from report import _ci, _num, _p, _table  # noqa: E402

CHECKS = {"2": "Question headings", "4": "Tables", "5": "Statistics", "6": "Attributed quotes",
          "7": "Cited sources", "8": "Direct answer first", "10": "Explicit comparisons"}
JUDGE_NAMES = {"gemma-4-12b": "Gemma-4-12B", "qwen3.8-27b": "Qwen3.8-27B"}
PART_NAMES = {"new": "E3's new queries", "retry": "the extra attempt for E1's failed pairs"}


def label_text(label: str | None, delta: float) -> str:
    """A label in words: E1's labels, with the statistics-free statuses spelled out."""
    if label is None:
        return "n/a"
    return {
        "no effect larger than δ": f"no effect larger than {delta:.2f}",
        "insufficient n": "too few queries for a verdict",
        "not run": "not run",
        "not completed": "answers not complete",
        "reported without a verdict": "no verdict (shown for comparison)",
    }.get(label, label)


def _ref(c: dict) -> str:
    return "the unedited page" if c["ref"] == "original" else f"its placebo ({c['ref']})"


def _check(c: dict) -> str:
    return f"{CHECKS.get(c['arm'], c['arm'])} (arm {c['arm']})"


def summary_lines(res: dict) -> list[str]:
    s = res["settings"]
    judges = " and ".join(JUDGE_NAMES.get(j, j) for j in res["judges"])
    out = ["# E3 results: seven checks with more queries and one more attempt per edit", "",
           "E1 gave no verdict for these checks because fewer than 30 queries had a valid edit and placebo. "
           "E3 asks E1's question again with more pages: the 72 five-page GEO-bench test queries E1 did not use, "
           "the four-page queries for the checks that need no second page, and one more editing attempt for every "
           "pair. The pages, prompts, judges, seeds, score and statistics are E1's.", ""]
    q = res["queries_by_part"]
    out.append(f"Queries in the pooled analysis: {res['n_queries']} ({q['e1']} from E1, {q['new']} new). "
               f"Answers come from {judges}" + (" (the first judge alone: the second has not finished every "
                                                "version)" if res["mode"] == "single-model" else "") + ".")
    missing = [PART_NAMES[k] for k in ("new", "retry") if res["parts"][k] != "ok"]
    if missing:
        out.append(f"Not in this report yet, because their answers are not scored: {' and '.join(missing)}.")
    out.append("")
    fam = res["family"]
    rule = f"A check gets a verdict when at least {s['min_n']} queries have a valid pair."
    if fam["m"]:
        tested = ", ".join(CHECKS.get(a, a).lower() for a in fam["arms"])
        rule += (f" {fam['m']} checks reach that ({tested}); they are tested together, with Holm's correction "
                 f"at {s['alpha']}." if fam["m"] > 1 else f" One check reaches that ({tested}); it is tested at {s['alpha']}.")
    else:
        rule += " No check reaches that yet."
    out.append(rule)
    out.append("")
    return out


def main_table(res: dict) -> list[str]:
    delta = res["settings"]["delta"]
    out = ["## Pooled result", "",
           "d is the citation score of the edited page minus the score of its reference (each check's placebo, "
           "which rewords the same spans without the change; for tables, the unedited page), averaged over seeds "
           "and judges per query and then over queries. Positive d means the edit helped the page get cited.", ""]
    rows = []
    for c in res["contrasts"]:
        e1 = c.get("e1") or {}
        rows.append([_check(c), _ref(c).replace("its placebo ", "placebo "), str(c["n"]), _num(c["mean_d"]),
                     _ci(c["ci95"]), _p(c["p"]), _p(c["p_holm"]), label_text(c["label"], delta),
                     f"{label_text(e1.get('label'), delta)} (n {e1['n']})" if e1 else "n/a"])
    out += _table(["Check", "Compared with", "Queries", "d", "95% CI", "p", "p (Holm)", "E3 result", "E1 result"], rows)
    notes = []
    for c in res["contrasts"]:
        if c["label"] == "helps, possibly through length or query-term overlap":
            notes.append(f"- {_check(c)}: the gain may come from the edit making the page longer or repeating the "
                         "query's words; once those are accounted for, the remaining effect is not clearly above zero.")
        if c["label"] == "model-dependent":
            notes.append(f"- {_check(c)}: the two judges disagree in direction, so the result depends on the model.")
        if c["status"] == "insufficient n":
            notes.append(f"- {_check(c)}: {c['n']} queries with a valid pair, under the {res['settings']['min_n']} "
                         "needed for a verdict.")
        if c["status"] == "not run":
            notes.append(f"- {_check(c)}: no valid edit was judged, so the check is reported as not run.")
    if notes:
        out += ["Notes:", "", *notes, ""]
    return out


def breakdown_table(res: dict) -> list[str]:
    out = ["## Where the queries come from", "",
           "The same contrasts on parts of the pooled set, without verdicts. If the extra attempt moved the estimate, "
           "E1's queries with the extra attempt differ from E1's queries as E1 ran them; if the new queries "
           "behave differently, they differ from both.", ""]
    names = list(res["breakdowns"])
    header = ["Check"] + [res["breakdowns"][n]["title"] for n in names]
    rows = []
    for i, c in enumerate(res["contrasts"]):
        row = [_check(c)]
        for n in names:
            b = res["breakdowns"][n]
            if b["status"] != "ok":
                row.append("not run")
                continue
            x = b["contrasts"][i]
            row.append("no valid pair" if not x["n"] else f"n {x['n']}, d {_num(x['mean_d'])} {_ci(x['ci95'])}")
        rows.append(row)
    return out + _table(header, rows)


def validity_table(res: dict) -> list[str]:
    out = ["## Edits that passed validation (pooled)", "",
           "Applicable: the check flagged something to change on the page. Valid: the edit passed E1's six validity "
           "checks within the attempts it had (two in E1, three in E3).", ""]
    rows = []
    for arm, e in res["exclusions"].items():
        name = CHECKS.get(arm, f"placebo for {CHECKS.get(arm[1:], arm[1:]).lower()}" if arm.startswith("P") else arm)
        rows.append([f"{name} ({arm})", str(e["applicable"]), str(e["valid"]), str(e["validity_exclusions"]),
                     _num(e["mean_length_ratio"], False), _num(e["mean_key_terms_delta"])])
    out += _table(["Version", "Applicable", "Valid", "Failed validation", "Length ratio", "Key-term change"], rows)
    if res["refused_queries"]:
        out += [f"Queries left out because a prompt was over 31,000 tokens: {', '.join(res['refused_queries'])}.", ""]
    return out


def render(res: dict) -> str:
    lines = summary_lines(res) + main_table(res) + breakdown_table(res) + validity_table(res)
    lines += ["E1's published results stay as they are; the tool's labels for these checks change only through "
              "this pooled result, by E1's rule table.", "", CAVEAT, ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(E3_DIR / "out"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    res = json.loads((out / "analysis_e3.json").read_text(encoding="utf-8"))
    (out / "RESULTS_E3.md").write_text(render(res), encoding="utf-8")
    print(f"report_e3: wrote {out / 'RESULTS_E3.md'}")


if __name__ == "__main__":
    main()
