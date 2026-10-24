"""Tests for build_prompts.py: slot rotation, fixed order across versions, the prompt twin, refusal.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import random
import sys
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
E1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E1))
sys.path.insert(0, str(E1 / "tests"))

import build_prompts as bp  # noqa: E402
import fixtures  # noqa: E402

_SPEC = importlib.util.spec_from_file_location("batch_generate", E1.parent / "explorer" / "batch_generate.py")
batch_generate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(batch_generate)


def utf8_tokens(prompt: str) -> int:
    return len(prompt.encode("utf-8"))


class Slots(unittest.TestCase):
    def test_target_slot_rotates_so_each_slot_is_used_twice_over_seeds_1_to_8(self):
        slots = [bp.target_slot(s) for s in range(1, 9)]
        self.assertEqual(slots, [1, 2, 3, 4, 1, 2, 3, 4])

    def test_arrange_puts_the_target_in_its_slot_and_competitors_in_seeded_order(self):
        comps = [{"page_id": c, "title": c, "text": c} for c in ("q-p5", "q-p2", "q-p4")]
        target = {"title": "T", "text": "target"}
        for seed in range(1, 9):
            order = bp.arrange("why?", seed, target, comps)
            self.assertEqual(len(order), 4)
            self.assertIs(order[bp.target_slot(seed) - 1], target)
            expected = sorted(comps, key=lambda c: c["page_id"])
            random.Random(f"why?|{seed}").shuffle(expected)
            self.assertEqual([o for o in order if o is not target], expected)

    def test_competitor_order_does_not_depend_on_input_order(self):
        comps = [{"page_id": c, "title": c, "text": c} for c in ("a", "b", "c")]
        target = {"title": "T", "text": "t"}
        self.assertEqual(bp.arrange("q", 3, target, comps), bp.arrange("q", 3, target, comps[::-1]))

    def test_arrange_refuses_anything_but_three_competitors(self):
        with self.assertRaises(ValueError):
            bp.arrange("q", 1, {"title": "", "text": ""}, [{"page_id": "a", "title": "", "text": ""}])


class PromptTwin(unittest.TestCase):
    def test_layout_matches_build_prompt_in_prompt_ts(self):
        prompt = bp.build_prompt("Why?", [{"title": " A ", "text": "alpha"}, {"title": "", "text": "beta"}])
        self.assertTrue(prompt.startswith("Write an accurate and concise answer for the given user question"))
        self.assertIn("\n\nQuestion: Why?\n\nSearch Results:\n### Source [1]:\nA\nalpha\n\n\n### Source [2]:\nbeta\n\n", prompt)
        self.assertTrue(prompt.endswith("\n" + bp.REMINDER))
        self.assertEqual(bp.REMINDER, "Answer the question above using only these sources. Write in English. "
                                      "End every sentence with its citation, for example [1][2].")

    def test_placeholders_are_filled_in_one_pass_and_dollar_signs_stay_literal(self):
        prompt = bp.build_prompt("Is {source_text} $& here?", [{"title": "t", "text": "costs $1 {query}"}])
        self.assertIn("Question: Is {source_text} $& here?\n", prompt)
        self.assertIn("t\ncosts $1 {query}\n", prompt)

    def test_titles_are_trimmed_with_javascript_whitespace_rules(self):
        self.assertEqual(bp.js_trim("\ufeff\u00a0 x \u2028\u3000"), "x")
        # U+001C is whitespace to Python's str.strip but not to String.prototype.trim.
        self.assertEqual(bp.js_trim("\x1cx\x1c"), "\x1cx\x1c")
        prompt = bp.build_prompt("q", [{"title": "\ufeff \t", "text": "body"}])
        self.assertIn("### Source [1]:\nbody\n", prompt)


class BuildAll(unittest.TestCase):
    def setUp(self):
        self.pages = fixtures.pages()
        self.versions = fixtures.versions()
        self.appl = fixtures.applicability()

    def build(self, count=utf8_tokens, limit=31_000, versions=None):
        return bp.build_all(self.pages, versions or self.versions, self.appl, sets={"smoke"},
                            judges=["gemma-4-12b", "qwen3.8-27b"], seeds=range(1, 9),
                            count_tokens=count, limit=limit)

    def test_each_prompt_has_exactly_four_sources_and_no_donor(self):
        rows, refused = self.build()
        self.assertEqual(refused, [])
        donors = {p["title"] for p in self.pages if p["role"] == "donor"}
        for row in rows:
            self.assertEqual(row["prompt"].count("### Source ["), 4)
            self.assertIn("### Source [4]:", row["prompt"])
            for title in donors:
                self.assertNotIn(title, row["prompt"])

    def test_source_order_is_identical_across_versions_of_a_query_and_seed(self):
        rows, _ = self.build()
        comp_titles = {p["title"] for p in self.pages if p["role"] == "competitor"}
        orders = defaultdict(set)
        for row in rows:
            heads = [line for line in row["prompt"].split("\n") if line in comp_titles]
            orders[(row["query_id"], row["seed"])].add((tuple(heads), row["slot"]))
            self.assertEqual(row["slot"], bp.target_slot(row["seed"]))
        for key, seen in orders.items():
            self.assertEqual(len(seen), 1, key)

    def test_rows_carry_the_shared_fields_and_unique_keys(self):
        rows, _ = self.build()
        self.assertEqual(len({r["key"] for r in rows}), len(rows))
        for field in ("key", "query_id", "version_id", "arm", "judge", "seed", "slot", "prompt"):
            self.assertIn(field, rows[0])
        # 4 queries; s2 lost its invalid arm-5 version; s4 has no arm-11 version.
        per_query = defaultdict(set)
        for r in rows:
            per_query[r["query_id"]].add(r["arm"])
        self.assertNotIn("5", per_query["s2"])
        self.assertIn("P5", per_query["s2"])
        self.assertIn("original", per_query["s4"])
        self.assertEqual(len(rows), sum(len(a) for a in per_query.values()) * 8 * 2)

    def test_versions_of_not_applicable_pairs_are_never_prompted(self):
        extra = dict(self.versions[0], version_id="s4:11", query_id="s4", arm="11")
        rows, _ = self.build(versions=self.versions + [extra])
        self.assertFalse(any(r["version_id"] == "s4:11" for r in rows))

    def test_a_prompt_over_the_limit_excludes_its_query_from_every_arm(self):
        def count(prompt):
            return 40_000 if "Edited for arm 9." in prompt and "fix sour espresso" in prompt else 100

        rows, refused = self.build(count=count)
        self.assertEqual([r["query_id"] for r in refused], ["s2"])
        self.assertEqual(refused[0]["max_tokens"], 40_000)
        self.assertFalse(any(r["query_id"] == "s2" for r in rows))
        self.assertTrue(any(r["query_id"] == "s1" for r in rows))

    def test_limit_is_inclusive(self):
        rows, refused = self.build(count=lambda p: 31_000)
        self.assertEqual(refused, [])
        self.assertTrue(rows)

    def test_a_query_without_an_original_is_an_error(self):
        vs = [v for v in self.versions if v["version_id"] != "s1:original"]
        with self.assertRaises(ValueError):
            self.build(versions=vs)


class BatchFiles(unittest.TestCase):
    def test_batch_lines_are_prompt_lines_batch_generate_accepts(self):
        rows, _ = bp.build_all(fixtures.pages(), fixtures.versions(), fixtures.applicability(), sets={"smoke"},
                               judges=["gemma-4-12b"], seeds=range(1, 9), count_tokens=utf8_tokens, limit=31_000)
        files = bp.batch_files(rows)
        self.assertEqual(set(files), {"smoke.gemma-4-12b.tier1", "smoke.gemma-4-12b.tier2", "smoke.gemma-4-12b.tier3"})
        lines = files["smoke.gemma-4-12b.tier1"]
        text = "".join(json.dumps(x) + "\n" for x in lines)
        parsed = batch_generate.read_prompts(text)
        batch_generate.check_model(parsed, "google/gemma-4-12B-it")
        self.assertEqual(batch_generate.max_model_len(parsed), 32_768)
        self.assertEqual({p["temperature"] for p in parsed}, {0.5})
        self.assertEqual({p["seed"] for p in parsed}, set(range(1, 9)))
        tier1 = {r["arm"] for r in rows if r["key"] in {x["key"] for x in lines}}
        self.assertEqual(tier1, {"original", "5", "P5", "9", "ALL", "P_ALL"})
        self.assertEqual({r["arm"] for r in rows if r["key"] in {x["key"] for x in files["smoke.gemma-4-12b.tier3"]}},
                         {"1", "4", "11"})


class Cli(unittest.TestCase):
    def test_build_writes_prompts_batches_and_a_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            fixtures.write_fixture(data)
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                bp.main(["--data", str(data), "--sets", "smoke", "--tokens", "utf8"])
            self.assertIn("0 queries refused", printed.getvalue())
            rows = [json.loads(x) for x in (data / "prompts.jsonl").read_text().splitlines()]
            summary = json.loads((data / "prompt_build.json").read_text())
            self.assertEqual(summary["prompts"], len(rows))
            self.assertEqual(summary["refused"], [])
            self.assertEqual(summary["token_count"], "utf8")
            self.assertTrue((data / "batches" / "smoke.qwen3.8-27b.tier2.prompts.jsonl").exists())

    def test_twin_mode_prints_prompts_for_given_source_lists(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "in.json"
            src.write_text(json.dumps([{"query": "q?", "sources": [{"title": "a", "text": "b"}]}]))
            out = Path(tmp) / "out.json"
            bp.main(["--twin", str(src), "--twin-out", str(out)])
            self.assertEqual(json.loads(out.read_text()), [bp.build_prompt("q?", [{"title": "a", "text": "b"}])])


if __name__ == "__main__":
    unittest.main()
