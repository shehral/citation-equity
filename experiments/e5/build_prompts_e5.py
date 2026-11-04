"""E5's judge prompts and batch files (experiments/PLAN_E5.md r2, "One run" and "Runs and compute").

Every valid, applicable E5 version is prompted, the original and arm 9 included (they are
re-answered in E5's run), with E1's prompt, sources, slot rotation, judges, seeds and settings
(experiments/e1/build_prompts.py: build_prompt, arrange, batch line format). Only what differs:

- Keys are "e5|<judge>|<version_id>|<seed>", so no E5 key equals an E1, E2 or E3 key; version_id is
  E1's "<query_id>:<arm>". E5's answers live in their own folder ($CE_ROOT/e5/answers on the
  cluster, experiments/e5/data/answers here) and are scored with E1's score.py.
- Tiers (PLAN_E5): tier 1 = original, 9, 9P, 9K; tier 2 = 9L, 12K, P12K; tier 3 = 9A, 9G, and 12
  and P12 (on the new queries, and E1's own 12 and P12 on E1's main queries, re-answered: PLAN_E5
  amendment 2). Batch files: tier1; tier2-12K (12K, P12K) and tier2-9L (9L), split so the plan's cut
  order within tier 2 can be applied; tier3 (9A, 9G, and E1's 12 and P12, all built locally) and
  tier3-12 (12, P12 on the new queries, from the edit job). tier1 and tier3 come from the local
  build and run in parallel with the edit job; tier2-* and tier3-12 come from the edit job.
- One batch file per (E5 set, judge, batch): data/batches/e5-<set>.<judge>.<tier>.prompts.jsonl, the
  set being E5's (main holds the strata e1, e3 and e3-four; replication). Within a file, queries are
  in sha256(query_id) order with all versions of a query adjacent (seed, then version), so a cut
  job leaves complete queries (stats S7d).
- Applicability: a version is prompted when it is valid and its own row and its parent rows in
  E5's applicability.jsonl are applicable (9P, 9K, 9L, 9A, 9G need arm 9; P12 needs 12; P12K needs
  12K; a missing row counts as applicable, E1's rule).
- Token counts: --tokens hf (the default; on the cluster, where the judges' tokenizers are cached)
  counts every prompt with each judge's tokenizer and refuses a query with any prompt over 31,000
  tokens from every version (E1's rule; E1 and E3 refused none). --tokens none (local) writes
  everything without counting or refusing; prompt_build.json says so.
- A batch file that already exists is never changed: re-running after the edit job rewrites the
  tier 1 and tier 3 files only when their content is identical (else it stops), and adds the
  tier 2 and tier3-12 files.

Outputs in --data: prompts.jsonl (E1's prompt rows plus e5_set and stratum), batches/, and
prompt_build.json (counts per batch, per tier and judge, refused queries, sha256 of every batch).

Usage: python3 -I experiments/e5/build_prompts_e5.py [--data experiments/e5/data] [--tokens hf|none]
           [--judges gemma-4-12b,qwen3.8-27b]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

import build_prompts as bp  # noqa: E402  (E1's)
from e1_common import JUDGE_ORDER, JUDGES, MAX_MODEL_LEN, SEEDS, TEMPERATURE, TOKEN_LIMIT  # noqa: E402

ARM_ORDER = ["original", "9", "9P", "9K", "9L", "9A", "9G", "12", "P12", "12K", "P12K"]
TIER = {"original": 1, "9": 1, "9P": 1, "9K": 1, "9L": 2, "12K": 2, "P12K": 2, "9A": 3, "9G": 3}
PARENTS = {"9P": ["9"], "9K": ["9K", "9"], "9L": ["9L", "9"], "9A": ["9A", "9"], "9G": ["9G", "9"],
           "9": ["9"], "12": ["12"], "P12": ["12"], "12K": ["12K"], "P12K": ["12K"]}


def tier_and_batch(arm: str, stratum: str) -> tuple[int, str]:
    """(tier, batch name part) for a version (PLAN_E5 tiers)."""
    if arm in ("12", "P12"):
        if stratum == "e1":  # E1's own versions, re-answered (PLAN_E5 amendment 2); they exist before the edit job
            return 3, "tier3"
        if stratum not in e5.NEW_STRATA:
            raise ValueError(f"E5 answers arm {arm} on the main set only (E1's queries and the new ones), "
                             f"not on stratum {stratum}")
        return 3, "tier3-12"
    if arm not in TIER:
        raise ValueError(f"unknown E5 arm {arm!r}")
    if arm == "9L":  # tier 2 in two files, so the plan's cut order (9L before 12K and P12K) can be applied
        return 2, "tier2-9L"
    if arm in ("12K", "P12K"):
        return 2, "tier2-12K"
    return TIER[arm], f"tier{TIER[arm]}"


def applicable(appl: dict, qid: str, arm: str) -> bool:
    if arm == "original":
        return True
    return all(appl.get((qid, a), True) for a in PARENTS[arm])


def key(judge: str, version_id: str, seed: int) -> str:
    return f"e5|{judge}|{version_id}|{seed}"


def build(pages, versions, applicability, *, judges, count_tokens=None, limit=TOKEN_LIMIT, seeds=SEEDS):
    """(prompt rows in batch order, refused queries)."""
    appl = {(a["query_id"], str(a["arm"])): bool(a["applicable"]) for a in applicability}
    by_query = defaultdict(list)
    for p in pages:
        by_query[p["query_id"]].append(p)
    vers = defaultdict(list)
    for v in versions:
        if v["valid"] and applicable(appl, v["query_id"], v["arm"]):
            vers[v["query_id"]].append(v)
    rows, refused = [], []
    for qid in sorted(vers, key=e5.query_order):
        qpages = by_query[qid]
        competitors = [p for p in qpages if p["role"] == "competitor"]
        query, page_set = qpages[0]["query"], qpages[0]["set"]
        qvers = sorted(vers[qid], key=lambda v: ARM_ORDER.index(v["arm"]))
        built, most = [], 0
        for seed in seeds:
            for v in qvers:
                prompt = bp.build_prompt(query, bp.arrange(query, seed, {"title": v["title"], "text": v["text"]},
                                                           competitors))
                if count_tokens:
                    most = max(most, count_tokens(prompt))
                built.append((v, seed, prompt))
        if count_tokens and most > limit:
            refused.append({"query_id": qid, "max_tokens": most})
            continue
        stratum = e5.STRATUM[page_set]
        for v, seed, prompt in built:
            tier, batch = tier_and_batch(v["arm"], stratum)
            for judge in judges:
                rows.append({"key": key(judge, v["version_id"], seed), "query_id": qid,
                             "version_id": v["version_id"], "arm": v["arm"], "judge": judge, "seed": seed,
                             "slot": bp.target_slot(seed), "prompt": prompt, "set": page_set, "tier": tier,
                             "batch": f"e5-{e5.E5_SET_OF[page_set]}.{judge}.{batch}",
                             "e5_set": e5.E5_SET_OF[page_set], "stratum": stratum})
    if len({r["key"] for r in rows}) != len(rows):
        raise ValueError("duplicate prompt keys: version_id must be unique")
    return rows, refused


def batch_files(rows: list[dict]) -> dict[str, list[dict]]:
    """E1's PromptLine rows (batch_generate.py), one file per E5 batch, in the rows' order."""
    files = defaultdict(list)
    for r in rows:
        files[r["batch"]].append({
            "key": r["key"], "model": JUDGES[r["judge"]], "seed": r["seed"], "temperature": TEMPERATURE,
            "numCtx": MAX_MODEL_LEN, "prompt": r["prompt"], "packId": f"e5-{r['e5_set']}",
            "draftId": r["version_id"], "queryId": r["query_id"], "run": r["seed"],
        })
    return dict(files)


def shard(files: dict[str, list[dict]], n: int) -> dict[str, list[dict]]:
    """Each batch split into n files at query boundaries, in order (<batch>-p<i>of<n>), so parallel
    jobs each hold complete queries; n = 1 keeps the files as they are."""
    if n <= 1:
        return files
    out = {}
    for name, lines in files.items():
        blocks: list[list[dict]] = []
        for line in lines:
            if not blocks or blocks[-1][-1]["queryId"] != line["queryId"]:
                blocks.append([])
            blocks[-1].append(line)
        parts = [[] for _ in range(min(n, len(blocks)))]
        size, i = len(lines) / len(parts), 0
        for block in blocks:
            if parts[i] and sum(map(len, parts[: i + 1])) >= size * (i + 1) and i + 1 < len(parts):
                i += 1
            parts[i].extend(block)
        for j, part in enumerate(parts, start=1):
            out[f"{name}-p{j}of{len(parts)}"] = part
    return out


def jsonl_text(rows: list[dict]) -> str:
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def write_batches(folder: Path, files: dict[str, list[dict]]) -> dict[str, dict]:
    """Writes each batch file; an existing one must already have the same content."""
    folder.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, lines in sorted(files.items()):
        text = jsonl_text(lines)
        path = folder / f"{name}.prompts.jsonl"
        if path.exists() and path.read_text(encoding="utf-8") != text:
            raise SystemExit(f"build_prompts_e5: {path} exists with other prompts; it may already be running. "
                             "Move it aside only if no job uses it.")
        if not path.exists():
            path.write_text(text, encoding="utf-8")
        out[name] = {"prompts": len(lines), "queries": len({l['queryId'] for l in lines}),
                     "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(e5.DATA))
    ap.add_argument("--judges", default=",".join(JUDGE_ORDER))
    ap.add_argument("--tokens", choices=["hf", "none"], default="hf")
    ap.add_argument("--shards", type=int, default=1,
                    help="split each batch into this many files at query boundaries (parallel jobs; default 1)")
    args = ap.parse_args(argv)
    data = Path(args.data)
    e5.refuse_foreign_data(data, ap)
    judges = args.judges.split(",")
    if unknown := [j for j in judges if j not in JUDGE_ORDER]:
        ap.error(f"unknown judge(s) {unknown}; E5's judges are {JUDGE_ORDER}")
    count = bp.hf_counter(judges) if args.tokens == "hf" else None
    rows, refused = build(common.read_jsonl(data / "pages.jsonl"), common.read_jsonl(data / "versions.jsonl"),
                          common.read_jsonl(data / "applicability.jsonl"), judges=judges, count_tokens=count)
    common.write_jsonl(data / "prompts.jsonl", rows)
    batches = write_batches(data / "batches", shard(batch_files(rows), args.shards))
    per = Counter((r["e5_set"], r["judge"], r["tier"]) for r in rows)
    per_arm = Counter((r["e5_set"], r["stratum"], r["arm"], r["judge"]) for r in rows)
    summary = {"prompts": len(rows), "limit": TOKEN_LIMIT, "token_count": args.tokens, "refused": refused,
               "judges": judges, "shards": args.shards, "batches": batches,
               "per_set_judge_tier": {f"{s}.{j}.tier{t}": n for (s, j, t), n in sorted(per.items())},
               "per_stratum_arm_judge": {f"{s}.{st}.{a}.{j}": n for (s, st, a, j), n in sorted(per_arm.items())},
               "versions_sha256": e5.sha256_file(data / "versions.jsonl")}
    if args.tokens == "none":
        summary["note"] = "local build: no token counts, so no query was refused; rebuild with --tokens hf on the cluster"
    e5.write_json(data / "prompt_build.json", summary)
    print(f"build_prompts_e5: {len(rows)} prompts in {len(batches)} batch files; refused {len(refused)} "
          f"(tokens: {args.tokens})")
    for name, b in batches.items():
        print(f"  {name}: {b['prompts']} prompts, {b['queries']} queries")


if __name__ == "__main__":
    main()
