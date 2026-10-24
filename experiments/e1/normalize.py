"""E1 normalization, usable-page rules and the 3,000-token cap (PREREG_E1.md, Data 4-5 and 8).

Reads raw fetch records (fetch_geobench.ts, cseo_replication.ts, or --from-samples), and writes:
- candidates.jsonl: one row per (query, page) with the chosen source (live before Wayback), the
  normalized and capped text, and whether the page is usable;
- fetch_log.jsonl: one row per raw record (url, source, status, words, tokens, fetch time, sha256
  of the normalized text). Kept locally, never committed;
- wayback_needed.jsonl: main-set pages with no usable live fetch and no Wayback record yet.

Token counts take the larger of the two judge tokenizers (run on Explorer, where they are
cached: --tokenizers google/gemma-4-12B-it,Qwen/Qwen3.8-27B), or `--approx` (words x 1.35) for
local tests. Run both normalize passes of a fetch with the same mode.

Usage:
  python3 -I normalize.py [--raw data/raw/live.jsonl ...] (--approx | --tokenizers A,B)
  python3 -I normalize.py --from-samples ../../samples --data data/smoke --approx    # smoke set
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402

CAP_TOKENS = 3000
MIN_WORDS = 250
MIN_TERM_SHARE = 0.5
JUDGE_TOKENIZERS = ("google/gemma-4-12B-it", "Qwen/Qwen3.8-27B")

# --- Cleaning (Data 4) ------------------------------------------------------------------------

# A link destination may hold balanced parentheses (as in wiki URLs like /wiki/Kestrel_(bird)).
_DEST = r"(?:[^()\s]|\([^()\s]*\))*"
_IMAGE = re.compile(rf"!\[[^\]]*\]\({_DEST}(?:\s+\"[^\"]*\")?\)")
_LINK = re.compile(rf"(?<!!)\[([^\]]*)\]\(({_DEST})((?:\s+\"[^\"]*\")?)\)")
_FOOTNOTE_MARK = re.compile(r"\[\^[^\]\s]+\](?!:)")
_FOOTNOTE_DEF = re.compile(r"^\[\^[^\]\s]+\]:")
_WAYBACK = re.compile(r"^https?://web\.archive\.org/web/\d+[a-z_]*/(.+)$", re.I)


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def unwrap_wayback(url: str) -> str:
    m = _WAYBACK.match(url)
    return m.group(1) if m else url


def _drop_footnote_definitions(text: str) -> str:
    """Removes `[^n]: ...` definitions and their indented continuation lines."""
    out: list[str] = []
    in_def = False
    for line in text.split("\n"):
        if _FOOTNOTE_DEF.match(line):
            in_def = True
            continue
        if in_def and line.startswith(("    ", "\t")):
            continue
        in_def = False
        out.append(line)
    return "\n".join(out)


def clean(text: str, page_url: str | None) -> str:
    """Images, footnote markers and definitions removed; own-site links turned into anchor text.

    A link is own-site when it is relative, a fragment, or its host (www. ignored, Wayback
    wrappers unwrapped) is the page's host. Links to other sites are kept, with a Wayback
    wrapper removed from the URL.
    """
    text = _IMAGE.sub("", text)
    page_host = _host(page_url) if page_url else ""

    def link(m: re.Match) -> str:
        anchor, url, title = m.group(1), m.group(2), m.group(3)
        if anchor.strip() == "":
            return ""
        absolute = unwrap_wayback(urljoin(page_url, url) if page_url else url)
        scheme = urlsplit(absolute).scheme
        own = not scheme or url.startswith("#") or (page_host and _host(absolute) == page_host)
        if own and scheme in ("", "http", "https"):
            return anchor
        return f"[{anchor}]({unwrap_wayback(url)}{title})"

    text = _LINK.sub(link, text)
    text = _FOOTNOTE_MARK.sub("", text)
    text = _drop_footnote_definitions(text)
    text = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", text)
    return text.strip()


# --- Usable page (Data 5) ---------------------------------------------------------------------

SEPARATORS = re.compile(r"\s+(?:\||-|\u2013|\u2014|::|\u00b7|\u2022)\s+")
_GENERIC_START = [
    re.compile(p, re.I)
    for p in (
        r"(?:home|homepage|home page)$",
        r"welcome(?: to [^|]+)?$",
        r"(?:log ?in|sign ?in|sign ?up|create an account|register)\b",
        r"(?:cookie|consent|privacy (?:choices|preferences|settings)|before you continue|we value your privacy)",
        r"(?:400|401|403|404|410|429|500|502|503|504)\b",
        r"error(?:\s+\d+)?$",
        r"(?:page )?not found",
        r"access denied",
        r"forbidden$",
        r"just a moment",
        r"attention required",
        r"are you a robot",
        r"security check",
        r"too many requests",
        r"service unavailable",
        r"site (?:is )?(?:under )?maintenance",
    )
]
_GENERIC_ANYWHERE = re.compile(r"\b(?:page not found|404 not found)\b", re.I)


def generic_title(title: str, page_url: str | None) -> bool:
    """Data 5(c): the title is empty, only a site name, or a home, login, consent or error title."""
    t = title.strip()
    if not t:
        return True
    if _GENERIC_ANYWHERE.search(t):
        return True
    parts = [t, SEPARATORS.split(t)[0].strip()]
    if any(p.match(part) for part in parts for p in _GENERIC_START):
        return True
    if page_url:
        host = _host(page_url)
        label = host.split(".")[-2] if host.count(".") >= 1 else host
        squash = re.sub(r"[^a-z0-9]", "", re.sub(r"^www\.", "", t.lower()))
        if squash in {re.sub(r"[^a-z0-9]", "", host), re.sub(r"[^a-z0-9]", "", label)}:
            return True
    return False


def usable(title: str, text: str, query: str, page_url: str | None, title_rule: bool) -> tuple[bool, str | None]:
    n = common.count_words(text)
    if n < MIN_WORDS:
        return False, f"fewer than {MIN_WORDS} words ({n})"
    terms = common.content_terms(query)
    have = len(common.terms_present(terms, f"{title}\n{text}"))
    if terms and have / len(terms) < MIN_TERM_SHARE:
        return False, f"contains {have} of {len(terms)} query key terms"
    if title_rule and generic_title(title, page_url):
        return False, f"generic title {title.strip()!r}"
    return True, None


# --- The cap (Data 5) -------------------------------------------------------------------------


def approx_tokens(text: str) -> int:
    """Local stand-in for the judge tokenizers: whitespace words x 1.35, rounded up."""
    return math.ceil(len(text.split()) * 1.35)


def tokenizer_counter(model_ids) -> callable:
    """The larger token count of the given cached Hugging Face tokenizers (offline)."""
    from transformers import AutoTokenizer  # imported here: only the cluster has it

    toks = [AutoTokenizer.from_pretrained(m, local_files_only=True) for m in model_ids]
    return lambda text: max(len(t(text, add_special_tokens=False)["input_ids"]) for t in toks)


def _last_fit(text: str, positions: list[int], count, limit: int) -> int | None:
    """The largest position whose prefix has at most `limit` tokens (prefix counts grow)."""
    lo, hi, best = 0, len(positions) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if count(text[: positions[mid]].rstrip()) <= limit:
            best = positions[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def cap(text: str, count, limit: int = CAP_TOKENS) -> tuple[str, bool]:
    """Cuts a page over `limit` tokens at the last heading before the limit, else at the last
    paragraph boundary (then line, then space). A heading at offset 0 is not a cut point."""
    if count(text) <= limit:
        return text, False
    candidates = [
        [m.start() for m in re.finditer(r"(?m)^#{1,6}[ \t]", text) if m.start() > 0],
        [m.end() for m in re.finditer(r"\n[ \t]*\n\s*", text)],
        [m.end() for m in re.finditer(r"\n", text)],
        [m.end() for m in re.finditer(r"\s+", text)],
    ]
    for positions in candidates:
        pos = _last_fit(text, positions, count, limit)
        if pos:
            return text[:pos].rstrip(), True
    return "", True


# --- Records ----------------------------------------------------------------------------------

PAGE_FIELDS = ("query_id", "set", "split", "row_idx", "order", "query", "url_index", "url")


def _normalized(rec: dict, count) -> dict:
    """One raw record cleaned, capped and judged."""
    out = {k: rec.get(k) for k in PAGE_FIELDS}
    out.update(source=rec["source"], status=rec.get("status"), fetched_at=rec.get("fetched_at"))
    if not rec.get("ok"):
        out.update(title="", text="", words=0, tokens_max=0, cut=False, sha256=None, usable=False,
                   unusable_reason=f"fetch failed: {rec.get('reason') or 'unknown'}")
        return out
    title = (rec.get("title") or "").strip()
    text, cut = cap(clean(rec.get("text") or "", rec.get("url")), count)
    out.update(title=title, text=text, words=common.count_words(text), tokens_max=count(text), cut=cut,
               sha256=common.sha256_text(text))
    if rec["set"] == "smoke":
        ok, reason = True, None  # the smoke set checks the pipeline only; no page is dropped
    else:
        ok, reason = usable(title, text, rec["query"], rec.get("url"), title_rule=rec["set"] == "main")
    out.update(usable=ok, unusable_reason=reason)
    return out


def process(records: list[dict], count) -> tuple[list[dict], list[dict], list[dict]]:
    """(candidates, fetch log, Wayback-needed) for raw records; live is preferred over Wayback."""
    by_page: dict[tuple, dict[str, dict]] = {}
    log = []
    for rec in records:
        norm = _normalized(rec, count)
        log.append({"query_id": rec["query_id"], "url_index": rec["url_index"], "url": rec.get("url"),
                    "source": rec["source"], "status": rec.get("status"), "words": norm["words"],
                    "tokens": norm["tokens_max"], "fetched_at": rec.get("fetched_at"), "sha256": norm["sha256"]})
        # A later record for the same page and source (a re-fetch) replaces the earlier one.
        by_page.setdefault((rec["query_id"], rec["url_index"]), {})[rec["source"]] = norm
    rows, need = [], []
    for key in sorted(by_page, key=lambda k: (by_page[k][next(iter(by_page[k]))]["order"], k[1])):
        sources = by_page[key]
        chosen = next((sources[s] for s in ("live", "wayback", "cseo", "sample") if s in sources and sources[s]["usable"]), None)
        if chosen is None:
            chosen = sources.get("wayback") or next(iter(sources.values()))
            if chosen["set"] == "main" and "wayback" not in sources:
                need.append({k: chosen[k] for k in PAGE_FIELDS})
        rows.append(chosen)
    return rows, log, need


def sample_records(samples_dir: Path) -> list[dict]:
    """The smoke set: each sample question with the first 5 documents of its pack, in order."""
    index = json.loads((samples_dir / "index.json").read_text(encoding="utf-8"))
    records, order = [], 0
    for entry in index:
        pack = json.loads((samples_dir / entry["slug"] / "pack.json").read_text(encoding="utf-8"))
        for q in pack["queries"]:
            order += 1
            for i, doc in enumerate(q["documents"][:5], start=1):
                records.append({"query_id": f"smoke-{entry['slug']}-{q['queryId']}", "set": "smoke", "split": None,
                                "row_idx": None, "order": order, "query": q["query"], "url_index": i, "url": None,
                                "source": "sample", "ok": True, "status": None, "reason": None,
                                "title": doc.get("title", ""), "text": doc["text"], "fetched_at": None})
    return records


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", action="append", help="raw records JSONL (repeatable; default data/raw/*.jsonl)")
    ap.add_argument("--from-samples", help="build the smoke set from this samples/ directory instead")
    ap.add_argument("--data", default=str(common.DATA))
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--approx", action="store_true", help="words x 1.35 instead of the judge tokenizers")
    mode.add_argument("--tokenizers", help=f"comma-separated HF ids (E1: {','.join(JUDGE_TOKENIZERS)})")
    args = ap.parse_args(argv)

    data = Path(args.data)
    if args.from_samples:
        records = sample_records(Path(args.from_samples))
    else:
        paths = [Path(p) for p in args.raw] if args.raw else sorted((data / "raw").glob("*.jsonl"))
        records = [r for p in paths for r in common.read_jsonl(p)]
    count = approx_tokens if args.approx else tokenizer_counter(args.tokenizers.split(","))
    rows, log, need = process(records, count)
    common.write_jsonl(data / "candidates.jsonl", rows)
    common.write_jsonl(data / "fetch_log.jsonl", log)
    common.write_jsonl(data / "wayback_needed.jsonl", need)
    print(json.dumps({"records": len(records), "pages": len(rows), "usable": sum(r["usable"] for r in rows),
                      "cut": sum(r["cut"] for r in rows), "wayback_needed": len(need),
                      "tokens": "approx" if args.approx else args.tokenizers}, indent=1))


if __name__ == "__main__":
    main()
