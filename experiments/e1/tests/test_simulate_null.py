"""Tests for simulate_null.py: label shuffling and about 5% familywise false positives per family.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
E1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E1))

import simulate_null as sn  # noqa: E402


class Shuffle(unittest.TestCase):
    def test_labels_are_permuted_within_each_query_only(self):
        inp = sn.synthetic_inputs(n_queries=5, seed=1)
        shuffled = sn.shuffle_labels(inp.cells, np.random.default_rng(0))
        before = {(c["query_id"], c["judge"], c["arm"]): c["score"] for c in inp.cells}
        after = {(c["query_id"], c["judge"], c["arm"]): c["score"] for c in shuffled}
        self.assertEqual(set(before), set(after))
        for q in {c["query_id"] for c in inp.cells}:
            for j in {c["judge"] for c in inp.cells}:
                self.assertEqual(Counter(v for k, v in before.items() if k[:2] == (q, j)),
                                 Counter(v for k, v in after.items() if k[:2] == (q, j)))
        self.assertNotEqual(before, after)

    def test_both_judges_of_a_query_get_the_same_permutation(self):
        inp = sn.synthetic_inputs(n_queries=1, seed=1)
        shuffled = sn.shuffle_labels(inp.cells, np.random.default_rng(0))
        moved = {}
        for c in shuffled:
            moved.setdefault(c["arm"], set()).add(c["version_id"])
        self.assertTrue(all(len(v) == 1 for v in moved.values()))


class FamilywiseRate(unittest.TestCase):
    def test_about_five_percent_familywise_false_positives_per_family(self):
        result = sn.simulate(sims=300, n_queries=60, draws=10_000, seed=1)
        for family in ("A", "B", "ALL"):
            rate = result["families"][family]["fwer"]
            self.assertGreaterEqual(rate, 0.01, family)
            self.assertLessEqual(rate, 0.10, family)
        self.assertEqual(result["families"]["A"]["m"], 9)
        self.assertEqual(result["families"]["B"]["m"], 3)
        self.assertEqual(result["families"]["ALL"]["m"], 2)

    def test_without_holm_family_a_would_exceed_five_percent(self):
        result = sn.simulate(sims=300, n_queries=60, draws=10_000, seed=1)
        self.assertGreater(result["families"]["A"]["unadjusted_any"], 0.15)

    def test_cli_writes_the_simulation_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "null.json"
            sn.main(["--sims", "20", "--queries", "40", "--draws", "2000", "--out", str(out)])
            result = json.loads(out.read_text())
            self.assertEqual(result["sims"], 20)
            self.assertIn("mc_se", result["families"]["A"])


if __name__ == "__main__":
    unittest.main()
