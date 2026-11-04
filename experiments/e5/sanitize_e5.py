"""E5's committed aggregates without page text: writes experiments/results/e5/{analysis_e5.json, e5_results.json,
score_summary.json} from experiments/e5/out, and refuses when any page-derived text remains.

Page-derived text: the pages' titles and texts (data/pages.jsonl), every version's title and text (data/versions.jsonl:
copied page sentences and the editor's rewrites of page spans) and the page questions q_G (data/edit_texts.jsonl).
Queries, q' (the keyword's words) and q_L (the local model's question from the keyword) are not page-derived.

1. Transform (E2's rule, commits c8e5fc6 and 01f4b67): in validator messages only (the keys of every
   failed_by_reason and not_applicable_by_reason table, and every "reason" or "excluded_reason" value), a quoted
   fragment ('...', "...", curly quotes) becomes '…'. A quote mark inside a word (an apostrophe, as in page's) is not a
   quote, so prose is never garbled. analyze_e5.py already cuts reasons before their first quote, so on E5's
   outputs this normally changes nothing; it is kept as a guard.
2. Check: every string and key of the three files (and of any --check file) against the page-derived texts. A string
   fails when it holds a run of 6 words from a page-derived text, or a whole page title or q_G of 3 to 5 words. A run
   that also occurs in our own code (experiments/e1 and experiments/e5 scripts, the engine bundles, the engine's
   sources) is authored wording, not page text, and passes. Any failure stops the script before it writes.

Usage: python3 -I experiments/e5/sanitize_e5.py [--out DIR] [--data DIR] [--dest DIR] [--check FILE ...] [--check-only]
       (--check adds files that are only checked, never written, e.g. RESULTS_E5.md; --check-only writes nothing)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E5_DIR = Path(__file__).resolve().parent
EXP = E5_DIR.parent
ROOT = EXP.parent
sys.path.insert(0, str(EXP / "e1"))

from e1_common import write_json  # noqa: E402

FILES = ("analysis_e5.json", "e5_results.json", "score_summary.json")
REASON_TABLES = ("failed_by_reason", "not_applicable_by_reason")
REASON_FIELDS = ("reason", "excluded_reason")
RUN = 6  # words
SHORT = (3, 5)  # whole titles and q_G of this many words
# A quote that opens after a non-letter and closes before a non-letter, so apostrophes inside words never match.
QUOTED = re.compile(r"(?<![A-Za-z])(['\"“‘])([^'\"“”‘’]+?)(['\"”’])(?![A-Za-z])")
WORD = re.compile(r"[a-z0-9]+")


def authored_sources() -> list[Path]:
    """Our own code: E1's and E5's scripts (not their tests or fixtures), the engine bundles and the engine's sources."""
    out = sorted(p for d in (EXP / "e1", E5_DIR) for p in d.glob("*.py"))
    out += [p for p in (EXP / "e1" / "out" / "bundle" / "engine_cli.js", E5_DIR / "out" / "bundle" / "questions_cli.js")
            if p.exists()]
    out += sorted(p for p in (ROOT / "packages" / "engine" / "src").rglob("*.ts")
                  if "test" not in p.name and "fixture" not in str(p))
    return out


def words(text: str) -> list[str]:
    return WORD.findall(text.lower())


def runs(ws: list[str], n: int = RUN) -> set[tuple]:
    return {tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)}


def scrub_reason(text: str) -> str:
    return QUOTED.sub(lambda m: f"{m.group(1)}…{m.group(3)}", text)


def transform(x, counts: dict, *, in_table: bool = False):
    """Applies scrub_reason to validator messages only; counts what changed."""
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            key = scrub_reason(k) if in_table else k
            if key != k:
                counts["reason keys"] = counts.get("reason keys", 0) + 1
            if k in REASON_FIELDS and isinstance(v, str):
                new = scrub_reason(v)
                if new != v:
                    counts["reason values"] = counts.get("reason values", 0) + 1
                out[key] = new
            else:
                out[key] = transform(v, counts, in_table=k in REASON_TABLES)
        return out
    if isinstance(x, list):
        return [transform(v, counts) for v in x]
    return x


