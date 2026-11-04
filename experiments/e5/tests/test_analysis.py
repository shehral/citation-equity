"""Tests for analyze_e5.py on synthetic E5 inputs with known effects (experiments/PLAN_E5.md r2): each branch of
the plan's decision structure, the judge and cross-run rules, the reported items, and E1's statistics settings.

Run: python3 -I -m unittest discover -s experiments/e5/tests
"""

from __future__ import annotations

import contextlib
import dataclasses
import inspect
import io
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

import numpy as np

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
E1 = E5.parent / "e1"
for p in (E5, E1):
    sys.path.insert(0, str(p))

import analyze as an  # noqa: E402
import analyze_e5 as a5  # noqa: E402
import score as e1_score  # noqa: E402
import simulate_null_e5 as s5  # noqa: E402
from e1_common import JUDGE_ORDER, SEEDS, write_jsonl  # noqa: E402

N_SEEDS = len(SEEDS)

FAST = {"draws": 2000, "resamples": 500}
GEMMA, QWEN = JUDGE_ORDER
STRONG = 0.08


def run(effects=None, **kw):
    kw = {"seed": 7, "answer_sd": 0.2, "all_valid": True} | kw
    inp = s5.synthetic_e5(effects=effects or {}, **kw)
    return inp, a5.analyze(inp, **FAST)


def family(res, arm, ref, set_name="main"):
    return next(c for c in res[set_name]["planned"]["family"] if (c["arm"], c["ref"]) == (arm, ref))


def reported(res, arm, ref, scope="pooled", set_name="main"):
    return next(c for c in res[set_name]["reported"] if (c["arm"], c["ref"], c["scope"]) == (arm, ref, scope))


class GateAndFamily(unittest.TestCase):
    def test_gate_passes_and_the_family_carries_verdicts(self):
        _, res = run({"9": STRONG, "9K": STRONG})
        gate = res["main"]["planned"]["gate"]
        self.assertTrue(gate["passed"])
        self.assertIn(gate["label"], a5.HELPS)
        self.assertEqual(gate["n"], 180)  # the new queries only (e3 and e3-four)
        self.assertIn(family(res, "9K", "original")["label"], a5.HELPS)
        self.assertIn(family(res, "9K", "9P")["label"], a5.HELPS)
        self.assertNotIn(family(res, "9L", "original")["label"], a5.HELPS + (a5.GATE_FAILED,))
        self.assertEqual(res["main"]["readings"]["family_m"], 4)
        # Holm over four: the smallest p is multiplied by 4 (capped at 1).
        fam = res["main"]["planned"]["family"]
        smallest = min(fam, key=lambda c: c["p"])
        self.assertAlmostEqual(smallest["p_holm"], min(1.0, 4 * smallest["p"]))

    def test_gate_fails_and_the_family_is_descriptive(self):
        _, res = run({"9K": STRONG, "9L": STRONG})
        r = res["main"]["readings"]
        self.assertFalse(r["gate_passed"])
        for c in res["main"]["planned"]["family"]:
            self.assertEqual(c["label"], a5.GATE_FAILED)
            self.assertIsNotNone(c["p_holm"])  # the numbers are still reported
        for g in a5.GUESSES:
            self.assertEqual(r["retention"][g]["reading"], a5.GATE_FAILED)
        self.assertIn(r["gate_label"], (an.NO_EFFECT, "inconclusive"))
        self.assertEqual(r["meaning"]["9K"]["case"], "gate did not pass")
        self.assertIn("pooled estimate over the main queries with a valid arm 9 (step 5)", r["meaning"]["9K"]["tool"])
        self.assertIn("next to E1's result", r["meaning"]["9K"]["paper"])

    def test_a_gate_that_hurts_draws_no_reading_and_step_5_sets_the_label(self):
        _, res = run({"9": -STRONG})  # PLAN_E5 amendment 2
        r = res["main"]["readings"]
        self.assertEqual(r["gate_label"], "hurts")
        self.assertEqual(r["meaning"]["9K"]["case"], "gate did not pass")
        self.assertIn("No reading is drawn from the guesses (gate: hurts)", r["meaning"]["9K"]["paper"])
        self.assertIn("(step 5)", r["meaning"]["9K"]["tool"])
        self.assertTrue(all(c["label"] == a5.GATE_FAILED for c in res["main"]["planned"]["family"]))

    def test_replication_family_is_its_own_holm_family_without_a_gate(self):
        _, res = run({"9K": STRONG})
        fam = res["replication"]["planned"]["family"]
        self.assertEqual([(c["arm"], c["ref"]) for c in fam], a5.FAMILY)
        self.assertEqual(res["replication"]["readings"]["family_m"], 4)
        self.assertIn(family(res, "9K", "original", "replication")["label"], a5.HELPS)
        self.assertEqual(fam[0]["n"], 60)

    def test_step5_pools_every_main_query_and_sets_the_tool_action(self):
        _, res = run({"9": STRONG})
        s = res["main"]["planned"]["step5"]
        self.assertEqual(s["n"], 260)
        self.assertIn(s["label"], a5.HELPS)
        self.assertIn("measured label", res["main"]["readings"]["readers_words_label"]["tool_action"])
        self.assertIn("cumulative", res["main"]["readings"]["readers_words_label"]["note"])


class Retention(unittest.TestCase):
    def test_keeps_the_gain(self):
        _, res = run({"9": STRONG, "9K": STRONG}, answer_sd=0.15)
        x = res["main"]["readings"]["retention"]["9K"]
        self.assertEqual(x["reading"], "keeps the gain")
        self.assertGreater(x["ci90_G_minus_9"][0], -a5.MARGIN)
        self.assertIn("keyword", res["main"]["readings"]["meaning"]["9K"]["paper"])

    def test_loses_the_gain(self):
        _, res = run({"9": STRONG, "9L": 0.0})
        x = res["main"]["readings"]["retention"]["9L"]
        self.assertEqual(x["reading"], "loses the gain")
        self.assertGreater(x["ci95_9_minus_G"][0], 0)
        self.assertIn("Main limit", res["main"]["readings"]["meaning"]["9L"]["paper"])

    def _rec(self, label=None, **kw):
        base = {"status": "ok", "label": label, "n": 150, "mean_d": -0.01, "ci90": [-0.02, 0.0], "ci95": [-0.024, 0.004]}
        return base | kw

    def test_partly_kept_when_neither_rule_holds(self):
        x = a5.retention_reading(True, self._rec("helps"), self._rec("helps"), self._rec())
        self.assertEqual(x["reading"], "partly kept, unclear")  # 90% lower -0.02 < -0.015, 95% CI includes 0

    def test_keeps_needs_both_helps_labels(self):
        rec = self._rec(ci90=[-0.012, 0.0])
        self.assertEqual(a5.retention_reading(True, self._rec("helps"), self._rec("inconclusive"), rec)["reading"],
                         "partly kept, unclear")
        self.assertEqual(a5.retention_reading(True, self._rec(an.HELPS_CONFOUNDED), self._rec("helps"), rec)["reading"],
                         "keeps the gain")

    def test_keeps_comes_first_when_both_rules_hold_and_is_flagged(self):
        rec = self._rec(mean_d=-0.006, ci90=[-0.010, -0.002], ci95=[-0.011, -0.001])
        x = a5.retention_reading(True, self._rec("helps"), self._rec("helps"), rec)
        self.assertEqual(x["reading"], "keeps the gain")
        self.assertTrue(x["both_rules"])
        # Amendment 2: the report says the exact question did better, by less than the margin.
        self.assertIn("The exact question still did better, by less than 0.015", a5.meaning("helps", {"9K": x})["9K"]["paper"])

    def test_too_few_queries(self):
        x = a5.retention_reading(True, self._rec("helps"), self._rec("helps"), self._rec(status="insufficient n", n=12))
        self.assertEqual(x["reading"], "insufficient n")


