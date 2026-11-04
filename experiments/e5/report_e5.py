"""Markdown results for E5 (experiments/PLAN_E5.md r2) from out/analysis_e5.json, in plain language, and
out/e5_results.json, the small machine-readable summary the paper and the tool read.

Usage: python3 -I experiments/e5/report_e5.py [--out DIR] [--secondary] [--analysis FILE] [--null FILE]
       (reads DIR/analysis_e5.json, or DIR/analysis_e5_secondary.json with --secondary, and the null
        simulation from DIR/null_simulation_e5.json or else experiments/e5/freeze/null_simulation_e5.json;
        writes DIR/RESULTS_E5.md and DIR/e5_results.json, with a _secondary suffix for a secondary run)

e5_results.json keeps the row keys packages/engine/src/e5.ts reads (E5Row) and step 5's scope "all main queries",
which the tool matches on; amendment 3's sensitivity rows and the added analyses are extra rows with their own step
("amendment 3 sensitivity", "added analysis") and the label "reported without a verdict".
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E5_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(E5_DIR.parent / "e1"))

from e1_common import CAVEAT, write_json  # noqa: E402
from report import _ci, _num, _p, _table  # noqa: E402

NAMES = {
    "original": "the unedited page",
    "9": "the reader's exact question",
    "9P": "a section without the reader's words",
    "9K": "a keyword's two words",
    "9L": "a question a local model wrote from the keyword",
    "9A": "all the reader's key words, without the exact question",
    "9G": "a question in the page's own words",
    "12": "the reader's missing words worked into the top",
    "P12": "a rewording of the same spans (placebo for the reader's missing words)",
    "12K": "the keyword's missing words worked into the top",
    "P12K": "a rewording of the spans the keyword edit changed (placebo)",
}
JUDGE_NAMES = {"gemma-4-12b": "Gemma-4-12B", "qwen3.8-27b": "Qwen3.8-27B"}
STRATUM_NAMES = {"e1": "E1's queries", "e3": "E3 five-page", "e3-four": "E3 four-page"}
GUESS_FAMILY = ("9K", "9L", "9A", "9G")
HELPS_LABELS = ("helps", "helps, possibly through length or query-term overlap")
NO_EFFECT = "no effect larger than δ"
REPORTED = "reported without a verdict"
A3_STEP, ADDED_STEP = "amendment 3 sensitivity", "added analysis"
# The tool's label words for guessed questions: a copy decision made after E5's results (2026-11-03), recorded as such
# in RESULTS_E5.md. The statistical readings stay the plan's.
TOOL_COPY_AFTER_RESULTS = {"9K": "May help less", "9L": "No effect in our test"}
TOOL_COPY_INPUTS = {"9K": "keyword questions", "9L": "local-model questions"}


def _series(items: list[str]) -> str:
    items = list(items)
    if len(items) <= 2:
        return " and ".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _ci_fine(ci) -> str:
    """_ci, with four decimals for an end that rounds to 0 at three (so +0.0001 does not read as +0.000)."""
    if not ci:
        return "n/a"
    fmt = lambda x: f"{x:+.4f}" if 0 < abs(x) < 0.0005 else f"{x:+.3f}"  # noqa: E731
    return f"[{fmt(ci[0])}, {fmt(ci[1])}]"


def _fraction_words(share: float) -> str:
    return " (about two-thirds)" if 0.6 <= share < 0.73 else " (about half)" if 0.43 <= share < 0.57 else ""


def judge_role(judge: str, judges: list[str]) -> str:
    return "the primary judge" if judges and judge == judges[0] else "the second judge"


def carried_by(c: dict, alpha: float = 0.05) -> str | None:
    """For a helps label (E1's note included) on two or more judges: the one judge whose own sign-flip p is under
    alpha (with a positive mean) when no other judge's is. None otherwise."""
    pj = c.get("per_judge") or {}
    if c.get("label") not in HELPS_LABELS or len(pj) < 2:
        return None
    sig = [j for j, x in pj.items() if x.get("p") is not None and x["p"] < alpha and (x.get("mean_d") or 0) > 0]
    return sig[0] if len(sig) == 1 else None


def judge_note(c: dict, res: dict, where: str = "") -> str | None:
    judges = list(res["settings"]["judges"])
    j = carried_by(c, res["settings"].get("alpha", 0.05))
    if j is None:
        return None
    x = c["per_judge"][j]
    others = [k for k in c["per_judge"] if k != j]
    o = c["per_judge"][others[0]]
    return (f"- {name(c['arm'])} vs {name(c['ref'])}{where}: the helps label rests mainly on {JUDGE_NAMES.get(j, j)}, "
            f"{judge_role(j, judges)} (d {_num(x['mean_d'])} {_ci(x.get('ci95'))}, p {_p(x['p'])}); "
            f"{JUDGE_NAMES.get(others[0], others[0])}, {judge_role(others[0], judges)}, alone gives d "
            f"{_num(o['mean_d'])} {_ci(o.get('ci95'))} (p {_p(o['p'])}).")


def label_text(label: str | None, delta: float = 0.03) -> str:
    if label is None:
        return "n/a"
    return {
        "no effect larger than δ": f"no effect larger than {delta:.2f}",
        "insufficient n": "too few queries for a verdict",
        "not run": "not run",
        "not completed": "answers not complete",
        "reported without a verdict": "no verdict (reported)",
        "descriptive (gate failed)": "no verdict (the gate did not pass)",
    }.get(label, label)


def name(arm: str) -> str:
    return NAMES.get(arm, arm)


def contrast_name(c: dict) -> str:
    return f"{c['arm']} vs {c['ref']}"


def flags(c: dict) -> str:
    out = []
    if c.get("single_model"):
        out.append("Gemma only")
    if c.get("cross_run"):
        src = c.get("sources") or {}
        parts = [f"{src[k]} {text}" for k, text in SOURCE_TEXT if src.get(k)]
        out.append("cross-run (" + ", ".join(parts) + ")")
    return ", ".join(out) or "both judges, one run"


SOURCE_TEXT = (("mixed", "with one version from an earlier run"), ("earlier_one_run", "both from one earlier run"),
               ("earlier_two_runs", "from two earlier runs"))


def _row(step: str, c: dict, delta: float) -> list[str]:
    return [step, name(c["arm"]), name(c["ref"]), str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]), _ci(c["ci90"]),
            _p(c["p"]), _p(c.get("p_holm")), _num(c.get("mde"), False), label_text(c["label"], delta), flags(c)]


