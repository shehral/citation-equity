"""E1 validity checks (PREREG_E1.md, "Validity checks"), run on every edited version.

1. Text outside the spans is byte-identical to the original (step by step for ALL). Arms 5-7 add
   material, so inside their spans the original text must also survive: insertions only.
2. The arm's own engine check value rises (arms 2-10), or its feature is present (1, 11-14).
   Two arms of 2-10 are judged by their feature instead (see the README): arm 9 (the query as an
   H2 directly under the title, then a page sentence copied verbatim), and arm 7 when the donor
   has no URL (replication set), where every edited claim must name the donor.
   A placebo instead keeps every engine check within +-0.02 of the original and keeps exactly
   the query key terms its spans contain.
3. No number token, URL or capitalized multi-word sequence (not counting a sentence's first
   word) that does not occur verbatim in the target; the donor is also allowed for arms 5-7 and
   the query for arms 9, 11 and 12. Arm 2's headings use only words of the heading or its
   section's first paragraph (plus function words); arm 12 adds only key terms and function words.
4. No heading, list item, table row or link (by URL) of the original is removed, except the
   headings arms 2 and 12 (and any placebo) reword inside their spans and the list items arm 4
   turns into a table.
5. Length: arms 1-4, 8, 10, 12, 13 within 0.95-1.10x the page's words; additive arms 5, 6, 7, 9,
   11, 14 at most 1.15x (added words recorded); placebos within +-10% of their spans' words;
   ALL within 0.9-1.6x.
6. Arm 3 keeps the multiset of content words of its spans within 5%.

Every function returns None when its check passes, or a message for the regenerate prompt.
"""

from __future__ import annotations

import difflib
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
import deterministic_arms as da  # noqa: E402
import normalize  # noqa: E402

ENGINE_CHECK = {
    "1": "standalone-paragraphs", "2": "question-headings", "3": "lists", "4": "tables", "5": "statistics",
    "6": "expert-quotes", "7": "cited-sources", "8": "direct-answer-lead", "9": "question-coverage",
    "10": "comparisons",
}
ADDITIVE = {"5", "6", "7", "9", "11", "14"}
INSERT_ONLY = {"5", "6", "7"}
DONOR_ARMS = {"5", "6", "7"}
QUERY_ARMS = {"9", "11", "12"}
HEADING_CONVERTERS = {"2", "12", "P2", "P12"}
LIST_CONVERTERS = {"4"}
PLACEBO_TOLERANCE = 0.02


def is_placebo(arm: str) -> bool:
    return arm.startswith("P")


def base_arm(arm: str) -> str:
    """'P5' -> '5', 'P_ALL' -> 'ALL'."""
    return arm[1:].lstrip("_") if is_placebo(arm) else arm


def donor_name(donor: dict) -> str:
    """How a donor is named in an attribution. A fetched page: the site part of its title
    ("... - Wikipedia"), else the title, else the host. A C-SEO document has no title or URL
    (PREREG_E1, Replication set: attributed by the donor's name): its first line, up to 12 words."""
    title = (donor.get("title") or "").strip()
    if donor.get("url"):
        parts = normalize.SEPARATORS.split(title)
        if len(parts) > 1:
            return parts[-1].strip()
        host = urlsplit(donor["url"]).hostname or ""
        return title or host.removeprefix("www.")
    first = next((line.strip() for line in (donor.get("text") or "").split("\n") if line.strip()), title)
    return " ".join(first.split()[:12])


def splice(text: str, edits: list[dict]) -> str:
    """Applies non-overlapping {start, end, replacement} edits (original offsets)."""
    out, pos = [], 0
    for e in sorted(edits, key=lambda e: (e["start"], e["end"])):
        if e["start"] < pos:
            raise ValueError(f"overlapping edits at {e['start']}")
        out += [text[pos : e["start"]], e["replacement"]]
        pos = e["end"]
    return "".join(out) + text[pos:]


def _within(e: dict, spans: list[dict]) -> bool:
    return any(s["field"] == e["field"] and s["start"] <= e["start"] and e["end"] <= s["end"] for s in spans)


# --- 1 ------------------------------------------------------------------------------------------


