# The answer prompt (QUERY_PROMPT) and the source layout of build_prompt are adapted from
# GEO-optim/GEO (https://github.com/GEO-optim/GEO), commit c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888,
# licensed Apache-2.0: `query_prompt` and the source layout of `generate_answer` in
# src/generative_le.py; the CITATION pattern follows `extract_citations_new` in src/utils.py.
# Changes: Python port of packages/bench/src/prompt.ts (sources headed `### Source [n]:` with
# their titles, and REMINDER appended after the sources, neither in GEO); everything else in this
# file is written for this project.
"""Bench sensitivity test (pre-registered in experiments/PREREG_sensitivity.md).

For each sample question, one target page competes with 7 on-topic synthetic
competitors. Four versions of the target (offtopic, before, after, answer_first)
are tested on identical competitor sets and positions per seed, so differences
come only from the target text.

Usage: python sensitivity.py --model <hf id> --data <dir with samples/> --out <dir> [--no-thinking]
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import re
import time
from pathlib import Path

SEEDS = list(range(1, 9))
N_COMPETITORS = 7
CONDITIONS = ["offtopic", "before", "after", "answer_first"]
SAMPLES = ["espresso-bitterness", "rag-explained"]
OTHER = {"espresso-bitterness": "rag-explained", "rag-explained": "espresso-bitterness"}

# One sentence that answers each question, written before any run.
ORACLE = {
    ("espresso-bitterness", "q1"): "Espresso usually tastes bitter because it is over-extracted: the grind is too fine, the shot runs too long, or the water is too hot.",
    ("espresso-bitterness", "q2"): "To fix bitter espresso, grind a little coarser, stop the shot at about 25 to 30 seconds, and lower the water temperature by a few degrees.",
    ("espresso-bitterness", "q3"): "Use water between about 90 and 96 degrees Celsius for espresso, starting near 93 degrees and going lower if shots taste bitter.",
    ("espresso-bitterness", "q4"): "An espresso shot should take about 25 to 30 seconds from the moment the pump starts to the end of the pour.",
    ("rag-explained", "q1"): "Retrieval-augmented generation (RAG) is a technique in which a language model first retrieves relevant documents and then writes its answer using them as context.",
    ("rag-explained", "q2"): "A RAG pipeline splits documents into chunks, indexes them, retrieves the chunks most relevant to the question, and passes them to a language model that writes the answer.",
    ("rag-explained", "q3"): "Use RAG when answers depend on facts that change or must be cited, and fine-tuning when the model must learn a consistent style, format or task behaviour.",
    ("rag-explained", "q4"): "Evaluate a RAG system on two levels: retrieval quality, whether the right passages are found, and answer quality, whether the answer is correct and supported by those passages.",
}

# Mirrors packages/bench/src/prompt.ts (GEO query_prompt, Aggarwal et al. KDD 2024, Apache-2.0, plus the Task 12 reminder).
QUERY_PROMPT = """Write an accurate and concise answer for the given user question, using _only_ the provided summarized web search results. The answer should be correct, high-quality, and written by an expert using an unbiased and journalistic tone. The user's language of choice such as English, Français, Español, Deutsch, or 日本語 should be used. The answer should be informative, interesting, and engaging. The answer's logic and reasoning should be rigorous and defensible. Every sentence in the answer should be _immediately followed_ by an in-line citation to the search result(s). The cited search result(s) should fully support _all_ the information in the sentence. Search results need to be cited using [index]. When citing several search results, use [1][2][3] format rather than [1, 2, 3]. You can use multiple search results to respond comprehensively while avoiding irrelevant search results.

Question: {query}