HEADER = ["Step", "Edit", "Compared with", "Queries", "d", "95% CI", "90% CI", "p", "p (Holm)", "Detectable",
          "Result", "Judges and run"]


def intro(res: dict) -> list[str]:
    q = res["queries"]
    s = res["settings"]
    snap = res.get("snapshot") or {}
    out = ["# E5 results: does the reader's-words gain survive when the writer has only a keyword?", "",
           "In E1 to E3 the only edits that clearly raised citation put the reader's own words near the top of the "
           "page, and every one of them used the exact question the page was then judged on. A writer never sees "
           "that question; at best they have a keyword. E5 asks three things. Does the gain from adding the reader's "
           "exact question as a section under the title hold on GEO-bench test queries E1 never used? Does the edit "
           "still help when its heading carries only the two rarest key words of the reader's question? And does it "
           "help when the heading is a question a local model wrote from that keyword? Every answer is judged against "
           "the reader's true question; only the text used to make the edit changes. The pages, judges, seeds, score "
           "and statistics are E1's.", "",
           *sections_paragraph(res),
           f"Queries: {q['main']} on the main set ({q['e1']} from E1 and {q['new']} new: "
           f"{q['by_stratum'].get('e3', 0)} five-page and {q['by_stratum'].get('e3-four', 0)} four-page) and "
           f"{q['replication']} on the replication set (C-SEO Bench). d is the citation score of the edited page minus "
           "the score of the version it is compared with, averaged over 8 seeds and the judges per query and then over "
           "queries; positive d means the edit helped the page get cited. A result needs at least "
           f"{s['min_n']} queries.", ""]
    if snap.get("files"):
        answers = sum(1 for f in snap["files"] if "/answers/" in f)
        out += [f"The analysis ran once, on the answer files present at {snap.get('started_at')}; the sha256 of "
                f"each of its {len(snap['files'])} input files ({answers} answer file{'s' if answers != 1 else ''} "
                "among them) is in "
                "analysis_e5.json.", ""]
    if snap.get("warnings"):
        out += ["Input files that were missing: " + "; ".join(snap["warnings"]) + ".", ""]
    if res.get("secondary"):
        out += ["This is a secondary run on answers that arrived after the planned snapshot. It changes no label.", ""]
    return out


def sections_paragraph(res: dict) -> list[str]:
    """How the section edits are built (each copies the page sentence that best matches its heading, so the sentence
    can differ), with the main set's counts, and the local-model question that is the reader's own (amendment 3)."""
    text = ("Every section edit adds one heading under the title and copies beneath it the page sentence that best "
            "matches the heading's words, so the copied sentence can differ between versions as well as the heading. "
            "\"A section without the reader's words\" is E2's control: the same kind of section built from a page "
            "sentence that holds the fewest of the reader's key words.")
    sv = ((res.get("validity") or {}).get("sentence_vs_9") or {}).get("main") or {}
    differs = [(arm, x) for arm, x in sv.items() if x["different_sentence"]]
    always = [arm for arm, x in sv.items() if x["n"] and not x["different_sentence"] and not x["unknown"]]
    if differs:
        text += (" On the main set the copied sentence differs from the exact question's for "
                 + _series([f"\"{name(arm)}\" on {x['different_sentence']} of {x['n']} queries" for arm, x in differs]))
        if always:
            text += ("; only " + _series([f"\"{name(a)}\" ({sv[a]['n']} of {sv[a]['n']})" for a in always])
                     + " always copies the same sentence")
        same = next((c for c in res["main"].get("reported", []) if c.get("scope") == "same-sentence subset"), None)
        text += "."
        if same and same.get("n"):
            text += (f" The heading-only comparison is the same-sentence subset in the ladder below ({name(same['arm'])} "
                     f"vs {name(same['ref'])}, {same['n']} queries).")
    out = [text, ""]
    a3 = res.get("amendment_3_sensitivity") or {}
    fl = ((a3.get("flagged") or {}).get("main") or {}).get("9L") or {}
    ip = (a3.get("main") or {}).get("identical_prompts")
    if fl.get("n"):
        valid = (((res.get("validity") or {}).get("main") or {}).get("all") or {}).get("9L", {}).get("valid")
        s = (f"{name('9L').capitalize()}: on {fl['n']} of the {valid} main queries with a valid version, the local "
             "model wrote the reader's exact question (PLAN_E5 amendment 3 flags these; its section below reports every "
             "contrast without them).")
        if ip and ip.get("identical_versions"):
            lo, hi = ip["differing_lower_on_9L"], ip["differing_higher_on_9L"]
            way = ("all lower on the local model's copy" if lo and not hi else "all higher on the local model's copy"
                   if hi and not lo else f"{lo} lower and {hi} higher on the local model's copy")
            d = ip["d_9L_minus_9"]
            s += (f" {ip['identical_versions']} of those {fl['n']} versions are byte-identical to the exact question's "
                  f"version, so their prompts are identical too ({ip['prompt_sets_identical']} of "
                  f"{ip['prompt_sets_compared']} prompt sets compared, one per query and judge). They were answered in "
                  "different batches of the one run, so they are a measured within-run noise floor for identical "
                  f"prompts: {ip['cells_differ']} of their {ip['cells']} judge cells differ")
            if ip["cells_differ"]:
                s += f" ({way}; at most {ip['max_abs_cell_diff']:.4f})"
            s += (f", and the mean per-query difference (the local model's copy minus the exact question's) is "
                  f"{_num(d['mean_d'])} over {d['n']} queries (exact sign-flip p {_p(d.get('p'))}). "
                  "Identical prompts do not give identical cells within the run, whatever the source (batch "
                  "composition, or the GPU type, which varied across the run's jobs; the freeze log lists them); the "
                  "drift check below measures the same kind of noise between runs.")
        out += [s, ""]
    return out