def check_outside_spans(orig_text, edited_text, orig_title, edited_title, edits, spans, insert_only):
    for e in edits:
        if not _within(e, spans):
            return f"An edit at {e['field']} {e['start']}-{e['end']} lies outside the edited spans."
    text_edits = [e for e in edits if e["field"] == "text"]
    title_edits = [e for e in edits if e["field"] == "title"]
    if splice(orig_text, text_edits) != edited_text:
        return "Text outside the edited spans changed."
    if splice(orig_title, title_edits) != edited_title:
        return "The title changed, but it is not one of the spans."
    if insert_only:
        for e in edits:
            source = (orig_text if e["field"] == "text" else orig_title)[e["start"] : e["end"]]
            ops = difflib.SequenceMatcher(None, source, e["replacement"], autojunk=False).get_opcodes()
            if any(op not in ("equal", "insert") for op, *_ in ops):
                return "Keep the original sentence exactly as it is and only insert the new material."
    return None


# --- 2 ------------------------------------------------------------------------------------------


def _check(eng: dict, check_id: str) -> dict:
    return eng["checks"].get(check_id, {"applicable": False, "score": 0, "metrics": {}})


def _folded(text: str) -> str:
    return " ".join(text.lower().split())


def _named_by_attribution(donor, edits, before) -> str | None:
    """Arm 7 when the donor has no URL (replication set): cited-sources counts only http(s) links
    and footnotes, so it cannot rise; every edited claim must name the donor instead."""
    name = donor_name(donor)
    needed = f"Attribute each edited claim to the source by name, as \"(source: {name})\"."
    if not edits:
        return needed
    for e in edits:
        source = (before[1] if e["field"] == "text" else before[0])[e["start"] : e["end"]]
        if _folded(e["replacement"]).count(_folded(name)) <= _folded(source).count(_folded(name)):
            return needed
    return None


def _query_heading_on_top(query, before, after) -> str | None:
    """Arm 9's feature: the query as an H2 directly under the title, then one page sentence copied
    verbatim. question-coverage need not rise: the copied highest-overlap sentence often misses
    that check's 8-40-word and 60% key-term bar, and the arm is defined by the extraction."""
    text = after[1]
    rest = text[da.top_position(text) :]
    head = f"## {query.strip()}\n\n"
    if not rest.startswith(head):
        return "The page does not show the query as an H2 directly under the title."
    sentence = rest[len(head) :].split("\n\n", 1)[0].strip()
    if not sentence or sentence not in before[1]:
        return "Under the query heading, copy one sentence of the page verbatim."
    return None


def check_own_feature(arm, eng_before, eng_after, query, before, after, donor=None, edits=()):
    """`before`/`after` are (title, text) of the version before and after this edit; `edits` are
    its {field, start, end, replacement} edits in `before`'s coordinates."""
    if arm == "7" and donor and not donor.get("url"):
        return _named_by_attribution(donor, edits, before)
    if arm == "9":
        return _query_heading_on_top(query, before, after)
    if arm == "1":
        b, a = _check(eng_before, ENGINE_CHECK["1"]), _check(eng_after, ENGINE_CHECK["1"])
        if not a["applicable"] or a["metrics"].get("unresolvedOpeners", 0) >= b["metrics"].get("unresolvedOpeners", 0):
            return "Every flagged paragraph must open by naming its subject instead of a pointer like 'This' or 'It'."
        return None
    if arm in ENGINE_CHECK:
        check_id = ENGINE_CHECK[arm]
        b, a = _check(eng_before, check_id), _check(eng_after, check_id)
        if not a["applicable"]:
            return f"After the edit the {check_id} check is not applicable."
        if a["score"] <= b["score"]:
            return f"The {check_id} check did not rise ({b['score']:.3f} -> {a['score']:.3f})."
        return None
    title, text = after
    if arm == "11":
        first = da.prose_sentences(text, eng_after)[:1]
        if not first or not da.is_definition(first[0], common.content_terms(query)):
            return "The page does not open with the definition sentence."
    elif arm == "12":
        if len(da.missing_terms(query, title, text, eng_after)) >= len(
            da.missing_terms(query, before[0], before[1], eng_before)
        ):
            return "Work the missing query key terms into the title, the first heading or the first paragraph."
    elif arm == "13":
        if len(eng_after["artifacts"]["headings"]) <= len(eng_before["artifacts"]["headings"]):
            return "No section was split under a new heading."
    elif arm == "14":
        if not text[da.top_position(text) :].startswith("Updated: "):
            return "The page does not show 'Updated: <date>' under the title."
    return None


