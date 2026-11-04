"""Tests for report_e5.py (RESULTS_E5.md and e5_results.json) and simulate_null_e5.py.

Run: python3 -I -m unittest discover -s experiments/e5/tests
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
E1 = E5.parent / "e1"
for p in (E5, E1):
    sys.path.insert(0, str(p))

import analyze_e5 as a5  # noqa: E402
import report_e5 as r5  # noqa: E402
import simulate_null_e5 as s5  # noqa: E402
from e1_common import CAVEAT, write_json  # noqa: E402

FAST = {"draws": 2000, "resamples": 500}
ROW_KEYS = {"contrast", "set", "n", "d", "ci95", "ci90", "p", "p_holm", "label", "single_model", "cross_run"}


def analysis(effects, **kw):
    inp = s5.synthetic_e5(effects=effects, **({"seed": 7, "answer_sd": 0.2, "all_valid": True} | kw))
    return a5.analyze(inp, **FAST)


class Report(unittest.TestCase):
    def setUp(self):
        self.res = analysis({"9": 0.08, "9K": 0.08}, with_earlier=True, e1_arm12_earlier=True)

    def test_plain_language_rules(self):
        text = r5.render(self.res)
        self.assertNotIn("—", text)  # no em dash
        self.assertNotIn("contradict", text.lower())
        self.assertTrue(text.rstrip().endswith(CAVEAT))
        for phrase in ("the reader's exact question", "a keyword's two words",
                       "a question a local model wrote from the keyword", "a section without the reader's words"):
            self.assertIn(phrase, text)
        order = [text.index(h) for h in ("# E5 results", "## Planned results", "## What the results mean",
                                         "## Reported without a verdict", "## Edits that passed validation",
                                         "## Drift check")]
        self.assertEqual(order, sorted(order))

    def test_gate_failed_wording(self):
        text = r5.render(analysis({"9K": 0.08}))
        self.assertIn("no verdict (the gate did not pass)", text)
        self.assertIn("did not pass, so the four guess tests are descriptive", text)

    def test_flags_in_the_tables(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True)
        victim = next(c for c in inp.cells if c["arm"] == "9K" and c["judge"] == a5.JUDGE_ORDER[1])
        victim["n_answers"] = 7
        text = r5.render(a5.analyze(inp, **FAST))
        self.assertIn("Gemma only", text)
        self.assertIn("Planned contrasts on Gemma alone", text)

    def test_a_missing_words_label_resting_on_e1s_note_is_said(self):
        res = json.loads(json.dumps(self.res))
        res["main"]["readings"]["missing_words"] = a5.missing_words({"label": a5.an.HELPS_CONFOUNDED}, {"mean_d": 0.01})
        text = r5.render(res)
        self.assertIn("The label rests on counting E1's note as helps", text)
        self.assertNotIn("—", text)
        self.assertTrue(r5.summary(res)["readings"]["missing_words_rests_on_e1_note"])
        self.assertIs(r5.summary(self.res)["readings"]["missing_words_rests_on_e1_note"],
                      self.res["main"]["readings"]["missing_words"]["rests_on_e1_note"])

    def test_summary_rows(self):
        s = r5.summary(self.res)
        self.assertTrue(all(ROW_KEYS <= set(r) for r in s["contrasts"]))
        steps = [r["step"] for r in s["contrasts"]]
        self.assertEqual(steps.count("gate"), 1)
        self.assertEqual(steps.count("family"), 8)  # four main, four replication
        self.assertEqual(s["readings"]["retention"].keys(), {"9K", "9L"})
        json.dumps(s)

    def test_main_writes_both_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            write_json(out / "analysis_e5.json", self.res)
            write_json(out / "null_simulation_e5.json", {
                "sims": 10, "structure": {"familywise_false_positive_rate": 0.05, "mc_se": 0.01,
                                          "gate_significant": {"rate": 0.05}, "family_significant_after_gate": {"rate": 0.003}},
                "family_if_never_gated": {"holm": {"rate": 0.052, "mc_se": 0.007}},
                "replication_family": {"holm": {"rate": 0.04}}})
            with contextlib.redirect_stdout(io.StringIO()):
                r5.main(["--out", str(out)])
            text = (out / "RESULTS_E5.md").read_text()
            self.assertIn("## Null simulation", text)
            # The headline is the gate's own rate; the family's protection is stated separately (review M1).
            self.assertIn("the gate alone was significant in 5.0% of simulations", text)
            self.assertIn("5.2% of simulations (Monte Carlo SE 0.7%) if they were never gated", text)
            self.assertIn("0.3% after the gate passed", text)
            rows = json.loads((out / "e5_results.json").read_text())["contrasts"]
            self.assertTrue(rows)

    def test_secondary_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            write_json(out / "analysis_e5_secondary.json", self.res | {"secondary": True})
            with contextlib.redirect_stdout(io.StringIO()):
                r5.main(["--out", str(out), "--secondary", "--null", str(out / "none.json")])
            self.assertIn("secondary run", (out / "RESULTS_E5_secondary.md").read_text())
            self.assertTrue(json.loads((out / "e5_results_secondary.json").read_text())["secondary"])
            self.assertFalse((out / "RESULTS_E5.md").exists())

    def test_cross_run_flags_name_the_sources(self):
        c = {"single_model": False, "cross_run": True,
             "sources": {"within_e5": 5, "mixed": 2, "earlier_one_run": 3, "earlier_two_runs": 0}}
        self.assertEqual(r5.flags(c), "cross-run (2 with one version from an earlier run, 3 both from one earlier run)")

    def test_validity_table_gives_not_applicable_counts_and_tool_shares(self):
        text = "\n".join(r5.validity(self.res))
        self.assertIn("Tool: covers q", text)
        v = self.res["validity"]["main"]["all"]["9K"]
        self.assertIn("not_applicable_by_reason", v)
        self.assertTrue(all(set(x) == {"true", "of", "share"} for x in v["tool_flags"].values()))


E5ROW_KEYS = ROW_KEYS | {"arm", "ref", "step", "scope", "mde"}  # packages/engine/src/e5.ts E5Row, key for key


class Amendment3Report(unittest.TestCase):
    """The amendment-3 section, the wording fixes and the extra e5_results.json rows."""

    @classmethod
    def setUpClass(cls):
        inp = s5.synthetic_e5(effects={"9": 0.08, "9K": 0.04}, seed=7, answer_sd=0.2, all_valid=True)
        flagged = {"geo-test-0", "geo-test-1", "geo-test-1000"}
        for v in inp.versions:
            if v["arm"] in ("9L", "9G") and v["query_id"] in flagged:
                v["edit_text_is_q"] = True
        cls.res = a5.analyze(inp, **FAST)
        cls.text = r5.render(cls.res)

    def test_the_section_sits_between_the_readings_and_the_reported_items(self):
        t = self.text
        heads = ["## What the results mean", "## Amendment 3 sensitivity", "## Reported without a verdict"]
        self.assertEqual([t.index(h) for h in heads], sorted(t.index(h) for h in heads))
        self.assertIn("left out of the first analysis by omission", t)
        self.assertIn("Replication set, flagged versions: none.", t)
        self.assertIn("E1's rules would give", t)
        unchanged = self.res["amendment_3_sensitivity"]["every_label_unchanged"]
        self.assertEqual("Every planned label and reading is unchanged without the flagged queries." in t, unchanged)
        self.assertNotIn("—", t)

    def test_wording_fixes(self):
        t = self.text
        self.assertNotIn("differ only in the heading's words", t)
        self.assertIn("so the copied sentence can differ between versions as well as the heading", t)
        n5 = self.res["main"]["planned"]["step5"]["n"]
        self.assertIn(f"| 5: every main query with a valid arm 9 ({n5}) |", t)
        self.assertIn("on the new queries alone, d(exact - guess)", t)
        self.assertIn("where arm 9 was followed up because it passed", t)

    def test_the_plans_lines_stay_and_the_data_reading_follows_them(self):
        r = self.res["main"]["readings"]
        losing = [g for g, x in r["meaning"].items() if x["case"] == "loses the gain"]
        self.assertTrue(r["gate_passed"] and losing)
        t = self.text
        for g in losing:
            self.assertIn(r["meaning"][g]["tool"], t)  # the plan's text, verbatim
        self.assertLess(t.index(r["meaning"][losing[0]]["paper"]), t.index("### Reading these lines against the data"))
        self.assertIn("a copy decision made after the results", t)
        self.assertIn('"May help less"', t)
        self.assertIn("the statistical readings above are the plan's", t)
        gate_failed = r5.render(a5.analyze(s5.synthetic_e5(effects={"9K": 0.08}, seed=7, answer_sd=0.2,
                                                          all_valid=True), **FAST))
        self.assertNotIn("### Reading these lines against the data", gate_failed)

    def test_a_helps_label_carried_by_one_judge_is_said(self):
        res = json.loads(json.dumps(self.res))
        c = next(c for c in res["main"]["planned"]["family"] if c["label"] in r5.HELPS_LABELS)
        gemma, qwen = res["settings"]["judges"]
        c["per_judge"][gemma]["p"], c["per_judge"][qwen]["p"] = 0.2, 0.001
        c["per_judge"][qwen]["mean_d"] = abs(c["per_judge"][qwen]["mean_d"]) or 0.01
        self.assertEqual(r5.carried_by(c), qwen)
        self.assertIn("the helps label rests mainly on Qwen3.8-27B, the second judge", r5.render(res))
        c["per_judge"][gemma]["p"] = 0.001
        self.assertIsNone(r5.carried_by(c))  # both judges significant: no clause

    def test_e5_results_keeps_the_tools_schema_and_adds_rows(self):
        s = r5.summary(self.res)
        self.assertEqual(set(s), {"experiment", "snapshot_started_at", "secondary", "readings", "drift", "contrasts"})
        self.assertTrue(all(set(r) == E5ROW_KEYS for r in s["contrasts"]))
        step5 = [r for r in s["contrasts"] if r["step"] == "step5"]
        self.assertEqual([r["scope"] for r in step5], ["all main queries"])  # the tool matches on this scope
        extra = [r for r in s["contrasts"] if r["step"] == r5.A3_STEP]
        self.assertTrue(extra)
        self.assertTrue(all(r["label"] == r5.REPORTED for r in extra))
        self.assertEqual({r["contrast"] for r in extra if r["scope"].startswith("pooled, without the")} >= {"9L vs original"},
                         True)
        json.dumps(s)

    def test_identical_prompts_and_near_duplicates_render(self):
        res = json.loads(json.dumps(self.res))
        res["added_analyses"]["gate_without_near_duplicates"]["left_out"] = [
            {"query_id": "geo-test-1000", "e1_query": "geo-test-0", "pages": 4, "pages_shared_with_e1_query": 3,
             "how": "test"}]
        ip = res["amendment_3_sensitivity"]["main"]["identical_prompts"]
        ip.update({"identical_versions": 1, "prompt_sets_compared": 2, "prompt_sets_identical": 2, "cells": 2,
                   "cells_differ": 1, "differing_lower_on_9L": 1, "differing_higher_on_9L": 0, "max_abs_cell_diff": 0.0625,
                   "mean_abs_cell_diff": 0.03125, "per_judge": {j: {"cells": 1, "differ": k, "mean": -0.0625 * k}
                                                                 for j, k in zip(res["settings"]["judges"], (1, 0))},
                   "rows": [{"query_id": "geo-test-0", "stratum": "e1", "same_prompts": {},
                             "cell_diff_9L_minus_9": dict(zip(res["settings"]["judges"], (-0.0625, 0.0))),
                             "d": -0.03125}],
                   "d_9L_minus_9": {"n": 1, "mean_d": -0.03125, "ci95": None, "ci90": None, "p": 1.0}})
        t = r5.render(res)
        self.assertIn("geo-test-1000 shares 3 of its 4 pages with E1's geo-test-0", t)
        self.assertIn("### Identical prompts: a measured within-run noise floor", t)
        self.assertIn("measured within-run noise floor for identical prompts", t)
        self.assertIn("| geo-test-0 | E1's queries | -0.06250 | +0.00000 | -0.03125 |", t)
        steps = {(r["step"], r["contrast"]) for r in r5.summary(res)["contrasts"]}
        self.assertIn((r5.ADDED_STEP, "9 vs original"), steps)
        self.assertIn((r5.A3_STEP, "9L vs 9"), steps)


class NullSimulation(unittest.TestCase):
    def test_familywise_rate_is_about_five_percent_and_reproducible(self):
        a = s5.simulate(sims=200, draws=2000, resamples=300, seed=1)
        b = s5.simulate(sims=200, draws=2000, resamples=300, seed=1)
        self.assertEqual(a, b)
        rate = a["structure"]["familywise_false_positive_rate"]
        self.assertGreaterEqual(rate, 0.01)
        self.assertLessEqual(rate, 0.10)
        self.assertLessEqual(a["family_if_never_gated"]["holm"]["rate"], 0.10)
        self.assertGreater(a["family_if_never_gated"]["unadjusted_any"]["rate"],
                           a["family_if_never_gated"]["holm"]["rate"])
        self.assertLessEqual(a["structure"]["gate_passed"]["rate"], a["structure"]["gate_significant"]["rate"])
        self.assertGreaterEqual(a["n_per_contrast"]["gate"], 30)
        self.assertEqual(a["structure_source"], "synthetic layout at the pre-run rates")

    def test_shuffle_keeps_each_querys_cells(self):
        inp = s5.synthetic_e5(seed=1, n_e1=3, n_e3=3, n_four=0, n_rep=2, all_valid=True)
        import numpy as np
        import simulate_null as sn
        shuffled = sn.shuffle_labels(inp.cells, np.random.default_rng(0))
        for q in {c["query_id"] for c in inp.cells}:
            before = sorted(c["score"] for c in inp.cells if c["query_id"] == q)
            after = sorted(c["score"] for c in shuffled if c["query_id"] == q)
            self.assertEqual(before, after)

    def test_synthetic_inputs_follow_the_contract(self):
        inp = s5.synthetic_e5(seed=1)
        et = inp.edit_texts[0]
        self.assertTrue({"query_id", "set", "stratum", "query", "key_terms", "n_key_terms", "k", "q_prime", "template",
                         "text_9A", "q_G", "q_L", "q_L_status"} <= set(et))
        self.assertEqual({r["set"] for r in inp.edit_texts}, {"main", "replication"})
        self.assertEqual({r["stratum"] for r in inp.edit_texts}, {"e1", "e3", "e3-four", "replication"})
        self.assertTrue({c["arm"] for c in inp.cells} <= set(a5.VERSIONS))
        v = next(v for v in inp.versions if v["arm"] == "9K")
        self.assertTrue({"edit_text", "same_sentence_as_9", "tool_gate", "valid", "length_ratio",
                         "key_terms_delta"} <= set(v))
        c = inp.cells[0]
        self.assertEqual(set(c), {"set", "query_id", "version_id", "arm", "judge", "n_answers", "n_valid", "valid_rate",
                                  "score", "cited", "pawc", "dropped"})


if __name__ == "__main__":
    unittest.main()