def planned(res: dict) -> list[str]:
    m = res["main"]["planned"]
    delta = res["settings"]["delta"]
    out = ["## Planned results", "",
           "Main set. Step 1 is the gate. The four tests of step 2 are one family with Holm's correction, read only "
           "if the gate passes. Step 4 is its own test. Step 5 sets the tool's reader's-words label; it is a "
           "cumulative estimate that includes E1's queries. Each step is at alpha 0.05. \"Detectable\" is the "
           "smallest mean d the step could detect with 80% power, from the realized spread.", ""]
    rows = [_row("1 (new queries)", m["gate"], delta)]
    rows += [_row("2", c, delta) for c in m["family"]]
    rows.append(_row("4", m["arm12"], delta))
    rows.append(_row(f"5: every main query with a valid arm 9 ({m['step5']['n']})", m["step5"], delta))
    out += _table(HEADER, rows)
    rep = res["replication"]["planned"]["family"]
    out += ["Replication set, its own Holm family (no gate):", ""]
    out += _table(HEADER, [_row("R", c, delta) for c in rep])
    notes = []
    for c in [m["gate"], *m["family"], m["arm12"], m["step5"], *rep]:
        where = " (replication set)" if c.get("family") == "replication" else ""
        if c["label"] == "helps, possibly through length or query-term overlap":
            notes.append(f"- {name(c['arm'])} vs {name(c['ref'])}{where}: the gain may come from the edit making the page "
                         "longer or repeating the query's words; once those are accounted for, the remaining effect "
                         "is not clearly above zero.")
        if c["label"] == "model-dependent":
            notes.append(f"- {name(c['arm'])} vs {name(c['ref'])}{where}: the two judges disagree in direction, so the "
                         "result depends on the model.")
        if c["status"] == "insufficient n":
            notes.append(f"- {name(c['arm'])} vs {name(c['ref'])}{where}: {c['n']} queries, under the "
                         f"{res['settings']['min_n']} needed for a verdict.")
        carried = judge_note(c, res, where)
        if carried:
            notes.append(carried)
    if notes:
        out += ["Notes:", "", *dict.fromkeys(notes), ""]
    return out


def readings(res: dict) -> list[str]:
    r = res["main"]["readings"]
    m = res["main"]["planned"]
    delta = res["settings"]["delta"]
    out = ["## What the results mean", ""]
    gate = m["gate"]
    out.append(f"The gate ({name('9')} on the new queries): {label_text(gate['label'], delta)}, d {_num(gate['mean_d'])} "
               f"{_ci(gate['ci95'])} over {gate['n']} queries. The gate "
               + ("passed, so the four guess tests carry verdicts." if r["gate_passed"]
                  else "did not pass, so the four guess tests are descriptive.") + "")
    out.append("")
    out += near_duplicate_line(res)
    margin = res["settings"]["margin"]
    out.append(f"Whether each guess keeps the gain is read with a margin of {margin:.3f}, about half of arm 9's gain, "
               "fixed before any answer: it keeps the gain if it helps against the unedited page and against a "
               "section without the reader's words, and the lower end of the 90% interval of d(guess - exact "
               f"question) is above -{margin:.3f}; it loses the gain if the exact question beats it with a 95% interval "
               "above zero; otherwise it is partly kept, unclear.")
    out.append("")
    rows = []
    for g, x in r["retention"].items():
        rows.append([name(g), str(x["n"]), _num(x["d_G_minus_9"]), _ci(x["ci90_G_minus_9"]), _num(x["d_9_minus_G"]),
                     _ci(x["ci95_9_minus_G"]),
                     x["reading"] + (f" (the exact question still did better, by less than {margin:.3f})"
                                     if x.get("both_rules") else "")])
    out += _table(["Guess", "Queries", "d(guess - exact)", "90% CI", "d(exact - guess)", "95% CI", "Reading"], rows)
    out += new_query_retention(res)
    if r["meaning"]:
        out += ["The plan's lines for each guess, as pre-registered for this result and kept as written:", ""]
    for g, x in r["meaning"].items():
        out += [f"- {name(g)}. " + (x["tool"] if x["tool"] == x["paper"] else f"Tool: {x['tool']} Paper: {x['paper']}")]
    against = against_data(res)
    out += [""] + against
    if against:
        out += ["### Step 4, step 5 and the page-question placebo", ""]
    out += [f"- Missing words (step 4): {r['missing_words']['text']} Rule: {r['missing_words']['rule']}; "
            f"{name('12K')} vs {name('original')} d {_num(m['arm12_vs_original']['mean_d'])} "
            f"{_ci(m['arm12_vs_original']['ci95'])} (n {m['arm12_vs_original']['n']}).",
            f"- The tool's reader's-words label (step 5, {r['readers_words_label']['note']}): "
            f"{label_text(r['readers_words_label']['label'], delta)}; the tool's action: "
            f"{r['readers_words_label']['tool_action']}.",
            f"- {r['note_9G']}", ""]
    return out


def near_duplicate_line(res: dict) -> list[str]:
    """The added analysis on the gate: the new queries that share pages with an E1 query, and the gate without them."""
    add = (res.get("added_analyses") or {}).get("gate_without_near_duplicates")
    if not add or not add.get("left_out"):
        return []
    lo = add["left_out"]
    parts = [f"{x['query_id']} shares {x['pages_shared_with_e1_query']} of its {x['pages']} pages with E1's "
             f"{x['e1_query']} ({x['how']})" for x in lo]
    which = "one of the gate's new queries is" if len(lo) == 1 else f"{len(lo)} of the gate's new queries are"
    return [f"Added analysis, after the results: {which} not wholly new: " + "; ".join(parts) + ". Without "
            + ("it" if len(lo) == 1 else "them") + f" the gate is d {_num(add['mean_d'])} {_ci(add['ci95'])} over "
            f"{add['n']} queries (p {_p(add.get('p'))}), reported without a verdict.", ""]