class ShareKept(unittest.TestCase):
    def test_estimable_share(self):
        _, res = run({"9": STRONG, "9K": STRONG / 2}, answer_sd=0.15)
        x = res["main"]["share_kept_new"]["9K"]
        self.assertTrue(x["estimable"])
        self.assertAlmostEqual(x["share"], x["numerator"] / x["denominator"])
        self.assertLess(abs(x["share"] - 0.5), 0.3)
        self.assertLessEqual(x["ci90"][0], x["share"])
        self.assertGreaterEqual(x["ci90"][1], x["share"])
        self.assertIsNone(res["main"]["share_kept_new"]["caveat"])
        self.assertIn("followed up because it passed", res["main"]["share_kept_e1"]["caveat"])
        self.assertEqual(res["main"]["share_kept_e1"]["strata"], ["e1"])

    def test_not_estimable_when_the_denominator_can_be_zero(self):
        _, res = run({"9K": 0.03})
        x = res["main"]["share_kept_new"]["9K"]
        self.assertFalse(x["estimable"])
        self.assertIsNone(x["share"])
        self.assertIn("denominator", x["reason"])
        self.assertIsNotNone(x["d_G_minus_9"]["mean_d"])  # only d(G - 9) is given


class JudgesAndRuns(unittest.TestCase):
    def test_single_model_when_qwen_misses_one_query(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True)
        victim = next(c for c in inp.cells if c["arm"] == "9K" and c["judge"] == QWEN and c["query_id"].startswith("geo"))
        victim["n_answers"] = 7  # incomplete
        res = a5.analyze(inp, **FAST)
        c = family(res, "9K", "original")
        self.assertTrue(c["single_model"])
        self.assertEqual(c["judges"], [GEMMA])
        self.assertEqual(c["n"], 260)  # Gemma alone for all its queries
        self.assertIn(QWEN, c["secondary"])
        self.assertEqual(c["secondary"][QWEN]["n"], 259)
        self.assertFalse(family(res, "9L", "original")["single_model"])
        self.assertFalse(res["main"]["planned"]["gate"]["single_model"])

    def test_cross_run_fallback_for_incomplete_reference_cells(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, with_earlier=True)
        gone = {f"geo-test-{i}" for i in range(10)}
        inp.cells = [c for c in inp.cells if not (c["arm"] == "original" and c["query_id"] in gone)]
        res = a5.analyze(inp, **FAST)
        c = family(res, "9K", "original")
        self.assertTrue(c["cross_run"])
        self.assertEqual(c["sources"], {"within_e5": 250, "mixed": 10, "earlier_one_run": 0, "earlier_two_runs": 0})
        self.assertEqual(c["n"], 260)
        self.assertFalse(res["main"]["planned"]["gate"]["cross_run"])  # new queries untouched
        e5_only = a5.analyze(dataclasses.replace(inp, earlier_cells=[]), **FAST)
        c2 = family(e5_only, "9K", "original")
        self.assertFalse(c2["cross_run"])
        self.assertEqual(c2["n"], 250)  # without earlier cells those queries are left out

    def test_a_same_run_earlier_pair_is_preferred_to_a_mixed_pair(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, with_earlier=True)
        no_9 = {f"geo-test-{i}" for i in range(10)}  # E1 queries: E1 answered original and 9
        inp.cells = [c for c in inp.cells if not ((c["arm"] == "9" and c["query_id"] in no_9)
                                                  or (c["arm"] == "original" and c["query_id"] == "geo-test-20"))]
        ix = a5.E5Index(inp)
        e1q = ix.queries("main", ("e1",))
        r = a5.resolve(ix, "9", "original", e1q)
        self.assertEqual(r["sources"], {"within_e5": 69, "mixed": 0, "earlier_one_run": 11, "earlier_two_runs": 0})
        self.assertTrue(r["cross_run"])
        for q in [*sorted(no_9), "geo-test-20"]:  # both versions from E1, never E5's arm 9 against E1's original
            self.assertEqual(r["_src"][q], "earlier_one_run")
            want = np.mean([ix.cell(q, "9", j, "e1")["score"] - ix.cell(q, "original", j, "e1")["score"] for j in JUDGE_ORDER])
            self.assertAlmostEqual(r["d"][q], want)
        # 9 against 9P: no earlier run answered both (E1 has 9, E2a has 9P), so E5's 9P is kept (mixed) ...
        r = a5.resolve(ix, "9", "9P", e1q)
        self.assertEqual((r["sources"]["mixed"], r["sources"]["earlier_one_run"]), (10, 0))
        # ... and with E5's 9P gone too, the pair is from two earlier runs (counted apart from one-run pairs).
        inp.cells = [c for c in inp.cells if not (c["arm"] == "9P" and c["query_id"] in no_9)]
        r = a5.resolve(a5.E5Index(inp), "9", "9P", e1q)
        self.assertEqual(r["sources"], {"within_e5": 70, "mixed": 0, "earlier_one_run": 0, "earlier_two_runs": 10})
        res = a5.analyze(inp, **FAST)
        self.assertEqual(res["main"]["planned"]["step5"]["sources"]["earlier_one_run"], 11)

    def test_an_earlier_answer_to_a_different_version_text_or_prompt_is_left_out(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, with_earlier=True)
        gone = {"geo-test-0", "geo-test-1", "geo-test-2"}
        inp.cells = [c for c in inp.cells if not (c["arm"] == "original" and c["query_id"] in gone)]
        mine = next(v for v in inp.versions if v["query_id"] == "geo-test-1" and v["arm"] == "original")
        inp.earlier_versions = [
            {"query_id": "geo-test-0", "arm": "original", "set": "main", "run": "e1", "title": "", "text": "other"},
            {"query_id": "geo-test-1", "arm": "original", "set": "main", "run": "e1", "title": "", "text": mine["text"]}]
        inp.prompt_digests = {("e5", "geo-test-2", "original", j): "a" for j in JUDGE_ORDER} | {
            ("e1", "geo-test-2", "original", j): "b" for j in JUDGE_ORDER} | {
            ("e5", "geo-test-1", "original", j): "c" for j in JUDGE_ORDER} | {
            ("e1", "geo-test-1", "original", j): "c" for j in JUDGE_ORDER}
        ix = a5.E5Index(inp)
        check = ix.earlier_check
        self.assertEqual(check["left out: the earlier run answered a different version text"], 2)  # geo-test-0, 2 judges
        self.assertEqual(check["left out: the earlier run's prompts differ from E5's"], 2)  # geo-test-2
        self.assertEqual(check["same version text"], 2)  # geo-test-1
        self.assertEqual(check["same prompts"], 2)
        self.assertNotIn(("geo-test-0", "original", GEMMA), ix.earlier)
        r = a5.resolve(ix, "9K", "original", ix.queries("main", ("e1",)))
        self.assertNotIn("geo-test-0", r["d"])  # no E5 cells and no usable earlier cells: the query drops out
        self.assertNotIn("geo-test-2", r["d"])
        self.assertEqual(r["_src"]["geo-test-1"], "mixed")
        self.assertEqual(r["n_incomplete"], 2)

    def test_only_the_four_scored_sets_enter(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True)
        smoke = [c | {"set": "smoke", "run": "e1", "score": 0.0} for c in inp.cells if c["arm"] == "original"]
        inp.cells = [c for c in inp.cells if c["arm"] != "original" or c["query_id"] != "geo-test-0"]
        inp.cells.append(smoke[0] | {"run": None})
        ix = a5.E5Index(dataclasses.replace(inp, earlier_cells=smoke))
        self.assertEqual(ix.earlier, {})
        self.assertNotIn(("geo-test-0", "original", GEMMA), ix.e5)

    def test_earlier_versions_and_cells_serve_e1_arm12(self):
        _, res = run({}, e1_arm12_earlier=True)
        pooled, new = reported(res, "12", "P12"), reported(res, "12", "P12", "new queries")
        self.assertEqual(pooled["n"], 260)
        self.assertEqual(new["n"], 180)
        self.assertTrue(pooled["cross_run"])
        self.assertEqual(pooled["sources"]["earlier_one_run"], 80)  # E1's 12 and P12, both from E1
        self.assertFalse(new["cross_run"])
        self.assertEqual(reported(res, "12K", "12")["sources"]["mixed"], 80)

    def test_a_version_without_answers_is_not_run(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, effects={"9": STRONG})
        inp.cells = [c for c in inp.cells if c["arm"] != "9L"]
        res = a5.analyze(inp, **FAST)
        c = family(res, "9L", "original")
        self.assertEqual((c["status"], c["label"], c["single_model"], c["n"]), ("not run", "not run", False, 0))
        self.assertEqual(res["main"]["readings"]["family_m"], 2)  # Holm over the tests that ran
        self.assertEqual(res["main"]["readings"]["retention"]["9L"]["reading"], "not run")
        self.assertIn("no reading is drawn", res["main"]["readings"]["meaning"]["9L"]["tool"])

    def test_dropped_cells_leave_the_query_out(self):
        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True)
        victim = next(c for c in inp.cells if c["arm"] == "9" and c["judge"] == GEMMA and c["query_id"] == "geo-test-1000")
        victim["dropped"] = True
        res = a5.analyze(inp, **FAST)
        gate = res["main"]["planned"]["gate"]
        self.assertEqual((gate["n"], gate["dropped_cells"]), (179, 1))
        self.assertFalse(gate["single_model"])

    def test_drift_check(self):
        _, res = run({}, with_earlier=True, drift=0.06)
        d = res["drift"]
        self.assertAlmostEqual(d["overall"]["mean"], 0.06, delta=0.02)
        self.assertTrue(d["excludes_0"])
        self.assertEqual(set(d["per_judge"]), {GEMMA, QWEN})
        self.assertEqual(d["per_version"]["9"]["n_queries"], 140)  # E1's queries (main 80 + replication 60)
        self.assertEqual(d["per_version"]["original"]["n_queries"], 320)
        self.assertEqual({r: d["per_run"][r]["n_queries"] for r in d["per_run"]}, {"e1": 140, "e3": 180})
        _, res0 = run({}, with_earlier=True, drift=0.0)
        self.assertFalse(res0["drift"]["excludes_0"])


