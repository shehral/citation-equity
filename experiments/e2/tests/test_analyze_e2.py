"""Tests for analyze_e2.py and report_e2.py on synthetic cells (experiments/PLAN_E2.md).

Run: python3 -I -m unittest discover -s experiments/e2/tests
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E2))
sys.path.insert(0, str(E2 / "tests"))

import analyze_e2 as a2  # noqa: E402
import e2_fixtures  # noqa: E402,F401  (puts experiments/e1 on the path)
import report_e2 as r2  # noqa: E402

import analyze as an  # noqa: E402

G, Q8, Q5 = "gemma-4-12b", "qwen3.8-27b", "qwen3.5-9b"
FAST = {"draws": 5_000, "resamples": 1_000}


def page(q, set_name):
    return {"page_id": f"{q}-p1", "query_id": q, "set": set_name, "role": "target",
            "url": f"https://example.org/{q}", "source": "sample", "query": "what is x", "title": "T", "text": "x"}


def version(q, set_name, arm, valid=True, reason=None, length_ratio=1.05, key_terms_delta=2):
    return {"version_id": f"{q}:{arm}", "query_id": q, "set": set_name, "arm": arm, "valid": valid,
            "excluded_reason": reason, "edit_distance": 0 if arm == "original" else 20,
            "length_ratio": 1.0 if arm == "original" else length_ratio,
            "key_terms_delta": 0 if arm == "original" else key_terms_delta, "added_words": 0}


def cell(q, set_name, arm, judge, score):
    return {"set": set_name, "query_id": q, "version_id": f"{q}:{arm}", "arm": arm, "judge": judge,
            "n_answers": 8, "n_valid": 8, "valid_rate": 1.0, "score": float(score), "cited": 1.0,
            "pawc": 0.25, "dropped": False}


def completion(set_name, arms, judges, n):
    return [{"set": set_name, "judge": j, "arm": a, "prompts": 8 * n, "answered": 8 * n, "missing": 0}
            for a in arms for j in judges]


def write_inputs(data: Path, out: Path, inp: an.Inputs) -> None:
    """The files score.py and the E1 pipeline leave in a data and an out folder."""
    if inp.pages:
        e2_fixtures.write_jsonl(data / "pages.jsonl", inp.pages)
    if inp.applicability:
        e2_fixtures.write_jsonl(data / "applicability.jsonl", inp.applicability)
    e2_fixtures.write_jsonl(data / "versions.jsonl", inp.versions)
    e2_fixtures.write_jsonl(out / "cells.jsonl", inp.cells)
    e2_fixtures.write_jsonl(out / "scores.jsonl", inp.scores)
    (out / "score_summary.json").write_text(json.dumps({"completion": inp.completion}), encoding="utf-8")


def synthetic(n_main=40, n_rep=10):
    """E1 inputs (original, 9) and E2a inputs (9W, 9P): 9 beats 9W by 0.05; 9P is within 0.003 of 9."""
    rng = np.random.default_rng(5)
    e1 = an.Inputs(pages=[], versions=[], applicability=[], cells=[], completion=[])
    e2a = {"versions": [], "cells": [], "completion": [], "refused": []}
    for set_name, n in (("main", n_main), ("replication", n_rep)):
        qs = [f"{set_name[0]}{i:02d}" for i in range(n)]
        # Arm 12 is unfinished for the second judge in E1: E2a reads only original and 9, so it stays two-judge.
        e1.completion += [dict(r, missing=8) if (r["arm"], r["judge"]) == ("12", Q8) else r
                          for r in completion(set_name, ["original", "9", "12"], [G, Q8], n)]
        e2a["completion"] += completion(set_name, ["9W", "9P"], [G, Q8], n)
        for q in qs:
            e1.pages.append(page(q, set_name))
            e1.applicability.append({"query_id": q, "arm": "9", "applicable": True, "reason": None})
            e1.versions += [version(q, set_name, "original"), version(q, set_name, "9")]
            e2a["versions"] += [version(q, set_name, "9W"), version(q, set_name, "9P", key_terms_delta=0)]
            base = 0.5 + rng.normal(0, 0.05)
            for j in (G, Q8):
                nine = base + 0.03 + rng.normal(0, 0.01)
                e1.cells += [cell(q, set_name, "original", j, base), cell(q, set_name, "9", j, nine)]
                e2a["cells"] += [cell(q, set_name, "9W", j, nine - 0.05 + rng.normal(0, 0.01)),
                                 cell(q, set_name, "9P", j, nine + rng.uniform(-0.003, 0.003)),
                                 # E2a's own original and 9 cells are never read: E1's are.
                                 cell(q, set_name, "original", j, 0.0), cell(q, set_name, "9", j, 1.0)]
    return e1, e2a


def synthetic_e2b(n=35):
    """E2b on the main set: Qwen-edited 12 beats P12 (E1's sign kept); ALL loses to P_ALL (E1's sign flips)."""
    rng = np.random.default_rng(9)
    arms = ["original", "12", "P12", "ALL", "P_ALL"]
    b = an.Inputs(pages=[], versions=[], applicability=[], cells=[], completion=completion("main", arms, [G, Q5], n))
    e1 = an.Inputs(pages=[], versions=[], applicability=[], cells=[], completion=completion("main", arms, [G, Q8], n))
    for i in range(n):
        q = f"b{i:02d}"
        for inp in (b, e1):
            inp.pages.append(page(q, "main"))
            inp.applicability += [{"query_id": q, "arm": a, "applicable": True, "reason": None} for a in ("12", "ALL")]
        e1.versions += [version(q, "main", a) for a in arms]
        bad = i < 2
        b.versions += [version(q, "main", a, valid=not (bad and a == "12"),
                               reason="invalid: Add only the query's key terms" if bad and a == "12" else None)
                       for a in arms if not (bad and a == "P12")]
        base = 0.4 + rng.normal(0, 0.05)
        for j in (G, Q8):
            e1.cells += [cell(q, "main", "original", j, base), cell(q, "main", "12", j, base + 0.04),
                         cell(q, "main", "P12", j, base), cell(q, "main", "ALL", j, base + 0.07),
                         cell(q, "main", "P_ALL", j, base)]
        for j in (G, Q5):
            b.cells += [cell(q, "main", "original", j, base), cell(q, "main", "12", j, base + 0.03 + rng.normal(0, 0.01)),
                        cell(q, "main", "P12", j, base), cell(q, "main", "ALL", j, base - 0.02 + rng.normal(0, 0.01)),
                        cell(q, "main", "P_ALL", j, base)]
    return b, e1


class E2a(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        e1, e2a = synthetic()
        cls.inp = a2.e2a_inputs(e1, **e2a)
        cls.main = a2.analyze_e2a(cls.inp, "main", **FAST)
        cls.rep = a2.analyze_e2a(cls.inp, "replication", **FAST)

    def test_the_planned_family_is_9_vs_9w_and_9_vs_9p_with_holm_over_two(self):
        planned = {(c["arm"], c["ref"]): c for c in self.main["planned"]}
        self.assertEqual(list(planned), [("9", "9W"), ("9", "9P")])
        self.assertEqual(self.main["family"]["m"], 2)
        for c in planned.values():
            self.assertEqual(c["n"], 40)
            self.assertEqual(c["mde_alpha"], 0.025)
            self.assertGreaterEqual(c["p_holm"], c["p"])

    def test_labels_and_the_reading(self):
        planned = {(c["arm"], c["ref"]): c for c in self.main["planned"]}
        self.assertEqual(planned[("9", "9W")]["label"], "helps")
        self.assertAlmostEqual(planned[("9", "9W")]["mean_d"], 0.05, delta=0.01)
        self.assertEqual(planned[("9", "9P")]["label"], an.NO_EFFECT)
        self.assertEqual(self.main["reading"]["case"], "heading markup")

    def test_e1s_original_and_arm_9_cells_are_used_not_e2s(self):
        reported = {(c["arm"], c["ref"]): c for c in self.main["reported"]}
        self.assertEqual(list(reported), [("9W", "original"), ("9P", "original")])
        self.assertAlmostEqual(reported[("9P", "original")]["mean_d"], 0.03, delta=0.01)
        self.assertAlmostEqual(reported[("9W", "original")]["mean_d"], -0.02, delta=0.01)
        for c in reported.values():
            self.assertEqual(c["label"], "reported without a verdict")
            self.assertIsNone(c["p_holm"])

    def test_the_confound_regression_is_reported_but_does_not_change_the_label(self):
        planned = {(c["arm"], c["ref"]): c for c in self.main["planned"]}
        conf = planned[("9", "9P")]["confound"]
        self.assertIn("dkey_terms", conf["dropped"])  # every 9 - 9P key-term change is 2 here
        self.assertEqual(planned[("9", "9P")]["label"], an.NO_EFFECT)

    def test_two_judges_and_the_version_statistics(self):
        self.assertEqual(self.main["mode"], "two-judge")
        self.assertEqual(self.main["judges"], [G, Q8])
        v = self.main["versions"]
        self.assertEqual(v["9W"]["applicable"], 40)
        self.assertEqual(v["9W"]["valid"], 40)
        self.assertAlmostEqual(v["9P"]["mean_key_terms_delta"], 0.0)
        self.assertAlmostEqual(v["9"]["mean_length_ratio"], 1.05)

    def test_the_replication_set_is_its_own_analysis(self):
        self.assertEqual(self.rep["set"], "replication")
        self.assertEqual({c["label"] for c in self.rep["planned"]}, {"insufficient n"})
        self.assertEqual(self.rep["planned"][0]["n"], 10)
        self.assertEqual(self.rep["reading"]["case"], None)

    def test_a_judge_that_has_not_finished_gives_single_model_results(self):
        e1, e2a = synthetic(n_main=31, n_rep=0)
        e2a["completion"] = [dict(r, missing=8) if r["judge"] == Q8 and r["arm"] == "9P" else r
                             for r in e2a["completion"]]
        res = a2.analyze_e2a(a2.e2a_inputs(e1, **e2a), "main", **FAST)
        self.assertEqual(res["mode"], "single-model")
        self.assertEqual(res["judges"], [G])


class Readings(unittest.TestCase):
    def test_the_plans_four_readings_and_everything_else(self):
        H, N = "helps", an.NO_EFFECT
        self.assertEqual(a2.reading(H, N)["case"], "heading markup")
        self.assertEqual(a2.reading(N, H)["case"], "query words")
        self.assertEqual(a2.reading(H, H)["case"], "both")
        self.assertEqual(a2.reading(N, N)["case"], "neither")
        for pair in ((H, "inconclusive"), ("hurts", N), ("insufficient n", H), (an.HELPS_CONFOUNDED, N)):
            self.assertIsNone(a2.reading(*pair)["case"], pair)
            self.assertIn("no reading", a2.reading(*pair)["text"])


class E2b(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        b, e1 = synthetic_e2b()
        cls.res = a2.analyze_e2b(b, e1, **FAST)

    def test_a_label_stands_when_d_keeps_e1s_sign_and_is_editor_dependent_otherwise(self):
        c = {(x["arm"], x["ref"]): x for x in self.res["contrasts"]}
        self.assertEqual(list(c), [("12", "P12"), ("ALL", "P_ALL")])
        self.assertEqual(c[("12", "P12")]["label"], "stands")
        self.assertEqual(c[("ALL", "P_ALL")]["label"], "editor-dependent")
        self.assertAlmostEqual(c[("12", "P12")]["e1_mean_d"], 0.04)
        self.assertAlmostEqual(c[("ALL", "P_ALL")]["e1_mean_d"], 0.07)
        self.assertLess(c[("ALL", "P_ALL")]["mean_d"], 0)

    def test_the_e2b_judges_and_pages_whose_edits_failed(self):
        self.assertEqual(self.res["judges"], [G, Q5])
        self.assertEqual(self.res["mode"], "two-judge")
        c = {(x["arm"], x["ref"]): x for x in self.res["contrasts"]}
        self.assertEqual(c[("12", "P12")]["n"], 33)
        self.assertEqual(c[("12", "P12")]["status"], "ok")
        failed = self.res["versions"]["12"]
        self.assertEqual((failed["valid"], failed["invalid"]), (33, 2))
        self.assertEqual([f["query_id"] for f in failed["failed"]], ["b00", "b01"])

    def test_versions_are_also_reported_against_the_original(self):
        rows = {(x["arm"], x["ref"]): x for x in self.res["reported"]}
        self.assertEqual(set(rows), {("12", "original"), ("P12", "original"), ("ALL", "original"),
                                     ("P_ALL", "original")})
        self.assertEqual(rows[("ALL", "original")]["label"], "reported without a verdict")

    def test_few_queries_are_flagged_but_the_sign_rule_still_applies(self):
        b, e1 = synthetic_e2b(n=6)
        res = a2.analyze_e2b(b, e1, **FAST)
        c = {(x["arm"], x["ref"]): x for x in res["contrasts"]}
        self.assertEqual(c[("12", "P12")]["status"], "insufficient n")
        self.assertTrue(c[("12", "P12")]["few_queries"])
        self.assertEqual(c[("12", "P12")]["label"], "stands")

    def test_unfinished_answers_give_no_label(self):
        b, e1 = synthetic_e2b()
        b.completion = [dict(r, missing=8) if r["arm"] == "P_ALL" else r for r in b.completion]
        res = a2.analyze_e2b(b, e1, **FAST)
        c = {(x["arm"], x["ref"]): x for x in res["contrasts"]}
        self.assertEqual(c[("ALL", "P_ALL")]["label"], "not completed")


class CliAndReport(unittest.TestCase):
    def test_main_writes_analysis_and_plain_language_results(self):
        e1, e2a = synthetic()
        b, e1b = synthetic_e2b()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            d = {k: root / k for k in ("e1d", "e1o", "ad", "ao", "bd", "bo", "out")}
            # E1 holds both the E2a synthetic set and the E2b reference cells.
            write_inputs(d["e1d"], d["e1o"], an.Inputs(
                pages=e1.pages + e1b.pages, versions=e1.versions + e1b.versions,
                applicability=e1.applicability + e1b.applicability, cells=e1.cells + e1b.cells,
                completion=e1.completion + e1b.completion))
            write_inputs(d["ad"], d["ao"], an.Inputs(pages=[], versions=e2a["versions"], applicability=[],
                                                     cells=e2a["cells"], completion=e2a["completion"]))
            write_inputs(d["bd"], d["bo"], b)
            with contextlib.redirect_stdout(io.StringIO()):
                a2.main(["--e1-data", str(d["e1d"]), "--e1-out", str(d["e1o"]), "--e2a-data", str(d["ad"]),
                     "--e2a-out", str(d["ao"]), "--e2b-data", str(d["bd"]), "--e2b-out", str(d["bo"]),
                     "--out", str(d["out"]), "--draws", "2000", "--resamples", "500"])
            result = json.loads((d["out"] / "analysis_e2.json").read_text())
            self.assertEqual(set(result), {"e2a", "e2b", "settings"})
            self.assertEqual(set(result["e2a"]), {"main", "replication"})
            labels = {(c["arm"], c["ref"]): c["label"] for c in result["e2b"]["contrasts"]}
            self.assertEqual(labels, {("12", "P12"): "stands", ("ALL", "P_ALL"): "editor-dependent"})
            r2.main(["--out", str(d["out"])])
            text = (d["out"] / "RESULTS_E2.md").read_text()
        self.assertIn("planned test", text)
        self.assertIn("reported without a verdict", text)
        self.assertRegex(text, r"\| ALL vs P_ALL \|.*\| editor-dependent \|")
        self.assertRegex(text, r"\| 12 vs P12 \|.*\| stands \|")
        self.assertIn("The heading markup carries the gain", text)
        self.assertIn(r2.CAVEAT, text)
        for word in ("registered", "Registered", "exploratory", "Exploratory", "\u2014"):  # no em dash
            self.assertNotIn(word, text)

    def test_a_part_without_inputs_is_not_run(self):
        e1, e2a = synthetic()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_inputs(root / "e1d", root / "e1o", e1)
            write_inputs(root / "ad", root / "ao", an.Inputs(pages=[], versions=e2a["versions"], applicability=[],
                                                             cells=e2a["cells"], completion=e2a["completion"]))
            with contextlib.redirect_stdout(io.StringIO()):
                a2.main(["--e1-data", str(root / "e1d"), "--e1-out", str(root / "e1o"), "--e2a-data", str(root / "ad"),
                     "--e2a-out", str(root / "ao"), "--e2b-data", str(root / "none"), "--e2b-out", str(root / "none"),
                     "--out", str(root / "out"), "--draws", "2000", "--resamples", "500"])
            result = json.loads((root / "out" / "analysis_e2.json").read_text())
            self.assertEqual(result["e2b"]["status"], "not run")
            r2.main(["--out", str(root / "out")])
            self.assertIn("E2b has not run", (root / "out" / "RESULTS_E2.md").read_text())


if __name__ == "__main__":
    unittest.main()
