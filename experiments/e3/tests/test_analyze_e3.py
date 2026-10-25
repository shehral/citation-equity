"""Tests for analyze_e3.py and report_e3.py on synthetic cells (experiments/PLAN_E3.md, Analysis).

Run: python3 -I -m unittest discover -s experiments/e3/tests
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
E3 = Path(__file__).resolve().parents[1]
E1 = E3.parent / "e1"
for p in (E3, E1):
    sys.path.insert(0, str(p))

import analyze as an  # noqa: E402
import analyze_e3 as a3  # noqa: E402
import report_e3  # noqa: E402
from e1_common import JUDGE_ORDER, write_json, write_jsonl  # noqa: E402

FAST = {"draws": 2000, "resamples": 500}
GAIN = 0.05


def target(qid: str, set_: str) -> dict:
    return {"page_id": f"{qid}-p1", "query_id": qid, "set": set_, "role": "target", "url": f"https://x.org/{qid}",
            "source": "live", "query": f"what is {qid}", "title": "T", "text": "t"}


def version(qid: str, arm: str, set_: str, valid: bool = True) -> dict:
    return {"version_id": f"{qid}:{arm}", "query_id": qid, "set": set_, "arm": arm, "valid": valid,
            "excluded_reason": None if valid else "invalid: x", "attempts": 1, "length_ratio": 1.0,
            "key_terms_delta": 0, "edit_distance": 3, "text": "t", "title": "T"}


def cell(qid: str, arm: str, set_: str, score: float) -> list[dict]:
    return [{"set": set_, "query_id": qid, "version_id": f"{qid}:{arm}", "arm": arm, "judge": j, "n_answers": 8,
             "n_valid": 8, "valid_rate": 1.0, "score": score, "cited": 1.0, "pawc": 0.2, "dropped": False}
            for j in JUDGE_ORDER]


def pair(qid: str, set_: str, i: int, *, arm="2", ref="P2", gain=GAIN):
    """Valid versions and cells of an arm and its reference; d varies a little by query."""
    d = gain + 0.01 * ((i % 5) - 2)
    return ([version(qid, arm, set_), version(qid, ref, set_)],
            cell(qid, arm, set_, 0.5 + d) + cell(qid, ref, set_, 0.5))


def inputs(pages, versions, cells, applicability=()) -> an.Inputs:
    return an.Inputs(pages=pages, versions=versions, applicability=list(applicability), cells=cells,
                     scores=[], completion=None, refused=[])


def world():
    """E1: 20 queries with arm 2 and P2 valid (e0-e19), 10 whose P2 failed (e20-e29), 10 whose arm 2
    failed (e30-e39), arm 6 valid on 5. Retry: P2 for e20-e29, arm 2 and P2 for e30-e34.
    New: 10 queries (n0-n9) with arm 2 and P2."""
    e_pages, e_versions, e_cells = [], [], []
    for i in range(40):
        q = f"e{i}"
        e_pages.append(target(q, "main"))
        e_versions.append(version(q, "original", "main"))
        e_cells += cell(q, "original", "main", 0.5)
        if i < 20:
            v, c = pair(q, "main", i)
        elif i < 30:
            v, c = [version(q, "2", "main"), version(q, "P2", "main", valid=False)], cell(q, "2", "main", 0.55)
            if i == 20:  # a stale cell for an invalid E1 version: the retried one must replace it
                c += cell(q, "P2", "main", 0.0)
        else:
            v, c = [version(q, "2", "main", valid=False)], []
        if i < 5:
            v6, c6 = pair(q, "main", i, arm="6", ref="P6")
            v, c = v + v6, c + c6
        e_versions += v
        e_cells += c
    e1 = inputs(e_pages, e_versions + [version("r1", "2", "replication")], e_cells)
    r_versions, r_cells = [], []
    for i in range(20, 35):
        q = f"e{i}"
        if i < 30:
            r_versions.append(version(q, "P2", "main"))
            r_cells += cell(q, "P2", "main", 0.5)
        else:
            v, c = pair(q, "main", i)
            r_versions += v
            r_cells += c
    retry = inputs(e_pages, r_versions, r_cells)
    n_pages, n_versions, n_cells = [], [], []
    for i in range(10):
        q = f"n{i}"
        n_pages.append(target(q, "e3" if i < 5 else "e3-four"))
        v, c = pair(q, n_pages[-1]["set"], i)
        n_versions += [version(q, "original", n_pages[-1]["set"])] + v
        n_cells += cell(q, "original", n_pages[-1]["set"], 0.5) + c
    new = inputs(n_pages, n_versions, n_cells)
    return e1, new, retry


def by_arm(rows):
    return {c["arm"]: c for c in rows}


class PoolingTest(unittest.TestCase):
    def setUp(self):
        e1, new, retry = world()
        self.res = a3.analyze(e1, new, retry, e1_labels={("2", "P2"): {"label": "insufficient n", "n": 20,
                                                                        "mean_d": 0.05}}, **FAST)
        self.c = by_arm(self.res["contrasts"])

    def test_every_query_with_a_valid_pair_counts_once(self):
        self.assertEqual(self.c["2"]["n"], 20 + 10 + 5 + 10)
        self.assertEqual(self.res["queries_by_part"], {"e1": 40, "new": 10})
        self.assertAlmostEqual(self.c["2"]["mean_d"], GAIN, places=2)

    def test_the_holm_family_holds_only_arms_with_30_queries_and_labels_are_e1s(self):
        self.assertEqual(self.res["family"]["arms"], ["2"])
        self.assertEqual(self.c["2"]["label"], "helps")
        self.assertEqual(self.c["2"]["e1"]["label"], "insufficient n")
        self.assertEqual((self.c["6"]["n"], self.c["6"]["label"]), (5, "insufficient n"))
        self.assertEqual(self.c["4"]["label"], "not run")
        self.assertIsNone(self.c["6"]["p_holm"])

    def test_a_retried_version_replaces_e1s_row_and_cell(self):
        e1, new, retry = world()
        merged = a3.with_retries(a3.e1_part(e1), retry)
        ix = an.Index(merged)
        self.assertTrue(ix.usable_version("e20", "P2"))
        self.assertEqual(ix.cell[("e20", "P2", JUDGE_ORDER[0])]["score"], 0.5)
        self.assertEqual(sum(1 for v in merged.versions if v["version_id"] == "e20:P2"), 1)
        self.assertNotIn("replication", {v["set"] for v in merged.versions})

    def test_the_breakdowns_split_the_pool_without_verdicts(self):
        b = self.res["breakdowns"]
        n = {k: by_arm(v["contrasts"])["2"]["n"] for k, v in b.items()}
        self.assertEqual(n, {"new_queries": 10, "e1_queries_with_retries": 35, "e1_as_run": 20})
        labels = {by_arm(v["contrasts"])["2"]["label"] for v in b.values()}
        self.assertEqual(labels, {a3.REPORTED})
        self.assertTrue(all(c["p_holm"] is None for v in b.values() for c in v["contrasts"]))

    def test_a_missing_part_is_not_run_and_e1_alone_is_e1s_result(self):
        e1, _, _ = world()
        res = a3.analyze(e1, None, None, **FAST)
        self.assertEqual(res["parts"], {"e1": "ok", "new": "not run", "retry": "not run"})
        self.assertEqual(by_arm(res["contrasts"])["2"]["n"], 20)
        self.assertEqual(res["breakdowns"]["new_queries"]["status"], "not run")
        # The pooled contrast on E1 alone is E1's own analysis of the same pairs.
        ix = an.Index(e1, "main")
        d, _ = an.query_differences(ix, "2", "P2", JUDGE_ORDER, "score")
        self.assertEqual((len(d), round(sum(d.values()) / len(d), 9)),
                         (20, round(by_arm(res["contrasts"])["2"]["mean_d"], 9)))


class ReportTest(unittest.TestCase):
    def test_the_report_is_plain_language(self):
        e1, new, retry = world()
        text = report_e3.render(a3.analyze(e1, new, retry, **FAST))
        self.assertIn("| Question headings (arm 2) | placebo (P2) | 45 |", text)
        self.assertIn("helps", text)
        self.assertIn("too few queries for a verdict", text)
        for word in ("—", "registered", "exploratory", "δ"):
            self.assertNotIn(word, text)


class MainTest(unittest.TestCase):
    def test_reads_the_folders_and_writes_the_analysis_and_report(self):
        e1, new, retry = world()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folders = {"e1": (root / "e1d", root / "e1o", e1), "new": (root / "nd", root / "no", new),
                       "retry": (root / "rd", root / "ro", retry)}
            for name, (data, out, inp) in folders.items():
                if name != "retry":
                    write_jsonl(data / "pages.jsonl", inp.pages)
                    write_jsonl(data / "applicability.jsonl", inp.applicability)
                write_jsonl(data / "versions.jsonl", inp.versions)
                write_jsonl(out / "cells.jsonl", inp.cells)
            write_json(root / "e1o" / "analysis.json", {"main": {"contrasts": [
                {"arm": "2", "ref": "P2", "label": "insufficient n", "n": 20, "mean_d": 0.05}]}})
            out = root / "e3o"
            argv = ["--e1-data", str(root / "e1d"), "--e1-out", str(root / "e1o"), "--new-data", str(root / "nd"),
                    "--new-out", str(root / "no"), "--retry-data", str(root / "rd"), "--retry-out", str(root / "ro"),
                    "--out", str(out), "--draws", "2000", "--resamples", "500"]
            with contextlib.redirect_stdout(io.StringIO()):
                a3.main(argv)
                report_e3.main(["--out", str(out)])
            res = json.loads((out / "analysis_e3.json").read_text())
            self.assertEqual(res["parts"], {"e1": "ok", "new": "ok", "retry": "ok"})
            self.assertEqual(by_arm(res["contrasts"])["2"]["e1"]["n"], 20)
            self.assertIn("E3 results", (out / "RESULTS_E3.md").read_text())


if __name__ == "__main__":
    unittest.main()
