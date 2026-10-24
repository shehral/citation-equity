"""Tests for batch_generate.py's prompt handling and output shape (no vLLM, no GPU).

Run: python3 -I experiments/explorer/test_batch_generate.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

# -I leaves the script's own folder off sys.path, so load the module by path.
sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
_SPEC = importlib.util.spec_from_file_location("batch_generate", Path(__file__).with_name("batch_generate.py"))
bg = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(bg)


def line(**overrides) -> dict:
    """A PromptLine as `ce bench --export-prompts` writes it."""
    base = {"key": "0a1b2c3d", "model": "org/Model-9B", "seed": 1001, "temperature": 0.5, "numCtx": 16384,
            "prompt": "Write an accurate answer.\n\nQuestion: Why?", "packId": "p", "draftId": "before",
            "queryId": "q2", "run": 0}
    return base | overrides


def jsonl(*lines: dict) -> str:
    return "".join(json.dumps(x) + "\n" for x in lines)


class ReadPrompts(unittest.TestCase):
    def test_reads_lines_in_order_and_skips_blank_lines(self):
        text = jsonl(line(key="a"), line(key="b", temperature=0)) + "\n\r\n"
        prompts = bg.read_prompts(text)
        self.assertEqual([p["key"] for p in prompts], ["a", "b"])
        self.assertEqual(prompts[1]["temperature"], 0)

    def test_keeps_line_separator_characters_inside_a_prompt(self):
        # JSON.stringify leaves U+0085, U+2028 and U+2029 raw inside strings; str.splitlines breaks on them.
        text = "page text\nmore\u0085x  y  z"
        raw = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in (line(key="a", prompt=text), line(key="b")))
        self.assertIn(" ", raw)  # the characters really are raw in the file, as Node writes them
        prompts = bg.read_prompts(raw)
        self.assertEqual([p["key"] for p in prompts], ["a", "b"])
        self.assertEqual(prompts[0]["prompt"], text)

    def test_reads_crlf_line_endings(self):
        prompts = bg.read_prompts(jsonl(line(key="a")).replace("\n", "\r\n") + jsonl(line(key="b")).replace("\n", "\r\n"))
        self.assertEqual([p["key"] for p in prompts], ["a", "b"])

    def test_names_the_line_of_bad_json(self):
        with self.assertRaisesRegex(ValueError, r"^prompts line 2 is not valid JSON"):
            bg.read_prompts(jsonl(line()) + '{"key": \n')

    def test_names_the_line_and_field_of_a_bad_prompt(self):
        bad = line()
        del bad["numCtx"]
        with self.assertRaisesRegex(ValueError, r"^prompts line 3: field 'numCtx' is missing"):
            bg.read_prompts(jsonl(line()) + "\n" + jsonl(bad))
        with self.assertRaisesRegex(ValueError, r"field 'seed' is missing or has the wrong type"):
            bg.read_prompts(jsonl(line(seed=True)))
        with self.assertRaisesRegex(ValueError, r"^prompts line 1 is not a JSON object"):
            bg.read_prompts("[1, 2]\n")

    def test_refuses_an_empty_file(self):
        with self.assertRaisesRegex(ValueError, "no prompts"):
            bg.read_prompts("\n")


class CheckModel(unittest.TestCase):
    def test_accepts_a_file_exported_for_the_model(self):
        bg.check_model([line(), line(key="b")], "org/Model-9B")

    def test_refuses_a_file_exported_for_another_model(self):
        with self.assertRaisesRegex(ValueError, r"exported for model llama3\.2:3b, not org/Model-9B"):
            bg.check_model([line(model="llama3.2:3b")], "org/Model-9B")
        with self.assertRaisesRegex(ValueError, r"exported for model a, org/Model-9B, not org/Model-9B"):
            bg.check_model([line(model="org/Model-9B"), line(model="a")], "org/Model-9B")


class RequestShape(unittest.TestCase):
    def test_max_model_len_is_the_largest_num_ctx(self):
        self.assertEqual(bg.max_model_len([line(numCtx=8192), line(numCtx=16384), line(numCtx=4096)]), 16384)

    def test_each_prompt_is_one_user_message_with_its_own_seed_and_temperature(self):
        prompts = [line(seed=1, temperature=0.5), line(seed=2001, temperature=0, prompt="Other")]
        self.assertEqual(bg.chat_messages(prompts), [
            [{"role": "user", "content": prompts[0]["prompt"]}],
            [{"role": "user", "content": "Other"}],
        ])
        self.assertEqual(bg.sampling_args(prompts, 600), [
            {"temperature": 0.5, "seed": 1, "max_tokens": 600},
            {"temperature": 0.0, "seed": 2001, "max_tokens": 600},
        ])


class AnswerLines(unittest.TestCase):
    def test_writes_one_answer_line_per_prompt_keyed_as_exported(self):
        prompts = [line(key="a"), line(key="b")]
        text = bg.answer_lines(prompts, ["Bitter [1].", "Café [2]."], "org/Model-9B")
        self.assertTrue(text.endswith("\n"))
        rows = [json.loads(x) for x in text.splitlines()]
        self.assertEqual(rows, [
            {"key": "a", "answer": "Bitter [1].", "model": "org/Model-9B"},
            {"key": "b", "answer": "Café [2].", "model": "org/Model-9B"},
        ])
        self.assertIn("Café", text)

    def test_refuses_a_count_mismatch(self):
        with self.assertRaisesRegex(ValueError, "1 answers for 2 prompts"):
            bg.answer_lines([line(), line()], ["x"], "m")


class Main(unittest.TestCase):
    def test_exits_with_the_reason_before_loading_vllm_for_a_wrong_model(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            prompts = Path(tmp) / "p.jsonl"
            prompts.write_text(jsonl(line(model="llama3.2:3b")), encoding="utf-8")
            with self.assertRaises(SystemExit) as ctx:
                bg.main(["--prompts", str(prompts), "--model", "org/Model-9B", "--out", str(Path(tmp) / "a.jsonl")])
            self.assertRegex(str(ctx.exception.code), r"^batch_generate: the prompts file was exported for model")
            self.assertFalse((Path(tmp) / "a.jsonl").exists())

    def test_exits_with_a_message_for_a_missing_prompts_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nope.jsonl"
            with self.assertRaises(SystemExit) as ctx:
                bg.main(["--prompts", str(missing), "--model", "org/Model-9B", "--out", str(Path(tmp) / "a.jsonl")])
            self.assertRegex(str(ctx.exception.code), r"^batch_generate: cannot read the prompts file .*nope\.jsonl")


class Thinking(unittest.TestCase):
    def test_thinking_is_off_by_default_and_on_only_with_the_flag(self):
        base = ["--prompts", "p", "--model", "m", "--out", "o"]
        self.assertFalse(bg.parse_args(base).thinking)
        self.assertFalse(bg.parse_args(base + ["--no-thinking"]).thinking)
        self.assertTrue(bg.parse_args(base + ["--thinking"]).thinking)
        self.assertEqual(bg.chat_kwargs(False), {"chat_template_kwargs": {"enable_thinking": False}})
        self.assertEqual(bg.chat_kwargs(True), {})


if __name__ == "__main__":
    unittest.main()