Search Results:
{source_text}
"""
REMINDER = "Answer the question above using only these sources. Write in English. End every sentence with its citation, for example [1][2]."
CITATION = re.compile(r"\[[^\w\s]*(\d+)[^\w\s]*\]")


def build_prompt(query: str, sources: list[dict]) -> str:
    parts = []
    for i, s in enumerate(sources):
        body = f"{s['title'].strip()}\n{s['text']}" if s.get("title", "").strip() else s["text"]
        parts.append(f"### Source [{i + 1}]:\n{body}\n")
    return QUERY_PROMPT.replace("{query}", query).replace("{source_text}", "\n\n".join(parts)) + REMINDER


def title_of(md: str, fallback: str) -> str:
    m = re.search(r"^# (.+)$", md, re.M)
    return m.group(1).strip() if m else fallback


def answer_first(md: str, question: str, sentence: str) -> str:
    lines = md.splitlines()
    idx = next((i for i, line in enumerate(lines) if line.startswith("# ")), -1)
    insert = ["", f"## {question}", "", sentence, ""]
    return "\n".join(lines[: idx + 1] + insert + lines[idx + 1 :]) if idx >= 0 else "\n".join(insert + lines)


def target_text(cond: str, sample: str, qid: str, query: str, drafts: dict) -> tuple[str, str]:
    if cond == "offtopic":
        md = drafts[(OTHER[sample], "before")]
    elif cond == "after":
        md = drafts[(sample, "after")]
    else:
        md = drafts[(sample, "before")]
        if cond == "answer_first":
            md = answer_first(md, query, ORACLE[(sample, qid)])
    return title_of(md, "Draft"), md


def score(answer: str, target_index: int, n_sources: int) -> dict:
    marks = [int(m) for m in CITATION.findall(answer) if 1 <= int(m) <= n_sources]
    cited = sorted(set(marks))
    return {
        "valid": bool(marks),
        "target_cited": target_index in cited,
        "target_share": (marks.count(target_index) / len(marks)) if marks else None,
        "sources_cited": len(cited),
    }


def sign_flip_p(diffs: list[float]) -> float:
    obs = abs(sum(diffs))
    n = len(diffs)
    if n == 0:
        return 1.0
    hits = sum(1 for signs in itertools.product((1, -1), repeat=n) if abs(sum(s * d for s, d in zip(signs, diffs))) >= obs - 1e-12)
    return hits / 2**n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-thinking", action="store_true")
    ap.add_argument("--max-model-len", type=int, default=16384)
    ap.add_argument("--tp", type=int, default=1)
    args = ap.parse_args()

    data = Path(args.data)
    packs = {s: json.loads((data / s / "pack.json").read_text()) for s in SAMPLES}
    drafts = {(s, v): (data / s / f"{v}.md").read_text() for s in SAMPLES for v in ("before", "after")}

    jobs = []
    for sample in SAMPLES:
        for q in packs[sample]["queries"]:
            qid, query, docs = q["queryId"], q["query"], q["documents"]
            for seed in SEEDS:
                rng = random.Random(f"{sample}|{qid}|{seed}")
                competitors = rng.sample(docs, N_COMPETITORS)
                position = rng.randrange(N_COMPETITORS + 1)
                for cond in CONDITIONS:
                    title, text = target_text(cond, sample, qid, query, drafts)
                    sources = competitors[:position] + [{"title": title, "text": text}] + competitors[position:]
                    jobs.append({"sample": sample, "qid": qid, "query": query, "seed": seed, "cond": cond,
                                 "target_index": position + 1, "prompt": build_prompt(query, sources)})

    t0 = time.time()
    from vllm import LLM, SamplingParams

    llm = LLM(model=args.model, max_model_len=args.max_model_len, gpu_memory_utilization=0.88, seed=1,
              enforce_eager=True, tensor_parallel_size=args.tp)
    t_load = time.time() - t0
    messages = [[{"role": "user", "content": j["prompt"]}] for j in jobs]
    params = [SamplingParams(temperature=0.5, seed=j["seed"], max_tokens=600) for j in jobs]
    kwargs = {"chat_template_kwargs": {"enable_thinking": False}} if args.no_thinking else {}
    t1 = time.time()
    outs = llm.chat(messages, params, **kwargs)
    t_gen = time.time() - t1

    rows = []
    for j, o in zip(jobs, outs):
        text = o.outputs[0].text
        rows.append({k: v for k, v in j.items() if k != "prompt"} | score(text, j["target_index"], N_COMPETITORS + 1) | {"answer": text})

    # Per (condition, question): mean target share over valid answers.
    def per_q(cond):
        out = {}
        for sample in SAMPLES:
            for q in packs[sample]["queries"]:
                vals = [r["target_share"] for r in rows if r["cond"] == cond and r["sample"] == sample and r["qid"] == q["queryId"] and r["valid"]]
                out[(sample, q["queryId"])] = sum(vals) / len(vals) if vals else None
        return out

    pq = {c: per_q(c) for c in CONDITIONS}
    keys = list(pq["before"].keys())
    mean = {c: (sum(v for v in pq[c].values() if v is not None) / max(1, sum(v is not None for v in pq[c].values()))) for c in CONDITIONS}
    diffs = [pq["answer_first"][k] - pq["before"][k] for k in keys if pq["answer_first"][k] is not None and pq["before"][k] is not None]
    diffs_after = [pq["after"][k] - pq["before"][k] for k in keys if pq["after"][k] is not None and pq["before"][k] is not None]
    valid_rate = sum(r["valid"] for r in rows) / len(rows)
    h1 = mean["offtopic"] <= 0.05
    p_af = sign_flip_p(diffs)
    h2 = (mean["answer_first"] - mean["before"] >= 0.10) and p_af <= 0.05
    summary = {
        "model": args.model,
        "answers": len(rows),
        "load_seconds": round(t_load, 1),
        "generate_seconds": round(t_gen, 1),
        "valid_rate": round(valid_rate, 4),
        "mean_target_share": {c: round(mean[c], 4) for c in CONDITIONS},
        "chance_share": round(1 / (N_COMPETITORS + 1), 4),
        "target_cited_rate": {c: round(sum(r["target_cited"] for r in rows if r["cond"] == c and r["valid"]) / max(1, sum(1 for r in rows if r["cond"] == c and r["valid"])), 4) for c in CONDITIONS},
        "mean_sources_cited": round(sum(r["sources_cited"] for r in rows if r["valid"]) / max(1, sum(r["valid"] for r in rows)), 2),
        "answer_first_minus_before": {"mean": round(sum(diffs) / len(diffs), 4) if diffs else None, "p_sign_flip": p_af, "n_questions": len(diffs)},
        "after_minus_before_exploratory": {"mean": round(sum(diffs_after) / len(diffs_after), 4) if diffs_after else None, "p_sign_flip": sign_flip_p(diffs_after), "n_questions": len(diffs_after)},
        "H1_floor": h1,
        "H2_sensitivity": h2,
        "usable_for_E2": valid_rate >= 0.90 and h1 and h2,
    }
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.model.replace("/", "__")
    (out_dir / f"sensitivity_{name}.json").write_text(json.dumps({"summary": summary, "per_question": {c: {f"{k[0]}/{k[1]}": v for k, v in pq[c].items()} for c in CONDITIONS}, "rows": rows}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
