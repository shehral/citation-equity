"""E3 end to end on hand-made inputs: the editor with three attempts on the new sets, prompts, fake
answers, score.py on E3's sets, analyze_e3.py with E1's synthetic folder, and the report.

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
for p in (E3, E3 / "tests", E1, E1 / "tests"):
    sys.path.insert(0, str(p))

import analyze_e3  # noqa: E402
import build_prompts  # noqa: E402
import common  # noqa: E402
import editor  # noqa: E402
import fake_answers  # noqa: E402
import report_e3  # noqa: E402
import score  # noqa: E402
from test_analyze_e3 import world  # noqa: E402
from test_editor import QUERY, TEXT, toy_engine  # noqa: E402
from test_editor_e3 import Scripted  # noqa: E402


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args)


def new_pages() -> list[dict]:
    rows = []
    for qid, set_, roles in (("n1", "e3", ["target", "competitor", "competitor", "competitor", "donor"]),
                             ("f1", "e3-four", ["target", "competitor", "competitor", "competitor"])):
        for i, role in enumerate(roles, start=1):
            rows.append({"page_id": f"{qid}-p{i}", "query_id": qid, "set": set_, "query": QUERY,
                         "url": f"https://site{i}.org/{qid}", "source": "live", "title": f"T{i}",
                         "text": TEXT if role == "target" else f"Page {i} about espresso.", "words": 30,
                         "tokens_max": 40, "cut": False, "sha256": "0" * 64, "role": role})
    return rows


class PipelineTest(unittest.TestCase):
    def test_new_queries_from_edits_to_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data, out = root / "e3data", root / "e3out"
            pages = new_pages()
            applicability = [{"query_id": q, "arm": "2", "applicable": True, "reason": None} for q in ("n1", "f1")]
            common.write_jsonl(data / "pages.jsonl", pages)
            common.write_jsonl(data / "applicability.jsonl", applicability)
            rows = editor.run(pages, applicability, Scripted(fix_at=3), arms=["2"], engine=toy_engine,
                              do_all=False, max_attempts=3)
            common.write_jsonl(data / "versions.jsonl", rows)
            by = {r["version_id"]: r for r in rows}
            self.assertEqual({k: (v["valid"], v["attempts"]) for k, v in by.items() if v["arm"] != "original"},
                             {"n1:2": (True, 3), "f1:2": (True, 3), "n1:P2": (True, 3), "f1:P2": (True, 3)})

            quiet(build_prompts.main, ["--data", str(data), "--sets", "e3,e3-four", "--tokens", "utf8"])
            built = json.loads((data / "prompt_build.json").read_text())
            self.assertEqual(built["batches"]["e3.gemma-4-12b.tier2"], 16)
            self.assertEqual(built["batches"]["e3-four.qwen3.8-27b.tier1"], 8)
            fake_answers.write_answers(data)
            quiet(score.main, ["--data", str(data), "--out", str(out / "new"), "--sets", "e3,e3-four"])
            self.assertTrue((out / "new" / "cells.jsonl").exists())

            e1, _, _ = world()
            e1d, e1o = root / "e1d", root / "e1o"
            common.write_jsonl(e1d / "pages.jsonl", e1.pages)
            common.write_jsonl(e1d / "applicability.jsonl", [])
            common.write_jsonl(e1d / "versions.jsonl", e1.versions)
            common.write_jsonl(e1o / "cells.jsonl", e1.cells)
            quiet(analyze_e3.main, ["--e1-data", str(e1d), "--e1-out", str(e1o), "--new-data", str(data),
                                    "--new-out", str(out / "new"), "--retry-data", str(root / "none"),
                                    "--retry-out", str(root / "none"), "--out", str(out),
                                    "--draws", "2000", "--resamples", "500"])
            res = json.loads((out / "analysis_e3.json").read_text())
            self.assertEqual(res["parts"], {"e1": "ok", "new": "ok", "retry": "not run"})
            arm2 = next(c for c in res["contrasts"] if c["arm"] == "2")
            self.assertEqual(arm2["n"], 22)  # E1's 20 pairs and the two new queries
            new2 = next(c for c in res["breakdowns"]["new_queries"]["contrasts"] if c["arm"] == "2")
            self.assertEqual(new2["n"], 2)
            quiet(report_e3.main, ["--out", str(out)])
            self.assertIn("2 new", (out / "RESULTS_E3.md").read_text())

    def test_score_still_refuses_an_unknown_set_and_keeps_e1s_default(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            score.main(["--sets", "e4"])
        self.assertEqual(score.SETS, ["main", "replication", "smoke", "timing"])


if __name__ == "__main__":
    unittest.main()