def new_query_retention(res: dict) -> list[str]:
    """Next to each retention reading: the new queries alone (d, 95% interval, p, share kept) and the reweighted
    estimate, then the E1 selection caveat. The planned reading is the pooled one."""
    r, m = res["main"]["readings"], res["main"]["planned"]
    new = res["main"].get("share_kept_new") or {}
    out = []
    for g in r["retention"]:
        sh = new.get(g) or {}
        nq = sh.get("d_G_minus_9") or {}
        if not nq.get("n") or not nq.get("ci95"):
            continue
        lower = -nq["ci95"][1]
        where = ("above 0 by less than 0.001" if 0 < lower < 0.001 else "above 0" if lower > 0 else "including 0")
        s = (f"- {name(g)}: on the new queries alone, d(exact - guess) is {_num(-nq['mean_d'])} "
             f"{_ci_fine([-nq['ci95'][1], -nq['ci95'][0]])} (n {nq['n']}, p {_p(nq.get('p'))}), its 95% interval {where}")
        if sh.get("estimable"):
            s += f"; the guess keeps {sh['share']:.2f} [{sh['ci90'][0]:.2f}, {sh['ci90'][1]:.2f}] of the gain there"
        else:
            s += f"; its share of the gain there is not estimable ({sh.get('reason')})"
        rw = m["retention"][g].get("reweighted_new") or {}
        if rw.get("estimate") is not None:
            s += (f"; reweighted to E1's query lengths, d(guess - exact) is {_num(rw['estimate'])} "
                  f"{_ci(rw.get('ci95'))}")
        out.append(s + ".")
    if out:
        e1 = [(g, m["retention"][g].get("by_stratum", {}).get("e1") or {}) for g in r["retention"]]
        e1_txt = ", ".join(f"{name(g)} {_num(x.get('mean_d'))} (n {x.get('n')})" for g, x in e1 if x.get("n"))
        out.append("- The pooled readings in the table are the planned ones. They partly rest on E1's queries, where arm 9 "
                   "was followed up because it passed, so its gain there may be overstated"
                   + (f" (d(guess - exact) on E1's queries: {e1_txt})" if e1_txt else "") + ".")
        out.append("")
    return out


def against_data(res: dict) -> list[str]:
    """After the plan's lines for a guess that loses the gain: what the measured numbers add (the guess's own tests,
    its share kept on the new queries, the ladder), and the tool's label words, a copy decision made after the
    results. The statistical readings stay the plan's."""
    r, m = res["main"]["readings"], res["main"]["planned"]
    if not r.get("gate_passed"):
        return []
    losing = [g for g, x in r["meaning"].items() if x.get("case") == "loses the gain"]
    if not losing:
        return []
    delta, alpha = res["settings"]["delta"], res["settings"].get("alpha", 0.05)
    fam = {(c["arm"], c["ref"]): c for c in m["family"]}
    out = ["### Reading these lines against the data", "",
           "The lines above are the plan's text for a guess that loses the gain. They call keyword inputs untested and "
           "say the gain needs most of the reader's words. The measured numbers add this:", ""]
    for g in losing:
        vo, vp = fam[(g, "original")], fam[(g, "9P")]
        if vo["label"] in HELPS_LABELS and vp["label"] in HELPS_LABELS:
            verb = "did help, Holm-significant against both references"
        elif vo["label"] == NO_EFFECT and vp["label"] == NO_EFFECT:
            verb = f"showed no effect larger than {delta:.2f}"
        else:
            verb = "gave mixed results"
        line = (f"- {name(g).capitalize()} {verb} (against the unedited page: {label_text(vo['label'], delta)}, "
                f"d {_num(vo['mean_d'])}, Holm p {_p(vo['p_holm'])}; against a section without the reader's words: "
                f"{label_text(vp['label'], delta)}, d {_num(vp['mean_d'])}, Holm p {_p(vp['p_holm'])})")
        carried = [(ref, carried_by(c, alpha)) for ref, c in (("the unedited page", vo), ("the words-free section", vp))]
        carried = [f"against {ref} the label rests mainly on {JUDGE_NAMES.get(j, j)}" for ref, j in carried if j]
        if carried:
            line += "; " + "; ".join(carried)
        sh = (res["main"].get("share_kept_new") or {}).get(g) or {}
        if sh.get("estimable"):
            line += (f"; on the new queries it kept {sh['share']:.2f}{_fraction_words(sh['share'])} of the exact "
                     f"question's gain (90% CI {sh['ci90'][0]:.2f} to {sh['ci90'][1]:.2f})")
        out.append(line + ".")
    rep = {(c["arm"], c["ref"], c["scope"]): c for c in res["main"].get("reported", [])}
    echo, words = rep.get(("9", "9A", "pooled")), rep.get(("9A", "9K", "pooled"))
    if echo and words and echo.get("n") and words.get("n") and echo.get("p") is not None and words.get("p") is not None:
        tracks = echo["p"] < alpha <= words["p"]
        out += ["", ("The shortfall tracks the exact query string, which the judge's prompt also shows, rather than the "
                     "words the keyword drops. " if tracks else "The ladder of reader words: ")
                + f"The exact question vs all the reader's key words gives d {_num(echo['mean_d'])} {_ci(echo['ci95'])} "
                f"(p {_p(echo['p'])}, {echo['n']} queries); all the key words vs the keyword's two words gives d "
                f"{_num(words['mean_d'])} {_ci(words['ci95'])} (p {_p(words['p'])}"
                + (", not significant" if words["p"] >= alpha else "") + f", {words['n']} queries)."]
    copy = [f"{TOOL_COPY_INPUTS[g]} \"{TOOL_COPY_AFTER_RESULTS[g]}\"" for g in ("9K", "9L") if g in TOOL_COPY_AFTER_RESULTS]
    out += ["", "The tool therefore labels " + _series(copy) + ". Those label words are a copy decision made after the "
            "results and are recorded here as such; the statistical readings above are the plan's.", ""]
    return out


