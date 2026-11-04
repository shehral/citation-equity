"""The local smoke run of E5's edit job (smoke_e5.py) on two real E5 queries, when E5's data is built."""

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import e5_common as e5  # noqa: E402

READY = all((e5.DATA / f).exists() for f in ("pages.jsonl", "edit_texts.jsonl", "edit_applicability.jsonl",
                                             "versions.jsonl")) and e5.ENGINE_BUNDLE.exists() and e5.QUESTIONS_BUNDLE.exists()


@unittest.skipUnless(READY, "E5's data or bundles are not built here (README, local steps)")
class Smoke(unittest.TestCase):
    def test_edit_job_outputs_are_well_formed_and_validated(self):
        import smoke_e5

        with redirect_stdout(io.StringIO()):
            smoke_e5.main([])
        r = json.loads((e5.DATA / "smoke" / "smoke.json").read_text(encoding="utf-8"))
        cli, coop, down = r["cli_fake_editor"], r["cooperative_fake_editor"], r["downstream"]
        self.assertEqual(cli["q_L"], {"ok": 2})
        self.assertTrue(cli["refuses_e1_versions_out"])
        self.assertEqual(coop["q_L_sampling"], {'{"seed": 1, "temperature": 0.5}': 2})
        self.assertTrue(coop["prompt_question_is_right"])
        self.assertEqual(coop["versions"].get("12K valid=True"), 2)
        self.assertGreaterEqual(coop["versions"].get("P12K valid=True", 0), 1)
        self.assertEqual(coop["versions"].get("12 valid=True"), 1)
        self.assertTrue(down["extra_fields_on_every_version"])
        self.assertTrue(down["cells_complete"])
        arms = {k.split()[1] for k in down["cells"]}
        self.assertLessEqual({"original", "9", "9P", "9K", "9L", "9A", "9G", "12", "P12", "12K", "P12K"}, arms)


if __name__ == "__main__":
    unittest.main()