def check_placebo(eng_before, eng_after, query, orig_span_texts, new_span_texts):
    for check_id in sorted(set(eng_before["checks"]) | set(eng_after["checks"])):
        b, a = _check(eng_before, check_id), _check(eng_after, check_id)
        if b["applicable"] != a["applicable"] or (
            b["applicable"] and abs(a["score"] - b["score"]) > PLACEBO_TOLERANCE + 1e-9
        ):
            return (f"The paraphrase changed the {check_id} check ({b['score']:.3f} -> {a['score']:.3f}); "
                    "keep the same structure, figures, quotes and links.")
    terms = common.content_terms(query)
    had = common.terms_present(terms, "\n".join(orig_span_texts))
    has = common.terms_present(terms, "\n".join(new_span_texts))
    if had != has:
        lost, added = sorted(had - has), sorted(has - had)
        return f"Keep exactly the query key terms the spans contain (lost: {lost}, added: {added})."
    return None


# --- 3 ------------------------------------------------------------------------------------------

_NUMBER = re.compile(r"[0-9][0-9.,%]*")
_URL = re.compile(r"https?://[^\s)\]>\"'<]+")
_CAPS = re.compile(r"(?<![\w'’-])[A-Z][\w'’-]*(?:[ \t]+[A-Z][\w'’-]*)+")


def corpus(target, donor=None, query=None) -> str:
    """The text an edit may draw numbers, URLs and names from."""
    parts = [target[0], target[1]]
    if donor:
        parts += [donor.get("title") or "", donor.get("text") or "", donor.get("url") or ""]
    if query:
        parts.append(query)
    return "\n".join(parts)


def _occurs(token: str, text: str, guard: str) -> bool:
    return re.search(rf"(?<!{guard}){re.escape(token)}(?!{guard})", text) is not None


def new_facts(text: str, allowed: str) -> list[str]:
    found = []
    for m in _NUMBER.finditer(text):
        tok = m.group(0).rstrip(".,")
        if tok and not _occurs(tok, allowed, "[0-9]"):
            found.append(f"number '{tok}'")
    for m in _URL.finditer(text):
        tok = m.group(0).rstrip(".,;:!?")
        if tok not in allowed:
            found.append(f"URL {tok}")
    for m in _CAPS.finditer(text):
        words, start = m.group(0).split(), m.start()
        if common.starts_sentence(text, start):
            words = words[1:]
        if len(words) >= 2:
            seq = " ".join(words)
            if not _occurs(seq, re.sub(r"[ \t]+", " ", allowed), r"[\w'’-]"):
                found.append(f"name '{seq}'")
    return list(dict.fromkeys(found))


def check_no_new_facts(text: str, allowed: str):
    found = new_facts(text, allowed)
    if found:
        return "Do not add facts that are not in the allowed sources: " + ", ".join(found[:8]) + "."
    return None


def _stems(text: str) -> set[str]:
    return {common.stem(w) for w in common.tokens(text)}


def check_heading_vocabulary(text: str, eng_orig: dict, edits: list[dict]):
    """Arm 2: a new heading uses only words of that heading or its section's first paragraph."""
    a = eng_orig["artifacts"]
    for e in edits:
        for hi, h in enumerate(a["headings"]):
            if not (h["start"] < e["end"] and e["start"] < h["end"]) and not (e["start"] == h["start"]):
                continue
            allowed = _stems(h["text"])
            section = next((i for i, s in enumerate(a["sections"]) if s["headingIndex"] == hi), None)
            first = next((p for p in da.prose_paragraphs(eng_orig) if p["sectionIndex"] == section), None)
            if first:
                allowed |= _stems(text[first["start"] : first["end"]])
            extra = [w for w in common.tokens(e["replacement"]) if w not in common.STOPWORDS and common.stem(w) not in allowed]
            if extra:
                return f"The heading may use only words from the heading or its section's first paragraph (not: {', '.join(dict.fromkeys(extra))})."
    return None


