"""Tests for analyze.py: sign-flip test, bootstrap, Holm, verdict rules, power, confound regression.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E1))

import analyze as an  # noqa: E402
import report as rp  # noqa: E402
import simulate_null as sn  # noqa: E402

G, Q = "gemma-4-12b", "qwen3.8-27b"
FAST = {"draws": 20_000, "resamples": 2_000}


class SignFlip(unittest.TestCase):
    def test_exact_case_enumerates_every_sign_pattern(self):
        self.assertEqual(an.sign_flip_p([1, 2, 3]), 2 / 8)  # only +++ and --- reach |6|
        self.assertEqual(an.sign_flip_p([1, 1, 1, 1]), 2 / 16)
        self.assertEqual(an.sign_flip_p([0.5] * 12), 2 / 4096)
        self.assertEqual(an.sign_flip_p([1, -1]), 1.0)
        self.assertEqual(an.sign_flip_p([]), 1.0)

    def test_ties_with_the_observed_statistic_count_despite_float_error(self):
        # 0.1 + 0.2 and 0.3 differ in the last bit; the pattern (-, -, +) ties with the observed |0|.
        self.assertEqual(an.sign_flip_p([0.1, 0.2, -0.3]), 1.0)

    def test_monte_carlo_case_twins_metrics_ts_with_numpy_default_rng_1(self):
        d = np.linspace(-0.2, 0.5, 13)
        draws = 5_000
        rng = np.random.default_rng(1)
        observed = abs(d.sum())
        tol = 1e-9 * max(1.0, float(np.abs(d).sum()))
        hits = 0
        for _ in range(draws):
            flips = rng.random(13) < 0.5
            hits += abs(np.where(flips, -d, d).sum()) >= observed - tol
        self.assertEqual(an.sign_flip_p(d, draws=draws), (hits + 1) / (draws + 1))

    def test_default_draws_is_100000(self):
        p = an.sign_flip_p([1.0] * 20)
        self.assertGreater(p, 0)
        self.assertEqual(round(p * 100_001), p * 100_001)

    def test_several_columns_at_once_match_one_at_a_time(self):
        rng = np.random.default_rng(7)
        D = rng.normal(0.01, 0.05, size=(30, 4))
        many = an.sign_flip_ps(D, draws=10_000)
        for k in range(4):
            self.assertEqual(many[k], an.sign_flip_p(D[:, k], draws=10_000))


class Bootstrap(unittest.TestCase):
    def test_percentile_intervals_are_seeded_and_nested(self):
        d = np.random.default_rng(3).normal(0.02, 0.05, 40)
        a = an.bootstrap_ci(d)
        self.assertEqual(a, an.bootstrap_ci(d))
        self.assertLessEqual(a["ci95"][0], a["ci90"][0])
        self.assertGreaterEqual(a["ci95"][1], a["ci90"][1])
        self.assertLess(a["ci90"][0], d.mean())
        self.assertGreater(a["ci90"][1], d.mean())

    def test_matches_a_direct_percentile_bootstrap(self):
        d = np.array([0.1, -0.05, 0.2, 0.0, 0.05])
        rng = np.random.default_rng(1)
        means = d[rng.integers(0, 5, size=(10_000, 5))].mean(axis=1)
        got = an.bootstrap_ci(d)
        self.assertEqual(got["ci95"], [float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))])
        self.assertEqual(got["ci90"], [float(np.quantile(means, 0.05)), float(np.quantile(means, 0.95))])

    def test_constant_differences_give_a_point_interval(self):
        self.assertEqual(an.bootstrap_ci([0.25] * 6)["ci95"], [0.25, 0.25])


class Holm(unittest.TestCase):
    def test_step_down_adjustment_is_monotone(self):
        adj = an.holm({"a": 0.01, "b": 0.04, "c": 0.03})
        self.assertAlmostEqual(adj["a"], 0.03)
        self.assertAlmostEqual(adj["c"], 0.06)
        self.assertAlmostEqual(adj["b"], 0.06)

    def test_adjusted_values_are_capped_at_one(self):
        self.assertEqual(an.holm({"a": 0.6, "b": 0.7}), {"a": 1.0, "b": 1.0})

    def test_empty_family(self):
        self.assertEqual(an.holm({}), {})


class Verdicts(unittest.TestCase):
    def v(self, p_holm=0.01, mean=0.04, judges=None, judge_p=None, ci90=(0.02, 0.06)):
        judges = judges if judges is not None else {G: 0.04, Q: 0.05}
        judge_p = judge_p if judge_p is not None else {G: 0.001, Q: 0.001}
        return an.verdict(p_holm, mean, judges, judge_p, ci90)

    def test_model_dependent_comes_first(self):
        self.assertEqual(self.v(judges={G: 0.06, Q: -0.01}, judge_p={G: 0.009, Q: 0.4}), "model-dependent")

    def test_opposite_signs_without_a_judge_below_001_is_not_model_dependent(self):
        self.assertEqual(self.v(judges={G: 0.06, Q: -0.01}, judge_p={G: 0.01, Q: 0.4}, ci90=(0.0, 0.07)),
                         "inconclusive")

    def test_helps_needs_holm_significance_a_positive_mean_and_every_judge_positive(self):
        self.assertEqual(self.v(), "helps")
        self.assertEqual(self.v(p_holm=0.051, ci90=(0.01, 0.07)), "inconclusive")
        self.assertEqual(self.v(judges={G: 0.04, Q: 0.0}, ci90=(0.01, 0.07)), "inconclusive")

    def test_hurts_mirrors_helps(self):
        self.assertEqual(self.v(mean=-0.04, judges={G: -0.04, Q: -0.03}, ci90=(-0.06, -0.02)), "hurts")

    def test_no_effect_larger_than_delta_when_the_90_interval_is_inside_plus_minus_003(self):
        self.assertEqual(self.v(p_holm=0.5, mean=0.0, ci90=(-0.03, 0.03)), "no effect larger than δ")
        self.assertEqual(self.v(p_holm=0.5, mean=0.0, ci90=(-0.031, 0.01)), "inconclusive")

    def test_a_significant_effect_inside_delta_is_still_helps(self):
        self.assertEqual(self.v(mean=0.01, judges={G: 0.01, Q: 0.01}, ci90=(0.005, 0.015)), "helps")

    def test_single_model_skips_the_model_dependent_rule(self):
        self.assertEqual(self.v(judges={G: 0.04}, judge_p={G: 0.001}), "helps")


class Power(unittest.TestCase):
    def test_planning_mde_reproduces_the_preregistered_figures(self):
        self.assertAlmostEqual(an.planning_mde(60), 0.021, delta=0.001)
        self.assertAlmostEqual(an.planning_mde(80), 0.018, delta=0.001)

    def test_realized_mde_scales_with_sd_over_root_n(self):
        a = an.realized_mde(0.1, 40, alpha=0.05 / 9)
        b = an.realized_mde(0.1, 160, alpha=0.05 / 9)
        self.assertAlmostEqual(a / b, 2.0)
        z = 2.7729 + 0.8416
        self.assertAlmostEqual(a, z * 0.1 / math.sqrt(0.95 * 40), places=3)


class Regression(unittest.TestCase):
    def test_t_quantiles(self):
        self.assertAlmostEqual(an.t_ppf(0.975, 10), 2.228139, places=5)
        self.assertAlmostEqual(an.t_ppf(0.975, 30), 2.042272, places=5)
        self.assertAlmostEqual(an.t_ppf(0.975, 2), 4.302653, places=5)

    def test_intercept_and_its_confidence_interval(self):
        x = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
        y = np.array([1.1, 2.9, 5.2, 7.1, 8.7])
        r = an.ols_intercept(y, {"x": x})
        # By hand: b1 = 19.4 / 10, b0 = 5 - 2 * 1.94 = 1.12, RSS = 0.124 on 3 df,
        # se(b0) = sqrt(0.124 / 3 * (1/5 + 4/10)) = 0.157480, t(0.975, 3) = 3.182446.
        self.assertAlmostEqual(r["intercept"], 1.12, places=9)
        self.assertAlmostEqual(r["ci95"][0], 1.12 - 3.182446 * 0.157480, places=5)
        self.assertAlmostEqual(r["ci95"][1], 1.12 + 3.182446 * 0.157480, places=5)
        self.assertEqual(r["regressors"], ["x"])

    def test_zero_variance_regressors_are_dropped_and_reported(self):
        y = np.array([0.1, 0.2, 0.15, 0.3])
        r = an.ols_intercept(y, {"dlog_length": np.array([0.1, 0.2, 0.3, 0.4]), "dkey": np.zeros(4)})
        self.assertEqual(r["regressors"], ["dlog_length"])
        self.assertEqual(r["dropped"], {"dkey": 0.0})
        self.assertTrue(r["identifiable"])

    def test_a_dropped_nonzero_constant_makes_the_intercept_unidentifiable(self):
        y = np.array([0.1, 0.2, 0.15, 0.3])
        r = an.ols_intercept(y, {"dlog_length": np.full(4, 0.05), "dkey": np.array([0, 1, 2, 1.0])})
        self.assertFalse(r["identifiable"])


def contrast(result, arm, ref=None):
    for c in result["contrasts"]:
        if c["arm"] == arm and (ref is None or c["ref"] == ref):
            return c
    raise KeyError((arm, ref))


class QueryLevelD(unittest.TestCase):
    def test_d_is_the_mean_over_judges_of_cell_differences(self):
        inp = sn.synthetic_inputs(n_queries=2, seed=0)
        cells = {(c["query_id"], c["arm"], c["judge"]): c for c in inp.cells}
        d, _ = an.query_differences(inp, "9", "original", [G, Q], "score")
        for q, value in d.items():
            want = np.mean([cells[(q, "9", j)]["score"] - cells[(q, "original", j)]["score"] for j in (G, Q)])
            self.assertAlmostEqual(value, want)

    def test_a_dropped_cell_removes_the_query_from_contrasts_with_that_version_and_is_counted(self):
        inp = sn.synthetic_inputs(n_queries=3, seed=0)
        for c in inp.cells:
            if c["query_id"] == inp.cells[0]["query_id"] and c["arm"] == "9" and c["judge"] == Q:
                c["dropped"] = True
        d, info = an.query_differences(inp, "9", "original", [G, Q], "score")
        self.assertEqual(len(d), 2)
        self.assertEqual(info["dropped_cells"], 1)
        d4, _ = an.query_differences(inp, "4", "original", [G, Q], "score")
        self.assertEqual(len(d4), 3)


class AnalyzeSet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        effects = {"9": {G: 0.05, Q: 0.05}, "5": {G: -0.05, Q: -0.05}, "6": {G: 0.05, Q: -0.05},
                   "ALL": {G: 0.05, Q: 0.05}}
        inp = sn.synthetic_inputs(n_queries=60, effects=effects, answer_sd=0.1, seed=11)
        # Arm 3: applicable on only 20 queries.
        keep3 = {f"q{i:03d}" for i in range(20)}
        inp.applicability = [a | {"applicable": a["query_id"] in keep3} if a["arm"] == "3" else a
                             for a in inp.applicability]
        # Arm 12: d driven entirely by length.
        rng = np.random.default_rng(5)
        x = {f"q{i:03d}": float(rng.uniform(0.02, 0.2)) for i in range(60)}
        for v in inp.versions:
            if v["arm"] == "12":
                v["length_ratio"], v["key_terms_delta"] = math.exp(x[v["query_id"]]), 0
            if v["arm"] == "P12":
                v["length_ratio"], v["key_terms_delta"] = 1.0, 0
        ref = {(c["query_id"], c["judge"]): c["score"] for c in inp.cells if c["arm"] == "P12"}
        for c in inp.cells:
            if c["arm"] == "12":
                c["score"] = ref[(c["query_id"], c["judge"])] + 0.5 * x[c["query_id"]] + float(rng.normal(0, 0.005))
        cls.result = an.analyze_set(inp, "main", **FAST)

    def test_two_judge_mode_and_editor_tag(self):
        self.assertEqual(self.result["mode"], "two-judge")
        self.assertIn("Gemma-edited", self.result["tags"])

    def test_planted_effects_get_their_labels(self):
        self.assertEqual(contrast(self.result, "9")["label"], "helps")
        self.assertEqual(contrast(self.result, "5")["label"], "hurts")
        self.assertEqual(contrast(self.result, "6")["label"], "model-dependent")
        self.assertEqual(contrast(self.result, "2")["label"], "no effect larger than δ")

    def test_arms_below_30_queries_are_insufficient_n_and_leave_the_family(self):
        c3 = contrast(self.result, "3")
        self.assertEqual((c3["n"], c3["label"], c3["p_holm"]), (20, "insufficient n", None))
        self.assertEqual(self.result["families"]["A"]["m"], 8)
        self.assertNotIn("3", self.result["families"]["A"]["arms"])

    def test_holm_runs_within_each_family(self):
        fam = self.result["families"]
        self.assertEqual(fam["B"]["arms"], ["11", "12", "14"])
        self.assertEqual([tuple(x) for x in fam["ALL"]["contrasts"]], [("ALL", "P_ALL"), ("ALL", "original")])
        ps = {c["arm"]: c["p"] for c in self.result["contrasts"] if c["family"] == "B"}
        holm = an.holm(ps)
        for c in self.result["contrasts"]:
            if c["family"] == "B":
                self.assertAlmostEqual(c["p_holm"], holm[c["arm"]])

    def test_arms_1_and_13_are_descriptive(self):
        for arm in ("1", "13"):
            c = contrast(self.result, arm)
            self.assertEqual((c["label"], c["p_holm"], c["family"]), ("descriptive", None, None))
            self.assertIn("ci95", c)

    def test_both_all_contrasts_are_reported(self):
        self.assertEqual(contrast(self.result, "ALL", "P_ALL")["label"], "helps")
        self.assertEqual(contrast(self.result, "ALL", "original")["label"], "helps")

    def test_a_length_driven_help_is_qualified_by_the_confound_regression(self):
        c = contrast(self.result, "12")
        self.assertEqual(c["label"], "helps, possibly through length or query-term overlap")
        self.assertLessEqual(c["confound"]["ci95"][0], 0)
        self.assertEqual(contrast(self.result, "9")["label"], "helps")

    def test_mde_uses_the_strictest_holm_step_of_the_family(self):
        c = contrast(self.result, "9")
        self.assertAlmostEqual(c["mde"], an.realized_mde(c["sd"], c["n"], alpha=0.05 / 8))

    def test_secondaries_are_reported(self):
        c = contrast(self.result, "9")
        self.assertEqual(set(c["per_judge"]), {G, Q})
        for key in ("cited", "pawc", "valid_rate"):
            self.assertIn(key, c["secondary"])
        self.assertEqual(set(c["slots"]), {"1", "2", "3", "4"})
        self.assertIn("wikipedia_target", c["subgroups"])
        self.assertEqual(c["subgroups"]["wayback_target"]["n"], 9)  # q000, q007, ..., q056
        self.assertGreaterEqual(c["subgroups"]["wayback_any"]["n"], c["subgroups"]["wayback_target"]["n"])
        self.assertEqual(c["subgroups"]["wikipedia_target"]["n"], 12)  # every fifth query
        vs_original = {x["arm"]: x for x in self.result["vs_original"]}
        self.assertIn("2", vs_original)
        self.assertEqual(vs_original["2"]["ref"], "original")


class SingleModel(unittest.TestCase):
    def test_an_unfinished_second_judge_means_single_model_verdicts(self):
        inp = sn.synthetic_inputs(n_queries=40, effects={"9": {G: 0.05, Q: -0.05}}, answer_sd=0.1, seed=2)
        for row in inp.completion:
            if row["judge"] == Q and row["arm"] == "12":
                row["missing"] = 5
        result = an.analyze_set(inp, "main", **FAST)
        self.assertEqual(result["mode"], "single-model")
        self.assertIn("single-model", result["tags"])
        c9 = contrast(result, "9")
        self.assertEqual(c9["label"], "helps")
        self.assertEqual(set(c9["per_judge"]), {G})
        self.assertIn(Q, result["secondary_judges"])

    def test_an_arm_the_primary_judge_did_not_finish_is_not_completed(self):
        inp = sn.synthetic_inputs(n_queries=40, seed=3)
        for row in inp.completion:
            if row["judge"] == G and row["arm"] == "P8":
                row["missing"] = 1
        result = an.analyze_set(inp, "main", **FAST)
        self.assertEqual(contrast(result, "8")["label"], "not completed")
        self.assertNotIn("8", result["families"]["A"]["arms"])


class Exclusions(unittest.TestCase):
    def test_validity_exclusions_over_20_percent_are_flagged(self):
        inp = sn.synthetic_inputs(n_queries=10, seed=4)
        for v in inp.versions:
            if v["arm"] == "7" and v["query_id"] in {"q000", "q001", "q002"}:
                v["valid"] = False
        result = an.analyze_set(inp, "main", **FAST)
        ex = result["exclusions"]["7"]
        self.assertEqual((ex["applicable"], ex["validity_exclusions"], ex["flagged"]), (10, 3, True))
        self.assertFalse(result["exclusions"]["9"]["flagged"])


class Replication(unittest.TestCase):
    def test_replication_set_uses_one_family_and_reports_removal_support(self):
        inp = sn.synthetic_inputs(n_queries=40, effects={"5": {G: -0.05, Q: -0.05}}, answer_sd=0.1, seed=6,
                                  set_name="replication", arms=sn.REPLICATION_VERSIONS)
        result = an.analyze_set(inp, "replication", **FAST)
        self.assertEqual(list(result["families"]), ["R"])
        self.assertEqual(result["families"]["R"]["arms"], ["5", "6", "7", "9", "11", "12", "14", "ALL"])
        self.assertTrue(contrast(result, "5")["replication_supports_removal"])
        self.assertFalse(contrast(result, "9")["replication_supports_removal"])

    def _replication(self, n_queries=40, completion_edit=None):
        # Arm 5 carries a strong negative effect, so only its status can block removal support.
        inp = sn.synthetic_inputs(n_queries=n_queries, effects={"5": {G: -0.3, Q: -0.3}}, answer_sd=0.1, seed=6,
                                  set_name="replication", arms=sn.REPLICATION_VERSIONS)
        for row in inp.completion:
            if row["arm"] == "5" and completion_edit:
                completion_edit(row)
        return contrast(an.analyze_set(inp, "replication", **FAST), "5")

    def test_removal_support_requires_status_ok(self):
        c = self._replication()
        self.assertEqual(c["status"], "ok")
        self.assertTrue(c["replication_supports_removal"])

    def test_an_unfinished_replication_arm_never_supports_removal(self):
        def unfinished(row):
            if row["judge"] == G:
                row["missing"] = 100
        c = self._replication(completion_edit=unfinished)
        self.assertEqual((c["status"], c["label"]), ("not completed", "not completed"))
        self.assertLess(c["mean_d"], 0)
        self.assertLess(c["p"], 0.05)
        self.assertFalse(c["replication_supports_removal"])

    def test_a_replication_arm_that_has_not_run_never_supports_removal(self):
        def not_run(row):
            row["prompts"], row["answered"], row["missing"] = 0, 0, 0
        c = self._replication(completion_edit=not_run)
        self.assertEqual(c["status"], "not run")
        self.assertFalse(c["replication_supports_removal"])

    def test_insufficient_n_never_supports_removal(self):
        c = self._replication(n_queries=20)
        self.assertEqual(c["status"], "insufficient n")
        self.assertLess(c["mean_d"], 0)
        self.assertLess(c["p"], 0.05)
        self.assertFalse(c["replication_supports_removal"])

    def test_report_shows_why_a_check_lacks_removal_support(self):
        def unfinished(row):
            if row["judge"] == G:
                row["missing"] = 100
        inp = sn.synthetic_inputs(n_queries=40, effects={"5": {G: -0.3, Q: -0.3}}, answer_sd=0.1, seed=6,
                                  set_name="replication", arms=sn.REPLICATION_VERSIONS)
        for row in inp.completion:
            if row["arm"] == "5":
                unfinished(row)
        lines = rp._set_section(an.analyze_set(inp, "replication", **FAST))
        line = next(x for x in lines if x.startswith("Replication support"))
        self.assertIn("5 no (not completed)", line)
        self.assertNotIn("5 yes", line)


if __name__ == "__main__":
    unittest.main()
