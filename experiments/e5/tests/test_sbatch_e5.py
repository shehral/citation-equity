"""E5's guards in E1's jobs (feasibility F7): E5 options never write E1's folder, the edit job never
writes E5's deterministic versions.jsonl, and E5's batches run only with RUN=e5. Dry runs only,
with E1's test harness (shims record any sbatch, module or GPU call)."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "e1" / "tests"))

from test_sbatch import PLACEHOLDERS, Run  # noqa: E402

ROOT = PLACEHOLDERS["CE_ROOT"]
E5_EXTRA = (f"--arms 12,12K --no-all --edit-questions {ROOT}/data/e5/edit_questions.jsonl "
            f"--q-l-from {ROOT}/data/e5/edit_texts.jsonl --q-l-out {ROOT}/data/e5/q_L.jsonl")


class EditJob(unittest.TestCase):
    def test_e5_options_refuse_e1s_folder(self):
        for extra in (E5_EXTRA, "--arms 12K", f"--q-l-from x --q-l-out {ROOT}/data/e1/q_L.jsonl"):
            for data in ({}, {"DATA": f"{ROOT}/data/e1/"}):
                run = Run("edit.sbatch", PLACEHOLDERS, {"EXTRA": extra, **data})
                self.assertEqual(run.code, 2, run.out + run.err)
                self.assertIn("E5", run.out)
                self.assertNotIn("resolved settings", run.out)
                self.assertEqual(run.called, "")

    def test_e5_folder_reads_and_writes_e5s_edit_files(self):
        run = Run("edit.sbatch", PLACEHOLDERS, {"DATA": f"{ROOT}/data/e5", "SETS": "--set main --set e3 --set e3-four",
                                                "EXTRA": E5_EXTRA})
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"E5: APPL={ROOT}/data/e5/edit_applicability.jsonl VERSIONS={ROOT}/data/e5/edit_versions.jsonl "
                      f"EDIT_LOG={ROOT}/data/e5/edit_log.jsonl", run.out)
        self.assertEqual(run.called, "")

    def test_e5_never_writes_its_deterministic_versions(self):
        for data in (f"{ROOT}/data/e5", f"{ROOT}/data/e5/"):
            run = Run("edit.sbatch", PLACEHOLDERS, {"DATA": data, "EXTRA": E5_EXTRA,
                                                    "VERSIONS_E5": f"{ROOT}/data/e5/versions.jsonl"})
            self.assertEqual(run.code, 2, run.out + run.err)
            self.assertIn("deterministic", run.out)

    def test_e1_runs_print_no_e5_line(self):
        run = Run("edit.sbatch", PLACEHOLDERS, {"EXTRA": "--arms 9,5,6,7"})
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"DATA={ROOT}/data/e1", run.out)
        self.assertNotIn("E5:", run.out)


class GenerateJob(unittest.TestCase):
    def test_e5_batches_need_run_e5(self):
        run = Run("generate.sbatch", PLACEHOLDERS, {"JUDGE": "gemma-4-12b", "BATCH": "e5-main.gemma-4-12b.tier1"})
        self.assertEqual(run.code, 2, run.out + run.err)
        self.assertIn("RUN=e5", run.out)
        run = Run("generate.sbatch", PLACEHOLDERS, {"JUDGE": "gemma-4-12b", "BATCH": "e5-main.gemma-4-12b.tier1",
                                                    "RUN": "e1"})
        self.assertEqual(run.code, 2, run.out + run.err)

    def test_e5_batches_read_and_write_e5s_folder(self):
        run = Run("generate.sbatch", PLACEHOLDERS, {"JUDGE": "qwen3.8-27b", "BATCH": "e5-replication.qwen3.8-27b.tier2",
                                                    "RUN": "e5"})
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"PROMPTS={ROOT}/e5/batches/e5-replication.qwen3.8-27b.tier2.prompts.jsonl", run.out)
        self.assertIn(f"OUT={ROOT}/e5/answers/e5-replication.qwen3.8-27b.tier2.jsonl", run.out)

    def test_e5s_folder_takes_only_e5_batches(self):
        run = Run("generate.sbatch", PLACEHOLDERS, {"JUDGE": "gemma-4-12b", "BATCH": "main.gemma-4-12b.tier1",
                                                    "RUN": "e5"})
        self.assertEqual(run.code, 2, run.out + run.err)

    def test_e1_batches_are_unchanged(self):
        run = Run("generate.sbatch", PLACEHOLDERS)
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"PROMPTS={ROOT}/e1/batches/main.gemma-4-12b.tier1.prompts.jsonl", run.out)


if __name__ == "__main__":
    unittest.main()
