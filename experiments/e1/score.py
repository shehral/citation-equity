"""Scores every E1 answer and averages them into cells (PREREG_E1.md r2, Measurement 2).

Per answer, with the target in `slot` of 4 sources:
- valid: at least one citation to a source 1-4;
- citation score (primary): (5 - r) / 4, where r is the target's position among the distinct
  in-range sources in order of first citation, and r = 5 when the target is uncited;
- cited at all, and the PAWC share (a twin of the bench's pawcShares).
Per (query, version, judge) a cell is the mean over valid answers. A cell with fewer than 4 valid
answers is marked dropped, which removes that query from every contrast involving that version.

The citation pattern, sentence splitter and PAWC are Python twins of parseAnswer
(packages/bench/src/prompt.ts) and pawcShares (packages/bench/src/metrics.ts). Those are adapted
from GEO-optim/GEO (https://github.com/GEO-optim/GEO, commit
c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888, Apache-2.0): `extract_citations_new` in src/utils.py and
`impression_wordpos_count_simple` / `get_num_words` in src/utils.py. check_score_twin.ts compares
them with the TypeScript originals.

Inputs: data/prompts.jsonl and every data/answers/*.jsonl ({key, answer}, from batch_generate.py).
Outputs: out/scores.jsonl, out/cells.jsonl, out/score_summary.json (answers missing per
(set, judge, arm), which the analysis reads as completion).

Usage: python3 -I experiments/e1/score.py [--data DIR] [--out DIR]
       python3 -I experiments/e1/score.py --twin answers.json [--twin-out out.json]
"""

from __future__ import annotations

import argparse
import functools
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of experiments/e1
sys.path.insert(0, str(Path(__file__).resolve().parent))

from e1_common import JS_WHITESPACE, MIN_VALID, N_SOURCES, read_jsonl, write_json, write_jsonl  # noqa: E402

# JavaScript's \s, written out, since Python's \s also matches U+001C..U+001F and U+0085.
_WS = r"\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
# [^\p{L}\p{N}_\s]: Python's \w is str.isalnum() plus "_", which is \p{L}, \p{N} and "_".
_MARK = rf"[^\w{_WS}]"
CITATION = re.compile(rf"\[{_MARK}*[0-9]+{_MARK}*\]")
BOUNDARY = re.compile(rf"([.!?]+[\"'”’)]*)((?:[{_WS}]*\[{_MARK}*[0-9]+{_MARK}*\])*)(?:[{_WS}]+|\Z)")
WORD = re.compile(r"[^\W_]+(?:[-'’.][^\W_]+)*")
_DIGITS = re.compile(r"[0-9]+")


def _marker_numbers(text: str) -> list[int]:
    return [int(_DIGITS.search(m.group(0)).group(0)) for m in CITATION.finditer(text)]


def parse_answer(answer: str) -> list[tuple[str, list[int]]]:
    """parseAnswer: (sentence, its citation numbers) per sentence."""
    out = []
    for line in answer.split("\n"):
        marked = BOUNDARY.sub(lambda m: m.group(1) + m.group(2) + "\0", line)
        for piece in marked.split("\0"):
            text = piece.strip(JS_WHITESPACE)
            if text:
                out.append((text, _marker_numbers(text)))
    return out


