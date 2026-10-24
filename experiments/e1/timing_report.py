"""E1 timing smoke report (PREREG_E1.md, Run plan and compute; r3 amendments 6 and 8).

Reads the cluster logs of the timing-smoke jobs (the timing query edited by edit.sbatch and its
prompts answered by generate.sbatch, both judges) and projects GPU-hours for the main and
replication sets. It reads only the jobs' summary lines (prompt counts, seconds, tensor-parallel
size), never an answer: the timing query's outcomes are discarded.

- Generation: per judge, seconds per prompt = generate_seconds / prompts over its timing logs, and
  the model load is the longest one measured. Each (set, judge, tier) job is projected as
  load + versions x 8 seeds x seconds per prompt, times the job's GPUs (tp) for GPU-hours. A job over
  6 hours is split into ceil(hours / 6) shards in file order (amendment 6).
- Versions per set and tier come from pages.jsonl and applicability.jsonl: one original per query
  plus every applicable arm and its placebo. That assumes every edit valid, an upper bound.
- Editor: seconds per version from the editor's summary (model load not included), times the same
  version counts.
- The timing batch is small, so vLLM batches less than on a full set: the per-prompt figure, and so
  the projection, errs on the high side.

Usage: python3 -I experiments/e1/timing_report.py --gen-log ce-e1-gen-<id>.out [--gen-log ...]
           [--edit-log ce-e1-edit-<id>.out] [--data DIR] [--json OUT]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

from e1_common import JUDGE_ORDER, JUDGES, PLACEBOS, SEEDS, parent_arm, read_jsonl, tier, write_json  # noqa: E402

REPORTED_SETS = ("main", "replication")
SHARD_HOURS = 6
MODEL_JUDGE = {model: judge for judge, model in JUDGES.items()}
PLACEBO_OF = {parent_arm(p): p for p in PLACEBOS}
_START = re.compile(r"^=== ce-e1-(?:gen|edit) start:.*\btp=(\d+)", re.M)
_OBJECT = re.compile(r"^\{", re.M)


def log_summaries(text: str) -> list[dict]:
    """Every JSON object in a log that starts at the beginning of a line (the jobs' summaries)."""
    decoder, out = json.JSONDecoder(), []
    for m in _OBJECT.finditer(text):
        try:
            value, _ = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(value, dict):
            out.append(value)
    return out


def log_tp(text: str) -> int:
    """The tensor-parallel size (GPUs) from the job's start line, 1 when it is missing."""
    m = _START.search(text)
    return int(m.group(1)) if m else 1


def measured(gen_texts: list[str], edit_texts: list[str]) -> dict:
    """Throughput per judge (from batch_generate.py summaries) and for the editor (editor.py's)."""
    judges: dict[str, dict] = {}
    for text in gen_texts:
        tp = log_tp(text)
        for s in log_summaries(text):
            if "generate_seconds" not in s:
                continue
            if s["model"] not in MODEL_JUDGE:
                raise ValueError(f"log summary for {s['model']}, which is not an E1 judge ({sorted(MODEL_JUDGE)})")
            j = judges.setdefault(MODEL_JUDGE[s["model"]], {"jobs": 0, "prompts": 0, "generate_seconds": 0.0,
                                                            "load_seconds": 0.0, "tp": 1})
            j["jobs"] += 1
            j["prompts"] += s["prompts"]
            j["generate_seconds"] += s["generate_seconds"]
            j["load_seconds"] = max(j["load_seconds"], s["load_seconds"])
            j["tp"] = max(j["tp"], tp)
    for j in judges.values():
        j["seconds_per_prompt"] = j["generate_seconds"] / j["prompts"] if j["prompts"] else None

    editor = None
    for text in edit_texts:
        tp = log_tp(text)
        for s in log_summaries(text):
            if "backend" not in s or "per_arm" not in s:
                continue
            editor = editor or {"versions": 0, "seconds": 0.0, "tp": 1}
            editor["versions"] += sum(a["versions"] for a in s["per_arm"].values())
            editor["seconds"] += s["seconds"]
            editor["tp"] = max(editor["tp"], tp)
    if editor:
        editor["seconds_per_version"] = editor["seconds"] / editor["versions"] if editor["versions"] else None
    return {"judges": judges, "editor": editor}


def planned_versions(pages: list[dict], applicability: list[dict]) -> dict[str, dict[int, int]]:
    """Versions to generate per reported set and tier: originals, applicable arms and their placebos."""
    sets = {p["query_id"]: p["set"] for p in pages if p["role"] == "target" and p["set"] in REPORTED_SETS}
    plan: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for set_name in sets.values():
        plan[set_name][1] += 1
    for a in applicability:
        if a["query_id"] in sets and a["applicable"]:
            plan[sets[a["query_id"]]][tier(a["arm"])] += 1 + (a["arm"] in PLACEBO_OF)
    return {s: dict(sorted(tiers.items())) for s, tiers in plan.items()}


def project(m: dict, plan: dict[str, dict[int, int]], seeds: int = len(SEEDS)) -> dict:
    """Projected generation jobs, editor time and GPU-hour totals."""
    judges = [j for j in JUDGE_ORDER if (m["judges"].get(j) or {}).get("seconds_per_prompt") is not None]
    jobs = []
    for set_name in [s for s in REPORTED_SETS if s in plan]:
        for judge in judges:
            t = m["judges"][judge]
            for tier_, versions in plan[set_name].items():
                prompts = versions * seeds
                hours = (t["load_seconds"] + prompts * t["seconds_per_prompt"]) / 3600
                jobs.append({"set": set_name, "judge": judge, "tier": tier_, "versions": versions, "prompts": prompts,
                             "hours": hours, "gpu_hours": hours * t["tp"],
                             "shards": max(1, math.ceil(hours / SHARD_HOURS))})
    editor = {}
    e = m["editor"]
    if e and e["seconds_per_version"] is not None:
        for set_name in [s for s in REPORTED_SETS if s in plan]:
            versions = sum(plan[set_name].values())
            hours = versions * e["seconds_per_version"] / 3600
            editor[set_name] = {"versions": versions, "hours": hours, "gpu_hours": hours * e["tp"]}
    totals: dict = {s: {j: 0.0 for j in judges} for s in REPORTED_SETS if s in plan}
    for job in jobs:
        totals[job["set"]][job["judge"]] += job["gpu_hours"]
    totals["editor"] = sum(x["gpu_hours"] for x in editor.values())
    totals["all"] = sum(job["gpu_hours"] for job in jobs) + totals["editor"]
    return {"seeds": seeds, "measured": m, "jobs": jobs, "editor": editor, "totals": totals,
            "missing_judges": [j for j in JUDGE_ORDER if j not in judges]}


def render(p: dict) -> str:
    m = p["measured"]
    lines = ["E1 timing smoke projection (PREREG_E1.md, Run plan; r3 amendments 6 and 8)", "",
             "Measured on the held-out timing query (its answers are discarded and not read here):"]
    for judge, t in m["judges"].items():
        if t["seconds_per_prompt"] is not None:
            lines.append(f"  {judge}: {t['prompts']} prompts in {t['jobs']} job(s), {t['seconds_per_prompt']:.2f} s per "
                         f"prompt, model load {t['load_seconds']:.0f} s, tp {t['tp']}")
    for judge in p["missing_judges"]:
        lines.append(f"  {judge}: no timing log, so no projection for this judge")
    e = m["editor"]
    if e and e["seconds_per_version"] is not None:
        lines.append(f"  editor: {e['versions']} versions in {e['seconds']:.0f} s, {e['seconds_per_version']:.1f} s per "
                     f"version, tp {e['tp']} (model load not included)")
    else:
        lines.append("  editor: no edit log, so no editor projection")
    lines += ["", f"Generation jobs (versions x {p['seeds']} seeds; upper bound, every edit counted as valid):",
              f"  {'set':<12} {'judge':<12} {'tier':>4} {'versions':>8} {'prompts':>8} {'hours':>7} "
              f"{'GPU-hours':>9} {'shards':>6}"]
    for j in p["jobs"]:
        lines.append(f"  {j['set']:<12} {j['judge']:<12} {j['tier']:>4} {j['versions']:>8} {j['prompts']:>8} "
                     f"{j['hours']:>7.2f} {j['gpu_hours']:>9.2f} {j['shards']:>6}")
    if p["editor"]:
        lines += ["", "Editor:"]
        for set_name, x in p["editor"].items():
            lines.append(f"  {set_name}: {x['versions']} versions, {x['hours']:.2f} hours, {x['gpu_hours']:.2f} GPU-hours")
    lines += ["", "GPU-hours:"]
    for set_name in REPORTED_SETS:
        if set_name in p["totals"]:
            per = ", ".join(f"{j} {h:.2f}" for j, h in p["totals"][set_name].items())
            lines.append(f"  {set_name} generation: {per}")
    lines.append(f"  editor: {p['totals']['editor']:.2f}")
    lines.append(f"  total: {p['totals']['all']:.2f}")
    if p["jobs"]:
        longest = max(p["jobs"], key=lambda j: j["hours"])
        lines.append("")
        lines.append(f"Longest generation job: {longest['hours']:.2f} hours ({longest['set']}.{longest['judge']}."
                     f"tier{longest['tier']}).")
        over = [j for j in p["jobs"] if j["shards"] > 1]
        lines.append(f"Jobs over {SHARD_HOURS} hours, to shard in file order (amendment 6): "
                     + (", ".join(f"{j['set']}.{j['judge']}.tier{j['tier']} into {j['shards']}" for j in over)
                        if over else "none"))
    lines.append("The timing batch is small, so these figures err on the high side.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(Path(__file__).resolve().parent / "data"),
                    help="folder with the main pages.jsonl and applicability.jsonl")
    ap.add_argument("--gen-log", action="append", required=True, help="a generate.sbatch log (.out); repeatable")
    ap.add_argument("--edit-log", action="append", default=[], help="an edit.sbatch log (.out); repeatable")
    ap.add_argument("--json", help="also write the projection here")
    args = ap.parse_args(argv)

    def read(paths: list[str]) -> list[str]:
        return [Path(x).read_text(encoding="utf-8", errors="replace") for x in paths]

    data = Path(args.data)
    m = measured(read(args.gen_log), read(args.edit_log))
    p = project(m, planned_versions(read_jsonl(data / "pages.jsonl"), read_jsonl(data / "applicability.jsonl")))
    sys.stdout.write(render(p))
    if args.json:
        write_json(Path(args.json), p)


if __name__ == "__main__":
    main()
