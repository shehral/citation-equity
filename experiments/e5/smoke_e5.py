"""E5's local smoke run of the edit job (PLAN_E5 "Runs and compute" step 1; E3's fake-editor
precedent): the q_L, 12K and P12K paths (and 12 and P12 on a new query) on two real E5 queries, with
no model call, then every step that follows the edit job on the cluster.

1. A folder data/smoke/ with the two queries' rows of E5's pages, edit texts, applicability,
   engine output and deterministic versions.
2. The edit job's exact editor command (edit.sbatch's, E5 mode) with --backend fake: E1's fake
   editor answers every span unchanged, so 12 and 12K fail validation and regenerate, and q_L
   gets one line per keyword. Proves the command line, the guards and the files it writes.
3. The same editor run in process with fake_editor.FakeE5Backend, which edits as a cooperative
   editor would: 12K and 12 work the missing key words into the title, P12K and P12 paraphrase,
   and every version is validated by E1's validators (arm 12 with q', P12 with q).
4. build_prompts_e5.py (--tokens none) on the local build, then make_versions.py ql and
   merge-edits, build_prompts_e5.py again (it stops if a tier 1 or tier 3 file changed) and E1's
   score.py on fake answers, so the 9L, 12K, P12K, 12 and P12 rows (E1's own 12 and P12 on the E1
   query included) reach prompts, batches and cells.

Writes data/smoke/smoke.json (counts and checks; no page text) and prints it.

Usage: python3 -I experiments/e5/smoke_e5.py [--queries geo-test-A,geo-test-B]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

import editor  # noqa: E402
import fake_editor  # noqa: E402

FILES = ["pages.jsonl", "edit_texts.jsonl", "applicability.jsonl", "edit_applicability.jsonl",
         "edit_questions.jsonl", "engine_original.jsonl", "versions.jsonl"]
# Versions the cluster adds after the local build (make_versions ql: 9L; merge-edits: 12, P12, 12K, P12K, except E1's
# own 12 and P12, which the local build copies). The smoke starts from the local build, so it leaves them out: once the
# real edit job's rows are merged into data/versions.jsonl, copying them would make the smoke's second prompt build
# meet tier-2 batch files with other prompts and stop.
CLUSTER_ARMS = ("9L", "12", "P12", "12K", "P12K")


def local_build_row(r: dict) -> bool:
    return r["arm"] not in CLUSTER_ARMS or (r["arm"] in ("12", "P12") and r.get("stratum") == "e1")


def pick(data: Path) -> list[str]:
    """An E1 query and a new query where 12K applies (the new one with arm 12 too), each with a title."""
    texts = {t["query_id"]: t for t in common.read_jsonl(data / "edit_texts.jsonl")}
    appl = {(r["query_id"], r["arm"]): r["applicable"] for r in common.read_jsonl(data / "edit_applicability.jsonl")}
    titled = {p["query_id"] for p in common.read_jsonl(data / "pages.jsonl") if p["role"] == "target" and p["title"].strip()}
    e1 = next(q for q, t in texts.items() if t["stratum"] == "e1" and appl.get((q, "12K")) and q in titled)
    new = next(q for q, t in texts.items() if t["stratum"] in e5.NEW_STRATA and appl.get((q, "12K"))
               and appl.get((q, "12")) and q in titled)
    return [e1, new]


def subset(data: Path, out: Path, qids: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for stale in [*(out / "batches").glob("*.prompts.jsonl"), out / "answers" / "fake.jsonl"]:
        stale.unlink(missing_ok=True)  # the smoke's own outputs from an earlier run
    for name in FILES:
        rows = [r for r in common.read_jsonl(data / name) if r.get("query_id") in qids
                and (name != "versions.jsonl" or local_build_row(r))]
        common.write_jsonl(out / name, rows)


def cli_run(out: Path) -> dict:
    """edit.sbatch's E5 command with E1's fake backend."""
    sets = ["--set", "main", "--set", "e3", "--set", "e3-four"]
    cmd = [sys.executable, "-I", str(e5.E1_DIR / "editor.py"), "--backend", "fake",
           "--pages", str(out / "pages.jsonl"), "--applicability", str(out / "edit_applicability.jsonl"),
           "--out", str(out / "cli_edit_versions.jsonl"), "--log", str(out / "cli_edit_log.jsonl"), *sets,
           "--arms", "12,12K", "--no-all", "--edit-questions", str(out / "edit_questions.jsonl"),
           "--q-l-from", str(out / "edit_texts.jsonl"), "--q-l-out", str(out / "cli_q_L.jsonl")]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"smoke: the editor command failed:\n{proc.stderr[-2000:]}")
    rows = common.read_jsonl(out / "cli_edit_versions.jsonl")
    q_l = common.read_jsonl(out / "cli_q_L.jsonl")
    at = cmd.index("--out") + 1  # the same command aimed at E1's versions.jsonl must be refused
    guard = subprocess.run(cmd[:at] + [str(e5.E1_DIR / "data" / "versions.jsonl")] + cmd[at + 1:],
                           capture_output=True, text=True)
    return {"versions": dict(Counter(f'{r["arm"]} valid={r["valid"]}' for r in rows).most_common()),
            "q_L": dict(Counter(r["status"] for r in q_l)),
            "prompts_sent": len(common.read_jsonl(out / "cli_edit_log.jsonl")),
            "refuses_e1_versions_out": guard.returncode == 2 and "never writes E1's" in guard.stderr,
            "reasons": dict(Counter(f'{r["arm"]}: {(r["excluded_reason"] or "")[:90]}' for r in rows if not r["valid"]))}


def cooperative_run(out: Path) -> dict:
    """The editor in process with the cooperative fake editor (main()'s order: q_L, then the edits)."""
    backend, log = fake_editor.FakeE5Backend(), []
    q_l = editor.write_q_l(common.read_jsonl(out / "edit_texts.jsonl"), backend, log)
    common.write_jsonl(out / "q_L.jsonl", q_l)
    pages = editor.select_pages(common.read_jsonl(out / "pages.jsonl"), ["main", "e3", "e3-four"])
    edit_q = {r["query_id"]: r["edit_question"] for r in common.read_jsonl(out / "edit_questions.jsonl")}
    rows = editor.run(pages, common.read_jsonl(out / "edit_applicability.jsonl"), backend, arms=["12", "12K"],
                      engine=e5.engine, do_all=False, log=log, edit_questions=edit_q)
    common.write_jsonl(out / "edit_versions.jsonl", rows)
    common.write_jsonl(out / "edit_log.jsonl", log)
    sampling = Counter(json.dumps(c["sampling"], sort_keys=True) for c in backend.calls if c["arm"] == "q_L")
    prompts = {e["key"]: e["prompt"] for e in log}
    texts = {t["query_id"]: t for t in common.read_jsonl(out / "edit_texts.jsonl")}
    pages_by = {p["query_id"]: p for p in pages if p["role"] == "target"}
    question_lines = {}
    for key, prompt in prompts.items():
        qid, arm = key.split("|")[:2]
        if arm in ("12K", "P12K", "12", "P12"):
            want = texts[qid]["q_prime"] if arm == "12K" else pages_by[qid]["query"]
            question_lines[key] = f"Question the page is read for: {want}\n" in prompt
    return {"versions": dict(Counter(f'{r["arm"]} valid={r["valid"]}' for r in rows).most_common()),
            "q_L": dict(Counter(r["status"] for r in q_l)), "q_L_sampling": dict(sampling),
            "prompt_question_is_right": all(question_lines.values()), "prompts_checked": len(question_lines),
            "reasons": dict(Counter(f'{r["arm"]}: {(r["excluded_reason"] or "")[:90]}' for r in rows if not r["valid"]))}


def downstream(out: Path) -> dict:
    """make_versions ql and merge-edits, build_prompts_e5 and score.py on fake answers."""
    run = lambda *a: subprocess.run([sys.executable, "-I", *map(str, a)], capture_output=True, text=True)  # noqa: E731
    steps = {}
    # The cluster's order: prompts from the local build first (tier 1 and tier 3, E1's own 12 and P12 included),
    # then again after the edit job's rows are merged; the second run stops if a tier 1 or tier 3 file changed.
    for name, args in (("prompts-before", [e5.E5_DIR / "build_prompts_e5.py", "--data", out, "--tokens", "none"]),
                       ("ql", [e5.E5_DIR / "make_versions.py", "--data", out, "ql", "--q-l", out / "q_L.jsonl"]),
                       ("merge-edits", [e5.E5_DIR / "make_versions.py", "--data", out, "merge-edits",
                                        "--edits", out / "edit_versions.jsonl"]),
                       ("prompts", [e5.E5_DIR / "build_prompts_e5.py", "--data", out, "--tokens", "none"])):
        proc = run(*args)
        if proc.returncode != 0:
            raise SystemExit(f"smoke: {name} failed:\n{proc.stderr[-2000:]}")
        steps[name] = proc.stdout.strip().splitlines()[-1][:300]
    prompts = common.read_jsonl(out / "prompts.jsonl")
    answers = [{"key": p["key"], "answer": f"Answer [{p['slot']}][1]."} for p in prompts]
    common.write_jsonl(out / "answers" / "fake.jsonl", answers)
    proc = run(e5.E1_DIR / "score.py", "--data", out, "--out", out / "out", "--sets", "main,e3,e3-four,replication")
    if proc.returncode != 0:
        raise SystemExit(f"smoke: score.py failed:\n{proc.stderr[-2000:]}")
    cells = common.read_jsonl(out / "out" / "cells.jsonl")
    versions = common.read_jsonl(out / "versions.jsonl")
    extra_ok = all(("edit_text" in v and "tool_gate" in v and "same_sentence_as_9" in v) for v in versions)
    return {"steps": steps, "versions": dict(Counter(f'{v["arm"]} valid={v["valid"]}' for v in versions).most_common()),
            "extra_fields_on_every_version": extra_ok,
            "batches": json.loads((out / "prompt_build.json").read_text())["batches"],
            "cells": dict(Counter(f'{c["set"]} {c["arm"]} {c["judge"]}' for c in cells).most_common()),
            "cells_complete": all(c["n_answers"] == 8 and not c["dropped"] for c in cells)}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(e5.DATA))
    ap.add_argument("--queries", help="two query ids (default: the first E1 and new queries where 12K applies)")
    args = ap.parse_args(argv)
    data = Path(args.data)
    out = data / "smoke"
    qids = args.queries.split(",") if args.queries else pick(data)
    subset(data, out, qids)
    e5.check_engine_pin()
    result = {"queries": qids, "cli_fake_editor": cli_run(out), "cooperative_fake_editor": cooperative_run(out)}
    result["downstream"] = downstream(out)
    text = json.dumps(result, indent=1, default=str)
    (out / "smoke.json").write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
