"""Builds every E1 judge prompt (PREREG_E1.md r2, Measurement 2) and the batch files for the cluster.

Each prompt has exactly 4 sources: the target version and the query's 3 competitors (never the
donor). For each (query, seed) the order depends only on (query, seed), so it is identical for the
original, every arm, every placebo and ALL. Seed s puts the target in slot ((s - 1) mod 4) + 1, and
the competitors fill the other slots in the order random.Random(f"{query}|{seed}") shuffles them
into (starting from page_id order). Before anything is written, every prompt is counted with each
selected judge's tokenizer and the largest count is kept; a query with any prompt over 31,000
tokens is excluded from every arm and listed in prompt_build.json.

The prompt is a Python twin of buildPrompt in packages/bench/src/prompt.ts, which is adapted from
GEO-optim/GEO (https://github.com/GEO-optim/GEO, commit c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888,
Apache-2.0): `query_prompt` in src/generative_le.py. check_prompt_twin.ts verifies it byte for
byte against `ce bench --export-prompts`.

Inputs (Task 20a): data/pages.jsonl, data/versions.jsonl, data/applicability.jsonl.
Outputs: data/prompts.jsonl {key, query_id, version_id, arm, judge, seed, slot, prompt, set, tier},
data/batches/<set>.<judge>.tier<k>.prompts.jsonl (PromptLine files for
experiments/explorer/batch_generate.py) and data/prompt_build.json.

Usage: python3 -I experiments/e1/build_prompts.py [--data DIR] [--sets main,replication]
           [--judges gemma-4-12b,qwen3.8-27b] [--tokens hf|utf8] [--without-original]
       python3 -I experiments/e1/build_prompts.py --twin in.json [--twin-out out.json]
`--tokens hf` (default) loads the tokenizers of the judges named in --judges from the local
Hugging Face cache (run it where they are cached, such as Explorer). `--tokens utf8` counts UTF-8 bytes, an upper bound for
byte-level tokenizers, and is meant for the smoke set only.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

from e1_common import (  # noqa: E402
    JUDGE_ORDER,
    JS_WHITESPACE,
    JUDGES,
    MAX_MODEL_LEN,
    N_SOURCES,
    SEEDS,
    TEMPERATURE,
    TOKEN_LIMIT,
    parent_arm,
    read_jsonl,
    tier,
    write_json,
    write_jsonl,
)

DEFAULT_SETS = "main,replication"

QUERY_PROMPT = """Write an accurate and concise answer for the given user question, using _only_ the provided summarized web search results. The answer should be correct, high-quality, and written by an expert using an unbiased and journalistic tone. The user's language of choice such as English, Français, Español, Deutsch, or 日本語 should be used. The answer should be informative, interesting, and engaging. The answer's logic and reasoning should be rigorous and defensible. Every sentence in the answer should be _immediately followed_ by an in-line citation to the search result(s). The cited search result(s) should fully support _all_ the information in the sentence. Search results need to be cited using [index]. When citing several search results, use [1][2][3] format rather than [1, 2, 3]. You can use multiple search results to respond comprehensively while avoiding irrelevant search results.

Question: {query}

Search Results:
{source_text}
"""
REMINDER = (
    "Answer the question above using only these sources. Write in English. "
    "End every sentence with its citation, for example [1][2]."
)
_FIELD = re.compile(r"\{(query|source_text)\}")


def js_trim(s: str) -> str:
    return s.strip(JS_WHITESPACE)


def build_prompt(query: str, sources: list[dict]) -> str:
    """buildPrompt: sources numbered [1]..[n] in the order given, then REMINDER."""
    parts = []
    for i, s in enumerate(sources):
        title = js_trim(s["title"])
        body = f"{title}\n{s['text']}" if title else s["text"]
        parts.append(f"### Source [{i + 1}]:\n{body}\n")
    source_text = "\n\n".join(parts)
    # One pass, as in prompt.ts: a query containing "{source_text}" is not filled in a second time.
    geo = _FIELD.sub(lambda m: query if m.group(1) == "query" else source_text, QUERY_PROMPT)
    return geo + REMINDER


def target_slot(seed: int) -> int:
    return (seed - 1) % N_SOURCES + 1


def arrange(query: str, seed: int, target: dict, competitors: list[dict]) -> list[dict]:
    """The 4 sources for (query, seed): competitors in their seeded order, the target in its slot."""
    if len(competitors) != N_SOURCES - 1:
        raise ValueError(f"expected {N_SOURCES - 1} competitors for {query!r}, got {len(competitors)}")
    comps = sorted(competitors, key=lambda c: c["page_id"])
    random.Random(f"{query}|{seed}").shuffle(comps)
    slot = target_slot(seed)
    return comps[: slot - 1] + [target] + comps[slot - 1:]


def _applicable(appl: dict, query_id: str, arm: str) -> bool:
    if arm == "original":
        return True
    return appl.get((query_id, parent_arm(arm)), True)


def build_all(pages, versions, applicability, *, sets, judges, seeds=SEEDS, count_tokens, limit=TOKEN_LIMIT,
              require_original=True):
    """Prompt rows for every valid, applicable version of every query in `sets`, and the refused queries.

    `require_original=False` is for an E2 folder (experiments/PLAN_E2.md) that holds only E2 versions:
    the original's prompts and answers come from E1, so a query without an original is not an error.
    Queries with no version to prompt are then skipped."""
    appl = {(a["query_id"], a["arm"]): bool(a["applicable"]) for a in applicability}
    by_query = defaultdict(list)
    for p in pages:
        if p["set"] in sets:
            by_query[p["query_id"]].append(p)
    vers = defaultdict(list)
    for v in versions:
        if v["query_id"] in by_query and v["valid"] and _applicable(appl, v["query_id"], v["arm"]):
            vers[v["query_id"]].append(v)

    rows, refused = [], []
    for qid in sorted(by_query):
        qpages = by_query[qid]
        competitors = [p for p in qpages if p["role"] == "competitor"]
        query = qpages[0]["query"]
        qvers = sorted(vers[qid], key=lambda v: v["version_id"])
        if require_original and not any(v["arm"] == "original" for v in qvers):
            raise ValueError(f"query {qid} has no valid original version")
        if not qvers:
            continue
        built, most = [], 0
        for seed in seeds:
            for v in qvers:
                sources = arrange(query, seed, {"title": v["title"], "text": v["text"]}, competitors)
                prompt = build_prompt(query, sources)
                most = max(most, count_tokens(prompt))
                built.append((v, seed, prompt))
        if most > limit:
            refused.append({"query_id": qid, "max_tokens": most})
            continue
        for v, seed, prompt in built:
            for judge in judges:
                rows.append({
                    "key": f"{judge}|{v['version_id']}|{seed}", "query_id": qid, "version_id": v["version_id"],
                    "arm": v["arm"], "judge": judge, "seed": seed, "slot": target_slot(seed), "prompt": prompt,
                    "set": qpages[0]["set"], "tier": tier(v["arm"]),
                })
    if len({r["key"] for r in rows}) != len(rows):
        raise ValueError("duplicate prompt keys: version_id must be unique")
    return rows, refused


def batch_files(rows: list[dict]) -> dict[str, list[dict]]:
    """PromptLine rows for batch_generate.py, one file per (set, judge, tier) in the run plan's order."""
    files = defaultdict(list)
    for r in rows:
        files[f"{r['set']}.{r['judge']}.tier{r['tier']}"].append({
            "key": r["key"], "model": JUDGES[r["judge"]], "seed": r["seed"], "temperature": TEMPERATURE,
            "numCtx": MAX_MODEL_LEN, "prompt": r["prompt"], "packId": f"e1-{r['set']}",
            "draftId": r["version_id"], "queryId": r["query_id"], "run": r["seed"],
        })
    return dict(files)


