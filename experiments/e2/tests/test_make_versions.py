"""Tests for make_versions.py: E2a's 9W and 9P rows from E1's data (experiments/PLAN_E2.md).

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

sys.dont_write_bytecode = True
E2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E2))
sys.path.insert(0, str(E2 / "tests"))

import e2_fixtures as fx  # noqa: E402
import make_versions as mv  # noqa: E402

FIELDS = ["version_id", "query_id", "set", "arm", "text", "title", "valid", "attempts", "excluded_reason",
          "edit_distance", "length_ratio", "key_terms_delta", "added_words", "skipped_steps"]


def build(**kw):
    return mv.build(fx.pages(), fx.versions(), engine=fx.fake_run_engine, **kw)


class Build(unittest.TestCase):
    def test_rows_only_where_e1s_arm_9_is_valid_on_main_and_replication(self):
        rows, summary = build()
        self.assertEqual([r["version_id"] for r in rows], ["m1:9W", "m1:9P", "m2:9W", "m2:9P", "r1:9W", "r1:9P"])
        self.assertEqual(summary["counts"]["main"]["9W"], {"versions": 2, "valid": 2})
        self.assertEqual(summary["counts"]["replication"]["9P"], {"versions": 1, "valid": 1})
        self.assertEqual(summary["e1_arm9_valid"], {"main": 2, "replication": 1})

    def test_rows_use_e1s_versions_schema(self):
        rows, _ = build()
        for r in rows:
            self.assertEqual(list(r), FIELDS)
            self.assertEqual((r["attempts"], r["skipped_steps"]), (1, []))
        m1 = {r["arm"]: r for r in rows if r["query_id"] == "m1"}
        self.assertEqual(m1["9W"]["title"], "m1 page 1")
        self.assertEqual(m1["9W"]["set"], "main")

    def test_9w_is_e1s_arm_9_text_without_the_heading_markup(self):
        rows, _ = build()
        nine = {v["query_id"]: v["text"] for v in fx.versions() if v["arm"] == "9"}
        for r in rows:
            if r["arm"] == "9W":
                q = fx.QUERIES[r["query_id"]][1]
                self.assertEqual(r["text"], nine[r["query_id"]].replace(f"## {q}\n\n", f"{q}\n\n", 1))
                self.assertTrue(r["valid"])
                self.assertIsNone(r["excluded_reason"])

    def test_9p_text_and_its_measures(self):
        rows, _ = build()
        m1 = next(r for r in rows if r["version_id"] == "m1:9P")
        self.assertTrue(m1["text"].startswith(
            "# Espresso guide\n\n## Coffee is brewed daily\n\nCoffee is brewed daily by many people here.\n\nCoffee is brewed"))
        self.assertEqual(m1["key_terms_delta"], 0)
        self.assertEqual(m1["added_words"], 12)  # amendment 1: S is the 8-word body sentence
        self.assertGreater(m1["length_ratio"], 1)
        self.assertGreater(m1["edit_distance"], 0)
        w = next(r for r in rows if r["version_id"] == "m1:9W")
        self.assertEqual(w["key_terms_delta"], 4)  # the query and the sentence each bring both key terms

    def test_a_9p_whose_heading_brings_a_key_term_not_in_s_is_invalid(self):
        self.assertIsNone(mv.check_9p("what is espresso extraction", "Water boils fast", "Water boils fast."))
        msg = mv.check_9p("what is espresso extraction", "Espresso water", "Water boils fast.")
        self.assertTrue(msg.startswith("invalid: "), msg)

    def test_an_unchanged_version_is_invalid(self):
        self.assertEqual(mv.differs("a", "a"), "invalid: the version is the same as the original")
        self.assertIsNone(mv.differs("a", "b"))

    def test_a_recomputed_arm_9_that_differs_from_e1s_stops_the_build(self):
        versions = [dict(v, text=v["text"] + "x") if v["version_id"] == "m2:9" else v for v in fx.versions()]
        with self.assertRaisesRegex(ValueError, "m2"):
            mv.build(fx.pages(), versions, engine=fx.fake_run_engine)

    def test_engine_rows_from_e1_are_used_when_given(self):
        calls = []

        def engine(items):
            calls.append(items)
            return fx.fake_run_engine(items)

        rows, _ = mv.build(fx.pages(), fx.versions(), engine=engine,
                           engine_rows={r["id"]: r for r in fx.engine_rows()})
        self.assertEqual(calls, [])
        self.assertEqual(len(rows), 6)

    def test_counts_where_s_is_arm_9s_own_sentence(self):
        _, summary = build()
        self.assertEqual(summary["s_is_arm9_sentence"], {"main": 0, "replication": 0})


class Cli(unittest.TestCase):
    def test_writes_versions_and_prints_counts_per_set_and_arm(self):
        with tempfile.TemporaryDirectory() as tmp:
            e1 = Path(tmp) / "e1"
            fx.e1_data(e1)
            out = Path(tmp) / "e2" / "versions.jsonl"
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                mv.main(["--e1-data", str(e1), "--out", str(out)])
            rows = [json.loads(x) for x in out.read_text().splitlines()]
            self.assertEqual(len(rows), 6)
            text = printed.getvalue()
            self.assertIn("main 9W: 2 versions, 2 valid", text)
            self.assertIn("replication 9P: 1 versions, 1 valid", text)
            summary = json.loads((out.parent / "make_versions.json").read_text())
            self.assertEqual(summary["e1_arm9_valid"]["main"], 2)

    def test_refuses_to_write_into_e1s_versions_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            e1 = Path(tmp) / "e1"
            fx.e1_data(e1)
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                mv.main(["--e1-data", str(e1), "--out", str(e1 / "versions.jsonl")])


if __name__ == "__main__":
    unittest.main()