def check_query_wording(title: str, text: str, edits: list[dict], query: str):
    """Arm 12: the edits add only query key terms and function words."""
    allowed = _stems(query)
    for e in edits:
        source = (text if e["field"] == "text" else title)[e["start"] : e["end"]]
        added = Counter(common.stem(w) for w in common.tokens(e["replacement"])) - Counter(
            common.stem(w) for w in common.tokens(source))
        raw = {common.stem(w): w for w in common.tokens(e["replacement"])}
        extra = [raw[s] for s in added if s not in allowed and raw[s] not in common.STOPWORDS]
        if extra:
            return f"Add only the query's key terms and function words (not: {', '.join(extra)})."
    return None


# --- 4 ------------------------------------------------------------------------------------------


def _overlaps(r: dict, spans: list[dict]) -> bool:
    return any(s["field"] == "text" and s["start"] < r["end"] and r["start"] < s["end"] for s in spans)


def _rows(text: str, eng: dict) -> Counter:
    rows = Counter()
    for t in eng["artifacts"]["tables"]:
        for i, line in enumerate(text[t["start"] : t["end"]].split("\n")):
            if i != 1:
                rows[re.sub(r"\s+", " ", line.strip())] += 1
    return rows


def check_nothing_removed(arm, orig_text, edited_text, eng_orig, eng_edit, spans):
    ws = lambda s: re.sub(r"\s+", " ", s).strip()  # noqa: E731
    a0, a1 = eng_orig["artifacts"], eng_edit["artifacts"]
    kinds = [
        # A placebo rewords whatever its spans hold, headings included.
        ("heading", [ws(h["text"]) for h in a0["headings"]
                     if not ((arm in HEADING_CONVERTERS or is_placebo(arm)) and _overlaps(h, spans))],
         [ws(h["text"]) for h in a1["headings"]]),
        ("list item", [ws(i["text"]) for l in a0["lists"] for i in l["items"]
                       if not (arm in LIST_CONVERTERS and _overlaps(i, spans))],
         [ws(i["text"]) for l in a1["lists"] for i in l["items"]]),
        ("link", [l["url"] for l in a0["links"]], [l["url"] for l in a1["links"]]),
    ]
    for kind, before, after in kinds:
        missing = Counter(before) - Counter(after)
        if missing:
            return f"Do not remove any {kind} of the original (removed: {', '.join(repr(m) for m in list(missing)[:3])})."
    missing_rows = _rows(orig_text, eng_orig) - _rows(edited_text, eng_edit)
    if missing_rows:
        return f"Do not remove any table row of the original (removed: {list(missing_rows)[0]!r})."
    return None


# --- 5 ------------------------------------------------------------------------------------------


def page_words(version) -> int:
    return common.count_words(f"{version[0]}\n{version[1]}")


def check_length(arm, original, edited, orig_span_texts, new_span_texts):
    """(message or None, added words)."""
    if is_placebo(arm):
        before = sum(common.count_words(t) for t in orig_span_texts)
        after = sum(common.count_words(t) for t in new_span_texts)
        ratio = after / before if before else 1.0
        if not 0.9 - 1e-9 <= ratio <= 1.1 + 1e-9:
            return f"The paraphrase must keep the spans' length within 10% ({before} -> {after} words).", 0
        return None, 0
    w0, w1 = page_words(original), page_words(edited)
    ratio = w1 / w0 if w0 else 1.0
    if arm == "ALL":
        lo, hi = 0.9, 1.6
    elif arm in ADDITIVE:
        lo, hi = 0.0, 1.15
    else:
        lo, hi = 0.95, 1.10
    msg = None
    if not lo - 1e-9 <= ratio <= hi + 1e-9:
        msg = f"The page length went from {w0} to {w1} words ({ratio:.2f}x; allowed {lo:.2f}-{hi:.2f}x)."
    return msg, max(0, w1 - w0) if arm in ADDITIVE else 0


# --- 6 ------------------------------------------------------------------------------------------


# Line-start Markdown block markers: list items ("- ", "* ", "+ ", "1. ", "1) "), headings and
# block quotes, possibly nested. A numbered-list marker is markup, not a content word.
_LINE_MARKERS = re.compile(r"^(?:[ \t]*(?:[-*+>]|#{1,6}|\d+[.)])[ \t]+)+", re.MULTILINE)


def content_words(text: str) -> Counter:
    """Content words with stopwords and Markdown removed (check 6)."""
    text = _LINE_MARKERS.sub("", common.strip_markup(text))
    return Counter(w for w in common.tokens(text) if w not in common.STOPWORDS)


