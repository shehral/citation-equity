"""E2a page versions 9W and 9P (experiments/PLAN_E2.md), deterministic: no model writes them.

For every query whose E1 arm 9 version is valid (main and replication sets), it writes two rows in
E1's versions.jsonl schema (experiments/e1/README.md):

- 9W, words without a heading: the query as a plain paragraph, then arm 9's sentence, at arm 9's
  position (deterministic_arms.arm9w).
- 9P, a section without the query's words: `## <first N words of S>` then S, where S is the page's
  prose sentence with the fewest query key terms (ties: closest in word count to arm 9's sentence,
  then earliest) and N is the query's word count (deterministic_arms.arm9p).

Validity: the version differs from the original; for 9P, the inserted text adds no query key term
beyond those already in S. Before writing, arm 9 is rebuilt from the same engine output and must
equal E1's arm 9 text byte for byte, so 9W and 9P share the sentence E1's arm 9 used.

The engine output is E1's data/engine_original.jsonl when present, otherwise the engine bridge is
run (common.run_engine; set E1_ENGINE or build experiments/e1/out/bundle/engine_cli.js).

Usage: python3 -I experiments/e2/make_versions.py [--e1-data experiments/e1/data]
           [--out experiments/e2/data/versions.jsonl]
Writes the versions file and make_versions.json (counts) next to it, and prints counts per set and arm.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
E2_DIR = Path(__file__).resolve().parent
E1_DIR = E2_DIR.parent / "e1"
sys.path.insert(0, str(E1_DIR))

import common  # noqa: E402
import deterministic_arms as da  # noqa: E402
import validate  # noqa: E402
from e1_common import E2_ARMS, write_json  # noqa: E402

E2_SETS = ["main", "replication"]
BUILDERS = {"9W": da.arm9w, "9P": da.arm9p}


def differs(original_text: str, text: str) -> str | None:
    if text == original_text:
        return "invalid: the version is the same as the original"
    return None


def check_9p(query: str, heading: str, sentence: str) -> str | None:
    """9P's inserted text (heading and S) may hold only key terms that S already has."""
    terms = common.content_terms(query)
    extra = sorted(common.terms_present(terms, heading) - common.terms_present(terms, sentence))
    if extra:
        return f"invalid: the heading adds query key terms that sentence S does not have ({', '.join(extra)})"
    return None


def _row(page: dict, arm: str, text: str, reason: str | None) -> dict:
    original = (page["title"], page["text"])
    version = (page["title"], text)
    w0, w1 = validate.page_words(original), validate.page_words(version)
    return {"version_id": f"{page['query_id']}:{arm}", "query_id": page["query_id"], "set": page["set"],
            "arm": arm, "text": text, "title": page["title"], "valid": reason is None, "attempts": 1,
            "excluded_reason": reason, **validate.metrics(page["query"], original, version),
            "added_words": max(0, w1 - w0), "skipped_steps": []}


def build(pages: list[dict], e1_versions: list[dict], *, engine=None, engine_rows: dict | None = None):
    """(rows, summary): the 9W and 9P rows of every query whose E1 arm 9 is valid, and the counts."""
    targets = {p["query_id"]: p for p in pages if p["role"] == "target" and p["set"] in E2_SETS}
    nine = {v["query_id"]: v for v in e1_versions
            if v["arm"] == "9" and v["valid"] and v["query_id"] in targets}
    qids = sorted(nine)
    if engine_rows is not None:
        missing = [targets[q]["page_id"] for q in qids if targets[q]["page_id"] not in engine_rows]
        if missing:
            raise ValueError(f"engine output has no row for {len(missing)} target pages, e.g. {missing[:3]}")
        engs = {q: engine_rows[targets[q]["page_id"]] for q in qids}
    else:
        out = (engine or common.run_engine)(
            [{"id": q, "markdown": targets[q]["text"], "question": targets[q]["query"]} for q in qids])
        engs = {q: out[q] for q in qids}

    rows: list[dict] = []
    counts = {s: {a: {"versions": 0, "valid": 0} for a in E2_ARMS} for s in E2_SETS}
    same_sentence = dict.fromkeys(E2_SETS, 0)
    for q in qids:
        page, eng = targets[q], engs[q]
        text, query = page["text"], page["query"]
        edits, reason = da.arm9(text, eng, query)
        rebuilt = validate.splice(text, edits) if edits else None
        if rebuilt != nine[q]["text"]:
            raise ValueError(f"arm 9 rebuilt for {q} differs from E1's arm 9 version: the engine output or the "
                             "page is not the one E1 used")
        s9, sp = da.arm9_sentence(text, eng, query), da.arm9p_sentence(text, eng, query)
        same_sentence[page["set"]] += sp == s9
        for arm in E2_ARMS:
            edits, why = BUILDERS[arm](text, eng, query)
            if edits is None:  # cannot happen when arm 9 was built, kept for safety
                rows.append(_row(page, arm, text, f"invalid: {why}"))
                continue
            version = validate.splice(text, edits)
            reason = differs(text, version)
            if reason is None and arm == "9P":
                reason = check_9p(query, da.first_words(sp, common.count_words(query)), sp)
            rows.append(_row(page, arm, version, reason))
    for r in rows:
        c = counts[r["set"]][r["arm"]]
        c["versions"] += 1
        c["valid"] += r["valid"]
    arm9_valid = defaultdict(int)
    for q in qids:
        arm9_valid[targets[q]["set"]] += 1
    summary = {"counts": counts, "e1_arm9_valid": {s: arm9_valid[s] for s in E2_SETS},
               "s_is_arm9_sentence": same_sentence}
    return rows, summary


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--e1-data", default=str(E1_DIR / "data"))
    ap.add_argument("--out", default=str(E2_DIR / "data" / "versions.jsonl"))
    args = ap.parse_args(argv)
    e1, out = Path(args.e1_data), Path(args.out)
    if out.resolve() == (e1 / "versions.jsonl").resolve():
        ap.error("--out is E1's versions.jsonl; E2 versions go to their own file")
    engine_path = e1 / "engine_original.jsonl"
    engine_rows = {r["id"]: r for r in common.read_jsonl(engine_path)} if engine_path.exists() else None
    rows, summary = build(common.read_jsonl(e1 / "pages.jsonl"), common.read_jsonl(e1 / "versions.jsonl"),
                          engine_rows=engine_rows)
    common.write_jsonl(out, rows)
    summary["engine"] = str(engine_path) if engine_rows is not None else "engine bridge (common.run_engine)"
    write_json(out.parent / "make_versions.json", summary)
    for set_name in E2_SETS:
        print(f"{set_name}: E1 arm 9 valid for {summary['e1_arm9_valid'][set_name]} queries; "
              f"S is arm 9's own sentence for {summary['s_is_arm9_sentence'][set_name]}")
        for arm in E2_ARMS:
            c = summary["counts"][set_name][arm]
            print(f"  {set_name} {arm}: {c['versions']} versions, {c['valid']} valid")
    print(f"make_versions: {len(rows)} rows in {out}")


if __name__ == "__main__":
    main()
