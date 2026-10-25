"""Tests for e1_common.py: judges, arms, tiers and parent arms, including the E2 versions."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import e1_common as ec  # noqa: E402


class Judges(unittest.TestCase):
    def test_e1_judge_order_is_unchanged(self):
        self.assertEqual(ec.JUDGE_ORDER, ["gemma-4-12b", "qwen3.8-27b"])

    def test_the_e2b_judge_is_known(self):
        self.assertEqual(ec.JUDGES["qwen3.5-9b"], "Qwen/Qwen3.5-9B")
        self.assertEqual(ec.JUDGES["gemma-4-12b"], "google/gemma-4-12B-it")


class Arms(unittest.TestCase):
    def test_e2_versions_belong_to_arm_9_in_tier_1(self):
        for arm in ("9W", "9P"):
            self.assertEqual(ec.parent_arm(arm), "9")
            self.assertEqual(ec.tier(arm), 1)
        self.assertEqual(ec.E2_ARMS, ["9W", "9P"])

    def test_e1_parent_arms_are_unchanged(self):
        self.assertEqual(ec.parent_arm("P12"), "12")
        self.assertEqual(ec.parent_arm("P_ALL"), "ALL")
        self.assertEqual(ec.parent_arm("9"), "9")
        self.assertEqual(ec.tier("P12"), 2)
        self.assertNotIn("9W", ec.ARMS)


if __name__ == "__main__":
    unittest.main()
