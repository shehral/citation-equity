"""Tests for sanitize_e5.py: E2's quote rule on validator messages only, and the page-text check before writing.

Run: python3 -I -m unittest discover -s experiments/e5/tests
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
E5 = Path(__file__).resolve().parents[1]
for p in (E5, E5.parent / "e1"):
    sys.path.insert(0, str(p))

import analyze_e5 as a5  # noqa: E402
import sanitize_e5 as sz  # noqa: E402
from e1_common import write_json, write_jsonl  # noqa: E402

PAGE = "Granite counters resist heat because quartz crystals lock together under pressure deep below the crust."
Q_G = "Why do granite counters resist heat?"


class Sanitize(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.data, self.out, self.dest = root / "data", root / "out", root / "dest"
        self.data.mkdir()
        self.out.mkdir()
        write_jsonl(self.data / "pages.jsonl", [{"query_id": "q1", "title": "Stone surfaces", "text": PAGE}])
        write_jsonl(self.data / "versions.jsonl", [{"query_id": "q1", "arm": "9", "title": "Stone surfaces",
                                                    "text": "## a question\n\n" + PAGE}])
        write_jsonl(self.data / "edit_texts.jsonl", [{"query_id": "q1", "q_G": Q_G}])
        self.analysis = {"note": a5.A3_NOTE, "validity": {"main": {"all": {"12": {"failed_by_reason": {
            "invalid: Unknown span id 'span id=\"granite\"'; use only the page's ids": 2}}}}},
            "rows": [{"excluded_reason": "invalid: the heading \"Why granite\" is the page's first H2"}]}
        write_json(self.out / "e5_results.json", {"contrasts": [{"contrast": "9 vs original", "label": "helps"}]})
        write_json(self.out / "score_summary.json", {"answers": 3})

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *extra):
        write_json(self.out / "analysis_e5.json", self.analysis)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            sz.main(["--out", str(self.out), "--data", str(self.data), "--dest", str(self.dest), *extra])

    def test_quoted_fragments_in_validator_messages_only(self):
        self.run_main()
        got = json.loads((self.dest / "analysis_e5.json").read_text())
        key = next(iter(got["validity"]["main"]["all"]["12"]["failed_by_reason"]))
        self.assertEqual(key, "invalid: Unknown span id 'span id=\"…\"'; use only the page's ids")
        self.assertEqual(got["rows"][0]["excluded_reason"], "invalid: the heading \"…\" is the page's first H2")
        self.assertEqual(got["note"], a5.A3_NOTE)  # prose outside validator messages is never touched
        for name in sz.FILES:
            self.assertTrue((self.dest / name).exists())

    def test_page_text_left_anywhere_stops_before_writing(self):
        self.analysis["note"] = "see: " + PAGE[:70]
        with self.assertRaises(SystemExit):
            self.run_main()
        self.assertFalse(self.dest.exists())

    def test_a_whole_page_question_is_caught(self):
        self.analysis["rows"].append({"question": Q_G})
        with self.assertRaises(SystemExit):
            self.run_main()

    def test_a_check_file_is_checked_and_not_written(self):
        md = self.out / "RESULTS_E5.md"
        md.write_text("Results.\n\n" + PAGE + "\n")
        with self.assertRaises(SystemExit):
            self.run_main("--check", str(md))
        md.write_text("Results without page words.\n")
        self.run_main("--check", str(md), "--check-only")
        self.assertFalse(self.dest.exists())

    def test_wording_from_our_own_code_is_authored(self):
        authored = a5.A3_NOTE  # also in a page here, but written in analyze_e5.py
        write_jsonl(self.data / "pages.jsonl", [{"query_id": "q1", "title": "Stone surfaces", "text": authored}])
        self.run_main()
        self.assertTrue((self.dest / "analysis_e5.json").exists())

    def test_apostrophes_never_open_a_quote(self):
        text = "the page's first H2 is the edit's text"
        self.assertEqual(sz.scrub_reason(text), text)


if __name__ == "__main__":
    unittest.main()
