"""Tests for score.py: the citation score, validity, PAWC share and cell dropping.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E1))

import score  # noqa: E402


class CitationScore(unittest.TestCase):
    def test_target_cited_first_scores_one(self):
        s = score.score_answer("Espresso is bitter [2]. Grind coarser [1].", slot=2)
        self.assertEqual((s["valid"], s["rank"], s["score"], s["cited"]), (True, 1, 1.0, True))

    def test_uncited_target_has_rank_five_and_scores_zero(self):
        s = score.score_answer("Espresso is bitter [1][3]. Grind coarser [4].", slot=2)
        self.assertEqual((s["valid"], s["rank"], s["score"], s["cited"]), (True, 5, 0.0, False))

    def test_rank_counts_distinct_in_range_sources_in_order_of_first_citation(self):
        # First citations in order: 2, 3, 1 (repeats and out-of-range [5], [0] ignored).
        s = score.score_answer("A [2][2][5]. B [0][3]. C [2][1]. D [4].", slot=1)
        self.assertEqual((s["rank"], s["score"]), (3, 0.5))

    def test_an_answer_without_an_in_range_citation_is_invalid(self):
        for answer in ("No citations at all.", "Only out of range [5] and [0].", "Spaces [1, 2] do not count."):
            s = score.score_answer(answer, slot=1)
            self.assertFalse(s["valid"], answer)
            self.assertIsNone(s["score"])

    def test_punctuation_inside_a_marker_counts_as_in_the_bench(self):
        ((_, cits),) = score.parse_answer("x [1,] y [*2*] z [Source 3] w [ 4]")
        self.assertEqual(cits, [1, 2])


class Pawc(unittest.TestCase):
    def test_position_weighted_share_matches_a_hand_computation(self):
        # Sentence 0: 3 words of more than 2 characters, weight 1; sentence 1: 4 words, weight e^-1.
        answer = "Alpha beta gamma. [1] Delta epsilon zeta eta. [2]"
        s1 = 3.0
        s2 = 4 * math.exp(-1)
        self.assertAlmostEqual(score.score_answer(answer, slot=2)["pawc"], s2 / (s1 + s2), places=12)

    def test_parse_splits_sentences_and_keeps_markers_after_the_full_stop(self):
        sentences = score.parse_answer("One here. [1] Two? [2][3]\nThree [4]")
        self.assertEqual(sentences, [("One here. [1]", [1]), ("Two? [2][3]", [2, 3]), ("Three [4]", [4])])

    def test_word_count_uses_utf16_length_like_javascript(self):
        # An astral character is 2 UTF-16 code units, so a 2-character word of them has length 4.
        self.assertEqual(score.geo_word_count("\U0001d400\U0001d401 ab abc"), 2)


class Cells(unittest.TestCase):
    def row(self, valid, value=1.0, **kw):
        base = {"set": "smoke", "query_id": "q", "version_id": "q:original", "arm": "original", "judge": "g",
                "valid": valid, "score": value if valid else None, "cited": bool(value) if valid else None,
                "pawc": value if valid else None}
        return base | kw

    def test_a_cell_with_fewer_than_four_valid_answers_of_eight_is_dropped(self):
        rows = [self.row(True)] * 3 + [self.row(False)] * 5
        (cell,) = score.make_cells(rows)
        self.assertTrue(cell["dropped"])
        self.assertEqual((cell["n_answers"], cell["n_valid"]), (8, 3))
        self.assertEqual(cell["valid_rate"], 3 / 8)

    def test_a_cell_with_four_valid_answers_is_the_mean_over_valid_answers(self):
        rows = [self.row(True, 1.0), self.row(True, 0.5), self.row(True, 0.0), self.row(True, 0.25)]
        rows += [self.row(False)] * 4
        (cell,) = score.make_cells(rows)
        self.assertFalse(cell["dropped"])
        self.assertAlmostEqual(cell["score"], 0.4375)
        self.assertAlmostEqual(cell["cited"], 0.75)


class Main(unittest.TestCase):
    def test_scores_cells_and_missing_answers_are_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            (data / "answers").mkdir(parents=True)
            prompts = [{"key": f"g|v|{s}", "query_id": "q", "version_id": "v", "arm": "original", "judge": "g",
                        "seed": s, "slot": (s - 1) % 4 + 1, "prompt": "p", "set": "smoke", "tier": 1}
                       for s in range(1, 9)]
            (data / "prompts.jsonl").write_text("".join(json.dumps(p) + "\n" for p in prompts))
            answers = [{"key": f"g|v|{s}", "answer": f"Text [{(s - 1) % 4 + 1}].", "model": "m"} for s in range(1, 8)]
            (data / "answers" / "smoke.g.tier1.jsonl").write_text("".join(json.dumps(a) + "\n" for a in answers))
            score.main(["--data", str(data), "--out", str(out)])
            scores = [json.loads(x) for x in (out / "scores.jsonl").read_text().splitlines()]
            self.assertEqual(len(scores), 7)
            self.assertTrue(all(s["score"] == 1.0 for s in scores))
            summary = json.loads((out / "score_summary.json").read_text())
            self.assertEqual(summary["completion"], [{"set": "smoke", "judge": "g", "arm": "original",
                                                       "prompts": 8, "answered": 7, "missing": 1}])
            (cell,) = [json.loads(x) for x in (out / "cells.jsonl").read_text().splitlines()]
            self.assertEqual((cell["n_answers"], cell["n_valid"], cell["dropped"]), (7, 7, False))

    def test_conflicting_duplicate_answers_are_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            answers = Path(tmp)
            (answers / "a.jsonl").write_text(json.dumps({"key": "k", "answer": "one"}) + "\n")
            (answers / "b.jsonl").write_text(json.dumps({"key": "k", "answer": "two"}) + "\n")
            with self.assertRaises(ValueError):
                score.read_answers(answers)


if __name__ == "__main__":
    unittest.main()
