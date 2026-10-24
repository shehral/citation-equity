"""End to end on the hand-made smoke fixture with recorded fake answers, and the markdown report.

Run: python3 -I -m unittest discover -s experiments/e1/tests
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
E1 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E1))
sys.path.insert(0, str(E1 / "tests"))

import analyze  # noqa: E402
import build_prompts  # noqa: E402
import fake_answers  # noqa: E402
import fixtures  # noqa: E402
import report  # noqa: E402
import score  # noqa: E402
import simulate_null  # noqa: E402

CAVEAT = "Content check on a local model over a fixed page set. It does not predict live AI engines."


class SmokeRun(unittest.TestCase):
    def test_build_score_analyze_report_on_the_smoke_fixture(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fixtures.write_fixture(data)
            with contextlib.redirect_stdout(io.StringIO()):
                build_prompts.main(["--data", str(data), "--sets", "smoke", "--tokens", "utf8"])
            fake_answers.write_answers(data)
            score.main(["--data", str(data), "--out", str(out)])
            analyze.main(["--data", str(data), "--out", str(out), "--set", "smoke",
                          "--draws", "2000", "--resamples", "500"])
            simulate_null.main(["--sims", "10", "--queries", "40", "--draws", "2000",
                                "--out", str(out / "null_simulation.json")])
            report.main(["--out", str(out)])

            result = json.loads((out / "analysis.json").read_text())["smoke"]
            self.assertEqual(result["mode"], "two-judge")
            labels = {(c["arm"], c["ref"]): c["label"] for c in result["contrasts"]}
            self.assertEqual(labels[("9", "original")], "insufficient n")
            self.assertEqual(labels[("1", "original")], "descriptive")
            self.assertEqual(labels[("3", "P3")], "not run")
            self.assertEqual(result["exclusions"]["5"]["validity_exclusions"], 1)

            text = (out / "RESULTS_E1.md").read_text()
            self.assertIn(CAVEAT, text)
            self.assertIn("| 9 |", text)
            self.assertIn("insufficient n", text)
            self.assertIn("familywise", text)
            self.assertNotIn("—", text)


class Report(unittest.TestCase):
    def test_render_lists_every_contrast_with_its_label(self):
        inp = simulate_null.synthetic_inputs(n_queries=30, seed=9)
        result = analyze.analyze_set(inp, "main", draws=2000, resamples=500)
        text = report.render({"main": result}, None)
        for c in result["contrasts"]:
            self.assertIn(c["label"], text)
        self.assertIn("Holm", text)
        self.assertIn("MDE", text)
        self.assertIn("Effects below about 0.02", text)
        self.assertNotIn("—", text)


if __name__ == "__main__":
    unittest.main()