def strings(x, path: str = ""):
    """(path, text) for every string value and every key."""
    if isinstance(x, dict):
        for k, v in x.items():
            yield f"{path}.<key>", k
            yield from strings(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from strings(v, f"{path}[{i}]")
    elif isinstance(x, str):
        yield path, x


def page_texts(data: Path):
    """Every page-derived text: page titles and texts, version titles and texts, q_G."""
    for name, fields in (("pages.jsonl", ("title", "text")), ("versions.jsonl", ("title", "text")),
                         ("edit_texts.jsonl", ("q_G",))):
        path = data / name
        if not path.exists():
            raise SystemExit(f"sanitize_e5: {path} is missing; the check needs every page-derived text")
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    r = json.loads(line)
                    for k in fields:
                        if r.get(k):
                            yield name, k, r[k]


def check(items: list[tuple[str, str, str]], data: Path, sources: list[Path]) -> dict:
    """items: (file, path, text). Returns the hits (page-derived runs left in the outputs) and the counts."""
    out_runs: dict[tuple, list] = {}
    out_words: dict[str, list] = {}
    for f, path, text in items:
        ws = words(text)
        for r in runs(ws):
            out_runs.setdefault(r, []).append((f, path))
        out_words[(f, path)] = ws
    hit_runs, short = {}, {}
    n_texts = 0
    joined = {k: " " + " ".join(ws) + " " for k, ws in out_words.items()}
    for name, field, text in page_texts(data):
        n_texts += 1
        ws = words(text)
        if len(ws) >= RUN:
            for r in runs(ws) & out_runs.keys():
                hit_runs.setdefault(r, (name, field))
        if field in ("title", "q_G") and SHORT[0] <= len(ws) <= SHORT[1]:
            needle = " " + " ".join(ws) + " "
            for k, hay in joined.items():
                if needle in hay:
                    short.setdefault(needle.strip(), (name, field, k))
    authored = " " + " ".join(w for p in sources for w in words(p.read_text(encoding="utf-8", errors="ignore"))) + " "
    hits = []
    for r, (name, field) in hit_runs.items():
        if " " + " ".join(r) + " " not in authored:
            hits.append({"run": " ".join(r), "source": f"{name} {field}", "where": out_runs[r][:3]})
    for needle, (name, field, where) in short.items():
        if " " + needle + " " not in authored:
            hits.append({"run": needle, "source": f"{name} {field}", "where": [where]})
    return {"hits": hits, "page_texts": n_texts, "output_strings": len(items), "output_runs": len(out_runs),
            "runs_also_in_pages": len(hit_runs) + len(short),
            "of_which_authored": len(hit_runs) + len(short) - len(hits)}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(E5_DIR / "out"), help="analyze_e5.py, report_e5.py and score.py's output")
    ap.add_argument("--data", default=str(E5_DIR / "data"), help="E5's data folder (pages, versions, edit texts)")
    ap.add_argument("--dest", default=str(EXP / "results" / "e5"), help="where the sanitized aggregates go")
    ap.add_argument("--check", nargs="*", default=[], help="files that are only checked (e.g. RESULTS_E5.md)")
    ap.add_argument("--check-only", action="store_true", help="check, write nothing")
    args = ap.parse_args(argv)
    out, data, dest = Path(args.out), Path(args.data), Path(args.dest)
    counts: dict = {}
    clean = {name: transform(json.loads((out / name).read_text(encoding="utf-8")), counts) for name in FILES}
    items = [(name, path, text) for name, obj in clean.items() for path, text in strings(obj)]
    for extra in map(Path, args.check):
        items.append((extra.name, "<text>", extra.read_text(encoding="utf-8")))
    result = check(items, data, authored_sources())
    report = {"replaced_in_validator_messages": counts or {"nothing": 0}} | {k: v for k, v in result.items() if k != "hits"}
    print("sanitize_e5: " + json.dumps(report))
    if result["hits"]:
        for h in result["hits"][:20]:
            print(f"  page text left: {h['source']} in {h['where']}", file=sys.stderr)  # the run itself is not printed
        raise SystemExit(f"sanitize_e5: {len(result['hits'])} page-derived runs remain; nothing written")
    if args.check_only:
        return
    dest.mkdir(parents=True, exist_ok=True)
    for name, obj in clean.items():
        write_json(dest / name, obj)
    print(f"sanitize_e5: wrote {', '.join(str(dest / n) for n in FILES)}")


if __name__ == "__main__":
    main()
