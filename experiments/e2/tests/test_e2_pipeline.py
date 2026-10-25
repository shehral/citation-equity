"""E2 end to end on hand-made inputs: E2a from versions to the report, and E2b's editor command.

Run: python3 -I -m unittest discover -s experiments/e2/tests
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E2))
sys.path.insert(0, str(E2 / "tests"))

import e2_fixtures as fx  # noqa: E402  (puts experiments/e1 and its tests on the path)

import analyze_e2  # noqa: E402
import build_prompts  # noqa: E402
import common  # noqa: E402
import editor  # noqa: E402
import fake_answers  # noqa: E402
import make_versions  # noqa: E402
import report_e2  # noqa: E402
import score  # noqa: E402
from helpers import check, fake_engine  # noqa: E402


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()) as printed:
        fn(*args)
    return printed.getvalue()


class E2aEndToEnd(unittest.TestCase):
    def test_versions_prompts_answers_scores_analysis_and_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            e1d, e1o, ad, ao, out = root / "e1d", root / "e1o", root / "ad", root / "ao", root / "out"
            fx.e1_data(e1d)
            quiet(make_versions.main, ["--e1-data", str(e1d), "--out", str(ad / "versions.jsonl")])
            shutil.copy(e1d / "pages.jsonl", ad / "pages.jsonl")
            shutil.copy(e1d / "applicability.jsonl", ad / "applicability.jsonl")
            # E1's own prompts and answers for the original and arm 9; E2a builds only 9W and 9P.
            for data, extra in ((e1d, []), (ad, ["--without-original"])):
                quiet(build_prompts.main, ["--data", str(data), "--tokens", "utf8", *extra])
                fake_answers.write_answers(data)
            e1_prompts = common.read_jsonl(e1d / "prompts.jsonl")
            e2_prompts = common.read_jsonl(ad / "prompts.jsonl")
            self.assertEqual({p["arm"] for p in e2_prompts}, {"9W", "9P"})
            self.assertEqual({p["arm"] for p in e1_prompts}, {"original", "9"})
            batches = json.loads((ad / "prompt_build.json").read_text())["batches"]
            self.assertEqual(batches, {"main.gemma-4-12b.tier1": 32, "main.qwen3.8-27b.tier1": 32,
                                       "replication.gemma-4-12b.tier1": 16, "replication.qwen3.8-27b.tier1": 16})
            score.main(["--data", str(e1d), "--out", str(e1o)])
            score.main(["--data", str(ad), "--out", str(ao)])
            quiet(analyze_e2.main, ["--e1-data", str(e1d), "--e1-out", str(e1o), "--e2a-data", str(ad),
                                    "--e2a-out", str(ao), "--e2b-data", str(root / "no-b"),
                                    "--e2b-out", str(root / "no-b"), "--out", str(out),
                                    "--draws", "500", "--resamples", "200"])
            report_e2.main(["--out", str(out)])
            result = json.loads((out / "analysis_e2.json").read_text())
            text = (out / "RESULTS_E2.md").read_text()
        main = result["e2a"]["main"]
        self.assertEqual(main["mode"], "two-judge")
        self.assertEqual([(c["arm"], c["ref"], c["n"]) for c in main["planned"]], [("9", "9W", 2), ("9", "9P", 2)])
        self.assertEqual({c["label"] for c in main["planned"]}, {"insufficient n"})
        self.assertEqual(result["e2a"]["replication"]["planned"][0]["n"], 1)
        self.assertEqual(result["e2b"]["status"], "not run")
        self.assertIn("| 9 vs 9W | the heading markup | 2 |", text)


def lead_engine(items):
    """A fake engine with the question-headings check (share of H2 headings ending in '?')."""
    out = {}
    for item in items:
        md = item["markdown"]
        heads = re.findall(r"(?m)^## (.*)$", md)
        findings = []
        for h in heads:
            if not h.endswith("?"):
                s = md.index(f"## {h}") + 3
                findings.append({"start": s, "end": s + len(h), "message": "m"})
        eng = fake_engine(md, {"question-headings": check(sum(h.endswith("?") for h in heads) / max(1, len(heads)),
                                                          applicable=len(heads) >= 2, findings=findings)})
        out[item["id"]] = {"id": item["id"], **eng}
    return out


QUERY = "why does espresso taste bitter"
TEXT = ("Grinding beans matters a lot.\n\n## Grind size\n\nA fine grind slows the water down quite a lot.\n\n"
        "## Water\n\nHot water extracts faster.")


def e2b_pages():
    def page(i, role):
        return {"page_id": f"q1-p{i}", "query_id": "q1", "set": "main", "query": QUERY, "url": f"https://e.org/{i}",
                "source": "sample", "title": "T", "text": TEXT if role == "target" else "Donor text here.",
                "words": 20, "tokens_max": 30, "cut": False, "sha256": "0" * 64, "role": role}
    return [page(1, "target"), page(3, "donor")]


APPLICABILITY = [{"query_id": "q1", "arm": a, "applicable": True, "reason": None} for a in ("2", "12", "ALL")]


class E2bEditor(unittest.TestCase):
    def test_arms_12_runs_12_p12_all_and_p_all_and_nothing_else(self):
        class Backend:
            def __init__(self):
                self.arms = []

            def generate(self, jobs):
                self.arms += [j["arm"] for j in jobs]
                out = []
                for j in jobs:
                    if j["arm"] == "12":
                        body = {"title": "T espresso"}
                    elif j["arm"] == "2":
                        body = {s["id"]: s["text"] + "?" for s in j["spans"]}
                    else:
                        body = {s["id"]: s["text"].replace("Grind size", "Size of grind").replace("T", "U")
                                for s in j["spans"]}
                    out.append((json.dumps(body), "stop"))
                return out

        backend = Backend()
        rows = editor.run(e2b_pages(), APPLICABILITY, backend, arms=["12"], engine=lead_engine)
        by_arm = {r["arm"]: r for r in rows}
        self.assertEqual(sorted(by_arm), sorted(["original", "12", "P12", "ALL", "P_ALL"]))
        self.assertTrue(by_arm["12"]["valid"], by_arm["12"]["excluded_reason"])
        self.assertTrue(by_arm["ALL"]["valid"], by_arm["ALL"]["excluded_reason"])
        self.assertEqual(set(backend.arms), {"12", "P12", "2", "P_ALL"})  # arm 2 only as a step of ALL

    def test_the_documented_command_writes_only_its_own_folder(self):
        """edit.sbatch's editor line with E2b's settings (README), on the fake backend."""
        original = common.run_engine
        common.run_engine = lead_engine
        try:
            with tempfile.TemporaryDirectory() as tmp:
                e1, b = Path(tmp) / "e1", Path(tmp) / "e2" / "b"
                fx.write_jsonl(e1 / "pages.jsonl", e2b_pages())
                fx.write_jsonl(e1 / "applicability.jsonl", APPLICABILITY)
                fx.write_jsonl(e1 / "versions.jsonl", [{"version_id": "e1 versions, untouched"}])
                b.mkdir(parents=True)
                for f in ("pages.jsonl", "applicability.jsonl"):
                    shutil.copy(e1 / f, b / f)
                printed = quiet(editor.main, [
                    "--backend", "fake", "--model", "Qwen/Qwen3.8-27B", "--tp", "1",
                    "--pages", str(b / "pages.jsonl"), "--applicability", str(b / "applicability.jsonl"),
                    "--out", str(b / "versions.jsonl"), "--log", str(b / "editor_log.jsonl"),
                    "--set", "main", "--arms", "12"])
                rows = common.read_jsonl(b / "versions.jsonl")
                untouched = (e1 / "versions.jsonl").read_text()
        finally:
            common.run_engine = original
        self.assertEqual({r["arm"] for r in rows}, {"original", "12", "ALL", "P_ALL"})  # the fake 12 fails, so no P12
        self.assertIn('"12"', printed)
        self.assertEqual(untouched, '{"version_id": "e1 versions, untouched"}\n')


if __name__ == "__main__":
    unittest.main()