def _js_length(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def geo_word_count(sentence: str) -> int:
    """GEO's get_num_words: tokens longer than two UTF-16 code units, citation markers removed."""
    stripped = CITATION.sub(" ", sentence)
    return sum(1 for m in WORD.finditer(stripped) if _js_length(m.group(0)) > 2)


def pawc_shares(sentences: list[tuple[str, list[int]]], n_sources: int) -> list[float]:
    """pawcShares: position-adjusted word count per source, normalized to sum to 1."""
    scores = [0.0] * n_sources
    n = len(sentences)
    for i, (text, cits) in enumerate(sentences):
        if not cits:
            continue
        weight = math.exp(-i / (n - 1)) if n > 1 else 1
        value = (geo_word_count(text) * weight) / len(cits)
        for c in cits:
            if 1 <= c <= n_sources:
                scores[c - 1] += value
    # A left fold, as Array.reduce does: Python 3.12+ sum() rounds float sums differently.
    total = functools.reduce(lambda a, b: a + b, scores, 0.0)
    return [s / total for s in scores] if total > 0 else scores


def score_answer(answer: str, slot: int, n_sources: int = N_SOURCES) -> dict:
    sentences = parse_answer(answer)
    order = []
    for _, cits in sentences:
        for c in cits:
            if 1 <= c <= n_sources and c not in order:
                order.append(c)
    valid = bool(order)
    rank = order.index(slot) + 1 if slot in order else n_sources + 1
    return {
        "valid": valid,
        "rank": rank if valid else None,
        "score": (n_sources + 1 - rank) / n_sources if valid else None,
        "cited": (slot in order) if valid else None,
        "pawc": pawc_shares(sentences, n_sources)[slot - 1] if valid else None,
    }


def make_cells(score_rows: list[dict]) -> list[dict]:
    """One cell per (set, query, version, judge): means over valid answers, dropped below 4 valid."""
    groups = defaultdict(list)
    for r in score_rows:
        groups[(r["set"], r["query_id"], r["version_id"], r["arm"], r["judge"])].append(r)
    cells = []
    for (set_name, qid, vid, arm, judge), rows in sorted(groups.items()):
        valid = [r for r in rows if r["valid"]]

        def mean(field, rows=valid):
            return sum(float(r[field]) for r in rows) / len(rows) if rows else None

        cells.append({
            "set": set_name, "query_id": qid, "version_id": vid, "arm": arm, "judge": judge,
            "n_answers": len(rows), "n_valid": len(valid), "valid_rate": len(valid) / len(rows),
            "score": mean("score"), "cited": mean("cited"), "pawc": mean("pawc"),
            "dropped": len(valid) < MIN_VALID,
        })
    return cells


def read_answers(answers_dir: Path) -> dict[str, str]:
    """Answers by key from every *.jsonl in the folder; the same key with two different answers is an error."""
    answers: dict[str, str] = {}
    for path in sorted(Path(answers_dir).glob("*.jsonl")):
        for row in read_jsonl(path):
            key, answer = row["key"], row["answer"]
            if key in answers and answers[key] != answer:
                raise ValueError(f"key {key} has two different answers (second in {path.name}); keep one run")
            answers[key] = answer
    return answers


def score_all(prompts: list[dict], answers: dict[str, str]) -> tuple[list[dict], list[dict]]:
    scores, completion = [], defaultdict(lambda: [0, 0])
    for p in prompts:
        tally = completion[(p["set"], p["judge"], p["arm"])]
        tally[0] += 1
        if p["key"] not in answers:
            continue
        tally[1] += 1
        scores.append({k: p[k] for k in ("key", "set", "query_id", "version_id", "arm", "judge", "seed", "slot")}
                      | score_answer(answers[p["key"]], p["slot"]))
    rows = [{"set": s, "judge": j, "arm": a, "prompts": n, "answered": done, "missing": n - done}
            for (s, j, a), (n, done) in sorted(completion.items())]
    return scores, rows


def main(argv: list[str] | None = None) -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(here / "data"))
    ap.add_argument("--out", default=str(here / "out"))
    ap.add_argument("--twin", help="JSON list of answers: write their parsed sentences and PAWC shares")
    ap.add_argument("--twin-out")
    args = ap.parse_args(argv)

    if args.twin:
        answers = json.loads(Path(args.twin).read_text(encoding="utf-8"))
        result = []
        for a in answers:
            sentences = parse_answer(a)
            result.append({"sentences": [{"text": t, "citations": c} for t, c in sentences],
                           "pawc": pawc_shares(sentences, N_SOURCES)})
        text = json.dumps(result, ensure_ascii=False)
        if args.twin_out:
            Path(args.twin_out).write_text(text, encoding="utf-8")
        else:
            sys.stdout.write(text)
        return

    data, out = Path(args.data), Path(args.out)
    prompts = read_jsonl(data / "prompts.jsonl")
    answers = read_answers(data / "answers")
    known = {p["key"] for p in prompts}
    scores, completion = score_all(prompts, answers)
    cells = make_cells(scores)
    write_jsonl(out / "scores.jsonl", scores)
    write_jsonl(out / "cells.jsonl", cells)
    write_json(out / "score_summary.json", {
        "answers": len(scores), "prompts": len(prompts), "unknown_answer_keys": len(set(answers) - known),
        "valid": sum(1 for s in scores if s["valid"]), "dropped_cells": sum(1 for c in cells if c["dropped"]),
        "completion": completion,
    })


if __name__ == "__main__":
    main()