class Applicability(unittest.TestCase):
    def ix(self, appl, versions):
        texts = [{"query_id": "q1", "set": "main", "stratum": "e3", "n_key_terms": 4}]
        return a5.E5Index(a5.E5Inputs(edit_texts=texts, versions=versions, cells=[], applicability=appl))

    def v(self, arm, valid=True):
        return {"query_id": "q1", "arm": arm, "valid": valid, "set": "e3"}

    def test_a_guess_needs_its_own_row_and_arm_9s(self):
        vs = [self.v(a) for a in ("9", "9K", "9P", "12K", "P12K")]
        ix = self.ix([{"query_id": "q1", "arm": "9", "applicable": False}], vs)
        self.assertFalse(ix.usable("q1", "9K"))
        self.assertFalse(ix.usable("q1", "9P"))
        ix = self.ix([{"query_id": "q1", "arm": "9", "applicable": True},
                      {"query_id": "q1", "arm": "9K", "applicable": False}], vs)
        self.assertFalse(ix.usable("q1", "9K"))
        self.assertTrue(ix.usable("q1", "9P"))
        ix = self.ix([{"query_id": "q1", "arm": "12K", "applicable": False}], vs)
        self.assertFalse(ix.usable("q1", "P12K"))
        self.assertTrue(ix.usable("q1", "original") is False)  # no original version row: not usable

    def test_e3_applicability_is_never_a_fallback(self):
        texts = [{"query_id": "q1", "set": "main", "stratum": "e3", "n_key_terms": 4}]
        inp = a5.E5Inputs(edit_texts=texts, versions=[self.v("9")], cells=[], applicability=[],
                          e1_applicability=[{"query_id": "q1", "arm": "9", "applicable": False}])
        self.assertFalse(a5.E5Index(inp).usable("q1", "9"))  # E1's table is the only fallback
        load = inspect.getsource(a5.load_inputs)
        self.assertIn('if run == "e1"', load)

    def test_timing_and_refused_queries_never_enter(self):
        texts = [{"query_id": "t", "set": "timing", "stratum": "timing"},
                 {"query_id": "r", "set": "main", "stratum": "e1"}, {"query_id": "k", "set": "main", "stratum": "e1"}]
        ix = a5.E5Index(a5.E5Inputs(edit_texts=texts, versions=[], cells=[], refused=["r"]))
        self.assertEqual(ix.queries("main"), ["k"])


