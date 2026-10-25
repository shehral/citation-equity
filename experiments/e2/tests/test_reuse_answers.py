"""Tests for reuse_answers.py: E1 answers stand in for E2b prompts only when the prompt is byte-identical.

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
import reuse_answers as ra  # noqa: E402

G, Q = "gemma-4-12b", "qwen3.5-9b"


def prompt_row(judge, vid, seed, prompt, tier=1):
    qid, arm = vid.split(":")
    return {"key": f"{judge}|{vid}|{seed}", "query_id": qid, "version_id": vid, "arm": arm, "judge": judge,
            "seed": seed, "slot": (seed - 1) % 4 + 1, "prompt": prompt, "set": "main", "tier": tier}


def batch_line(row):
    return {"key": row["key"], "model": "m", "seed": row["seed"], "temperature": 0.5, "numCtx": 32768,
            "prompt": row["prompt"], "packId": "e1-main", "draftId": row["version_id"],
            "queryId": row["query_id"], "run": row["seed"]}


class Reuse(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.e1_prompts = root / "e1" / "prompts.jsonl"
        self.e1_answers = root / "e1" / "answers"
        self.data = root / "e2b"
        e1 = [prompt_row(G, "m1:original", 1, "P one"), prompt_row(G, "m1:original", 2, "P two"),
              prompt_row(G, "m2:original", 1, "P old"), prompt_row(G, "m2:original", 2, "P four"),
              prompt_row("qwen3.8-27b", "m1:original", 1, "P one")]
        fx.write_jsonl(self.e1_prompts, e1)
        answers = [{"key": r["key"], "answer": f"answer to {r['key']} [1].", "model": "google/gemma-4-12B-it"}
                   for r in e1 if r["key"] != f"{G}|m2:original|2"]
        fx.write_jsonl(self.e1_answers / "main.gemma-4-12b.tier1.jsonl", answers)
        e2 = [prompt_row(G, "m1:original", 1, "P one"), prompt_row(G, "m1:original", 2, "P two"),
              prompt_row(G, "m2:original", 1, "P new"), prompt_row(G, "m2:original", 2, "P four"),
              prompt_row(G, "m1:12", 1, "P twelve", tier=2), prompt_row(Q, "m1:original", 1, "P one")]
        fx.write_jsonl(self.data / "prompts.jsonl", e2)
        for judge, tier in ((G, 1), (G, 2), (Q, 1)):
            fx.write_jsonl(self.data / "batches" / f"main.{judge}.tier{tier}.prompts.jsonl",
                           [batch_line(r) for r in e2 if r["judge"] == judge and r["tier"] == tier])

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *extra):
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            ra.main(["--data", str(self.data), "--e1-prompts", str(self.e1_prompts),
                     "--e1-answers", str(self.e1_answers), *extra])
        return printed.getvalue()

    def read(self, path):
        return [json.loads(x) for x in Path(path).read_text().splitlines() if x.strip()]

    def test_only_byte_identical_prompts_with_an_answer_are_reused(self):
        printed = self.run_cli()
        reused = self.read(self.data / "answers" / f"reused-e1.{G}.jsonl")
        self.assertEqual([r["key"] for r in reused], [f"{G}|m1:original|1", f"{G}|m1:original|2"])
        self.assertEqual(reused[0]["answer"], f"answer to {G}|m1:original|1 [1].")
        summary = json.loads((self.data / "reuse.json").read_text())
        self.assertEqual(summary["reused"], 2)
        self.assertEqual({r["key"]: r["reason"] for r in summary["rebuilt"]},
                         {f"{G}|m2:original|1": "the E1 prompt differs", f"{G}|m2:original|2": "no E1 answer"})
        self.assertIn("2 reused", printed)

    def test_reused_keys_leave_the_batch_and_everything_else_stays(self):
        self.run_cli()
        tier1 = [r["key"] for r in self.read(self.data / "batches" / f"main.{G}.tier1.prompts.jsonl")]
        self.assertEqual(tier1, [f"{G}|m2:original|1", f"{G}|m2:original|2"])
        self.assertEqual(len(self.read(self.data / "batches" / f"main.{G}.tier2.prompts.jsonl")), 1)
        self.assertEqual(len(self.read(self.data / "batches" / f"main.{Q}.tier1.prompts.jsonl")), 1)
        self.assertEqual(len(self.read(self.data / "prompts.jsonl")), 6)  # score.py needs every key

    def test_a_second_run_gives_the_same_result(self):
        self.run_cli()
        self.run_cli()
        self.assertEqual(len(self.read(self.data / "answers" / f"reused-e1.{G}.jsonl")), 2)
        self.assertEqual(len(self.read(self.data / "batches" / f"main.{G}.tier1.prompts.jsonl")), 2)

    def test_answers_can_go_to_another_folder(self):
        other = Path(self.tmp.name) / "answers_here"
        self.run_cli("--answers-out", str(other))
        self.assertTrue((other / f"reused-e1.{G}.jsonl").exists())

    def test_e1_prompt_keys_are_read_without_parsing_every_line(self):
        line = json.dumps(prompt_row(G, "m1:original", 1, 'a "quoted" \\ prompt'), ensure_ascii=False)
        self.assertEqual(ra.line_key(line), f"{G}|m1:original|1")
        self.assertIsNone(ra.line_key('{"other": 1}'))


if __name__ == "__main__":
    unittest.main()
