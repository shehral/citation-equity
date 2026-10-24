"""E1 deterministic and extractive arms 4, 9, 11, 13 and 14 (PREREG_E1.md, Arms), and the
"feature already present" rules of arms 11-14 that the applicability table uses.

Each arm function takes the page text (Markdown), its engine output (engine_cli JSON) and, where
needed, the query, and returns (edits, None) or (None, reason it does not apply). An edit is
{"field": "text", "start", "end", "replacement"} in code point offsets of the original text;
editor.splice applies them. No model writes these arms.

`features` is called by applicability.ts:
  python3 -I deterministic_arms.py features --pages data/pages.jsonl --engine data/engine_original.jsonl
prints one JSON line per (query_id, arm) for arms 11-14.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402

SPLIT_WORDS = 400
HEADING_WORDS = 8


def _edit(start: int, end: int, replacement: str) -> dict:
    return {"field": "text", "start": start, "end": end, "replacement": replacement}


def top_position(text: str) -> int:
    """Where text "directly under the title" goes: the start, or after a leading H1 line."""
    m = re.match(r"#[ \t][^\n]*\n(?:[ \t]*\n)*", text)
    return m.end() if m else 0


def prose_paragraphs(eng: dict) -> list[dict]:
    return [p for p in eng["artifacts"]["paragraphs"] if not p["inListItem"] and not p["inBlockquote"]]


def prose_sentences(text: str, eng: dict) -> list[str]:
    return [text[s["start"] : s["end"]] for p in prose_paragraphs(eng) for s in p["sentences"]]


# --- Arm 4: the tables check's own `after` text --------------------------------------------------


def arm4(text: str, eng: dict):
    suggestions = eng["checks"].get("tables", {}).get("suggestions", [])
    edits = [_edit(s["start"], s["end"], s["after"]) for s in suggestions if s["kind"] == "edit" and "after" in s]
    if not edits:
        return None, "no Key: value list for the tables check to convert"
    return edits, None


# --- Arm 9: the query as an H2 under the title, with the best-overlap sentence --------------------


def arm9(text: str, eng: dict, query: str):
    terms = common.content_terms(query)
    best, best_n = None, -1
    for sentence in prose_sentences(text, eng):
        n = len(common.terms_present(terms, sentence))
        if n > best_n:  # strictly greater: the earliest sentence wins a tie
            best, best_n = sentence, n
    if best is None:
        return None, "the page has no prose sentence"
    pos = top_position(text)
    return [_edit(pos, pos, f"## {query.strip()}\n\n{best.strip()}\n\n")], None


# --- Arm 11: the first "<key term> is/are ..." sentence under the title ----------------------------

_DEFINITION = re.compile(
    # A demonstrative or pronoun opener ("These lakes are ...") points back; it defines nothing.
    r"\s*[\"'“‘(]*(?!(?:this|that|these|those|it|they|such|its|their)\b)(?:(?:a|an|the)\s+)?"
    r"((?:[^\W\d_][\w'’-]*\s+){0,3}[^\W\d_][\w'’-]*)\s+(?:is|are)\s",
    re.I,
)


def is_definition(sentence: str, terms) -> bool:
    m = _DEFINITION.match(sentence)
    return bool(m) and common.stem(m.group(1).split()[-1].lower()) in set(terms)


def arm11(text: str, eng: dict, query: str):
    terms = common.content_terms(query)
    sentences = prose_sentences(text, eng)
    if sentences and is_definition(sentences[0], terms):
        return None, "feature already present: the page opens with a definition"
    definition = next((s for s in sentences if is_definition(s, terms)), None)
    if definition is None:
        return None, "no sentence of the form '<key term> is/are'"
    pos = top_position(text)
    return [_edit(pos, pos, f"{definition.strip()}\n\n")], None


# --- Arm 13: split sections over 400 words ----------------------------------------------------------


def _plain_words(block: str) -> list[str]:
    plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", block)
    plain = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", plain)
    plain = re.sub(r"^\s*(?:[-*+]|\d+[.)]|>|\|)\s*", "", plain)
    plain = re.sub(r"[*_`|#]", " ", plain)
    return plain.split()


def arm13(text: str, eng: dict):
    a = eng["artifacts"]
    edits = []
    for index, section in enumerate(a["sections"]):
        starts = sorted(
            [p["start"] for p in prose_paragraphs(eng) if p["sectionIndex"] == index]
            + [x["start"] for x in a["lists"] + a["tables"] if x["sectionIndex"] == index]
        )
        if len(starts) < 2:
            continue
        body_start = starts[0]
        total = common.count_words(text[body_start : section["end"]])
        if total <= SPLIT_WORDS:
            continue
        half = total / 2
        cut = min(starts[1:], key=lambda b: (abs(common.count_words(text[body_start:b]) - half), b))
        heading = section["headingIndex"]
        depth = a["headings"][heading]["depth"] if heading is not None else 2
        block_end = text.find("\n\n", cut)
        words = _plain_words(text[cut : block_end if block_end >= 0 else len(text)])[:HEADING_WORDS]
        if not words:
            continue
        title = " ".join(words).rstrip(".,;:!?")
        edits.append(_edit(cut, cut, f"{'#' * depth} {title}\n\n"))
    if not edits:
        return None, "feature already present: no section over 400 words"
    return edits, None


# --- Arm 14: the page's own date as "Updated: <date>" -------------------------------------------------

_MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
_YEAR = r"(?:19|20)\d\d"
_DATE = (
    rf"(?:{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+{_YEAR}|\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTH},?\s+{_YEAR}"
    rf"|{_YEAR}-\d\d-\d\d|\d{{1,2}}/\d{{1,2}}/{_YEAR})"
)
_DATED = re.compile(rf"\b(?:published|updated|posted|modified|reviewed)\b[^\n]{{0,40}}?({_DATE})", re.I)


def find_date(text: str):
    """(date, offset) of the first date after a published/updated/posted/modified/reviewed word."""
    m = _DATED.search(text)
    return (m.group(1), m.start(1)) if m else (None, None)


def arm14(text: str, eng: dict):
    date, at = find_date(text)
    if date is None:
        return None, "no publication or update date found"
    first_block = text.find("\n\n", top_position(text))
    if first_block < 0 or at < first_block:
        return None, "feature already present: the date is under the title"
    pos = top_position(text)
    return [_edit(pos, pos, f"Updated: {date}\n\n")], None


# --- Arm 12 feature: query key terms missing from the title, first heading and first paragraph ------


def lead_spans(text: str, eng: dict) -> list[tuple[int, int]]:
    """Ranges of the first heading and the first prose paragraph that exist."""
    a = eng["artifacts"]
    out = []
    if a["headings"]:
        out.append((a["headings"][0]["start"], a["headings"][0]["end"]))
    paragraphs = prose_paragraphs(eng)
    if paragraphs:
        out.append((paragraphs[0]["start"], paragraphs[0]["end"]))
    return out


def missing_terms(query: str, title: str, text: str, eng: dict) -> list[str]:
    lead = " ".join([title] + [text[s:e] for s, e in lead_spans(text, eng)])
    present = common.terms_present(common.content_terms(query), lead)
    return [t for t in common.content_terms(query) if t not in present]


def features(page: dict, eng: dict) -> list[dict]:
    """Applicability rows for arms 11-14 (feature already present, or nothing to build from)."""
    text, query = page["text"], page["query"]
    rows = []
    for arm, result in (("11", arm11(text, eng, query)[1]), ("12", None), ("13", arm13(text, eng)[1]),
                        ("14", arm14(text, eng)[1])):
        if arm == "12":
            missing = missing_terms(query, page.get("title", ""), text, eng)
            result = None if missing else (
                "feature already present: every key term is in the title, first heading or first paragraph")
        rows.append({"arm": arm, "applicable": result is None, "reason": result})
    return rows


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("features", help="arm 11-14 applicability for every target")
    f.add_argument("--pages", default=str(common.DATA / "pages.jsonl"))
    f.add_argument("--engine", default=str(common.DATA / "engine_original.jsonl"))
    args = ap.parse_args(argv)

    engine = {r["id"]: r for r in common.read_jsonl(args.engine)}
    for page in common.read_jsonl(args.pages):
        if page["role"] != "target":
            continue
        for row in features(page, engine[page["page_id"]]):
            print(json.dumps({"query_id": page["query_id"], **row}, ensure_ascii=False))


if __name__ == "__main__":
    main()