class Breakdowns(unittest.TestCase):
    def test_merged_length_cells(self):
        L = a5.LEVELS
        self.assertEqual(a5.merged_cells({L[0]: 3, L[1]: 20, L[2]: 15, L[3]: 8}), [[L[0], L[1]], [L[2], L[3]]])
        self.assertEqual(a5.merged_cells({L[0]: 12, L[1]: 5, L[2]: 30, L[3]: 30}), [[L[0]], [L[1], L[2]], [L[3]]])
        self.assertEqual(a5.merged_cells({L[0]: 1, L[1]: 1, L[2]: 1, L[3]: 1}), [list(L)])
        self.assertEqual(a5.merged_cells({lv: 10 for lv in L}), [[lv] for lv in L])

    def test_length_breakdown_cells_are_large_enough_and_share_queries(self):
        _, res = run({"9": STRONG})
        for set_name in ("main", "replication"):
            block = res[set_name]["query_length"]
            cells = block["cells"]
            self.assertEqual(sorted(lv for c in cells for lv in c["levels"]), sorted(a5.LEVELS))
            if len(cells) > 1:
                self.assertTrue(all(c["d_9K_minus_9"]["n"] >= a5.MERGE_BELOW for c in cells), set_name)
            self.assertEqual(sum(c["d_9K_minus_9"]["n"] for c in cells),
                             sum(block["level_counts"].values()))

    def test_reweighting_to_e1_levels(self):
        L = a5.LEVELS
        texts = ([{"query_id": f"a{i}", "set": "main", "stratum": "e1", "n_key_terms": 2} for i in range(3)]
                 + [{"query_id": "b0", "set": "main", "stratum": "e1", "n_key_terms": 5}]
                 + [{"query_id": f"n{i}", "set": "main", "stratum": "e3", "n_key_terms": 2 if i < 2 else 6}
                    for i in range(6)])
        ix = a5.E5Index(a5.E5Inputs(edit_texts=texts, versions=[], cells=[]))
        w = a5.e1_weights(ix)
        self.assertEqual(w, {L[0]: 0.75, L[1]: 0.0, L[2]: 0.0, L[3]: 0.25})
        d = {"n0": 0.1, "n1": 0.1, "n2": 0.0, "n3": 0.0, "n4": 0.0, "n5": 0.0, "a0": 9.0}
        out = a5.reweighted(ix, {"_d": d}, w, None, 200)
        self.assertEqual(out["n"], 6)  # new queries only
        self.assertAlmostEqual(out["estimate"], 0.75 * 0.1 + 0.25 * 0.0)
        self.assertAlmostEqual(out["unweighted"], 0.2 / 6)
        missing = a5.reweighted(ix, {"_d": {"n0": 0.1, "n1": 0.3}}, w, None, 200)
        self.assertEqual(missing["levels_missing"], [L[3]])
        self.assertAlmostEqual(missing["estimate"], 0.2)  # renormalized over the levels present

    def test_strata_and_per_judge(self):
        _, res = run({"9": {GEMMA: 0.10, QWEN: 0.04}})
        gate = res["main"]["planned"]["gate"]
        self.assertEqual({s: gate["by_stratum"][s]["n"] for s in a5.STRATA}, {"e1": 0, "e3": 72, "e3-four": 108})
        self.assertGreater(gate["per_judge"][GEMMA]["mean_d"], gate["per_judge"][QWEN]["mean_d"])
        self.assertIsNotNone(gate["per_judge"][GEMMA]["p"])
        s5_ = res["main"]["planned"]["step5"]
        self.assertEqual(sum(s5_["by_stratum"][s]["n"] for s in a5.STRATA), s5_["n"])
        self.assertIsNotNone(s5_["reweighted_new"]["estimate"])

    def test_template_and_tool_gate_splits(self):
        inp, res = run({"9K": STRONG})
        sp = res["main"]["splits"]["9K"]
        ix = a5.E5Index(inp)
        kept = sum(1 for q in ix.queries("main") if ix.info[q]["template"] == "kept")
        self.assertEqual(sp["template_kept"]["n"], kept)
        self.assertEqual(sp["template_kept"]["n"] + sp["template_question"]["n"], sp["all"]["n"])
        gated = sum(1 for q in ix.queries("main") if ix.version_field(q, "9K", "tool_gate") is True)
        self.assertEqual(sp["tool_gate_given_q_prime"]["n"], gated)
        self.assertIn("tool_gate_given_q_L", res["main"]["splits"]["9L"])

    def test_same_sentence_subset_and_ladder(self):
        inp, res = run({"9": STRONG})
        ix = a5.E5Index(inp)
        same = sum(1 for q in ix.queries("main") if ix.version_field(q, "9K", "same_sentence_as_9") is True)
        c = reported(res, "9", "9K", "same-sentence subset")
        self.assertEqual(c["n"], same)
        self.assertEqual(c["sources"]["within_e5"], same)
        for arm, ref in (("9A", "9K"), ("9", "9A"), ("9G", "original"), ("9K", "9G")):
            self.assertEqual(reported(res, arm, ref)["label"], a5.REPORTED)
        for scope in ("new queries", "pooled"):
            for arm, ref in (("12K", "original"), ("P12K", "original"), ("12K", "12"), ("12", "P12")):
                self.assertEqual(reported(res, arm, ref, scope)["p_holm"], None)

    def test_missing_words_rule(self):
        _, res = run({"12K": STRONG})
        r = res["main"]["readings"]
        self.assertIn(res["main"]["planned"]["arm12"]["label"], a5.HELPS)
        self.assertTrue(r["missing_words"]["measured"])
        _, res = run({"12K": -0.03, "P12K": -0.12})  # 12K beats its placebo, yet is below the unedited page
        self.assertIn(res["main"]["planned"]["arm12"]["label"], a5.HELPS)
        self.assertLess(res["main"]["planned"]["arm12_vs_original"]["mean_d"], 0)
        self.assertFalse(res["main"]["readings"]["missing_words"]["measured"])

    def test_missing_words_flags_a_label_that_rests_on_e1s_note(self):
        above, below = {"mean_d": 0.01}, {"mean_d": -0.01}
        plain = a5.missing_words({"label": "helps"}, above)
        self.assertTrue(plain["measured"])
        self.assertFalse(plain["rests_on_e1_note"])
        noted = a5.missing_words({"label": an.HELPS_CONFOUNDED}, above)  # README-analysis choice 1: counts as helps
        self.assertTrue(noted["measured"])
        self.assertTrue(noted["rests_on_e1_note"])
        self.assertIn("rests on counting E1's note as helps", noted["text"])
        self.assertEqual(noted["label_12K_vs_P12K"], an.HELPS_CONFOUNDED)
        for arm12, vs in (({"label": an.HELPS_CONFOUNDED}, below), ({"label": "inconclusive"}, above),
                          ({"label": "helps"}, {"mean_d": 0.0}), ({"label": "helps"}, {"mean_d": None})):
            r = a5.missing_words(arm12, vs)
            self.assertFalse(r["measured"])  # choice 4: above 0 is the mean d, strictly
            self.assertFalse(r["rests_on_e1_note"])
            self.assertNotIn("rests on", r["text"])

    def test_validity_counts_hide_page_words(self):
        self.assertEqual(a5.reason_key("invalid: Do not add facts that are not in the allowed sources: name 'Carol'"),
                         "invalid: Do not add facts that are not in the allowed sources")
        self.assertEqual(a5.reason_key("invalid: The expert-quotes check did not rise (0.500 -> 0.500). | x"),
                         "invalid: The expert-quotes check did not rise")
        self.assertEqual(a5.reason_key("not applicable: the editor returned NONE"),
                         "not applicable: the editor returned NONE")
        inp, res = run({}, seed=3, all_valid=False)
        v = res["validity"]["main"]["all"]["9K"]
        self.assertEqual(v["valid"] + v["failed_validation"], v["applicable"])
        self.assertIn("tool_gate", v["tool_flags"])
        self.assertEqual(set(res["validity"]["main"]), {"all", "e1", "e3", "e3-four"})


class E1Settings(unittest.TestCase):
    def test_defaults_are_e1s(self):
        sig = inspect.signature(a5.analyze)
        self.assertEqual(sig.parameters["draws"].default, an.DRAWS)
        self.assertEqual(sig.parameters["resamples"].default, an.RESAMPLES)
        self.assertEqual((an.DRAWS, an.RESAMPLES, an.ALPHA, an.DELTA, an.MIN_N), (100_000, 10_000, 0.05, 0.03, 30))
        _, res = run({})
        self.assertEqual({k: res["settings"][k] for k in ("alpha", "delta", "min_n", "bootstrap_seed", "sign_flip_seed",
                                                         "margin", "answers_per_cell")},
                         {"alpha": 0.05, "delta": 0.03, "min_n": 30, "bootstrap_seed": 1, "sign_flip_seed": 1,
                          "margin": 0.015, "answers_per_cell": 8})

    def test_e1_functions_are_called_with_e1_settings(self):
        calls = {"sign_flip_ps": [], "bootstrap_ci": [], "verdict": [], "holm": 0}
        real = {name: getattr(an, name) for name in ("sign_flip_ps", "bootstrap_ci", "verdict", "holm")}

        def sf(D, *args, **kw):
            calls["sign_flip_ps"].append((args, kw))
            return real["sign_flip_ps"](D, *args, **kw)

        def bc(d, *args, **kw):
            calls["bootstrap_ci"].append((args, kw))
            return real["bootstrap_ci"](d, *args, **kw)

        def vd(*args, **kw):
            calls["verdict"].append((args, kw))
            return real["verdict"](*args, **kw)

        def hm(p):
            calls["holm"] += 1
            return real["holm"](p)

        inp = s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, effects={"9": STRONG})
        with mock.patch.object(an, "sign_flip_ps", sf), mock.patch.object(an, "bootstrap_ci", bc), \
                mock.patch.object(an, "verdict", vd), mock.patch.object(an, "holm", hm):
            res = a5.analyze(inp, draws=3000, resamples=700)
        self.assertTrue(calls["sign_flip_ps"])
        self.assertTrue(all(args == (3000,) and not kw for args, kw in calls["sign_flip_ps"]))  # seed: E1's default 1
        self.assertTrue(all(args == (700,) and not kw for args, kw in calls["bootstrap_ci"]))
        self.assertTrue(calls["verdict"] and all(len(args) == 5 and not kw for args, kw in calls["verdict"]))  # E1's alpha, delta
        self.assertGreaterEqual(calls["holm"], 2)  # main and replication families
        # The p-value and intervals equal E1's functions on the same vector.
        gate = res["main"]["planned"]["gate"]
        ix = a5.E5Index(inp)
        d = a5.resolve(ix, "9", "original", ix.queries("main", a5.NEW))["d"]
        values = [d[q] for q in sorted(d)]
        self.assertEqual(gate["p"], an.sign_flip_p(values, 3000))
        self.assertEqual(gate["ci95"], an.bootstrap_ci(values, 700)["ci95"])
        self.assertEqual(gate["mde"], an.realized_mde(gate["sd"], gate["n"], 0.05))
        fam = family(res, "9K", "original")
        self.assertEqual(fam["mde"], an.realized_mde(fam["sd"], fam["n"], 0.05 / 4))

    def test_cli_defaults_are_e1s(self):
        src = inspect.getsource(a5.main)
        self.assertIn("default=an.DRAWS", src)
        self.assertIn("default=an.RESAMPLES", src)


