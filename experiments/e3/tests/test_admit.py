"""Tests for admit.py: E3's two query sets from E1's candidates and draw rule, and the Python twin of
E1's applicability rules (checked against E1's frozen table when E1's data is present).

Run: python3 -I -m unittest discover -s experiments/e3/tests
"""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E3 = Path(__file__).resolve().parents[1]
E1 = E3.parent / "e1"
for p in (E3, E1, E1 / "tests"):
    sys.path.insert(0, str(p))

import admit  # noqa: E402
import common  # noqa: E402
import deterministic_arms as da  # noqa: E402
import draw  # noqa: E402
from helpers import check, fake_engine  # noqa: E402
from test_draw import query  # noqa: E402


def candidates():
    """Queries in dataset order: five-page q1..q5, four-page f1, f2, a three-page t1; q5 is the timing query."""
    rows = []
    for order, qid in enumerate(["q1", "q2", "f1", "q3", "t1", "q4", "f2", "q5"]):
        n = 4 if qid.startswith("f") else 3 if qid.startswith("t") else 5
        rows += query(qid, n_usable=n, order=order)
    return rows


class AdmitTest(unittest.TestCase):
    def setUp(self):
        # E1's admission with target 2: q1 and q2 (q5, the last five-page query, is the timing query).
        self.pages, self.summary = admit.admit(candidates(), target=2, floor=1)

    def test_e3_takes_the_five_page_queries_e1_did_not_use(self):
        sets = {}
        for p in self.pages:
            sets.setdefault(p["set"], set()).add(p["query_id"])
        self.assertEqual(sets, {"e3": {"q3", "q4"}, "e3-four": {"f1", "f2"}})
        self.assertEqual(self.summary["e3"]["query_ids"], ["q3", "q4"])
        self.assertEqual(self.summary["timing"], ["q5"])
        self.assertEqual(self.summary["e1_main"], 2)

    def test_roles_are_e1s_draw_and_four_page_queries_have_no_donor(self):
        for qid, n in (("q3", 5), ("f1", 4)):
            mine = [p for p in self.pages if p["query_id"] == qid]
            usable = [r for r in candidates() if r["query_id"] == qid and r["usable"]]
            self.assertEqual([p["role"] for p in mine], draw.assign_roles(usable[0]["query"], usable))
            self.assertEqual(len(mine), n)
        self.assertNotIn("donor", [p["role"] for p in self.pages if p["set"] == "e3-four"])
        self.assertEqual(sorted(p["role"] for p in self.pages if p["query_id"] == "q3"),
                         ["competitor"] * 3 + ["donor", "target"])
        self.assertEqual(set(self.pages[0]), {"page_id", *draw.PAGE_KEYS, "role"})

    def test_a_different_e1_admission_stops(self):
        with self.assertRaises(ValueError):
            admit.admit(candidates(), e1_main_ids={"q1", "q3"}, target=2, floor=1)
        admit.admit(candidates(), e1_main_ids={"q1", "q2"}, target=2, floor=1)

    def test_e1s_four_page_fallback_stops(self):
        with self.assertRaises(ValueError):
            admit.admit(candidates(), target=2, floor=10)


def engine(checks):
    return fake_engine("Some text.", checks)


