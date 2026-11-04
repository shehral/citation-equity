"""env_check.py: E1's records are read, settings come from the code, and mismatches are named."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import env_check  # noqa: E402


class EnvCheck(unittest.TestCase):
    def setUp(self):
        self.ref = json.loads(env_check.REFERENCE.read_text(encoding="utf-8"))

    def test_the_code_settings_are_e1s(self):
        settings = env_check.code_settings(env_check.CODE)
        found = {"packages": dict(self.ref["packages"]), "models": {}, "settings": settings,
                 "gpus": ["H200"], "for_model": None}
        found["models"] = {m: {"revision": r, "snapshot": True} for m, r in self.ref["models"].items()}
        self.assertEqual(env_check.compare(found, self.ref), [])

    def test_mismatches_are_named(self):
        settings = env_check.code_settings(env_check.CODE)
        settings["judges"]["max_tokens"] = 2048
        found = {"packages": dict(self.ref["packages"], vllm="0.32.0"), "settings": settings, "gpus": ["L40S"],
                 "for_model": "Qwen/Qwen3.8-27B",
                 "models": {m: {"revision": "abc", "snapshot": True} for m in self.ref["models"]}}
        bad = env_check.compare(found, self.ref)
        self.assertTrue(any("vllm" in b for b in bad))
        self.assertTrue(any("judges.max_tokens" in b for b in bad))
        self.assertTrue(any("revision abc" in b for b in bad))
        self.assertTrue(any("GPU L40S" in b for b in bad))

    def test_cache_revisions(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d) / "hub" / "models--google--gemma-4-12B-it"
            (base / "refs").mkdir(parents=True)
            (base / "refs" / "main").write_text("707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7\n")
            snap = base / "snapshots" / "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7"
            snap.mkdir(parents=True)
            (snap / "config.json").write_text("{}")
            got = env_check.model_revisions(d, ["google/gemma-4-12B-it", "Qwen/Qwen3.8-27B"])
        self.assertEqual(got["google/gemma-4-12B-it"]["revision"], "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7")
        self.assertTrue(got["google/gemma-4-12B-it"]["snapshot"])
        self.assertIsNone(got["Qwen/Qwen3.8-27B"]["revision"])

    def test_batch_files(self):
        with tempfile.TemporaryDirectory() as d:
            line = {"key": "k", "model": "Qwen/Qwen3.8-27B", "seed": 1, "temperature": 0.5, "numCtx": 32768}
            Path(d, "e5-main.qwen3.8-27b.tier1.prompts.jsonl").write_text(json.dumps(line) + "\n")
            batches = env_check.batch_settings(Path(d))
        found = {"packages": dict(self.ref["packages"]), "settings": env_check.code_settings(env_check.CODE),
                 "gpus": ["H200"], "for_model": None, "batches": batches,
                 "models": {m: {"revision": r, "snapshot": True} for m, r in self.ref["models"].items()}}
        self.assertEqual(env_check.compare(found, self.ref), ["batch e5-main.qwen3.8-27b.tier1.prompts.jsonl: seeds [1]"])


if __name__ == "__main__":
    unittest.main()
