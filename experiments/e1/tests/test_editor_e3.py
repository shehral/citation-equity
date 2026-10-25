"""Tests for E3's editor options (experiments/PLAN_E3.md): --max-attempts, resuming an edit from an
earlier attempt, recovering span edits from a version's text, and --retry-from (run_retry), with a
fake editor and a fake engine. E1's behaviour without these options is covered by test_editor.py.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
import editor  # noqa: E402
from test_editor import QUERY, TEXT, toy_engine  # noqa: E402

QUESTIONS = TEXT.replace("## Grind size", "## Grind size?").replace("## Water", "## Water?")
PLACEBO = TEXT.replace("## Grind size", "## Grind sizing").replace("## Water", "## Waters")
TOO_LONG = TEXT.replace("## Grind size", "## The size of the grind")


def page(qid, role="target", i=1):
    return {"page_id": f"{qid}-p{i}", "query_id": qid, "set": "main", "query": QUERY, "url": None,
            "source": "sample", "title": "T", "text": TEXT if role == "target" else "Donor text.", "words": 30,
            "tokens_max": 40, "cut": False, "sha256": "0" * 64, "role": role}


def applicable(*qids, arm="2"):
    return [{"query_id": q, "arm": arm, "applicable": True, "reason": None} for q in qids]


def prior(qid, arm, text, valid, attempts, reason=None):
    return {"version_id": f"{qid}:{arm}", "query_id": qid, "set": "main", "arm": arm, "text": text, "title": "T",
            "valid": valid, "attempts": attempts, "excluded_reason": reason}


class Scripted:
    """Answers arm 2 with question headings and P2 with a two-word paraphrase, from attempt `fix_at`
    on (counted per key); before that it returns every span unchanged, so validation fails."""

    def __init__(self, fix_at=1):
        self.fix_at, self.seen, self.jobs = fix_at, {}, []

    def generate(self, jobs):
        out = []
        for j in jobs:
            self.jobs.append(j)
            n = self.seen[j["key"]] = self.seen.get(j["key"], 0) + 1
            if n < self.fix_at:
                body = {s["id"]: s["text"] for s in j["spans"]}
            elif j["arm"] == "2":
                body = {s["id"]: s["text"] + "?" for s in j["spans"]}
            else:
                body = {s["id"]: {"Grind size": "Grind sizing", "Water": "Waters"}[s["text"]] for s in j["spans"]}
            out.append((json.dumps(body), "stop"))
        return out


class MaxAttemptsTest(unittest.TestCase):
    def run_arm2(self, backend, **kw):
        rows = editor.run([page("q1")], applicable("q1"), backend, arms=["2"], engine=toy_engine, placebos=False,
                          do_all=False, **kw)
        return next(r for r in rows if r["arm"] == "2")

    def test_three_attempts_pass_on_the_third_with_the_validators_message(self):
        backend = Scripted(fix_at=3)
        row = self.run_arm2(backend, max_attempts=3)
        self.assertEqual((row["valid"], row["attempts"]), (True, 3))
        prompts = [j["prompt"] for j in backend.jobs]
        self.assertEqual(len(prompts), 3)
        self.assertNotIn("failed these checks", prompts[0])
        self.assertIn("did not rise", prompts[2])
        # Each regenerate appends the last failure to the first prompt (as E1's one regenerate does).
        self.assertEqual(prompts[2].count("Your previous answer failed these checks"), 1)

    def test_the_default_is_e1s_two_attempts(self):
        row = self.run_arm2(Scripted(fix_at=3))
        self.assertEqual((row["valid"], row["attempts"]), (False, 2))
        self.assertTrue(row["excluded_reason"].startswith("invalid: "))

    def test_three_failures_exclude_after_three_attempts(self):
        row = self.run_arm2(Scripted(fix_at=9), max_attempts=3)
        self.assertEqual((row["valid"], row["attempts"]), (False, 3))


class ResumeTest(unittest.TestCase):
    def task(self, ctx, **kw):
        spans = editor.spans_for_arm("2", ctx.queries["q1"]["target"], ctx.eng0["q1"])
        return {**ctx.llm_task("q1", "2", ctx.original("q1"), ctx.eng0["q1"], spans), **kw}

    def test_a_task_resumes_at_its_next_attempt_with_its_prompt(self):
        ctx = editor.Pages([page("q1")], applicable("q1"), toy_engine)
        backend, log = Scripted(), []
        t = self.task(ctx, done=2, resume_prompt="PROMPT FOR ATTEMPT 3")
        res = editor.edit_round([t], backend, toy_engine, log, max_attempts=3)[t["key"]]
        self.assertEqual((res["status"], res["attempts"]), ("valid", 3))
        self.assertEqual([j["prompt"] for j in backend.jobs], ["PROMPT FOR ATTEMPT 3"])
        self.assertEqual([e["attempt"] for e in log], [3])

    def test_a_resumed_task_that_fails_is_not_regenerated_past_the_limit(self):
        ctx = editor.Pages([page("q1")], applicable("q1"), toy_engine)
        backend = Scripted(fix_at=9)
        t = self.task(ctx, done=2, resume_prompt="P3")
        res = editor.edit_round([t], backend, toy_engine, [], max_attempts=3)[t["key"]]
        self.assertEqual((res["status"], res["attempts"]), ("excluded", 3))
        self.assertEqual(len(backend.jobs), 1)

    def test_resume_builds_the_regenerate_prompt_from_the_last_failure(self):
        ctx = editor.Pages([page("q1")], applicable("q1"), toy_engine)
        t = self.task(ctx)
        reason = "invalid: The question-headings check did not rise (0.000 -> 0.000). | Second failure."
        out = editor.resume(dict(t), prior("q1", "2", TEXT, False, 2, reason), 3)
        self.assertEqual(out["done"], 2)
        self.assertEqual(out["resume_prompt"], editor.with_feedback(
            t["prompt"], ["The question-headings check did not rise (0.000 -> 0.000).", "Second failure."]))
        self.assertIsNone(editor.resume(dict(t), prior("q1", "2", TEXT, False, 3, reason), 3))


class RecoverEditsTest(unittest.TestCase):
    def spans(self, *subs, text=TEXT):
        out = []
        for i, sub in enumerate(subs, start=1):
            s = text.index(sub)
            out.append({"id": f"s{i}", "field": "text", "start": s, "end": s + len(sub), "text": sub})
        return out

    def test_recovers_each_replacement(self):
        spans = self.spans("Grind size", "Water")
        edits = editor.recover_edits(("T", TEXT), ("T", QUESTIONS), spans)
        self.assertEqual([(e["start"], e["replacement"]) for e in edits],
                         [(spans[0]["start"], "Grind size?"), (spans[1]["start"], "Water?")])

    def test_a_short_shared_piece_between_spans_is_placed_where_the_diff_puts_it(self):
        text = "Alpha one two. Beta three four. Gamma."
        spans = self.spans("Alpha one two.", "Beta three four.", text=text)
        edited = "Alpha one two (see A). Beta three four (see B). Gamma."
        edits = editor.recover_edits(("", text), ("", edited), spans)
        self.assertEqual([e["replacement"] for e in edits], ["Alpha one two (see A).", "Beta three four (see B)."])

    def test_unchanged_spans_give_no_edit_and_a_title_edit_is_its_own_field(self):
        spans = [{"id": "title", "field": "title", "start": 0, "end": 1, "text": "T"}] + self.spans("Water")
        self.assertEqual(editor.recover_edits(("T", TEXT), ("T", TEXT), spans), [])
        edits = editor.recover_edits(("T", TEXT), ("New T", TEXT), spans)
        self.assertEqual(edits, [{"field": "title", "start": 0, "end": 1, "replacement": "New T"}])

    def test_a_change_outside_the_spans_is_not_recovered(self):
        edited = QUESTIONS.replace("Hot water", "Warm water")
        self.assertIsNone(editor.recover_edits(("T", TEXT), ("T", edited), self.spans("Grind size", "Water")))


class RetryTest(unittest.TestCase):
    def run_retry(self, priors, backend, qids=("q1",), **kw):
        pages = [page(q) for q in qids]
        log = []
        rows, summary = editor.run_retry(pages, applicable(*qids), backend, priors, arms=["2"], engine=toy_engine,
                                         log=log, **kw)
        return {r["version_id"]: r for r in rows}, summary, log

    def test_an_invalid_arm_gets_attempt_three_then_a_new_placebo(self):
        reason = "invalid: The question-headings check did not rise (0.000 -> 0.000)."
        backend = Scripted()
        rows, summary, log = self.run_retry([prior("q1", "2", TEXT, False, 2, reason)], backend)
        self.assertEqual(set(rows), {"q1:2", "q1:P2"})  # only the edits made now; no original
        self.assertEqual((rows["q1:2"]["valid"], rows["q1:2"]["attempts"]), (True, 3))
        self.assertEqual(rows["q1:2"]["text"], QUESTIONS)
        self.assertEqual((rows["q1:P2"]["valid"], rows["q1:P2"]["attempts"]), (True, 1))
        self.assertEqual(rows["q1:P2"]["text"], PLACEBO)
        first = backend.jobs[0]
        self.assertEqual(first["arm"], "2")
        self.assertIn("did not rise (0.000 -> 0.000)", first["prompt"])
        self.assertEqual([(e["key"], e["attempt"]) for e in log], [("q1|2", 3), ("q1|P2", 1)])
        self.assertEqual(summary["2"]["arm_retried"], 1)
        self.assertEqual(summary["2"]["placebo_new"], 1)

    def test_a_new_placebo_gets_up_to_max_attempts(self):
        class PlaceboLate(Scripted):
            def generate(self, jobs):
                for j in jobs:  # arm 2 passes at once; P2 only on its third attempt
                    if j["arm"] == "2":
                        self.seen[j["key"]] = max(self.seen.get(j["key"], 0), 9)
                return super().generate(jobs)

        backend = PlaceboLate(fix_at=3)
        rows, _, _ = self.run_retry([prior("q1", "2", TEXT, False, 2, "invalid: x")], backend)
        self.assertEqual((rows["q1:P2"]["valid"], rows["q1:P2"]["attempts"]), (True, 3))

    def test_only_the_failed_placebo_is_retried_with_its_hints(self):
        reason = "invalid: The paraphrase must keep the spans' length within 10% (3 -> 7 words)."
        priors = [prior("q1", "2", QUESTIONS, True, 1), prior("q1", "P2", TOO_LONG, False, 2, reason)]
        backend = Scripted()
        rows, summary, _ = self.run_retry(priors, backend)
        self.assertEqual(set(rows), {"q1:P2"})
        self.assertEqual((rows["q1:P2"]["valid"], rows["q1:P2"]["attempts"]), (True, 3))
        (job,) = backend.jobs
        self.assertEqual([s["text"] for s in job["spans"]], ["Grind size", "Water"])
        self.assertIn("(3 -> 7 words)", job["prompt"])
        self.assertIn("s1: your version has 5 words; it must have exactly 2 words", job["prompt"])
        self.assertEqual(summary["2"]["placebo_retried"], 1)

    def test_passed_pairs_none_answers_and_used_up_attempts_are_untouched(self):
        priors = [prior("q1", "2", QUESTIONS, True, 1), prior("q1", "P2", PLACEBO, True, 1),
                  prior("q2", "2", TEXT, False, 3, "invalid: x"),
                  prior("q3", "2", TEXT, False, 1, "not applicable: the editor returned NONE")]
        backend = Scripted()
        rows, summary, log = self.run_retry(priors, backend, qids=("q1", "q2", "q3"))
        self.assertEqual((rows, log, backend.jobs), ({}, [], []))
        self.assertEqual(summary["2"]["passed_in_e1"], 1)
        self.assertEqual(summary["2"]["not_retried"], {"E1 used 3 attempts": 1, "not applicable in E1": 1})

    def test_a_placebo_whose_e1_text_does_not_fit_the_rebuilt_spans_is_skipped(self):
        other = TEXT.replace("Hot water", "Warm water")
        priors = [prior("q1", "2", QUESTIONS, True, 1), prior("q1", "P2", other, False, 2, "invalid: x")]
        backend = Scripted()
        rows, summary, _ = self.run_retry(priors, backend)
        self.assertEqual((rows, backend.jobs), ({}, []))
        self.assertIn("placebo: E1's spans could not be rebuilt from its arm version", summary["2"]["not_retried"])


class CliTest(unittest.TestCase):
    def test_retry_from_must_not_be_the_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "versions.jsonl"
            common.write_jsonl(out, [])
            for argv in (["--backend", "fake", "--retry-from", str(out), "--out", str(out)],
                         ["--backend", "fake", "--max-attempts", "0"]):
                with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                    editor.main(argv)

    def test_e3_sets_are_accepted(self):
        args = editor.parser().parse_args(["--backend", "fake", "--set", "e3", "--set", "e3-four"])
        self.assertEqual(args.set, ["e3", "e3-four"])
        self.assertEqual(args.max_attempts, 2)
        self.assertEqual(editor.select_pages([{"set": "e3"}, {"set": "main"}], ["e3"]), [{"set": "e3"}])


if __name__ == "__main__":
    unittest.main()
