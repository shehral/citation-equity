# The answer prompt (INSTRUCTION) and the source layout of build_prompt are adapted from
# GEO-optim/GEO (https://github.com/GEO-optim/GEO), commit c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888,
# licensed Apache-2.0: `query_prompt` and the source layout of `generate_answer` in
# src/generative_le.py.
# Changes: wrapped across lines; GEO's _only_ emphasis dropped, and _immediately followed_ and
# _all_ written as *...*; sources headed `### Source [n]:`, and REMINDER appended after the sources,
# neither in GEO; everything else in this file is written for this project.
"""Smoke test for Citation Equity experiments on Explorer.

Loads one cached instruct model offline with vLLM, answers one GEO-style
prompt (8 numbered sources, one planted to answer the question directly)
with 8 seeds, and reports citation-format compliance plus whether the
planted source is cited more than chance.

PASS criteria (written before the first run):
  - the model loads offline and generates;
  - at least 6 of 8 answers contain at least one valid [n] citation (n in 1..8);
  - total wall time under 20 minutes.
The planted-source numbers are an exploratory preview only, not a test.

Usage: python smoke_vllm.py --model <hf id> --out <dir> [--no-thinking]
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

QUESTION = "How long should an espresso shot take?"

SOURCES = [
    "Espresso machines come in many shapes. Lever machines, pump machines and capsule machines all make coffee, and each has fans who argue it makes the best cup.",
    "Grind size changes everything in coffee. A finer grind slows the water down and a coarser grind lets it run faster. Burr grinders give a more even grind than blade grinders.",
    "Coffee beans should be stored in an airtight container away from light. Whole beans keep their flavour for a few weeks after roasting; ground coffee goes stale within days.",
    "Milk drinks such as lattes and cappuccinos start with a shot of espresso. Steaming milk to around 60 C gives it a sweet taste and a smooth texture.",
    "A standard espresso shot should take 25 to 30 seconds from the moment the pump starts until you stop it, producing about 36 grams of liquid from 18 grams of ground coffee. Faster shots taste sour and slower shots taste bitter.",
    "Many cafes now offer oat milk and almond milk. Oat milk steams well and is the most popular plant-based option in many countries.",
    "Cleaning your espresso machine regularly keeps it working. Backflush the group head weekly and descale the boiler every few months depending on your water.",
    "Coffee was first brewed in Yemen in the 15th century and spread through the Ottoman Empire to Europe, where coffee houses became places for conversation.",
]
PLANTED = 5  # 1-based index of the source that answers the question

# GEO answer prompt (Aggarwal et al., KDD 2024; Apache-2.0), as adapted in packages/bench/src/prompt.ts,
# plus the English/citation reminder added in Task 12.
INSTRUCTION = (
    "Write an accurate and concise answer for the given user question, using only the provided summarized web "
    "search results. The answer should be correct, high-quality, and written by an expert using an unbiased and "
    "journalistic tone. The user's language of choice such as English, Français, Español, Deutsch, or 日本語 should "
    "be used. The answer should be informative, interesting, and engaging. The answer's logic and reasoning should "
    "be rigorous and defensible. Every sentence in the answer should be *immediately followed* by an in-line "
    "citation to the search result(s). The cited search result(s) should fully support *all* the information in "
    "the sentence. Search results need to be cited using [index]. When citing several search results, use "
    "[1][2][3] format rather than [1, 2, 3]. You can use multiple search results to respond comprehensively while "
    "avoiding irrelevant search results."
)
REMINDER = (
    "Answer the question above using only these sources. Write in English. "
    "End every sentence with its citation, for example [1][2]."
)


def build_prompt() -> str:
    sources = "\n\n".join(f"### Source [{i + 1}]:\n{s}" for i, s in enumerate(SOURCES))
    return f"{INSTRUCTION}\n\nQuestion: {QUESTION}\n\nSearch Results:\n{sources}\n\n{REMINDER}"


def parse(answer: str, n_sources: int) -> dict:
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", answer.strip()) if s]
    cites = [[int(m) for m in re.findall(r"\[(\d+)\]", s) if 1 <= int(m) <= n_sources] for s in sentences]
    cited = sorted({c for cs in cites for c in cs})
    total = sum(len(cs) for cs in cites)
    planted_share = (sum(cs.count(PLANTED) for cs in cites) / total) if total else 0.0
    return {
        "sentences": len(sentences),
        "sentences_with_citation": sum(1 for cs in cites if cs),
        "cited_sources": cited,
        "valid": bool(cited),
        "planted_cited": PLANTED in cited,
        "planted_share_of_citations": round(planted_share, 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-thinking", action="store_true", help="pass enable_thinking=False to the chat template")
    ap.add_argument("--max-model-len", type=int, default=16384)
    args = ap.parse_args()

    t0 = time.time()
    from vllm import LLM, SamplingParams  # imported here so --help works without a GPU

    llm = LLM(model=args.model, max_model_len=args.max_model_len, gpu_memory_utilization=0.85, seed=1)
    t_load = time.time() - t0

    messages = [[{"role": "user", "content": build_prompt()}] for _ in range(8)]
    params = [SamplingParams(temperature=0.5, seed=seed, max_tokens=600) for seed in range(1, 9)]
    kwargs = {"chat_template_kwargs": {"enable_thinking": False}} if args.no_thinking else {}
    t1 = time.time()
    outputs = llm.chat(messages, params, **kwargs)
    t_gen = time.time() - t1

    rows = []
    for seed, out in zip(range(1, 9), outputs):
        text = out.outputs[0].text
        rows.append({"seed": seed, **parse(text, len(SOURCES)), "answer": text})

    valid = sum(r["valid"] for r in rows)
    summary = {
        "model": args.model,
        "load_seconds": round(t_load, 1),
        "generate_seconds": round(t_gen, 1),
        "valid_answers": f"{valid}/8",
        "planted_cited": f"{sum(r['planted_cited'] for r in rows)}/8",
        "mean_planted_share_of_citations": round(sum(r["planted_share_of_citations"] for r in rows) / 8, 4),
        "chance_share": round(1 / len(SOURCES), 4),
        "mean_sources_cited": round(sum(len(r["cited_sources"]) for r in rows) / 8, 2),
        "pass": valid >= 6 and (time.time() - t0) < 20 * 60,
    }
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.model.replace("/", "__")
    (out_dir / f"smoke_{name}.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=1))
    print("--- first answer ---")
    print(rows[0]["answer"][:1200])


if __name__ == "__main__":
    main()
