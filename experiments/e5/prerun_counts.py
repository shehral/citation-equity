"""E5's pre-run counts (PLAN_E5 "Size and power"), from the local build, before any E5 answer:
applicable and valid counts per version x set x stratum, the template mix, how often q' and q_G
equal q, same-sentence counts, the tool's own view, the planned contrasts' n, the expected answers
per tier per judge and the projected GPU-hours at E1's measured 3,100 answers per GPU-hour.

Versions the edit job writes (9L, 12K, P12K, 12 and P12 on the new queries) are projected: 9L at
9K's valid count (the same rule on another heading), 12 and 12K at E1's main-set validity rate for
arm 12 (50 of 63) and their placebos at E1's P12 rate (33 of 50). E1's own 12 and P12 on its main
queries are E1's versions, copied and re-answered in tier 3 (PLAN_E5 amendment 2), so they are
counted, not projected.

Job hours use the judges' measured E1 and E3 rates (the slowest job of 1,900 prompts or more on each
GPU type, from the jobs' summary lines: model load plus seconds per prompt), not the single-query
timing smoke, whose 2.39 s per prompt for Gemma was mostly model load.

Writes data/prerun_counts.json and PRERUN.md (numbers only, no page text; PRERUN.md is committed).

Usage: python3 -I experiments/e5/prerun_counts.py [--data experiments/e5/data]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

ANSWERS_PER_GPU_HOUR = 3100  # E1's measured judging rate (PLAN_E5 "Runs and compute")
# Measured per GPU type: the slowest E1 or E3 judge job with 1,900 prompts or more (summary lines in
# citation-equity-paper/results/runs/logs; jobs.csv): (model load seconds, generate seconds per prompt).
#   Gemma-4-12B, A100 80 GB: E3 e3 tierall, 2,832 prompts, load 243 s, 1.14 s per prompt (E1 main tier1: 1.07)
#   Gemma-4-12B, A100 40 GB: E1 main tier2, 1,952 prompts, 1.66 s per prompt; load up to 223 s (E3 e3-four)
#   Qwen3.8-27B, H200: E1 main tier2, 1,952 prompts, 0.90 s per prompt; load up to 717 s (E1 main tier1)
# The gpu:a100 request can land on either A100, so Gemma jobs get a range.
MEASURED = {"gemma-4-12b": {"A100 80 GB": (243, 1.14), "A100 40 GB": (223, 1.66)},
            "qwen3.8-27b": {"H200": (717, 0.90)}}
E1_RATE = {"12": (50, 63), "P12": (33, 50)}  # E1 main set: arm 12 valid of applicable; P12 valid of 12 valid
SEEDS = 8
JUDGES = 2
STRATA = ["e1", "e3", "e3-four", "replication"]
ARMS = ["original", "9", "9P", "9K", "9L", "9A", "9G", "12", "P12", "12K", "P12K"]
# Every local input the cluster run reads, hashed for the freeze (the files stay in the gitignored data folder).
FROZEN_FILES = ["pages.jsonl", "edit_texts.jsonl", "applicability.jsonl", "edit_applicability.jsonl",
                "edit_questions.jsonl", "engine_original.jsonl", "versions.jsonl"]


def norm(s: str | None) -> str:
    return " ".join((s or "").lower().rstrip("?").split())


def counts(data: Path) -> dict:
    texts = common.read_jsonl(data / "edit_texts.jsonl")
    appl = common.read_jsonl(data / "applicability.jsonl")
    edit_appl = common.read_jsonl(data / "edit_applicability.jsonl")
    versions = common.read_jsonl(data / "versions.jsonl")
    build = json.loads((data / "prompt_build.json").read_text(encoding="utf-8"))
    stratum = {t["query_id"]: t["stratum"] for t in texts}
    out: dict = {"generated": datetime.now().astimezone().isoformat(timespec="seconds"),
                 "edit_texts_sha256": e5.sha256_file(data / "edit_texts.jsonl"),
                 "versions_sha256": e5.sha256_file(data / "versions.jsonl"),
                 "applicability_sha256": e5.sha256_file(data / "applicability.jsonl")}

    # Applicable and valid per version x stratum.
    table = {s: {a: {"applicable": None, "valid": None} for a in ARMS} for s in STRATA}
    for s in STRATA:
        table[s]["original"]["applicable"] = sum(1 for q in stratum.values() if q == s)
    for r in appl:
        if r["arm"] in ARMS and r["applicable"]:
            c = table[stratum[r["query_id"]]][r["arm"]]
            c["applicable"] = (c["applicable"] or 0) + 1
    for s in STRATA:  # 12 is rebuilt on the new queries only; E1's main queries keep (and re-answer) E1's versions
        if s == "replication":
            table[s]["12"] = {"applicable": None, "valid": None, "note": "not run on the replication set"}
        for a in ("9", "9P", "9K", "9A", "9G"):
            if table[s][a]["applicable"] is None:
                table[s][a]["applicable"] = 0
    for r in edit_appl:
        if r["arm"] == "12" and r["applicable"] and stratum[r["query_id"]] in e5.NEW_STRATA:
            pass  # counted from applicability.jsonl above
    for s in STRATA:
        nine_app = sum(1 for r in appl if r["arm"] == "9" and r["applicable"] and stratum[r["query_id"]] == s)
        table[s]["9P"]["applicable"] = nine_app
        # P12 needs a valid 12 (E1's placebo on 12's spans): its "applicable" is 12's valid count
        table[s]["P12"]["applicable"] = None
        table[s]["P12K"]["applicable"] = None
    e1_12_valid = sum(1 for v in versions if v["arm"] == "12" and v["valid"] and stratum[v["query_id"]] == "e1")
    if any(v["arm"] in ("12", "P12") and stratum[v["query_id"]] == "e1" for v in versions):
        table["e1"]["P12"]["applicable"] = e1_12_valid
        table["e1"]["12"]["note"] = table["e1"]["P12"]["note"] = "E1's version, re-answered in tier 3"
    built = Counter((stratum[v["query_id"]], v["arm"]) for v in versions if v["valid"])
    for (s, a), n in built.items():
        table[s][a]["valid"] = n
    for s in STRATA:
        for a in ("9", "9P", "9K", "9A", "9G", "original"):
            if table[s][a]["valid"] is None and table[s][a]["applicable"] is not None:
                table[s][a]["valid"] = 0
        k_valid = table[s]["9K"]["valid"] or 0
        if table[s]["9L"]["valid"] is None:
            table[s]["9L"] = {"applicable": None, "valid": None, "projected_valid": k_valid,
                              "note": "q_L comes from the edit job; projected at 9K's valid count"}
        for arm, base in (("12K", "12K"), ("12", "12")):
            app = table[s][base]["applicable"]
            if table[s][arm]["valid"] is None and app and not (arm == "12" and s in ("e1", "replication")):
                v12 = round(app * E1_RATE["12"][0] / E1_RATE["12"][1])
                table[s][arm]["projected_valid"] = v12
                placebo = "P12K" if arm == "12K" else "P12"
                table[s][placebo]["projected_valid"] = round(v12 * E1_RATE["P12"][0] / E1_RATE["P12"][1])
        if s == "replication":
            table[s]["12K"]["note"] = "not run on the replication set"
    out["versions"] = table
    out["files_sha256"] = {name: e5.sha256_file(data / name) for name in FROZEN_FILES if (data / name).exists()}
    out["bundles_sha256"] = {"engine_cli.js (E1's)": e5.ENGINE_SHA256,
                             "questions_cli.js": e5.bundles()["questions_cli"]["sha256"]}

    # Templates, q' and q_G against q.
    by_set = defaultdict(list)
    for t in texts:
        by_set[t["set"]].append(t)
    valid = {(v["query_id"], v["arm"]): v for v in versions if v["valid"]}
    out["templates"] = {s: dict(Counter(t["template"] for t in rows)) for s, rows in by_set.items()}
    out["templates_among_valid_9K"] = {s: dict(Counter(t["template"] for t in rows if (t["query_id"], "9K") in valid))
                                       for s, rows in by_set.items()}
    out["q_prime_equals_k"] = {s: sum(t["q_prime"] == t["k"] for t in rows) for s, rows in by_set.items()}
    out["q_prime_equals_q"] = {s: {"exact": sum(t["q_prime"] == t["query"] for t in rows),
                                   "ignoring_case_space_and_question_mark": sum(norm(t["q_prime"]) == norm(t["query"])
                                                                                for t in rows)}
                               for s, rows in by_set.items()}
    out["q_G_equals_q"] = {s: {"exact": sum(t["q_G"] == t["query"] for t in rows),
                               "ignoring_case_space_and_question_mark": sum(bool(t["q_G"]) and norm(t["q_G"]) == norm(t["query"])
                                                                            for t in rows)}
                           for s, rows in by_set.items()}
    out["q_G_origin"] = {s: dict(Counter(t["q_G_origin"] or "none" for t in rows)) for s, rows in by_set.items()}
    out["text_9A_equals_q"] = {s: sum(t["text_9A"] == t["query"] for t in rows) for s, rows in by_set.items()}
    # Edit texts that are q itself (ignoring case, spaces, a final '?'): there the version makes arm 9's edit
    # (up to the heading's case); listed by query id so the report can flag them (no page text).
    by_vid = {v["version_id"]: v for v in versions}
    flags = []
    for t in texts:
        for arm, field in (("9K", "q_prime"), ("9A", "text_9A"), ("9G", "q_G")):
            if not e5.is_q(t[field], t["query"]):
                continue
            v, nine = by_vid.get(f"{t['query_id']}:{arm}"), by_vid.get(f"{t['query_id']}:9")
            flags.append({"query_id": t["query_id"], "stratum": t["stratum"], "arm": arm,
                          "exact": t[field] == t["query"],
                          "version": None if v is None else ("valid" if v["valid"] else "invalid"),
                          "text_equals_arm_9": None if v is None or nine is None
                          else (v["title"], v["text"]) == (nine["title"], nine["text"])})
    out["edit_text_is_q"] = flags
    out["k_equals_9A"] = {s: sum(t["k"] == t["text_9A"] for t in rows) for s, rows in by_set.items()}
    out["n_key_terms"] = {s: dict(sorted(Counter(min(t["n_key_terms"], 5) for t in rows).items()))
                          for s, rows in by_set.items()}

    # Same sentence as arm 9, tool view, length and key terms, per arm and stratum (valid versions).
    per = defaultdict(lambda: defaultdict(list))
    for v in versions:
        if v["valid"]:
            per[(stratum[v["query_id"]], v["arm"])]["v"].append(v)
    detail = {}
    for (s, a), d in sorted(per.items()):
        vs = d["v"]
        row = {"valid": len(vs), "mean_length_ratio": round(sum(v["length_ratio"] for v in vs) / len(vs), 4),
               "mean_key_terms_delta": round(sum(v["key_terms_delta"] for v in vs) / len(vs), 3)}
        if a in ("9K", "9L", "9A", "9G"):
            row["same_sentence_as_9"] = sum(bool(v["same_sentence_as_9"]) for v in vs)
        if vs[0].get("edit_text") is not None:
            row["tool_gate"] = sum(bool(v["tool_gate"]) for v in vs)
            row["tool_covers_edit_text"] = sum(bool(v["tool_covers_edit_text"]) for v in vs)
            row["tool_covers_q"] = sum(bool(v["tool_covers_q"]) for v in vs)
        detail.setdefault(s, {})[a] = row
    out["valid_version_detail"] = detail

    # Planned contrasts' n (queries with both versions valid).
    def both(a, b, strata):
        return sum(1 for q, s in stratum.items() if s in strata and (q, a) in valid and (q, b) in valid)

    main_strata, new = ("e1", "e3", "e3-four"), e5.NEW_STRATA
    out["planned_n"] = {
        "gate 9 vs original (new)": both("9", "original", new),
        "9K vs original (main)": both("9K", "original", main_strata),
        "9K vs 9P (main)": both("9K", "9P", main_strata),
        "9L vs original (main)": "after the edit job (projected about 9K's)",
        "step 5: 9 vs original (main)": both("9", "original", main_strata),
        "replication 9K vs original": both("9K", "original", ("replication",)),
        "replication 9K vs 9P": both("9K", "9P", ("replication",)),
        "9 vs 9K, same sentence (main)": sum(1 for q, s in stratum.items() if s in main_strata and (q, "9K") in valid
                                             and (q, "9") in valid and valid[(q, "9K")]["same_sentence_as_9"]),
        "9K vs original, tool gate (main)": sum(1 for q, s in stratum.items() if s in main_strata and (q, "9K") in valid
                                                and valid[(q, "9K")]["tool_gate"]),
        "12K vs P12K (main)": "after the edit job (projected: " + str(sum(
            table[s]["P12K"].get("projected_valid") or 0 for s in main_strata)) + ")",
    }

    # Answers per tier per judge: built now, and projected for the edit job's versions.
    now = {}
    for k, n in build["per_set_judge_tier"].items():
        set_name, judge, tier = k.split(".", 1)[0], k.split(".", 1)[1].rsplit(".", 1)[0], k.rsplit(".", 1)[1]
        now.setdefault(tier, {}).setdefault(judge, {})[set_name] = n
    proj_versions = {
        "tier2-12K": {"main": sum((table[s]["12K"].get("projected_valid") or 0)
                                  + (table[s]["P12K"].get("projected_valid") or 0) for s in main_strata),
                      "replication": 0},
        "tier2-9L": {"main": sum(table[s]["9L"].get("projected_valid") or 0 for s in main_strata),
                     "replication": table["replication"]["9L"].get("projected_valid") or 0},
        "tier3-12": {"main": sum((table[s]["12"].get("projected_valid") or 0) + (table[s]["P12"].get("projected_valid") or 0)
                                 for s in new), "replication": 0},
    }
    projected = {t: {s: n * SEEDS for s, n in d.items()} for t, d in proj_versions.items()}
    per_judge = {}
    for tier, judges in now.items():
        for judge, sets in judges.items():
            per_judge.setdefault(judge, {})[tier] = {"built": sets, "answers": sum(sets.values())}
    for judge in per_judge:
        for tier, sets in projected.items():
            per_judge[judge][tier] = {"projected": sets, "answers": sum(sets.values())}
    total_built = sum(build["per_set_judge_tier"].values())
    total_proj = sum(sum(s.values()) for s in projected.values()) * JUDGES
    out["answers"] = {"per_judge": per_judge, "built_now": total_built, "projected_after_edit_job": total_proj,
                      "total": total_built + total_proj,
                      "gpu_hours_at_3100_per_hour": round((total_built + total_proj) / ANSWERS_PER_GPU_HOUR, 2),
                      "tier1_gpu_hours": round(sum(v for k, v in build["per_set_judge_tier"].items() if k.endswith("tier1"))
                                               / ANSWERS_PER_GPU_HOUR, 2),
                      "token_count": build["token_count"], "refused": build["refused"]}
    jobs = {}
    for name, b in build["batches"].items():
        judge = next(j for j in MEASURED if f".{j}." in name)
        jobs[name] = job_hours(judge, b["prompts"])
    for tier, sets in projected.items():
        for set_name, n in sets.items():
            for judge in MEASURED:
                if n:
                    jobs[f"e5-{set_name}.{judge}.{tier} (projected)"] = job_hours(judge, n)
    out["job_hours"] = jobs
    out["job_hours_total"] = {"fastest": round(sum(min(j["hours"].values()) for j in jobs.values()), 2),
                              "slowest": round(sum(max(j["hours"].values()) for j in jobs.values()), 2)}
    return out


def job_hours(judge: str, prompts: int) -> dict:
    """Wall-clock hours of one job per GPU type, at the measured load and rate."""
    return {"prompts": prompts, "hours": {gpu: round((load + prompts * sec) / 3600, 2)
                                          for gpu, (load, sec) in MEASURED[judge].items()}}


def markdown(c: dict) -> str:
    L = ["# E5 pre-run counts", "",
         f"Generated {c['generated']} from the local build (E1's pinned engine, E1's validators), before any E5 "
         "answer. Numbers only. Machine-readable: `data/prerun_counts.json` (gitignored folder).", "",
         "Inputs of the cluster run, sha256 (the files stay in the gitignored `data/` folder; versions.jsonl holds "
         "the deterministic versions and E1's own 12 and P12 until the edit job's rows are merged):", "",
         *[f"- {name} `{h}`" for name, h in c["files_sha256"].items()],
         *[f"- {name} `{h}`" for name, h in c["bundles_sha256"].items()], "",
         "## Applicable and valid versions", "",
         "Applicable / valid per stratum. A dash: not built in E5. Projected values (the edit job's versions) are "
         "in brackets: 9L at 9K's valid count, 12 and 12K at E1's arm 12 rate (50 of 63), placebos at E1's P12 rate "
         "(33 of 50). On E1's queries (e1), 12 and P12 are E1's own versions, copied and re-answered in tier 3 "
         "(PLAN_E5 amendment 2); P12's first number there is 12's valid count (the placebo needs a valid 12).", "",
         "| Version | " + " | ".join(STRATA) + " |", "|---|" + "---|" * len(STRATA)]
    for a in ARMS:
        cells = []
        for s in STRATA:
            r = c["versions"][s][a]
            app, val, proj = r.get("applicable"), r.get("valid"), r.get("projected_valid")
            if val is not None:
                cells.append(f"{app if app is not None else ''} / {val}".strip())
            elif proj is not None:
                cells.append(f"{app if app is not None else ''} / [{proj}]".strip())
            else:
                cells.append("-")
        L.append(f"| {a} | " + " | ".join(cells) + " |")
    L += ["", "## Edit texts", "",
          "| | main | replication |", "|---|---|---|"]
    for name, key in (("q' template: kept", "kept"), ("q' template: what-is", "what-is"), ("q' template: how-to", "how-to")):
        L.append(f"| {name} | {c['templates'].get('main', {}).get(key, 0)} | {c['templates'].get('replication', {}).get(key, 0)} |")
    for name, key in (("templates among valid 9K: kept", "kept"), ("templates among valid 9K: what-is", "what-is"),
                      ("templates among valid 9K: how-to", "how-to")):
        L.append(f"| {name} | {c['templates_among_valid_9K'].get('main', {}).get(key, 0)} | "
                 f"{c['templates_among_valid_9K'].get('replication', {}).get(key, 0)} |")
    for name, key in (("q' equals q (exact)", "exact"), ("q' equals q (ignoring case, spaces, ?)",
                                                         "ignoring_case_space_and_question_mark")):
        L.append(f"| {name} | {c['q_prime_equals_q']['main'][key]} | {c['q_prime_equals_q']['replication'][key]} |")
    for name, key in (("q_G equals q (exact)", "exact"), ("q_G equals q (ignoring case, spaces, ?)",
                                                          "ignoring_case_space_and_question_mark")):
        L.append(f"| {name} | {c['q_G_equals_q']['main'][key]} | {c['q_G_equals_q']['replication'][key]} |")
    for origin in ("title", "topic", "none"):
        L.append(f"| q_G origin: {origin} | {c['q_G_origin']['main'].get(origin, 0)} | "
                 f"{c['q_G_origin']['replication'].get(origin, 0)} |")
    L.append(f"| 9A text equals q | {c['text_9A_equals_q']['main']} | {c['text_9A_equals_q']['replication']} |")
    L.append(f"| k equals the 9A text (q has at most two key terms) | {c['k_equals_9A']['main']} | {c['k_equals_9A']['replication']} |")
    for n in ("1", "2", "3", "4", "5"):
        L.append(f"| key terms {n}{' or more' if n == '5' else ''} | {c['n_key_terms']['main'].get(int(n), 0)} | "
                 f"{c['n_key_terms']['replication'].get(int(n), 0)} |")
    L += ["", "Edit texts that are q itself (ignoring case, spaces and a final question mark): there the version "
          "makes arm 9's edit, up to the heading's case, so it measures arm 9, not a guess. Flag them in the report.", "",
          "| Query | Stratum | Version | Exactly q | Version built | Same text as arm 9 |", "|---|---|---|---|---|---|"]
    L += [f"| {f['query_id']} | {f['stratum']} | {f['arm']} | {'yes' if f['exact'] else 'no (case)'} | "
          f"{f['version'] or 'not applicable'} | {'' if f['text_equals_arm_9'] is None else ('yes' if f['text_equals_arm_9'] else 'no')} |"
          for f in c["edit_text_is_q"]]
    L += ["", "## Valid versions: same sentence as arm 9, the tool's view, length", "",
          "Same sentence: the version copies arm 9's sentence (only the heading differs). Tool gate: the tool "
          "(current engine) would suggest the edit (question-coverage with the edit text under 0.9 on the original). "
          "Covers: the tool counts the edited page as covering the edit text / q.", "",
          "| Stratum | Version | Valid | Same sentence | Tool gate | Covers edit text | Covers q | Mean length ratio | Mean key-term change |",
          "|---|---|---|---|---|---|---|---|---|"]
    for s, arms in c["valid_version_detail"].items():
        for a in ARMS:
            if a not in arms:
                continue
            r = arms[a]
            L.append(f"| {s} | {a} | {r['valid']} | {r.get('same_sentence_as_9', '')} | {r.get('tool_gate', '')} | "
                     f"{r.get('tool_covers_edit_text', '')} | {r.get('tool_covers_q', '')} | {r['mean_length_ratio']} | "
                     f"{r['mean_key_terms_delta']} |")
    L += ["", "## Planned contrasts: queries with both versions valid", "", "| Contrast | n |", "|---|---|"]
    L += [f"| {k} | {v} |" for k, v in c["planned_n"].items()]
    a = c["answers"]
    L += ["", "## Answers and GPU-hours", "",
          f"Judges Gemma-4-12B-it and Qwen3.8-27B, 8 seeds. Built now (tier 1, and tier 3's 9A, 9G and E1's own "
          f"12 and P12): "
          f"{a['built_now']:,} answers; projected after the edit job (tier 2: 9L, 12K, P12K; tier 3: 12 and P12 on "
          f"the new queries): {a['projected_after_edit_job']:,}. Total about {a['total']:,} answers, about "
          f"{a['gpu_hours_at_3100_per_hour']} GPU-hours of judging at E1's 3,100 answers per GPU-hour (tier 1 alone "
          f"{a['tier1_gpu_hours']}). Token counts: {a['token_count']} (the cluster build counts with the judges' "
          f"tokenizers and may refuse a query over 31,000 tokens; E1 and E3 refused none).", "",
          "| Judge | Batch | Answers (main + replication) |", "|---|---|---|"]
    for judge, tiers in a["per_judge"].items():
        for tier in sorted(tiers):
            t = tiers[tier]
            sets = t.get("built") or t.get("projected")
            kind = "" if "built" in t else " (projected)"
            L.append(f"| {judge} | {tier}{kind} | {t['answers']:,} ({' + '.join(f'{sets.get(s, 0):,}' for s in ('main', 'replication'))}) |")
    gpus = [g for d in MEASURED.values() for g in d]
    rates = "; ".join(f"{j} on an {g}: {load} s load, {sec} s per prompt" for j, d in MEASURED.items()
                      for g, (load, sec) in d.items())
    L += ["", "## Projected job hours (for the queue projection)", "",
          f"Wall-clock per job at the judges' measured E1 and E3 rates ({rates}; the slowest job of 1,900 prompts or "
          "more on each GPU type). `gpu:a100` can land on either A100, so Gemma has two columns. All jobs together: "
          f"{c['job_hours_total']['fastest']} to {c['job_hours_total']['slowest']} GPU-hours. A job over about 3 hours "
          "can be split with `build_prompts_e5.py --shards N` (files at query boundaries) when GPUs are free.", "",
          "| Batch | Prompts | " + " | ".join(f"Hours, {g}" for g in gpus) + " |", "|---|---|" + "---|" * len(gpus)]
    L += [f"| {k} | {v['prompts']:,} | " + " | ".join(str(v["hours"].get(g, "")) for g in gpus) + " |"
          for k, v in c["job_hours"].items()]
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(e5.DATA))
    ap.add_argument("--md", default=str(e5.E5_DIR / "PRERUN.md"))
    args = ap.parse_args(argv)
    e5.refuse_foreign_data(args.data, ap)
    c = counts(Path(args.data))
    e5.write_json(Path(args.data) / "prerun_counts.json", c)
    Path(args.md).write_text(markdown(c), encoding="utf-8")
    print(json.dumps({"planned_n": c["planned_n"], "answers": {k: v for k, v in c["answers"].items() if k != "per_judge"}},
                     indent=1))


if __name__ == "__main__":
    main()