def utf8_counter():
    return lambda prompt: len(prompt.encode("utf-8"))


def hf_counter(judges: list[str]):
    """The larger token count of the judges' tokenizers (local Hugging Face cache only)."""
    from transformers import AutoTokenizer  # only where the tokenizers are cached

    toks = [AutoTokenizer.from_pretrained(JUDGES[j], local_files_only=True) for j in judges]
    return lambda prompt: max(len(t.encode(prompt, add_special_tokens=False)) for t in toks)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(Path(__file__).resolve().parent / "data"))
    ap.add_argument("--sets", default=DEFAULT_SETS,
                    help="comma-separated sets (the timing smoke: --sets timing, in its own data folder)")
    ap.add_argument("--judges", default=",".join(JUDGE_ORDER))
    ap.add_argument("--tokens", choices=["hf", "utf8"], default="hf")
    ap.add_argument("--without-original", action="store_true",
                    help="E2: the folder holds only E2 versions (the original's prompts are E1's); "
                         "applicability.jsonl is then optional")
    ap.add_argument("--twin", help="JSON list of {query, sources: [{title, text}]}: print their prompts")
    ap.add_argument("--twin-out", help="with --twin: write the prompts here instead of stdout")
    args = ap.parse_args(argv)

    if args.twin:
        cases = json.loads(Path(args.twin).read_text(encoding="utf-8"))
        prompts = json.dumps([build_prompt(c["query"], c["sources"]) for c in cases], ensure_ascii=False)
        if args.twin_out:
            Path(args.twin_out).write_text(prompts, encoding="utf-8")
        else:
            sys.stdout.write(prompts)
        return

    data = Path(args.data)
    judges = args.judges.split(",")
    unknown = [j for j in judges if j not in JUDGES]
    if unknown:
        sys.exit(f"build_prompts: unknown judge(s) {unknown}; known: {list(JUDGES)}")
    # Counted with the tokenizers of the judges these prompts are built for.
    count = hf_counter(judges) if args.tokens == "hf" else utf8_counter()
    appl_path = data / "applicability.jsonl"
    if args.without_original and not appl_path.exists():
        print(f"build_prompts: no applicability.jsonl in {data}; every version there counts as applicable")
        applicability = []
    else:
        applicability = read_jsonl(appl_path)
    rows, refused = build_all(
        read_jsonl(data / "pages.jsonl"), read_jsonl(data / "versions.jsonl"), applicability,
        sets=set(args.sets.split(",")), judges=judges, count_tokens=count,
        require_original=not args.without_original,
    )
    write_jsonl(data / "prompts.jsonl", rows)
    files = batch_files(rows)
    for name, lines in sorted(files.items()):
        write_jsonl(data / "batches" / f"{name}.prompts.jsonl", lines)
    write_json(data / "prompt_build.json", {
        "prompts": len(rows), "limit": TOKEN_LIMIT, "token_count": args.tokens, "refused": refused,
        "batches": {name: len(lines) for name, lines in sorted(files.items())},
        # E2 folders only, so an E1 build writes the same summary as before.
        **({"judges": judges, "without_original": True} if args.without_original else {}),
    })
    print(f"build_prompts: {len(rows)} prompts, {len(refused)} queries refused over {TOKEN_LIMIT} tokens, "
          f"{len(files)} batch files in {data / 'batches'}")


if __name__ == "__main__":
    main()