SHARD = "main.gemma-4-12b.tier1.jsonl"
SCORED_SETS = "main,e3,e3-four,replication"


def score_files(data: Path, out: Path, cells: list, *, pending=()) -> list:
    """Prompts for the cells' (query, version, judge) and answers to the first n_answers seeds (no page text: one
    citation per answer), except the cells in `pending` (prompted, not yet answered); scored by E1's own score.py,
    which writes scores.jsonl, cells.jsonl and score_summary.json as on the real data. Returns score.py's cells."""
    prompts, answers = [], []
    waiting = {(c["query_id"], c["version_id"], c["judge"]) for c in pending}
    for c in [*cells, *pending]:
        for s in range(1, N_SEEDS + 1):
            key = f"e5|{c['judge']}|{c['version_id']}|{s}"
            prompts.append({"key": key, "set": c["set"], "query_id": c["query_id"], "version_id": c["version_id"],
                            "arm": c["arm"], "judge": c["judge"], "seed": s, "slot": (s - 1) % 4 + 1, "prompt": "p"})
            if s <= c["n_answers"] and (c["query_id"], c["version_id"], c["judge"]) not in waiting:
                answers.append({"key": key, "answer": f"An answer [{s % 4 + 1}]."})
    write_jsonl(data / "prompts.jsonl", prompts)
    write_jsonl(data / "answers" / SHARD, answers)
    e1_score.main(["--data", str(data), "--out", str(out), "--sets", SCORED_SETS])
    return read_rows(out / "cells.jsonl")