def check_content_words(orig_span_texts, new_span_texts):
    before = content_words("\n".join(orig_span_texts))
    after = content_words("\n".join(new_span_texts))
    total = sum(before.values())
    diff = sum(abs(before[w] - after[w]) for w in set(before) | set(after))
    if total and diff / total > 0.05 + 1e-9:
        return f"Keep the same words when turning prose into a list ({diff} of {total} content words changed)."
    return None


# --- Metrics --------------------------------------------------------------------------------------


def _levenshtein(a: list[str], b: list[str]) -> int:
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    a, b = a[i:], b[i:]
    j = 0
    while j < min(len(a), len(b)) and a[-1 - j] == b[-1 - j]:
        j += 1
    a, b = a[: len(a) - j], b[: len(b) - j]
    prev = list(range(len(b) + 1))
    for x, ca in enumerate(a, start=1):
        cur = [x] + [0] * len(b)
        for y, cb in enumerate(b, start=1):
            cur[y] = min(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + (ca != cb))
        prev = cur
    return prev[-1]


def metrics(query: str, original, edited) -> dict:
    """Word-level edit distance, length ratio (words) and change in query key-term count."""
    terms = common.content_terms(query)
    full0, full1 = f"{original[0]}\n{original[1]}", f"{edited[0]}\n{edited[1]}"
    w0 = page_words(original)
    return {
        "edit_distance": _levenshtein(common.word_list(full0), common.word_list(full1)),
        "length_ratio": page_words(edited) / w0 if w0 else 1.0,
        "key_terms_delta": common.key_term_count(terms, full1) - common.key_term_count(terms, full0),
    }


# --- All checks for one edit ------------------------------------------------------------------------


def validate(arm, original, edited, edits, spans, eng_orig, eng_edit, query, target, donor, step=False):
    """Runs the checks that apply to `arm` and returns {valid, failures, added_words}.

    `original` and `edited` are (title, text); for an ALL step, `original` is the step's input
    and `step=True` (checks 1-4 and 6; length is checked once on the whole ALL version).
    `target` is the unedited target page (title, text), the reference for check 3.
    """
    placebo = is_placebo(arm)
    a = base_arm(arm)
    failures = []

    def add(msg):
        if msg:
            failures.append(msg)

    orig_spans = [(original[1] if e["field"] == "text" else original[0])[e["start"] : e["end"]] for e in edits]
    new_spans = [e["replacement"] for e in edits]
    add(check_outside_spans(original[1], edited[1], original[0], edited[0], edits, spans,
                            insert_only=a in INSERT_ONLY and not placebo))
    if placebo:
        if not edits:  # an unchanged "paraphrase" would make A - P_A the same as A - original
            add("Reword the spans: the answer left every span unchanged.")
        add(check_placebo(eng_orig, eng_edit, query, orig_spans, new_spans))
    else:
        add(check_own_feature(a, eng_orig, eng_edit, query, original, edited,
                              donor=donor if a in DONOR_ARMS else None, edits=edits))
    allowed = corpus(target, donor=None if placebo or a not in DONOR_ARMS else donor,
                     query=None if placebo or a not in QUERY_ARMS else query)
    if step:  # an ALL step may keep what earlier steps added (the query heading, a donor figure)
        allowed += f"\n{original[0]}\n{original[1]}"
    add(check_no_new_facts(f"{edited[0]}\n{edited[1]}", allowed))
    if arm == "2":
        add(check_heading_vocabulary(original[1], eng_orig, edits))
    if arm == "12":
        add(check_query_wording(original[0], original[1], edits, query))
    add(check_nothing_removed(arm, original[1], edited[1], eng_orig, eng_edit, spans))
    added = 0
    if not step:
        msg, added = check_length(arm, original, edited, orig_spans, new_spans)
        add(msg)
    if arm == "3":
        add(check_content_words(orig_spans, new_spans))
    return {"valid": not failures, "failures": failures, "added_words": added}


def validate_all(original, edited, query, target, donor):
    """The whole ALL version against the original: checks 3 and 5 (each step passed 1-4 and 6)."""
    failures = []
    msg = check_no_new_facts(f"{edited[0]}\n{edited[1]}", corpus(target, donor=donor, query=query))
    if msg:
        failures.append(msg)
    msg, _ = check_length("ALL", original, edited, [], [])
    if msg:
        failures.append(msg)
    return {"valid": not failures, "failures": failures, "added_words": 0}