def amendment3(res: dict) -> list[str]:
    """PLAN_E5 amendment 3's sensitivity rows: the contrasts with a flagged version, without those queries."""
    a3 = res.get("amendment_3_sensitivity")
    if not a3:
        return []
    delta = res["settings"]["delta"]
    out = ["## Amendment 3 sensitivity: without the queries whose edit text is the reader's question", "",
           "PLAN_E5 amendment 3 keeps in, flagged, the versions whose edit text equals the reader's question q (ignoring "
           "case, spaces and a final question mark), and reports every page-question contrast, and every keyword or "
           "local-model contrast with such a version, also without those queries. These rows were left out of the first "
           "analysis by omission and added afterwards on the same snapshot of answers. They sit beside the planned "
           "results without a verdict of their own and change no planned label or reading.", ""]
    strata = {"e1": "E1's queries", "e3": "E3 five-page", "e3-four": "E3 four-page", "replication": "replication"}
    for set_name, title in (("main", "Main set"), ("replication", "Replication set")):
        fl = (a3.get("flagged") or {}).get(set_name) or {}
        parts = []
        for arm, x in fl.items():
            where = ", ".join(f"{strata.get(s, s)} {k}" for s, k in sorted(x.get("by_stratum", {}).items()))
            parts.append(f"{name(arm)} ({arm}) {x['n']}" + (f" ({where})" if x["n"] and set_name == "main" else ""))
        none = not any(x["n"] for x in fl.values())
        out += [f"{title}, flagged versions: " + ("none" if none else "; ".join(parts)) + ".", ""]
    block = a3.get("main") or {}
    if block.get("any_flagged"):
        rows = [[name(c["arm"]), name(c["ref"]), str(c["n_planned"]), str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]),
                 _ci(c["ci90"]), _p(c["p"]), _p(c.get("p_holm")), label_text(c["label_by_e1_rules"], delta),
                 label_text(c["planned_label"], delta)] for c in block["family"]]
        out += ["Main set, step 2's Holm family with each guess's flagged queries left out (Holm re-run over the four "
                "tests; the gate is unchanged, so E1's rules apply as planned):", ""]
        out += _table(["Edit", "Compared with", "Queries (planned)", "Queries without flagged", "d", "95% CI", "90% CI",
                       "p", "p (Holm)", "E1's rules would give", "Planned result"], rows)
        rows = []
        for g, x in block.get("readings", {}).items():
            rows.append([name(g), str(block["retention"][g]["n_planned"]), str(x["n"]), _num(x["d_G_minus_9"]),
                         _ci(x["ci90_G_minus_9"]), _num(x["d_9_minus_G"]), _ci(x["ci95_9_minus_G"]), x["reading"],
                         x["planned_reading"]])
        out += ["Retention without the flagged queries:", ""]
        out += _table(["Guess", "Queries (planned)", "Queries without flagged", "d(guess - exact)", "90% CI",
                       "d(exact - guess)", "95% CI", "Reading", "Planned reading"], rows)
        rows = []
        for key, title in (("share_kept_new", "new queries"), ("share_kept_e1", "E1's queries")):
            for g, x in (block.get(key) or {}).items():
                if g in ("strata", "caveat"):
                    continue
                share_txt = (f"{x['share']:.2f} [{x['ci90'][0]:.2f}, {x['ci90'][1]:.2f}]" if x["estimable"]
                             else f"not estimable ({x['reason']})")
                rows.append([title, name(g), str(x["n"]), share_txt, _brief(x["d_G_minus_9"])])
        if rows:
            out += ["Share of the exact question's gain kept, without the flagged queries:", ""]
            out += _table(["Queries", "Guess", "n", "Share kept (90% CI)", "d(guess - exact question)"], rows)
        rows = [[name(c["arm"]), name(c["ref"]), c["scope"], str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]), _p(c["p"])]
                for c in block.get("reported", [])]
        out += ["The page-question placebo without its flagged queries (no verdict, as planned):", ""]
        out += _table(["Edit", "Compared with", "Scope", "Queries", "d", "95% CI", "p"], rows)
        if block.get("splits"):
            out += splits(block["splits"], "Main set, without the flagged queries")
        ip = block.get("identical_prompts")
        if ip and ip.get("rows"):
            judges = list(res["settings"]["judges"])
            out += ["### Identical prompts: a measured within-run noise floor", "",
                    f"{ip['identical_versions']} of the {ip['flagged_9L']} flagged local-model versions are byte-identical "
                    "to the exact question's version, so their prompts are identical "
                    f"({ip['prompt_sets_identical']} of {ip['prompt_sets_compared']} prompt sets compared, one per query "
                    "and judge). They were answered in different batches of the one run, possibly on different GPU "
                    "types (the freeze log lists the run's). Cell difference: the local model's copy minus the exact "
                    "question's, per judge.", ""]
            rows = [[x["query_id"], STRATUM_NAMES.get(x["stratum"], x["stratum"]),
                     *[f"{x['cell_diff_9L_minus_9'][j]:+.5f}" if j in x["cell_diff_9L_minus_9"] else "n/a"
                       for j in judges], "n/a" if x["d"] is None else f"{x['d']:+.5f}"] for x in ip["rows"]]
            out += _table(["Query", "Stratum", *[JUDGE_NAMES.get(j, j) for j in judges], "d (mean over judges)"], rows)
            d = ip["d_9L_minus_9"]
            out += [f"{ip['cells_differ']} of {ip['cells']} judge cells differ ("
                    + ", ".join(f"{JUDGE_NAMES.get(j, j)} {x['differ']} of {x['cells']}" for j, x in ip["per_judge"].items())
                    + f"; {ip['differing_lower_on_9L']} lower and {ip['differing_higher_on_9L']} higher on the local "
                    f"model's copy; mean absolute cell difference {ip['mean_abs_cell_diff']:.4f}, largest "
                    f"{ip['max_abs_cell_diff']:.4f}). Mean per-query difference {d['mean_d']:+.5f} over {d['n']} "
                    f"queries (exact sign-flip p {_p(d.get('p'))}; too few queries for a bootstrap interval).", ""]
    rep = a3.get("replication") or {}
    if not rep.get("any_flagged") and rep.get("unchanged"):
        out += [f"Replication set: {rep['unchanged']}.", ""]
    out += [("Every planned label and reading is unchanged without the flagged queries."
             if a3.get("every_label_unchanged") else
             "Without the flagged queries these would read differently: " + ", ".join(a3.get("changed", []))
             + ". The planned labels stand (amendment 3 makes these sensitivity reports)."), ""]
    return out


