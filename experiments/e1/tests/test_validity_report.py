"""Tests for validity_report.py: per-arm valid / invalid / not-applicable counts, top reasons,
the 20% flag and ALL's skipped steps (r3 amendment 9)."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import common  # noqa: E402
import validity_report  # noqa: E402


def row(arm, valid=True, reason=None, skipped=None, qid="q1"):
    r = {"version_id": f"{qid}:{arm}", "query_id": qid, "set": "main", "arm": arm, "text": "t", "title": "T",
         "valid": valid, "attempts": 1 if valid else 2, "excluded_reason": reason}
    if skipped is not None:
        r["skipped_steps"] = skipped
    return r


ROWS = [
    row("original"),
    row("1", False, "invalid: Every flagged paragraph must open by naming its subject instead of a pointer like 'This' or 'It'."),
    row("1", qid="q2"),
    row("P2", False, "invalid: The paraphrase must keep the spans' length within 10% (19 -> 17 words).", qid="q1"),
    row("P2", False, "invalid: The paraphrase must keep the spans' length within 10% (130 -> 116 words). "
                     "| Keep exactly the query key terms the spans contain (lost: ['mak'], added: []).", qid="q2"),
    row("P2", qid="q3"),
    row("7", False, "not applicable: the editor returned NONE"),
    row("ALL", skipped=[{"step": "1", "reason": "invalid: Every flagged paragraph must open ..."}]),
    row("ALL", qid="q2", skipped=[{"step": "1", "reason": "invalid: x"}, {"step": "3", "reason": "invalid: y"}]),
    row("ALL", False, "invalid: every step failed", qid="q3", skipped=[{"step": "2", "reason": "invalid: z"}]),
    row("ALL", False, "not applicable: no step applied", qid="q4", skipped=[]),
    row("10", qid="q1"),
]


class SummaryTest(unittest.TestCase):
    def test_counts_per_arm_in_arm_order(self):
        s = validity_report.summarize(ROWS)
        self.assertEqual(list(s), ["1", "7", "10", "P2", "ALL"])  # the original is not an edit
        self.assertEqual({k: s["P2"][k] for k in ("versions", "valid", "invalid", "not_applicable")},
                         {"versions": 3, "valid": 1, "invalid": 2, "not_applicable": 0})
        self.assertEqual((s["7"]["invalid"], s["7"]["not_applicable"], s["7"]["invalid_share"]), (0, 1, None))
        self.assertEqual(s["1"]["invalid_share"], 0.5)

    def test_reasons_are_split_and_grouped_with_numbers_masked(self):
        reasons = dict(validity_report.summarize(ROWS)["P2"]["reasons"])
        self.assertEqual(reasons["The paraphrase must keep the spans' length within N% (N -> N words)."], 2)
        self.assertEqual(reasons["Keep exactly the query key terms the spans contain (lost: ['mak'], added: [])."], 1)
        self.assertEqual(list(reasons)[0], "The paraphrase must keep the spans' length within N% (N -> N words).")

    def test_more_than_20_percent_exclusions_is_flagged(self):
        s = validity_report.summarize(ROWS)
        self.assertTrue(s["1"]["flagged"])
        self.assertFalse(s["10"]["flagged"])
        self.assertFalse(s["7"]["flagged"])  # not applicable is not a validity exclusion

    def test_all_counts_its_skipped_steps(self):
        a = validity_report.summarize(ROWS)["ALL"]
        self.assertEqual(a["skipped_steps"], {"1": 2, "2": 1, "3": 1})
        self.assertEqual(a["with_skipped_steps"], 3)
        self.assertEqual((a["valid"], a["invalid"], a["not_applicable"]), (2, 1, 1))

    def test_rows_without_skipped_steps_still_read(self):
        s = validity_report.summarize([row("ALL", False, "invalid: step 1: Every flagged paragraph ...")])
        self.assertEqual(s["ALL"]["skipped_steps"], {})
        self.assertEqual(dict(s["ALL"]["reasons"]), {"step N: Every flagged paragraph ...": 1})


class CliTest(unittest.TestCase):
    def test_prints_a_table_and_writes_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            versions, out = Path(tmp) / "versions.jsonl", Path(tmp) / "report.json"
            common.write_jsonl(versions, ROWS)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                validity_report.main([str(versions), "--top", "1", "--json", str(out)])
            text = buf.getvalue()
            self.assertIn("P2", text)
            self.assertIn("valid 1, invalid 2, not applicable 0", text)
            self.assertIn("FLAGGED", text)
            self.assertIn("skipped steps: 1 x2, 2 x1, 3 x1", text)
            self.assertNotIn("Keep exactly the query key terms", text)  # --top 1
            report = json.loads(out.read_text())
            self.assertEqual(report["per_arm"]["P2"]["invalid"], 2)
            self.assertEqual(report["versions"], len(ROWS))


if __name__ == "__main__":
    unittest.main()
