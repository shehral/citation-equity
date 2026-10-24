"""Tests for the timing-smoke set (PREREG_E1.md r3 amendment 8): edited, prompted and generated
like the main set, never scored by default, never analyzed, and projected into GPU-hours by
timing_report.py. The draw of the timing query is tested in test_draw.py.

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

import analyze as an  # noqa: E402
import build_prompts as bp  # noqa: E402
import editor  # noqa: E402
import fixtures  # noqa: E402
import score  # noqa: E402
import simulate_null as sn  # noqa: E402
import timing_report as tr  # noqa: E402

G, Q = "gemma-4-12b", "qwen3.8-27b"


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def as_timing(rows: list[dict], prefix: str = "t") -> list[dict]:
    """The rows moved to the timing set, with query, version and page ids renamed apart."""
    out = []
    for r in rows:
        r = dict(r)
        for k in ("query_id", "version_id", "page_id", "key"):
            if k in r:
                r[k] = prefix + r[k]
        if "set" in r:
            r["set"] = "timing"
        out.append(r)
    return out


class Editor(unittest.TestCase):
    PAGES = [{"query_id": q, "set": s} for q, s in [("m", "main"), ("r", "replication"), ("s", "smoke"), ("t", "timing")]]

    def test_the_timing_set_is_edited_only_when_named(self):
        self.assertEqual([p["query_id"] for p in editor.select_pages(self.PAGES, None)], ["m", "r", "s"])
        self.assertEqual([p["query_id"] for p in editor.select_pages(self.PAGES, ["timing"])], ["t"])
        self.assertEqual([p["query_id"] for p in editor.select_pages(self.PAGES, ["main", "timing"])], ["m", "t"])

    def test_the_cli_accepts_set_timing(self):
        args = editor.parser().parse_args(["--backend", "fake", "--set", "timing"])
        self.assertEqual(args.set, ["timing"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            editor.parser().parse_args(["--backend", "fake", "--set", "nonsense"])


class BuildPrompts(unittest.TestCase):
    def test_timing_prompts_get_their_own_batch_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            fixtures.write_fixture(data)
            for name in ("pages", "versions", "applicability"):
                path = data / f"{name}.jsonl"
                rows = [json.loads(x) for x in path.read_text().splitlines()]
                write_jsonl(path, rows + as_timing(rows))
            with contextlib.redirect_stdout(io.StringIO()):
                bp.main(["--data", str(data), "--sets", "timing", "--tokens", "utf8"])
            rows = [json.loads(x) for x in (data / "prompts.jsonl").read_text().splitlines()]
            batches = json.loads((data / "prompt_build.json").read_text())["batches"]
        self.assertTrue(rows)
        self.assertEqual({r["set"] for r in rows}, {"timing"})
        self.assertTrue(all(name.startswith("timing.") for name in batches), batches)

    def test_the_default_sets_leave_timing_out(self):
        self.assertNotIn("timing", bp.DEFAULT_SETS.split(","))


class Score(unittest.TestCase):
    def run_score(self, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            prompts = [{"key": f"{s}|v|{seed}", "query_id": s, "version_id": f"{s}:original", "arm": "original",
                        "judge": "g", "seed": seed, "slot": 1, "prompt": "p", "set": s, "tier": 1}
                       for s in ("main", "timing") for seed in range(1, 9)]
            write_jsonl(data / "prompts.jsonl", prompts)
            write_jsonl(data / "answers" / "a.jsonl", [{"key": p["key"], "answer": "A [1]."} for p in prompts])
            score.main(["--data", str(data), "--out", str(out), *extra])
            cells = [json.loads(x) for x in (out / "cells.jsonl").read_text().splitlines()]
            summary = json.loads((out / "score_summary.json").read_text())
        return cells, summary

    def test_timing_answers_are_not_scored_by_default(self):
        cells, summary = self.run_score()
        self.assertEqual({c["set"] for c in cells}, {"main"})
        self.assertEqual({r["set"] for r in summary["completion"]}, {"main"})
        self.assertEqual(summary["prompts"], 8)
        self.assertEqual(summary["unknown_answer_keys"], 0)

    def test_set_timing_scores_only_the_timing_set(self):
        cells, _ = self.run_score("--sets", "timing")
        self.assertEqual({c["set"] for c in cells}, {"timing"})

    def test_an_unknown_set_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_score("--sets", "mian")


class Analyze(unittest.TestCase):
    def setUp(self):
        self.main_only = sn.synthetic_inputs(n_queries=30, seed=3)
        # A timing query with a huge planted effect: if it leaked into the analysis, results would move.
        t = sn.synthetic_inputs(n_queries=1, seed=4, set_name="timing", effects={"5": {G: 0.6, Q: 0.6}})
        m = self.main_only
        self.mixed = an.Inputs(
            pages=m.pages + as_timing(t.pages), versions=m.versions + as_timing(t.versions),
            applicability=m.applicability + as_timing(t.applicability), cells=m.cells + as_timing(t.cells),
            scores=m.scores + as_timing(t.scores), completion=m.completion + as_timing(t.completion))

    def test_timing_pages_never_enter_an_index(self):
        self.assertNotIn("tq000", an.Index(self.mixed).queries)
        self.assertEqual(an.Index(self.mixed).queries, an.Index(self.main_only).queries)
        self.assertEqual(an.Index(self.mixed).completion, an.Index(self.main_only).completion)

    def test_main_results_are_the_same_with_or_without_a_timing_query(self):
        fast = {"draws": 2000, "resamples": 200}
        self.assertEqual(an.analyze_set(self.mixed, "main", **fast), an.analyze_set(self.main_only, "main", **fast))

    def test_the_timing_set_is_never_analyzed(self):
        with self.assertRaises(ValueError):
            an.analyze_set(self.mixed, "timing")
        for sets in ("timing", "main,timing"):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                an.main(["--set", sets, "--data", "/nonexistent", "--out", "/nonexistent"])


GEN_GEMMA = """=== ce-e1-gen start: Sat Oct 24 01:00:00 EDT 2026 on d1 judge=gemma-4-12b model=google/gemma-4-12B-it \
prompts=/p/timing.gemma-4-12b.tierall.prompts.jsonl out=/o tp=1 ===
settings ok
INFO 10-24 01:00:05 [config.py:1] {'not': 'json at line start'}
{
 "model": "google/gemma-4-12B-it",
 "prompts": 100,
 "max_model_len": 32768,
 "answers_cut_at_max_tokens": 0,
 "load_seconds": 60.0,
 "generate_seconds": 200.0,
 "out": "/o"
}
=== ce-e1-gen done: Sat Oct 24 01:05:00 EDT 2026 ===
"""
GEN_QWEN = GEN_GEMMA.replace("gemma-4-12b", "qwen3.8-27b").replace("google/gemma-4-12B-it", "Qwen/Qwen3.8-27B") \
    .replace("tp=1", "tp=2").replace('"load_seconds": 60.0', '"load_seconds": 120.0') \
    .replace('"generate_seconds": 200.0', '"generate_seconds": 400.0')
EDIT = """=== ce-e1-edit start: Sat Oct 24 00:00:00 EDT 2026 on d1 model=google/gemma-4-31B-it tp=1 sets=--set timing extra= ===
{
 "backend": "vllm",
 "model": "google/gemma-4-31B-it",
 "seconds": 300.0,
 "prompts": 40,
 "per_arm": {
  "original": {"versions": 1, "valid": 1, "not_applicable": 0, "attempts_2": 0},
  "5": {"versions": 9, "valid": 8, "not_applicable": 0, "attempts_2": 1}
 }
}
=== ce-e1-edit done: Sat Oct 24 00:06:00 EDT 2026 ===
"""


def plan_inputs():
    pages = [{"query_id": q, "set": s, "role": role} for q, s in [("q1", "main"), ("q2", "main"),
                                                                    ("r1", "replication"), ("t1", "timing"),
                                                                    ("s1", "smoke")]
             for role in ("target", "competitor")]
    yes = {("q1", "5"), ("q1", "2"), ("q1", "13"), ("q1", "ALL"), ("q2", "9"), ("r1", "5"), ("t1", "5"), ("s1", "5")}
    appl = [{"query_id": q, "arm": a, "applicable": (q, a) in yes, "reason": None}
            for q in ("q1", "q2", "r1", "t1", "s1") for a in [str(n) for n in range(1, 15)] + ["ALL"]]
    return pages, appl


class TimingReport(unittest.TestCase):
    def test_log_summaries_finds_the_json_summaries_among_other_lines(self):
        (s,) = tr.log_summaries(GEN_GEMMA)
        self.assertEqual((s["prompts"], s["generate_seconds"]), (100, 200.0))
        self.assertEqual(tr.log_tp(GEN_QWEN), 2)
        self.assertEqual(tr.log_tp("no start line"), 1)

    def test_measured_throughput_per_judge_and_for_the_editor(self):
        m = tr.measured([GEN_GEMMA, GEN_QWEN], [EDIT])
        self.assertEqual(m["judges"][G], {"jobs": 1, "prompts": 100, "generate_seconds": 200.0,
                                          "load_seconds": 60.0, "tp": 1, "seconds_per_prompt": 2.0})
        self.assertEqual(m["judges"][Q]["tp"], 2)
        self.assertEqual(m["judges"][Q]["seconds_per_prompt"], 4.0)
        self.assertEqual(m["editor"], {"versions": 10, "seconds": 300.0, "tp": 1, "seconds_per_version": 30.0})

    def test_two_logs_of_one_judge_add_up(self):
        m = tr.measured([GEN_GEMMA, GEN_GEMMA], [])
        self.assertEqual((m["judges"][G]["jobs"], m["judges"][G]["prompts"]), (2, 200))
        self.assertEqual(m["judges"][G]["seconds_per_prompt"], 2.0)
        self.assertIsNone(m["editor"])

    def test_planned_versions_count_originals_applicable_arms_and_placebos_by_tier(self):
        pages, appl = plan_inputs()
        plan = tr.planned_versions(pages, appl)
        # main tier 1: 2 originals + q1's 5, P5, ALL, P_ALL + q2's 9; tier 2: 2, P2; tier 3: 13.
        self.assertEqual(plan, {"main": {1: 7, 2: 2, 3: 1}, "replication": {1: 3}})

    def test_projection_multiplies_versions_by_seeds_and_judge_throughput(self):
        pages, appl = plan_inputs()
        p = tr.project(tr.measured([GEN_GEMMA, GEN_QWEN], [EDIT]), tr.planned_versions(pages, appl))
        job = {(j["set"], j["judge"], j["tier"]): j for j in p["jobs"]}
        g1 = job[("main", G, 1)]
        self.assertEqual(g1["prompts"], 56)
        self.assertAlmostEqual(g1["hours"], (60 + 56 * 2.0) / 3600)
        self.assertAlmostEqual(g1["gpu_hours"], g1["hours"])
        q1 = job[("main", Q, 1)]
        self.assertAlmostEqual(q1["gpu_hours"], 2 * (120 + 56 * 4.0) / 3600)
        self.assertEqual(g1["shards"], 1)
        self.assertNotIn("timing", {j["set"] for j in p["jobs"]})
        self.assertAlmostEqual(p["editor"]["main"]["gpu_hours"], 10 * 30.0 / 3600)
        self.assertAlmostEqual(p["totals"]["main"][G], sum(j["gpu_hours"] for j in p["jobs"]
                                                          if j["set"] == "main" and j["judge"] == G))
        self.assertAlmostEqual(p["totals"]["all"], sum(j["gpu_hours"] for j in p["jobs"])
                               + sum(e["gpu_hours"] for e in p["editor"].values()))

    def test_a_job_over_six_hours_is_split_into_shards(self):
        p = tr.project(tr.measured([GEN_GEMMA], []), {"main": {1: 2000}})
        (job,) = p["jobs"]
        self.assertGreater(job["hours"], 6)
        self.assertEqual(job["shards"], 2)
        self.assertEqual(p["missing_judges"], [Q])

    def test_cli_prints_the_projection_and_writes_json(self):
        pages, appl = plan_inputs()
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_jsonl(d / "pages.jsonl", pages)
            write_jsonl(d / "applicability.jsonl", appl)
            (d / "g.out").write_text(GEN_GEMMA)
            (d / "q.out").write_text(GEN_QWEN)
            (d / "e.out").write_text(EDIT)
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                tr.main(["--data", str(d), "--gen-log", str(d / "g.out"), "--gen-log", str(d / "q.out"),
                         "--edit-log", str(d / "e.out"), "--json", str(d / "timing.json")])
            saved = json.loads((d / "timing.json").read_text())
        text = printed.getvalue()
        self.assertIn("main", text)
        self.assertIn("GPU-hours", text)
        self.assertNotIn("—", text)
        self.assertEqual(len(saved["jobs"]), 2 * 4)  # (main: tiers 1-3, replication: tier 1) x 2 judges


if __name__ == "__main__":
    unittest.main()