class ApplicabilityTwinTest(unittest.TestCase):
    def test_rules_follow_e1_lib(self):
        f = [{"start": 0, "end": 4, "message": "m"}]
        rule = admit.engine_arm_applicability
        self.assertEqual(rule("2", engine({"question-headings": check(0.5, findings=f)}), True), (True, None))
        self.assertEqual(rule("2", engine({"question-headings": check(0.9375, findings=f)}), True),
                         (False, "the question-headings check scores 0.938 (0.9 or more)"))
        self.assertEqual(rule("2", engine({"question-headings": check(0.5)}), True),
                         (False, "the question-headings check reports no span"))
        self.assertEqual(rule("5", engine({"statistics": check(0, findings=f)}), False),
                         (False, "no donor (four-page query)"))
        self.assertEqual(rule("4", engine({"tables": check(0.2, findings=f)}), True),
                         (False, "no Key: value list for the tables check to convert"))
        edit = [{"kind": "edit", "after": "| a | b |"}]
        self.assertEqual(rule("4", engine({"tables": check(0.2, suggestions=edit)}), True), (True, None))
        self.assertEqual(rule("8", engine({}), True), (False, "the direct-answer-lead check is not applicable"))

    def test_to_fixed_rounds_ties_up_as_javascript_does(self):
        self.assertEqual(admit.to_fixed(0.0625), "0.063")
        self.assertEqual(admit.to_fixed(0.9), "0.900")
        self.assertEqual(admit.to_fixed(1.0), "1.000")

    def test_arms_a_set_does_not_run_are_not_applicable(self):
        f = [{"start": 0, "end": 4, "message": "m"}]
        eng = engine({c: check(0.1, findings=f) for c in admit.ENGINE_CHECK.values()})
        target = {"page_id": "f1-p1", "query_id": "f1", "set": "e3-four", "query": "what is x", "title": "T",
                  "text": "Some text.", "role": "target"}
        rows = {r["arm"]: r for r in admit.applicability([target], {"f1-p1": eng})}
        self.assertEqual([a for a, r in rows.items() if r["applicable"]], ["2", "8", "10"])
        self.assertEqual(rows["5"]["reason"], admit.NOT_RUN["e3-four"])
        self.assertFalse(rows["ALL"]["applicable"])
        five = {**target, "set": "e3", "query_id": "q3", "page_id": "q3-p1"}
        donor = {**five, "role": "donor", "page_id": "q3-p2"}
        rows = {r["arm"]: r for r in admit.applicability([five, donor], {"q3-p1": eng})}
        self.assertEqual([a for a, r in rows.items() if r["applicable"]], ["2", "5", "6", "7", "8", "10"])
        self.assertEqual(rows["1"]["reason"], admit.NOT_RUN["e3"])

    def test_engine_rows_reuse_e1s_and_run_the_bridge_for_the_rest(self):
        targets = [{"page_id": "a-p1", "query_id": "a", "text": "A.", "query": "q"},
                   {"page_id": "b-p1", "query_id": "b", "text": "B.", "query": "q"}]
        seen = []

        def bridge(items):
            seen.extend(i["id"] for i in items)
            return {i["id"]: {"id": i["id"], "wordCount": 1, "checks": {}, "artifacts": {}} for i in items}

        rows, reused = admit.engine_rows(targets, {"a-p1": {"id": "a-p1", "query_id": "a", "wordCount": 9}}, bridge)
        self.assertEqual((reused, seen), (1, ["b-p1"]))
        self.assertEqual(rows[0], {"id": "a-p1", "query_id": "a", "wordCount": 9})
        self.assertEqual(rows[1]["query_id"], "b")


@unittest.skipUnless((E1 / "data" / "applicability.jsonl").exists() and (E1 / "data" / "engine_original.jsonl").exists(),
                     "E1's data (gitignored) is not here")
class E1ParityTest(unittest.TestCase):
    def test_the_twin_rebuilds_e1s_frozen_table(self):
        pages = common.read_jsonl(E1 / "data" / "pages.jsonl")
        engines = {r["id"]: r for r in common.read_jsonl(E1 / "data" / "engine_original.jsonl")}
        donors = {p["query_id"] for p in pages if p["role"] == "donor"}
        rows = []
        for p in pages:
            if p["role"] == "target":
                eng = engines[p["page_id"]]
                rows += admit.all_applicability(p["query_id"], p["set"], eng, p["query_id"] in donors,
                                                da.features(p, eng))
        self.assertEqual(rows, common.read_jsonl(E1 / "data" / "applicability.jsonl"))


class MainTest(unittest.TestCase):
    def test_never_writes_into_e1s_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            e1 = Path(tmp) / "e1"
            common.write_jsonl(e1 / "candidates.jsonl", candidates())
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                admit.main(["--e1-data", str(e1), "--out", str(e1)])
            self.assertEqual(sorted(x.name for x in e1.iterdir()), ["candidates.jsonl"])


if __name__ == "__main__":
    unittest.main()
