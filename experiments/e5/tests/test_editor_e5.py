"""E5's editor support (experiments/e1/editor.py): the Python twin of the tool's local-model
question path, and the 12K and P12K labels on E1's arm 12 machinery."""

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
ROOT = E5.parents[1]
sys.path.insert(0, str(E5))
sys.path.insert(0, str(E5.parent / "e1"))

import common  # noqa: E402
import editor  # noqa: E402

from fake_editor import FakeE5Backend  # noqa: E402

FIXTURES = json.loads((Path(__file__).parent / "tool_twin_fixtures.json").read_text(encoding="utf-8"))


class ToolTwin(unittest.TestCase):
    def test_prompt_twin_equals_the_typescript(self):
        self.assertGreaterEqual(len(FIXTURES["prompts"]), 8)
        for case in FIXTURES["prompts"]:
            self.assertEqual(editor.keyword_questions_prompt(case["keywords"], case["max"]), case["prompt"],
                             case["keywords"])

    def test_parse_twin_equals_the_typescript(self):
        self.assertGreaterEqual(len(FIXTURES["parses"]), 12)
        for case in FIXTURES["parses"]:
            got = editor.first_question(case["answer"])
            self.assertEqual([got] if got is not None else [], case["questions"], repr(case["answer"]))

    def test_settings_are_the_tools(self):
        self.assertEqual(editor.TOOL_TEMPERATURE, FIXTURES["default_temperature"])
        self.assertEqual(editor.TOOL_TEMPERATURE, FIXTURES["sent_temperature"])
        self.assertEqual(editor.TOOL_SEED, FIXTURES["default_seed"])

    @unittest.skipUnless(shutil.which("pnpm") and (ROOT / "packages/bench/node_modules/.bin/tsx").exists(),
                         "pnpm or the bench's tsx is not installed")
    def test_fixtures_are_current(self):
        proc = subprocess.run(
            ["pnpm", "--filter", "@citation-equity/bench", "exec", "tsx", "--conditions=@citation-equity/source",
             str(E5 / "tool_twin_fixtures.ts")], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr[-1000:])
        self.assertEqual(json.loads(proc.stdout), FIXTURES)

    def test_write_q_l_uses_the_tools_sampling_and_parse(self):
        backend = FakeE5Backend()
        log = []
        rows = editor.write_q_l([{"query_id": "q1", "set": "main", "k": "espresso machines"}], backend, log)
        self.assertEqual(rows[0]["q_L"], "What is espresso machines?")
        self.assertEqual(rows[0]["status"], "ok")
        self.assertEqual(backend.calls[0]["sampling"], {"temperature": 0.5, "seed": 1})
        self.assertEqual(log[0]["prompt"], editor.keyword_questions_prompt(["espresso machines"], 1))

    def test_no_question_line_is_recorded(self):
        class Silent:
            def generate(self, jobs, **sampling):
                return [("No question here.", "stop") for _ in jobs]

        rows = editor.write_q_l([{"query_id": "q1", "set": "main", "k": "x"}], Silent(), [])
        self.assertIsNone(rows[0]["q_L"])
        self.assertEqual(rows[0]["status"], editor.NO_QUESTION)


class Labels(unittest.TestCase):
    def test_e5_labels_use_e1_prompts(self):
        self.assertEqual(editor.prompt_name("12K"), "arm12")
        self.assertEqual(editor.prompt_name("P12K"), "p12")
        self.assertEqual(editor.prompt_name("12"), "arm12")
        self.assertEqual(editor.prompt_name("P12"), "p12")

    def test_default_arms_do_not_include_e5(self):
        self.assertNotIn("12K", editor.LLM_ARMS + editor.DETERMINISTIC_ARMS)


QUERY = "how do I clean espresso machines"
TEXT = ("Espresso is a strong coffee drink brewed under high pressure in a few seconds.\n\n## Beans\n\n"
        "Fresh beans make the best espresso shots for a good morning.\n")


def pages():
    def p(role, text, pid):
        return {"page_id": pid, "query_id": "geo-x", "set": "e3", "query": QUERY, "url": "", "source": "live",
                "title": "Espresso guide", "text": text, "words": 0, "tokens_max": 0, "cut": False,
                "sha256": common.sha256_text(text), "role": role}

    return [p("target", TEXT, "t"), p("competitor", "Other page about tea.", "c1")]


@unittest.skipUnless((E5.parent / "e1/out/bundle/engine_cli.js").exists(), "E1's engine bundle is not built here")
class TwelveK(unittest.TestCase):
    def run_editor(self, arms):
        appl = [{"query_id": "geo-x", "arm": "12K", "applicable": True, "reason": None},
                {"query_id": "geo-x", "arm": "12", "applicable": False, "reason": "not applicable: E1's"}]
        backend, log = FakeE5Backend(), []
        rows = editor.run(pages(), appl, backend, arms=arms, do_all=False, log=log,
                          edit_questions={"geo-x": "clean machines"})
        return {r["arm"]: r for r in rows}, log

    def test_12k_works_q_prime_into_the_title_and_p12k_paraphrases_with_q(self):
        rows, log = self.run_editor(["12K"])
        self.assertEqual(set(rows), {"original", "12K", "P12K"})
        self.assertTrue(rows["12K"]["valid"], rows["12K"]["excluded_reason"])
        self.assertEqual(rows["12K"]["title"], "Espresso guide clean machines")
        self.assertTrue(rows["P12K"]["valid"], rows["P12K"]["excluded_reason"])
        self.assertEqual(rows["P12K"]["title"], "guide Espresso")
        prompts = {e["key"]: e["prompt"] for e in log}
        self.assertIn("Question the page is read for: clean machines\n", prompts["geo-x|12K"])
        self.assertIn("Missing key words (word stems): clean, machin\n", prompts["geo-x|12K"])
        self.assertIn(f"Question the page is read for: {QUERY}\n", prompts["geo-x|P12K"])
        # metrics with the true query: 12K adds two of q's key terms
        self.assertEqual(rows["12K"]["key_terms_delta"], 2)

    def test_12k_without_its_edit_question_is_not_run(self):
        appl = [{"query_id": "geo-x", "arm": "12K", "applicable": True, "reason": None}]
        rows = editor.run(pages(), appl, FakeE5Backend(), arms=["12K"], do_all=False, edit_questions={})
        self.assertEqual([r["arm"] for r in rows], ["original"])

    def test_12k_is_validated_as_arm_12_with_q_prime(self):
        """A word outside q' (here 'espresso', a key word of q but not of q') fails arm 12's check 3."""
        class Overreach(FakeE5Backend):
            def generate(self, jobs, **sampling):
                return [(json.dumps({"title": "Espresso guide to clean espresso machines"}), "stop")
                        if j["arm"] == "12K" else super().generate([j])[0] for j in jobs]

        appl = [{"query_id": "geo-x", "arm": "12K", "applicable": True, "reason": None}]
        rows = {r["arm"]: r for r in editor.run(pages(), appl, Overreach(), arms=["12K"], do_all=False,
                                                edit_questions={"geo-x": "clean machines"})}
        self.assertFalse(rows["12K"]["valid"])
        self.assertIn("Add only the query's key terms", rows["12K"]["excluded_reason"])
        self.assertNotIn("P12K", rows)


if __name__ == "__main__":
    unittest.main()