def read_rows(path: Path) -> list:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class SnapshotRule(unittest.TestCase):
    def write(self, root: Path, inp: a5.E5Inputs, pending=()):
        data, out = root / "data", root / "out"
        write_jsonl(data / "edit_texts.jsonl", inp.edit_texts)
        write_jsonl(data / "versions.jsonl", inp.versions)
        write_jsonl(data / "applicability.jsonl", inp.applicability)
        score_files(data, out, inp.cells, pending=pending)
        return data, out

    def main(self, argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            a5.main(argv)

    def small(self):
        return s5.synthetic_e5(seed=7, answer_sd=0.2, all_valid=True, n_e1=10, n_e3=40, n_four=0, n_rep=10)

    def dry(self, data: Path, out: Path, root: Path) -> list:
        return ["--data", str(data), "--scored", str(out), "--out", str(root / "dry"), "--no-earlier",
                "--draws", "500", "--resamples", "200"]

    def refused(self, argv) -> str:
        with self.assertRaises(SystemExit) as stop:
            self.main(argv)
        return str(stop.exception)

    def test_runs_once_on_a_logged_snapshot_of_the_answers(self):
        inp = self.small()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            later = inp.cells[-2:]
            inp.cells = inp.cells[:-2]  # two cells still to come
            data, out = self.write(root, inp, pending=later)
            argv = ["--data", str(data), "--scored", str(out), "--out", str(out), "--no-earlier",
                    "--draws", "500", "--resamples", "200"]
            self.main(argv)
            res = json.loads((out / "analysis_e5.json").read_text())
            files = res["snapshot"]["files"]
            # edit texts, versions, applicability, cells, score summary, scores, 1 answer file
            self.assertEqual(len(files), 7)
            for name, path in (("cells.jsonl", out / "cells.jsonl"), ("score_summary.json", out / "score_summary.json"),
                               ("scores.jsonl", out / "scores.jsonl"), (SHARD, data / "answers" / SHARD)):
                key = next(k for k in files if k.endswith(name))
                self.assertEqual(files[key]["sha256"], a5.sha256(path))
            scoring = res["snapshot"]["scoring"]
            self.assertTrue(scoring["consistent"])
            self.assertEqual(scoring["rescored_answers"], scoring["scored_answers"])
            self.assertEqual((scoring["rescored_differ"], scoring["cells_differ"]), (0, 0))
            self.main(argv)  # same snapshot: allowed
            inp.cells += later  # the late answers arrive and are scored
            score_files(data, out, inp.cells)
            self.refused(argv)
            self.main(argv + ["--secondary"])
            sec = json.loads((out / "analysis_e5_secondary.json").read_text())
            self.assertTrue(sec["secondary"])
            self.assertEqual(json.loads((out / "analysis_e5.json").read_text())["snapshot"]["files"], files)

    def test_refuses_cells_scored_before_the_last_answers(self):
        inp = self.small()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            later = inp.cells[-1:]
            inp.cells = inp.cells[:-1]
            data, out = self.write(root, inp, pending=later)
            argv = self.dry(data, out, root)
            late = [{"key": f"e5|{later[0]['judge']}|{later[0]['version_id']}|{s}", "answer": "Late [1]."}
                    for s in range(1, N_SEEDS + 1)]
            write_jsonl(data / "answers" / "late.jsonl", late)  # copied back after score.py ran
            self.assertIn("distinct keys", self.refused(argv))
            (data / "answers" / "late.jsonl").unlink()
            cells = read_rows(out / "cells.jsonl")
            write_jsonl(out / "cells.jsonl", cells[:-1])  # cells.jsonl older than score_summary.json
            stop = self.refused(argv)
            self.assertIn("answers in cells.jsonl", stop)
            self.assertIn("differ from the cells rebuilt", stop)
            write_jsonl(out / "cells.jsonl", cells)
            self.main(argv)  # consistent again
            (out / "score_summary.json").unlink()
            self.refused(argv)
            self.assertTrue((root / "dry" / "analysis_e5.json").exists())

    def test_refuses_an_answer_file_replaced_in_place_after_scoring(self):
        inp = self.small()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data, out = self.write(root, inp)
            argv = self.dry(data, out, root)
            shard = data / "answers" / SHARD
            rows = read_rows(shard)
            original = list(rows)
            # Same keys, one answer's text changed so its citation changes: the counts all still agree.
            self.assertNotIn("[1]", rows[0]["answer"])  # seed 1, slot 1: now the target is cited first
            rows[0] = rows[0] | {"answer": "A different answer [1]."}
            write_jsonl(shard, rows)
            stop = self.refused(argv)
            self.assertIn("re-scored now differ from scores.jsonl", stop)
            self.assertIn(rows[0]["key"], stop)
            self.assertNotIn("distinct keys", stop)
            # A text change that scores the same passes; the new sha256 is in the snapshot.
            write_jsonl(shard, [original[0] | {"answer": original[0]["answer"] + " More words."}, *original[1:]])
            self.main(argv)
            res = json.loads((root / "dry" / "analysis_e5.json").read_text())
            self.assertEqual(next(f for k, f in res["snapshot"]["files"].items() if k.endswith(SHARD))["sha256"],
                             a5.sha256(shard))
            write_jsonl(shard, original)
            # A second shard with a different answer under a key already answered.
            write_jsonl(data / "answers" / "dup.jsonl", [original[0] | {"answer": "Another [2]."}])
            self.assertIn("two different answers", self.refused(argv))
            (data / "answers" / "dup.jsonl").unlink()
            # A scored answer whose row was removed from the answer files.
            write_jsonl(shard, original[1:])
            self.assertIn("no longer in the answer files", self.refused(argv))
            write_jsonl(shard, original)
            # A cell edited after scoring, and scores.jsonl missing.
            cells = read_rows(out / "cells.jsonl")
            write_jsonl(out / "cells.jsonl", [cells[0] | {"score": 0.123}, *cells[1:]])
            self.assertIn("differ from the cells rebuilt", self.refused(argv))
            write_jsonl(out / "cells.jsonl", cells)
            (out / "scores.jsonl").unlink()
            self.assertIn("scores.jsonl", self.refused(argv))

    def test_a_dry_run_elsewhere_leaves_the_planned_snapshot_open(self):
        inp = self.small()
        with tempfile.TemporaryDirectory() as tmp:
            data, out = self.write(Path(tmp), inp)
            dry = Path(tmp) / "dry"
            self.main(["--data", str(data), "--scored", str(out), "--out", str(dry), "--no-earlier",
                       "--draws", "500", "--resamples", "200"])
            self.assertTrue((dry / "analysis_e5.json").exists())
            self.assertFalse((out / "analysis_e5.json").exists())


class InputFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        inp = s5.synthetic_e5(seed=7, all_valid=True, n_e1=3, n_e3=3, n_four=0, n_rep=0)
        self.data, self.out = self.root / "data", self.root / "out"
        write_jsonl(self.data / "edit_texts.jsonl", inp.edit_texts)
        write_jsonl(self.data / "versions.jsonl", inp.versions)
        write_jsonl(self.data / "applicability.jsonl", inp.applicability)
        write_jsonl(self.out / "cells.jsonl", inp.cells)

    def tearDown(self):
        self.tmp.cleanup()

    def test_e5_applicability_is_required(self):
        (self.data / "applicability.jsonl").unlink()
        with self.assertRaises(SystemExit):
            a5.load_inputs(self.data, self.out, earlier=None)

    def test_each_missing_earlier_file_is_warned_about(self):
        nowhere = self.root / "nowhere"
        with contextlib.redirect_stderr(io.StringIO()) as err:
            _, snap = a5.load_inputs(self.data, self.out, earlier={"e1": (nowhere, nowhere, {"original"})}, prompts=False)
        self.assertEqual(len(snap.warnings), 3)  # cells, versions, applicability
        self.assertIn("no cross-run fallback and no drift check", snap.warnings[0])
        self.assertEqual(err.getvalue().count("warning"), 3)
        self.assertEqual(snap.as_dict()["warnings"], snap.warnings)

    def test_earlier_files_are_limited_to_the_scored_sets_and_the_runs_arms(self):
        e1 = self.root / "e1"
        cells = [{"set": st, "query_id": "geo-test-0", "version_id": f"geo-test-0:{arm}", "arm": arm, "judge": GEMMA,
                  "n_answers": 8, "n_valid": 8, "valid_rate": 1.0, "score": 0.5, "cited": 1.0, "pawc": 0.3,
                  "dropped": False} for st, arm in (("main", "original"), ("smoke", "original"), ("main", "7"))]
        write_jsonl(e1 / "cells.jsonl", cells)
        write_jsonl(e1 / "versions.jsonl", [])
        write_jsonl(e1 / "applicability.jsonl", [])
        with contextlib.redirect_stderr(io.StringIO()):
            inp, _ = a5.load_inputs(self.data, self.out, earlier={"e1": (e1, e1, {"original"})}, prompts=False)
        self.assertEqual([(c["set"], c["arm"], c["run"]) for c in inp.earlier_cells], [("main", "original", "e1")])

    def test_prompt_digests(self):
        def prompts(path, rows):
            write_jsonl(path, [{"key": k, "query_id": "q1", "version_id": f"q1:{arm}", "arm": arm, "judge": GEMMA,
                                "seed": seed, "slot": 1 + seed % 4, "prompt": text, "set": st}
                               for k, arm, seed, text, st in rows])

        e5rows = [(f"e5|{GEMMA}|q1:original|{s}", "original", s, f"prompt {s}", "e3") for s in (1, 2)]
        e5rows += [(f"e5|{GEMMA}|q1:9K|1", "9K", 1, "other arm", "e3")]
        prompts(self.root / "e5.jsonl", e5rows)
        prompts(self.root / "e3.jsonl", [(f"{GEMMA}|q1:original|{s}", "original", s, f"prompt {s}", "e3") for s in (2, 1)]
                + [(f"{GEMMA}|q1:original|1", "original", 1, "a smoke prompt", "smoke")])
        prompts(self.root / "e3b.jsonl", [(f"{GEMMA}|q1:original|{s}", "original", s, f"prompt {s}!", "e3") for s in (1, 2)])
        snap = a5.Snapshot()
        mine = snap.prompt_digests(self.root / "e5.jsonl", "e5", {"original"})
        same = snap.prompt_digests(self.root / "e3.jsonl", "e3", {"original"})
        other = snap.prompt_digests(self.root / "e3b.jsonl", "e3", {"original"})
        self.assertEqual(set(mine), {("e5", "q1", "original", GEMMA)})  # the 9K line is skipped
        self.assertEqual(mine[("e5", "q1", "original", GEMMA)], same[("e3", "q1", "original", GEMMA)])  # keys, order, smoke ignored
        self.assertNotEqual(mine[("e5", "q1", "original", GEMMA)], other[("e3", "q1", "original", GEMMA)])
        self.assertEqual(snap.files[a5._rel(self.root / "e5.jsonl")]["sha256"], a5.sha256(self.root / "e5.jsonl"))
        with self.assertRaises(SystemExit):
            snap.prompt_digests(self.root / "missing.jsonl", "e5", {"original"})


class EdgeCases(unittest.TestCase):
    @staticmethod
    def index(scores: dict, strata: dict) -> a5.E5Index:
        """One judge (Gemma); scores[(query, arm)] -> a complete cell."""
        texts = [{"query_id": q, "set": "main", "stratum": st, "n_key_terms": 3} for q, st in strata.items()]
        versions = [{"query_id": q, "arm": arm, "set": strata[q], "valid": True} for q, arm in scores]
        cells = [{"set": strata[q], "query_id": q, "version_id": f"{q}:{arm}", "arm": arm, "judge": GEMMA, "n_answers": 8,
                  "n_valid": 8, "score": x, "dropped": False} for (q, arm), x in scores.items()]
        return a5.E5Index(a5.E5Inputs(edit_texts=texts, versions=versions, cells=cells))

    def test_share_kept_with_a_resample_denominator_of_exactly_zero_warns_nothing(self):
        # d(9 - 9P) is 0.25 on 36 queries and -0.75 on 4: a resample with 10 negatives has a mean of exactly 0.
        strata = {f"q{i}": "e3" for i in range(40)}
        scores = {}
        for i, q in enumerate(strata):
            scores |= {(q, "9P"): 0.5, (q, "9"): 0.5 + (0.25 if i >= 4 else -0.75), (q, "9K"): 0.6, (q, "9L"): 0.6}
        ix = self.index(scores, strata)
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            out = a5.share_kept(ix, a5.NEW, a5.PBatch(500), 10_000)
        x = out["9K"]
        self.assertTrue(x["estimable"], x)
        self.assertGreater(x["denominator_resamples_at_or_below_0"], 0)
        self.assertLessEqual(x["denominator_resamples_at_or_below_0"], 0.025)
        self.assertEqual(x["resamples_without_a_ratio"], 0)
        self.assertTrue(np.isfinite(x["ci90"]).all())

    def test_validity_counts_not_applicable_queries_from_the_tables(self):
        strata = {"q1": "e3", "q2": "e3", "q3": "e3"}
        texts = [{"query_id": q, "set": "main", "stratum": st, "n_key_terms": 3} for q, st in strata.items()]
        versions = [{"query_id": q, "arm": "original", "set": "e3", "valid": True} for q in strata]
        versions += [{"query_id": "q1", "arm": a, "set": "e3", "valid": True, "length_ratio": 1.1, "key_terms_delta": 2,
                      "tool_covers_q": a == "9K", "tool_gate": True} for a in ("9", "9K")]
        appl = [{"query_id": q, "arm": "9", "applicable": False,
                 "reason": "the question-coverage check scores 0.950 (0.9 or more)"} for q in ("q2", "q3")]
        appl += [{"query_id": q, "arm": "9K", "applicable": False,
                  "reason": f"arm 9 is not applicable: the question-coverage check scores {x} (0.9 or more)"}
                 for q, x in (("q2", "0.950"), ("q3", "1.000"))]
        inp = a5.E5Inputs(edit_texts=texts, versions=versions, cells=[], applicability=appl)
        v = a5.validity(a5.E5Index(inp), inp)["main"]["all"]
        self.assertEqual({k: v["9K"][k] for k in ("queries", "not_applicable", "applicable", "valid")},
                         {"queries": 3, "not_applicable": 2, "applicable": 1, "valid": 1})
        self.assertEqual(v["9K"]["not_applicable_by_reason"],
                         {"arm # is not applicable: the question-coverage check scores #": 2})
        self.assertEqual(v["9P"]["not_applicable"], 2)  # no 9P rows at all: counted from arm 9's table
        self.assertEqual(v["9P"]["applicable_without_a_version"], 1)
        self.assertNotIn("P12", v)  # no row and no table for arm 12 here
        inp.versions.append({"query_id": "q1", "arm": "12", "set": "e3", "valid": False, "excluded_reason": "invalid: x"})
        inp.versions.append({"query_id": "q2", "arm": "12", "set": "e3", "valid": True})
        inp.applicability.append({"query_id": "q3", "arm": "12", "applicable": False, "reason": "feature already present"})
        v = a5.validity(a5.E5Index(inp), inp)["main"]["all"]
        self.assertEqual(v["P12"]["not_applicable"], 1)
        self.assertEqual(v["P12"]["applicable_without_a_version"], 1)  # q2 only: a placebo needs its edit valid
        self.assertEqual(v["9K"]["tool_flags"]["tool_covers_q"], {"true": 1, "of": 1, "share": 1.0})
        self.assertEqual(v["9"]["tool_flags"]["tool_covers_q"]["share"], 0.0)


class RealFormat(unittest.TestCase):
    @unittest.skipUnless((E1 / "out" / "cells.jsonl").exists() and (E5 / "data" / "versions.jsonl").exists(),
                         "needs E1's cells and E5's built versions (local data)")
    def test_e5_structure_with_e1_cells_as_the_earlier_run(self):
        structure = s5.structure_from_data(E5 / "data")
        inp = s5.synthetic_e5(seed=2, structure=structure)
        e1_cells = [c | {"run": "e1"} for c in a5.read_jsonl(E1 / "out" / "cells.jsonl") if c["arm"] in ("original", "9")]
        inp.earlier_cells = e1_cells
        res = a5.analyze(inp, **FAST)
        self.assertEqual(res["queries"]["main"], 260)
        self.assertGreaterEqual(res["main"]["planned"]["gate"]["n"], 100)
        self.assertEqual(res["drift"]["per_version"]["original"]["n_queries"], 140)
        self.assertIsNotNone(res["drift"]["overall"]["ci95"])


def flag(inp, arm, queries, value=True):
    """Marks the versions of `arm` on `queries` as having an edit text equal to q (versions.jsonl edit_text_is_q)."""
    for v in inp.versions:
        if v["arm"] == arm and v["query_id"] in queries:
            v["edit_text_is_q"] = value


class Amendment3(unittest.TestCase):
    """PLAN_E5 amendment 3: every 9G contrast, and every 9K or 9L contrast with a version whose edit text equals q,
    also reported without those queries; the identical prompts among them as a noise floor."""

    FLAG_9L = {"geo-test-0", "geo-test-1", "geo-test-2", "geo-test-1000", "geo-test-2000"}
    FLAG_9G = {"geo-test-3", "geo-test-2001"}

    def flagged_inputs(self, **kw):
        inp = s5.synthetic_e5(effects={"9": STRONG}, seed=7, answer_sd=0.2, all_valid=True, **kw)
        flag(inp, "9L", self.FLAG_9L)
        flag(inp, "9G", self.FLAG_9G)
        flag(inp, "9", {v["query_id"] for v in inp.versions})  # true for arm 9 by definition: never counted
        return inp

    def test_flagged_queries_are_left_out_beside_the_planned_rows(self):
        res = a5.analyze(self.flagged_inputs(), **FAST)
        a3 = res["amendment_3_sensitivity"]
        main = a3["flagged"]["main"]
        self.assertEqual((main["9L"]["n"], main["9G"]["n"], main["9K"]["n"]), (5, 2, 0))
        self.assertEqual(main["9L"]["by_stratum"], {"e1": 3, "e3": 1, "e3-four": 1})
        self.assertFalse(a3["replication"]["any_flagged"])  # no flagged replication version: its rows are unchanged
        fam = {(c["arm"], c["ref"]): c for c in a3["main"]["family"]}
        for arm, ref in a5.FAMILY:
            c, planned = fam[(arm, ref)], family(res, arm, ref)
            left = 5 if arm == "9L" else 0
            self.assertEqual(len(c["left_out"]), left)
            self.assertEqual(c["n"], planned["n"] - left)
            self.assertEqual(c["n_planned"], planned["n"])
            self.assertEqual(c["label"], a5.REPORTED)  # a sensitivity row, never a verdict of its own
            self.assertEqual(c["planned_label"], planned["label"])
            self.assertEqual(c["label_unchanged"], c["label_by_e1_rules"] == planned["label"])
            self.assertFalse(set(c["left_out"]) - self.FLAG_9L)
            if arm == "9K":  # nothing left out: the planned numbers
                self.assertEqual((c["mean_d"], c["p"], c["ci95"]), (planned["mean_d"], planned["p"], planned["ci95"]))
        # Holm is re-run over the four sensitivity tests.
        smallest = min(fam.values(), key=lambda c: c["p"])
        self.assertAlmostEqual(smallest["p_holm"], min(1.0, 4 * smallest["p"]))
        self.assertEqual(a3["main"]["retention"]["9L"]["n"], res["main"]["planned"]["retention"]["9L"]["n"] - 5)
        self.assertEqual(a3["main"]["readings"]["9L"]["planned_reading"], res["main"]["readings"]["retention"]["9L"]["reading"])
        self.assertEqual(set(a3["main"]["share_kept_new"]) - {"strata", "caveat"}, {"9L"})  # only flagged guesses
        self.assertEqual(a3["main"]["share_kept_new"]["9L"]["d_G_minus_9"]["n"],
                         res["main"]["share_kept_new"]["9L"]["d_G_minus_9"]["n"] - 2)  # geo-test-1000 and 2000
        self.assertEqual(a3["main"]["share_kept_e1"]["caveat"], a5.E1_CAVEAT)
        rep = {(c["arm"], c["ref"]): c for c in a3["main"]["reported"]}
        self.assertEqual(rep[("9G", "original")]["n"], reported(res, "9G", "original")["n"] - 2)
        self.assertEqual(rep[("9K", "9G")]["n"], reported(res, "9K", "9G")["n"] - 2)
        self.assertEqual(set(a3["main"]["splits"]), {"9L"})
        self.assertEqual(a3["main"]["splits"]["9L"]["all"]["n"], res["main"]["splits"]["9L"]["all"]["n"] - 5)
        self.assertEqual(a3["every_label_unchanged"], not a3["changed"])
        self.assertIn("change no planned label", a3["note"])

    def test_a_label_that_would_differ_is_listed_and_the_planned_label_stands(self):
        inp = s5.synthetic_e5(effects={"9": STRONG}, seed=7, answer_sd=0.2, all_valid=True)
        boosted = {q for q in (f"geo-test-{i}" for i in range(60))}
        flag(inp, "9L", boosted)
        for c in inp.cells:  # a 9L gain that sits only on the flagged queries
            if c["arm"] == "9L" and c["query_id"] in boosted:
                c["score"] = min(1.0, c["score"] + 0.3)
        res = a5.analyze(inp, **FAST)
        self.assertIn(family(res, "9L", "original")["label"], a5.HELPS)  # the planned label, from all queries
        a3 = res["amendment_3_sensitivity"]
        c = next(c for c in a3["main"]["family"] if (c["arm"], c["ref"]) == ("9L", "original"))
        self.assertNotIn(c["label_by_e1_rules"], a5.HELPS)
        self.assertFalse(c["label_unchanged"])
        self.assertFalse(a3["every_label_unchanged"])
        self.assertIn("main 9L vs original", a3["changed"])

    def test_identical_prompts_give_the_noise_floor(self):
        inp = self.flagged_inputs()
        same, other = ["geo-test-0", "geo-test-1", "geo-test-1000"], "geo-test-2"
        for v in inp.versions:
            if v["query_id"] in same + [other] and v["arm"] in ("9", "9L"):
                v["title"], v["text"] = "T", ("## q\n\nS\n\nbody" if v["arm"] == "9" or v["query_id"] != other
                                             else "## other\n\nS2\n\nbody")
        inp.prompt_digests = {("e5", q, arm, j): f"digest-{q}" for q in same for arm in ("9", "9L") for j in JUDGE_ORDER}
        cells = {(c["query_id"], c["arm"], c["judge"]): c for c in inp.cells}
        for q in same:
            for j in JUDGE_ORDER:
                cells[(q, "9L", j)]["score"] = cells[(q, "9", j)]["score"]
        cells[("geo-test-1", "9L", QWEN)]["score"] = cells[("geo-test-1", "9", QWEN)]["score"] - 0.125
        ip = a5.analyze(inp, **FAST)["amendment_3_sensitivity"]["main"]["identical_prompts"]
        self.assertEqual((ip["flagged_9L"], ip["identical_versions"]), (5, 3))
        self.assertEqual(ip["queries"], sorted(same))  # the flagged version with another text is not one of them
        self.assertEqual((ip["prompt_sets_compared"], ip["prompt_sets_identical"]), (6, 6))
        self.assertEqual((ip["cells"], ip["cells_differ"], ip["differing_lower_on_9L"]), (6, 1, 1))
        self.assertEqual(ip["per_judge"][QWEN]["differ"], 1)
        self.assertAlmostEqual(ip["max_abs_cell_diff"], 0.125)
        d = ip["d_9L_minus_9"]
        self.assertEqual(d["n"], 3)
        self.assertAlmostEqual(d["mean_d"], -0.125 / 2 / 3)
        self.assertAlmostEqual(d["p"], 1.0)  # exact: one nonzero difference, so every sign pattern reaches |sum|
        self.assertIsNone(d["ci95"])  # too few queries for a bootstrap interval

    def test_no_flagged_version_leaves_every_row_as_planned(self):
        _, res = run({"9": STRONG})
        a3 = res["amendment_3_sensitivity"]
        self.assertFalse(a3["main"]["any_flagged"])
        self.assertTrue(a3["every_label_unchanged"])
        self.assertIn("unchanged", a3["main"])

    def test_same_sentence_by_text(self):
        base = "intro\n\n## the question\n\nThe copied sentence.\n\nrest of the page"
        self.assertTrue(a5.same_sentence_by_text(base, base.replace("the question", "two words")))
        self.assertFalse(a5.same_sentence_by_text(base, base.replace("## the question\n\nThe copied sentence.",
                                                                     "## two words\n\nAnother sentence.")))
        self.assertFalse(a5.same_sentence_by_text(base, base.replace("The copied", "A copied")
                                                  .replace("the question", "two words")))
        self.assertIsNone(a5.same_sentence_by_text("", base))
        inp = s5.synthetic_e5(seed=7, all_valid=True, n_e3=0, n_four=0, n_rep=0, n_e1=4)
        texts = {"9": base, "9K": base.replace("the question", "two words"), "9P": base.replace(
            "## the question\n\nThe copied sentence.", "## Another\n\nAnother sentence.")}
        for v in inp.versions:
            if v["arm"] in texts:
                v["text"] = texts[v["arm"]]
            if v["arm"] == "9K":
                v["same_sentence_as_9"] = True
        sv = a5.sentence_vs_9(a5.E5Index(inp))["main"]
        self.assertEqual((sv["9K"]["same_sentence"], sv["9K"]["flag_vs_text"]), (4, {"compared": 4, "agree": 4}))
        self.assertEqual((sv["9P"]["different_sentence"], sv["9P"]["unknown"]), (4, 0))  # 9P has no flag: from the texts

    def test_gate_without_near_duplicates(self):
        with mock.patch.dict(a5.NEAR_DUPLICATES, {"geo-test-1000": {"e1_query": "geo-test-0", "pages": 4,
                                                                    "pages_shared_with_e1_query": 3, "how": "test"}}):
            _, res = run({"9": STRONG})
        add = res["added_analyses"]["gate_without_near_duplicates"]
        gate = res["main"]["planned"]["gate"]
        self.assertEqual((add["n"], add["n_planned"]), (gate["n"] - 1, gate["n"]))
        self.assertEqual([x["query_id"] for x in add["left_out"]], ["geo-test-1000"])
        self.assertIsNotNone(add["p"])  # filled by the batch, in place
        self.assertEqual(add["label"], a5.REPORTED)
        self.assertEqual(res["main"]["planned"]["gate"]["label"], gate["label"])  # the planned gate is untouched


if __name__ == "__main__":
    unittest.main()