def _brief(x: dict | None) -> str:
    if not x or not x.get("n"):
        return "no query"
    return f"n {x['n']}, d {_num(x['mean_d'])} {_ci(x.get('ci95'))}"


def reported(res: dict) -> list[str]:
    legend = "; ".join(f"{k}: {v}" for k, v in NAMES.items())
    out = ["## Reported without a verdict", "",
           "These are shown for understanding and get no verdict; each gives its number of queries. Short labels in "
           f"the tables below: {legend}.", ""]
    for set_name, title in (("main", "Main set"), ("replication", "Replication set")):
        rows = [[name(c["arm"]), name(c["ref"]), c["scope"], str(c["n"]), _num(c["mean_d"]), _ci(c["ci95"]),
                 _p(c["p"]), flags(c)] for c in res[set_name]["reported"]]
        out += [f"### {title}: the ladder of reader words, the page-question placebo and the rewrite edits", "",
                "The ladder: all key words vs the keyword's two words shows the words the keyword drops; the exact "
                "question vs all key words shows the exact-string echo of the judge's prompt; the exact question vs "
                "the keyword's two words on the queries where both copy the same sentence differs only in the heading.",
                ""]
        out += _table(["Edit", "Compared with", "Scope", "Queries", "d", "95% CI", "p", "Judges and run"], rows)
    out += share(res)
    for set_name, title in (("main", "Main set"), ("replication", "Replication set")):
        out += length(res[set_name]["query_length"], title)
        out += splits(res[set_name]["splits"], title)
    out += per_judge_and_stratum(res)
    return out


def share(res: dict) -> list[str]:
    out = ["### Share of the exact question's gain each guess keeps", "",
           "(guess - section without the reader's words) / (exact question - section without the reader's words), "
           "on the same queries, with a bootstrap 90% interval. It is not estimable when the denominator's 95% interval "
           "includes 0 or more than 2.5% of resamples give a denominator at or below 0; then only d(guess - exact "
           "question) is given.", ""]
    rows = []
    for key, title in (("share_kept_new", "new queries"), ("share_kept_e1", "E1's queries")):
        block = res["main"][key]
        for g in ("9K", "9L"):
            x = block[g]
            share_txt = (f"{x['share']:.2f} [{x['ci90'][0]:.2f}, {x['ci90'][1]:.2f}]" if x["estimable"]
                         else f"not estimable ({x['reason']})")
            rows.append([title, name(g), str(x["n"]), share_txt, _brief(x["d_G_minus_9"])])
    out += _table(["Queries", "Guess", "n", "Share kept (90% CI)", "d(guess - exact question)"], rows)
    caveat = res["main"]["share_kept_e1"].get("caveat")
    if caveat:
        out += [caveat, ""]
    return out


def length(block: dict, title: str) -> list[str]:
    out = [f"### {title}: by the number of key words in the reader's question", "",
           "The keyword keeps min(1, 2/|K(q)|) of the reader's key words, which is set by query length, so this is a "
           "breakdown by query length, not a dose. Cells under 10 queries are merged.", ""]
    rows = [[" + ".join(c["levels"]), _brief(c["d_9K_minus_9"]), _brief(c["d_9_vs_original"])] for c in block["cells"]]
    return out + _table(["Key words in q", "d(keyword's two words - exact question)",
                         "d(exact question vs unedited page)"], rows)


def splits(block: dict, title: str) -> list[str]:
    out = [f"### {title}: kept keyword or template question, and pages the tool would flag", "",
           "The tool turns most keywords into headings unchanged (kept); a few become a template question. The last "
           "columns keep only the pages where the tool, given the keyword's question, would also suggest the edit "
           "(question coverage under 0.9).", ""]
    rows = []
    for g, x in block.items():
        row = [name(g), _brief(x["all"]), _brief(x["template_kept"]), _brief(x["template_question"]),
               _brief(x["tool_gate_given_q_prime"])]
        rows.append(row)
    out += _table(["Guess vs the unedited page", "All", "Kept keyword", "Template question", "Tool would suggest it"],
                  rows)
    lq = block.get("9L", {}).get("tool_gate_given_q_L")
    if lq:
        out += [f"For the local model's question itself as the tool's input: {_brief(lq)}.", ""]
    return out


def per_judge_and_stratum(res: dict) -> list[str]:
    m = res["main"]["planned"]
    planned = [("gate", m["gate"]), *[("step 2", c) for c in m["family"]],
               *[("retention", c) for c in m["retention"].values()], ("step 4", m["arm12"]),
               ("12K vs original", m["arm12_vs_original"]), ("step 5", m["step5"])]
    judges = list(res["settings"]["judges"])
    out = ["### Planned contrasts per judge, per stratum and reweighted", "",
           "Per judge: each judge's mean d on the contrast's queries (for a contrast run on Gemma alone, Qwen's own "
           "complete queries, secondary). Per stratum: E1's queries, E3's five-page and four-page queries. "
           "Reweighted: the new-query estimate with E1's mix of query lengths.", ""]
    rows = []
    for step, c in planned:
        pj = []
        for j in judges:
            x = c["per_judge"].get(j) or (c.get("secondary") or {}).get(j)
            tag = "" if j in c["per_judge"] else " (secondary)"
            pj.append((_brief(x) + tag) if x else "n/a")
        st = [_brief(c.get("by_stratum", {}).get(s)) for s in ("e1", "e3", "e3-four")]
        rw = c.get("reweighted_new") or {}
        rw_txt = "n/a" if rw.get("estimate") is None else f"{_num(rw['estimate'])} {_ci(rw.get('ci95'))} (n {rw['n']})"
        rows.append([step, contrast_name(c), *pj, *st, rw_txt])
    out += _table(["Step", "Contrast", *[JUDGE_NAMES.get(j, j) for j in judges],
                   *[STRATUM_NAMES[s] for s in ("e1", "e3", "e3-four")], "New, reweighted to E1"], rows)
    rows = [[step, contrast_name(c), c.get("confound_note") or "n/a",
             _num((c.get("confound") or {}).get("intercept")), _ci((c.get("confound") or {}).get("ci95"))]
            for step, c in planned if step in ("gate", "step 2", "step 4", "step 5")]
    out += ["E1's length and key-term regression per planned test (the intercept is the effect at no change in length "
            "or key-term count):", ""]
    out += _table(["Step", "Contrast", "Note", "Intercept", "95% CI"], rows)
    return out


