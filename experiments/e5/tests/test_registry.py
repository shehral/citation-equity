"""E5's arm registry in e1_common (PLAN_E5 tiers) leaves every E1/E2 lookup unchanged."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "e1"))

import e1_common as ec  # noqa: E402

# parent_arm and tier of every E1/E2 label before E5 (e1_common at 7c1c725).
E1_TABLE = {
    "original": ["original", 1], "1": ["1", 3], "2": ["2", 2], "3": ["3", 2], "4": ["4", 3], "5": ["5", 1],
    "6": ["6", 1], "7": ["7", 1], "8": ["8", 2], "9": ["9", 1], "10": ["10", 3], "11": ["11", 3],
    "12": ["12", 2], "13": ["13", 3], "14": ["14", 3], "ALL": ["ALL", 1], "P2": ["2", 2], "P3": ["3", 2],
    "P5": ["5", 1], "P6": ["6", 1], "P7": ["7", 1], "P8": ["8", 2], "P10": ["10", 3], "P12": ["12", 2],
    "P_ALL": ["ALL", 1], "9W": ["9", 1], "9P": ["9", 1],
}


class Registry(unittest.TestCase):
    def test_e1_and_e2_lookups_are_unchanged(self):
        for arm, (parent, tier) in E1_TABLE.items():
            self.assertEqual(ec.parent_arm(arm), parent, arm)
            self.assertEqual(ec.tier(arm), tier, arm)

    def test_e5_labels_and_tiers(self):
        self.assertEqual(ec.E5_ARMS, ["9K", "9L", "9A", "9G", "12K", "P12K"])
        tiers = {"9K": 1, "9L": 2, "9A": 3, "9G": 3, "12K": 2, "P12K": 2}
        for arm, tier in tiers.items():
            self.assertEqual(ec.tier(arm), tier, arm)

    def test_e5_parent_arms(self):
        for arm in ("9K", "9L", "9A", "9G", "12K"):
            self.assertEqual(ec.parent_arm(arm), arm)
        self.assertEqual(ec.parent_arm("P12K"), "12K")

    def test_e5_labels_are_not_e1_arms(self):
        for arm in ec.E5_ARMS:
            self.assertNotIn(arm, ec.ARMS)
            self.assertNotIn(arm, ec.PLACEBOS)


if __name__ == "__main__":
    unittest.main()
