"""Tests for reuse_e3.py and E3's prompt folders: E1 answers are reused only for byte-identical
prompts with the same key, for each judge, and build_prompts.py runs on E3's sets.

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
for p in (E3, E1):
    sys.path.insert(0, str(p))

import build_prompts as bp  # noqa: E402
import reuse_e3  # noqa: E402
from e1_common import read_jsonl, write_jsonl  # noqa: E402


def pages(qid: str, set_: str, n_competitors: int = 3, donor: bool = True) -> list[dict]:
    rows = [{"page_id": f"{qid}-p1", "query_id": qid, "set": set_, "query": f"what is {qid}", "role": "target",
             "title": "Target", "text": f"{qid} is a thing."}]
    rows += [{"page_id": f"{qid}-p{i + 2}", "query_id": qid, "set": set_, "query": f"what is {qid}",
              "role": "competitor", "title": f"C{i}", "text": f"Competitor {i} on {qid}."} for i in range(n_competitors)]
    if donor:
        rows.append({"page_id": f"{qid}-p9", "query_id": qid, "set": set_, "query": f"what is {qid}", "role": "donor",
                     "title": "D", "text": "Donor."})
    return rows


def version(qid: str, arm: str, text: str, set_: str, valid: bool = True) -> dict:
    return {"version_id": f"{qid}:{arm}", "query_id": qid, "set": set_, "arm": arm, "title": "Target", "text": text,
            "valid": valid, "attempts": 1, "excluded_reason": None if valid else "invalid: x"}


def build(folder: Path, sets: str, without_original: bool = False) -> None:
    argv = ["--data", str(folder), "--sets", sets, "--tokens", "utf8"] + (["--without-original"] if without_original else [])
    with contextlib.redirect_stdout(io.StringIO()):
        bp.main(argv)


class PromptFoldersTest(unittest.TestCase):
    def test_new_queries_get_prompts_for_their_originals_and_arms_in_their_own_batches(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_jsonl(d / "pages.jsonl", pages("n1", "e3") + pages("f1", "e3-four", donor=False))
            write_jsonl(d / "applicability.jsonl", [])
            write_jsonl(d / "versions.jsonl", [version("n1", "original", "n1 is a thing.", "e3"),
                                               version("n1", "2", "n1 is a thing?", "e3"),
                                               version("f1", "original", "f1 is a thing.", "e3-four"),
                                               version("f1", "8", "f1 is new.", "e3-four", valid=False)])
            build(d, "e3,e3-four")
            batches = json.loads((d / "prompt_build.json").read_text())["batches"]
            self.assertEqual(batches, {"e3-four.gemma-4-12b.tier1": 8, "e3-four.qwen3.8-27b.tier1": 8,
                                       "e3.gemma-4-12b.tier1": 8, "e3.gemma-4-12b.tier2": 8,
                                       "e3.qwen3.8-27b.tier1": 8, "e3.qwen3.8-27b.tier2": 8})

    def test_a_retry_folder_holds_only_the_new_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_jsonl(d / "pages.jsonl", pages("m1", "main"))
            write_jsonl(d / "applicability.jsonl", [])
            write_jsonl(d / "versions.jsonl", [version("m1", "P2", "m1 is one thing.", "main")])
            build(d, "main", without_original=True)
            self.assertEqual({r["arm"] for r in read_jsonl(d / "prompts.jsonl")}, {"P2"})


class ReuseTest(unittest.TestCase):
    def test_reuses_only_byte_identical_prompts_for_each_judge(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            e1, e3 = root / "e1", root / "e3"
            for d in (e1, e3):
                write_jsonl(d / "pages.jsonl", pages("m1", "main"))
                write_jsonl(d / "applicability.jsonl", [])
            # E1 judged arm 2's version; E3 holds the same arm 2 text and a different P2 text.
            write_jsonl(e1 / "versions.jsonl", [version("m1", "original", "m1 is a thing.", "main"),
                                                version("m1", "2", "m1 is a thing?", "main"),
                                                version("m1", "P2", "m1 is one thing.", "main")])
            write_jsonl(e3 / "versions.jsonl", [version("m1", "2", "m1 is a thing?", "main"),
                                                version("m1", "P2", "m1 is some thing.", "main")])
            build(e1, "main")
            build(e3, "main", without_original=True)
            answers = [{"key": r["key"], "answer": f"answer for {r['key']}"} for r in read_jsonl(e1 / "prompts.jsonl")]
            write_jsonl(e1 / "answers" / "main.jsonl", answers)
            with contextlib.redirect_stdout(io.StringIO()):
                reuse_e3.main(["--data", str(e3), "--e1-prompts", str(e1 / "prompts.jsonl"),
                               "--e1-answers", str(e1 / "answers")])
            report = json.loads((e3 / "reuse.json").read_text())["judges"]
            for judge in ("gemma-4-12b", "qwen3.8-27b"):
                reused = read_jsonl(e3 / "answers" / f"reused-e1.{judge}.jsonl")
                self.assertEqual(len(reused), 8)
                self.assertTrue(all(r["key"].startswith(f"{judge}|m1:2|") and r["reused_from"] == "e1" for r in reused))
                self.assertEqual(report[judge]["reasons"], {"the E1 prompt differs": 8})
                left = read_jsonl(e3 / "batches" / f"main.{judge}.tier2.prompts.jsonl")
                self.assertEqual({x["draftId"] for x in left}, {"m1:P2"})
                self.assertEqual(report[judge]["batches"][f"main.{judge}.tier2"], {"before": 16, "after": 8})


if __name__ == "__main__":
    unittest.main()