TOOL_FLAG_NAMES = {"tool_covers_edit_text": "covers the edit text", "tool_covers_q": "covers q",
                   "tool_gate": "would suggest the edit"}


def _share(x: dict) -> str:
    return f"{x['share']:.0%} ({x['true']} of {x['of']})"


def validity(res: dict) -> list[str]:
    out = ["## Edits that passed validation", "",
           "Not applicable: the edit does not apply to the page by E1's rule (the page already answers the reader's "
           "true question; for a guess, also when its heading is the page's first heading already or, for the page "
           "question, when the tool finds none), or the editor found nothing to change. Valid: the edit passed E1's "
           "checks. Length ratio and key-term change are the means over valid edits (the change counts the reader's "
           "key words). The tool columns give the share of valid edits the current tool marks as covering the edit's "
           "own text, as covering the reader's question q, and (for the heading edits, judged on the unedited page) "
           "as a page where it would suggest the edit.", ""]
    for set_name, title in (("main", "Main set"), ("replication", "Replication set")):
        rows = []
        for arm, e in res["validity"][set_name].get("all", {}).items():
            tool = e["tool_flags"]
            rows.append([f"{name(arm)} ({arm})", str(e["queries"]), str(e["not_applicable"]), str(e["applicable"]),
                         str(e["valid"]), str(e["failed_validation"]), _num(e["mean_length_ratio"], False),
                         _num(e["mean_key_terms_delta"]),
                         str(e["same_sentence_as_9"]) if arm in GUESS_FAMILY else "n/a",
                         *[_share(tool[k]) if k in tool else "n/a" for k in TOOL_FLAG_NAMES],
                         str(e["from_earlier_run"])])
        out += [f"{title}:", ""]
        out += _table(["Version", "Queries", "Not applicable", "Applicable", "Valid", "Failed validation",
                       "Length ratio", "Key-term change", "Same sentence as 9",
                       *[f"Tool: {t}" for t in TOOL_FLAG_NAMES.values()], "From an earlier run"], rows)
        for key, text in (("not_applicable_by_reason", "Not applicable, most common reasons"),
                          ("failed_by_reason", "Most common reasons for failing validation")):
            reasons = [f"{arm}: {reason} ({n})" for arm, e in res["validity"][set_name].get("all", {}).items()
                       for reason, n in list(e[key].items())[:3]]
            if reasons:
                out += [f"{text}: " + "; ".join(reasons) + ".", ""]
        pending = [f"{arm} {e['applicable_without_a_version']}" for arm, e in res["validity"][set_name].get("all", {}).items()
                   if e.get("applicable_without_a_version")]
        if pending:
            out += ["Applicable but with no version in the snapshot: " + ", ".join(pending) + ".", ""]
    return out


def drift(res: dict) -> list[str]:
    d = res["drift"]
    out = ["## Drift check", "",
           "E5 answered the unedited page and the exact-question edit again. Here each is compared with the earlier "
           "runs' answers to the same prompts (E1, E3): E5 cell minus earlier cell for the same query, version and "
           "judge, averaged per query, with a 95% interval.", ""]
    rows = [["All", str(d["overall"]["n_queries"]), str(d["overall"]["n_cells"]), _num(d["overall"]["mean"]),
             _ci(d["overall"]["ci95"])]]
    runs = {"e1": "against E1", "e3": "against E3"}
    for group, names in (("per_judge", JUDGE_NAMES), ("per_version", NAMES), ("per_set", {}), ("per_run", runs)):
        for k, x in d.get(group, {}).items():
            rows.append([names.get(k, k), str(x["n_queries"]), str(x["n_cells"]), _num(x["mean"]), _ci(x["ci95"])])
    out += _table(["Group", "Queries", "Cells", "Mean difference", "95% CI"], rows)
    if d["overall"]["n_queries"]:
        out += [("The interval excludes 0: the runs differ, so contrasts that use earlier answers (marked cross-run) "
                 "should be read with care." if d["excludes_0"] else
                 "The interval includes 0: no shift between runs is detected."), ""]
    return out


def null_line(null: dict | None) -> list[str]:
    if not null:
        return []
    s, fam = null["structure"], null["family_if_never_gated"]["holm"]
    return ["## Null simulation", "",
            f"With version labels shuffled within each query ({null['sims']} simulations, no true effect), the gate "
            f"alone was significant in {s['gate_significant']['rate']:.1%} of simulations, its own 5% level: a gate "
            "that passes is a significant gate, so the gate plus the family can never exceed the gate's rate. The "
            "family's own protection: the four guess tests with Holm's correction gave a false positive in "
            f"{fam['rate']:.1%} of simulations (Monte Carlo SE {fam['mc_se']:.1%}) if they were never gated, and in "
            f"{s['family_significant_after_gate']['rate']:.1%} after the gate passed; the replication family in "
            f"{null['replication_family']['holm']['rate']:.1%}.", ""]


def runs_line(res: dict) -> list[str]:
    m, rep = res["main"]["planned"], res["replication"]["planned"]
    allc = [m["gate"], *m["family"], m["arm12"], m["step5"], *rep["family"]]
    single = [contrast_name(c) for c in allc if c.get("single_model")]
    cross = [contrast_name(c) for c in allc if c.get("cross_run")]
    out = []
    if single:
        out.append("Planned contrasts on Gemma alone (Qwen's cells were not complete for every query): "
                   + ", ".join(dict.fromkeys(single)) + ".")
    if cross:
        out.append("Planned contrasts that use an earlier run's answers for some queries (cross-run): "
                   + ", ".join(dict.fromkeys(cross)) + ".")
    return out + [""] if out else []


def render(res: dict, null: dict | None = None) -> str:
    lines = (intro(res) + planned(res) + runs_line(res) + readings(res) + amendment3(res) + reported(res)
             + validity(res) + drift(res))
    lines += null_line(null)
    lines += ["E1 to E3's published results stay as they are; the tool's reader's-words label follows step 5, by "
              "E1's rule table.", "", CAVEAT, ""]
    return "\n".join(lines)


