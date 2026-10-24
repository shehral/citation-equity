"""Shared helpers for the E1 data and editing pipeline (experiments/PREREG_E1.md, r2).

Everything here is plain Python 3.10+ with no third-party imports, so it runs locally with
`python3 -I` and on Explorer in the monitors env.

Offsets: every range in this pipeline is a pair of Python string (code point) offsets, end
exclusive. The engine bridge (engine_cli.ts) converts the engine's UTF-16 offsets before they
reach Python.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

E1_DIR = Path(__file__).resolve().parent
DATA = E1_DIR / "data"
PROMPTS_DIR = E1_DIR / "prompts"

# --- JSONL ---------------------------------------------------------------------------------


def read_jsonl(path: str | Path) -> list[dict]:
    """Objects from a JSONL file; lines end at "\\n" only (see batch_generate.read_prompts)."""
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").split("\n"), start=1):
        line = line.removesuffix("\r")
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as err:
            raise ValueError(f"{path} line {number} is not valid JSON ({err.msg})") from err
    return rows


def write_jsonl(path: str | Path, rows) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha_index(key: str, m: int) -> int:
    """PREREG_E1 Data 7: int(sha256(key.encode("utf-8")).hexdigest(), 16) mod m."""
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % m


# --- Key terms: a twin of the engine's contentTerms (packages/engine/src/checks/question-coverage.ts)

STOPWORDS = frozenset(
    (
        "a an the and or but if then so of to in on at by for from with about into over under "
        "as than that this these those there here it its is are was were be been being am "
        "do does did done doing have has had having can could should would will shall may might "
        "must i me my we our us you your he him his she her they them their what which who whom "
        "whose when where why how not no yes s t d ll re ve m don doesn didn isn aren wasn weren "
        "any some all each every much many more most very just also too get got"
    ).split()
)

# [\p{L}\p{N}]+ in the engine; in Python, [^\W_] is a letter or a number.
_TOKEN = re.compile(r"[^\W_]+")


def tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _has_vowel(w: str) -> bool:
    return re.search(r"[aeiouy]", w) is not None


def stem(word: str) -> str:
    """The engine's light suffix stemmer, rule for rule."""
    w = word
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if w.endswith("ing") and _has_vowel(w[:-3]):
        w = w[:-3]
    elif w.endswith("ed") and not w.endswith("eed") and _has_vowel(w[:-2]):
        w = w[:-2]
    elif re.search(r"(?:ch|sh|x|z|ss)es$", w):
        w = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not re.search(r"(?:ss|us|is)$", w):
        w = w[:-1]
    if len(w) > 3 and re.search(r"([b-df-hj-np-tv-z])\1$", w) and not re.search(r"(?:ll|ss|zz)$", w):
        w = w[:-1]
    if len(w) > 2 and w.endswith("e"):
        w = w[:-1]
    return w


def content_terms(text: str) -> list[str]:
    """A query's key terms in first-seen order: stopwords dropped, stemmed (engine twin)."""
    words = tokens(text)
    content = [w for w in words if w not in STOPWORDS] or words
    out: list[str] = []
    for w in content:
        s = stem(w)
        if s not in out:
            out.append(s)
    return out


def terms_present(terms, text: str) -> set[str]:
    present = {stem(w) for w in tokens(text)}
    return {t for t in terms if t in present}


def term_share(terms, text: str) -> float:
    terms = list(terms)
    return 0.0 if not terms else len(terms_present(terms, text)) / len(terms)


def key_term_count(terms, text: str) -> int:
    """Occurrences of any key term in `text` (every hit counts)."""
    wanted = set(terms)
    return sum(1 for w in tokens(text) if stem(w) in wanted)


# --- Words -------------------------------------------------------------------------------------

_DEST = r"(?:[^()\s]|\([^()\s]*\))*"  # a link destination, balanced parentheses allowed
_LINK_DEST = re.compile(rf"\]\({_DEST}(?:\s+\"[^\"]*\")?\)")
_IMAGE = re.compile(rf"!\[[^\]]*\]\({_DEST}(?:\s+\"[^\"]*\")?\)")
_BARE_URL = re.compile(r"https?://\S+")
_WORD = re.compile(r"[^\W_]+(?:(?:['’]|(?<=\d)[.,](?=\d))[^\W_]+)*")


def strip_markup(text: str) -> str:
    """Text with images, link destinations and bare URLs removed (for counting words)."""
    text = _IMAGE.sub(" ", text)
    text = _LINK_DEST.sub("]", text)
    return _BARE_URL.sub(" ", text)


def count_words(text: str) -> int:
    """Words in Markdown: letter/digit runs (an apostrophe, or a point or comma between digits,
    joins), with markup and URLs excluded. An approximation of the engine's Intl.Segmenter count.
    """
    return len(_WORD.findall(strip_markup(text)))


def word_list(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(strip_markup(text))]


# --- Sentence starts (for the capitalized-sequence rule) ----------------------------------------

_BLOCK_MARKER = re.compile(r"(?:[ \t]*(?:#{1,6}|[-*+>]|\d+[.)]|\|)[ \t]+|[ \t]*\|)*[ \t]*")


def starts_sentence(text: str, pos: int) -> bool:
    """True when `pos` opens a sentence: text or line start (after Markdown block markers),
    or after ., ! or ? (with closing quotes or brackets) and whitespace."""
    before = text[:pos]
    line = before[before.rfind("\n") + 1 :]
    if _BLOCK_MARKER.fullmatch(line):
        return True
    return re.search(r"[.!?:][\"'”’)\]]*\s+[\"'“‘(]*$", before) is not None


# --- The engine bridge ----------------------------------------------------------------------------

DEFAULT_ENGINE = ["node", str(E1_DIR / "out" / "bundle" / "engine_cli.js")]


def engine_command() -> list[str]:
    """The command that runs engine_cli: $E1_ENGINE (split on spaces) or the built bundle."""
    env = os.environ.get("E1_ENGINE")
    return env.split() if env else list(DEFAULT_ENGINE)


def run_engine(items: list[dict], cmd: list[str] | None = None) -> dict[str, dict]:
    """Runs the engine on [{id, markdown, question}] and returns {id: result}.

    The result holds `checks` ({checkId: {applicable, score, metrics, findings, suggestions}}),
    `artifacts` (headings, sections, paragraphs with sentences, lists, tables, links) and
    `wordCount`, all offsets in code points.
    """
    if not items:
        return {}
    payload = "".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items)
    proc = subprocess.run(cmd or engine_command(), input=payload.encode("utf-8"), capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"engine_cli failed ({proc.returncode}): {proc.stderr.decode('utf-8', 'replace')[-2000:]}")
    out = {}
    for line in proc.stdout.decode("utf-8").split("\n"):
        if line.strip():
            row = json.loads(line)
            out[row["id"]] = row
    missing = [i["id"] for i in items if i["id"] not in out]
    if missing:
        raise RuntimeError(f"engine_cli returned no result for {len(missing)} items, e.g. {missing[:3]}")
    return out