def sensitivity_rows(res: dict, row) -> list[dict]:
    """Amendment 3's rows and the added analyses as extra contrast rows (E5Row keys, their own step, no verdict)."""
    rows = []
    a3 = res.get("amendment_3_sensitivity") or {}
    for set_name in ("main", "replication"):
        block = a3.get(set_name) or {}
        for c in block.get("family", []):
            k = len(c.get("left_out", []))
            scope = (f"pooled, without the {k} flagged {c['arm']} queries" if k else
                     f"pooled, no flagged {c['arm']} query (Holm re-run with the other tests)")
            rows.append(row(c, set_name, A3_STEP, scope))
        for g, c in (block.get("retention") or {}).items():
            k = len(c.get("left_out", []))
            if k:
                rows.append(row(c, set_name, A3_STEP, f"retention, without the {k} flagged {g} queries"))
        rows += [row(c, set_name, A3_STEP) for c in block.get("reported", [])]
        ip = block.get("identical_prompts")
        if ip and ip.get("identical_versions"):
            d = ip["d_9L_minus_9"]
            rows.append({"contrast": "9L vs 9", "arm": "9L", "ref": "9", "set": set_name, "step": A3_STEP,
                         "scope": "identical prompts: flagged 9L versions byte-identical to arm 9's (noise floor)",
                         "n": d["n"], "d": d["mean_d"], "ci95": d["ci95"], "ci90": d["ci90"], "p": d["p"],
                         "p_holm": None, "label": REPORTED, "single_model": False, "cross_run": False, "mde": None})
    add = (res.get("added_analyses") or {}).get("gate_without_near_duplicates")
    if add and add.get("left_out"):
        ids = ", ".join(x["query_id"] for x in add["left_out"])
        rows.append({"contrast": "9 vs original", "arm": "9", "ref": "original", "set": "main", "step": ADDED_STEP,
                     "scope": f"new queries without {ids} (shares pages with an E1 query)", "n": add["n"],
                     "d": add["mean_d"], "ci95": add["ci95"], "ci90": add["ci90"], "p": add.get("p"), "p_holm": None,
                     "label": REPORTED, "single_model": bool(res["main"]["planned"]["gate"].get("single_model")),
                     "cross_run": bool(res["main"]["planned"]["gate"].get("cross_run")), "mde": add.get("mde")})
    return rows


def summary(res: dict) -> dict:
    """e5_results.json: one row per planned and reported contrast, plus the readings."""
    def row(c, set_name, step, scope=None):
        return {"contrast": contrast_name(c), "arm": c["arm"], "ref": c["ref"], "set": set_name, "step": step,
                "scope": scope or c.get("scope") or "pooled", "n": c["n"], "d": c["mean_d"], "ci95": c["ci95"],
                "ci90": c["ci90"], "p": c["p"], "p_holm": c.get("p_holm"), "label": c["label"],
                "single_model": bool(c.get("single_model")), "cross_run": bool(c.get("cross_run")),
                "mde": c.get("mde")}

    m, rep = res["main"]["planned"], res["replication"]["planned"]
    rows = [row(m["gate"], "main", "gate", "new queries")]
    rows += [row(c, "main", "family") for c in m["family"]]
    rows += [row(c, "main", "retention") for c in m["retention"].values()]
    rows += [row(m["arm12"], "main", "arm12"), row(m["arm12_vs_original"], "main", "arm12 rule"),
             row(m["step5"], "main", "step5", "all main queries")]
    rows += [row(c, "replication", "family") for c in rep["family"]]
    for set_name in ("main", "replication"):
        rows += [row(c, set_name, "reported") for c in res[set_name]["reported"]]
    rows += sensitivity_rows(res, row)
    r = res["main"]["readings"]
    return {
        "experiment": "E5", "snapshot_started_at": (res.get("snapshot") or {}).get("started_at"),
        "secondary": bool(res.get("secondary")),
        "readings": {"gate_passed": r["gate_passed"], "gate_label": r["gate_label"],
                     "retention": {g: x["reading"] for g, x in r["retention"].items()},
                     "missing_words_measured": r["missing_words"]["measured"],
                     "missing_words_rests_on_e1_note": bool(r["missing_words"].get("rests_on_e1_note")),
                     "readers_words_label": r["readers_words_label"]["label"],
                     "readers_words_tool_action": r["readers_words_label"]["tool_action"],
                     "meaning": r["meaning"]},
        "drift": {"mean": res["drift"]["overall"]["mean"], "ci95": res["drift"]["overall"]["ci95"],
                  "n_queries": res["drift"]["overall"]["n_queries"]},
        "contrasts": rows,
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(E5_DIR / "out"))
    ap.add_argument("--secondary", action="store_true", help="report DIR/analysis_e5_secondary.json")
    ap.add_argument("--analysis", help="analysis JSON (default DIR/analysis_e5.json, or the secondary one)")
    ap.add_argument("--null", help="null simulation JSON (default DIR/null_simulation_e5.json, else the frozen copy "
                                   "experiments/e5/freeze/null_simulation_e5.json)")
    args = ap.parse_args(argv)
    out = Path(args.out)
    default = out / ("analysis_e5_secondary.json" if args.secondary else "analysis_e5.json")
    res = json.loads(Path(args.analysis or default).read_text(encoding="utf-8"))
    if args.null:
        null_path = Path(args.null)
    else:
        null_path = next((p for p in (out / "null_simulation_e5.json", E5_DIR / "freeze" / "null_simulation_e5.json")
                          if p.exists()), out / "null_simulation_e5.json")
    null = json.loads(null_path.read_text(encoding="utf-8")) if null_path.exists() else None
    suffix = "_secondary" if res.get("secondary") else ""
    text = render(res, null)
    (out / f"RESULTS_E5{suffix}.md").write_text(text, encoding="utf-8")
    write_json(out / f"e5_results{suffix}.json", summary(res))
    print(f"report_e5: wrote {out / f'RESULTS_E5{suffix}.md'} and {out / f'e5_results{suffix}.json'}")


if __name__ == "__main__":
    main()
