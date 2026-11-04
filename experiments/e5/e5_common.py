"""Shared pieces of the E5 build (experiments/PLAN_E5.md r2): paths, the two pinned bundles, the
questions bridge, the edit-text rules and the E5 sets.

- Applicability, spans and every validation run on E1's engine bundle,
  experiments/e1/out/bundle/engine_cli.js, unchanged: `engine()` refuses to run unless its sha256
  is ENGINE_SHA256 (E1's bundle, built 2026-10-24). E5 never rebuilds it.
- keywordQuestion, pageQuestions and the tool's own coverage view run on the questions bridge,
  experiments/e5/out/bundle/questions_cli.js, built once from the commit named in bundles.json;
  `questions()` refuses a bundle whose sha256 is not the one recorded there.

Plain Python 3.10+, no third-party imports (runs locally with python3 -I and on Explorer).
"""

from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

E5_DIR = Path(__file__).resolve().parent
EXPERIMENTS = E5_DIR.parent
E1_DIR = EXPERIMENTS / "e1"
E2_DIR = EXPERIMENTS / "e2"
E3_DIR = EXPERIMENTS / "e3"
DATA = E5_DIR / "data"
sys.path.insert(0, str(E1_DIR))

import common  # noqa: E402
from e1_common import write_json  # noqa: E402,F401

BUNDLES_FILE = E5_DIR / "bundles.json"
ENGINE_SHA256 = "1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47"
ENGINE_BUNDLE = E1_DIR / "out" / "bundle" / "engine_cli.js"
QUESTIONS_BUNDLE = E5_DIR / "out" / "bundle" / "questions_cli.js"

# E5's two sets and the strata of the main set (PLAN_E5 "Query sets"). Versions, prompts and cells
# keep the page's own set (E1's "main" for E1's queries, E3's "e3" and "e3-four", "replication").
E5_SETS = ["main", "replication"]
STRATUM = {"main": "e1", "e3": "e3", "e3-four": "e3-four", "replication": "replication"}
E5_SET_OF = {"main": "main", "e3": "main", "e3-four": "main", "replication": "replication"}
PAGE_SETS = list(STRATUM)
NEW_STRATA = ("e3", "e3-four")

COVERED = 0.9  # E1's rule: a check scoring 0.9 or more needs no edit


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def bundles() -> dict:
    return json.loads(BUNDLES_FILE.read_text(encoding="utf-8"))


EARLIER = ("e1", "e2", "e3")


def foreign_data(path: str | Path) -> str | None:
    """Why `path` is an earlier experiment's data folder (E5 must never write there), or None.

    Refused: E1's, E2's and E3's code-relative folders (experiments/e1/data here, code/e1/data on
    the cluster) and anything inside them, and the cluster layout's $CE_ROOT/data/e1, data/e2,
    data/e3 (and their subfolders, such as data/e3/new)."""
    p = Path(path).resolve()
    for d in (E1_DIR / "data", E2_DIR / "data", E3_DIR / "data"):
        if p == d.resolve() or d.resolve() in p.parents:
            return f"{path} is {d.parent.name.upper()}'s data folder"
    for a in (p, *p.parents):
        if a.name == "data" and a.parent.name in EARLIER:
            return f"{path} is inside {a} (an earlier experiment's code-relative data folder)"
        if a.name in EARLIER and a.parent.name == "data":
            return f"{path} is inside {a} (an earlier experiment's data folder)"
    return None


def refuse_foreign_data(path: str | Path, ap=None) -> None:
    """Stops (argparse error when `ap` is given) when `path` is an earlier experiment's data folder."""
    why = foreign_data(path)
    if why:
        msg = f"--data: {why}; E5 writes only to its own folder (experiments/e5/data, $CE_ROOT/data/e5)"
        if ap is not None:
            ap.error(msg)
        raise SystemExit(msg)


# --- E1's engine, pinned ----------------------------------------------------------------------


def node() -> str:
    """The Node binary: $CE_NODE (E1's local.env, optional) or node on the PATH."""
    return os.environ.get("CE_NODE") or "node"


def with_node(cmd: list[str]) -> list[str]:
    """A command whose first word is the .js bundle itself (an unset $CE_NODE in
    `E1_ENGINE="$CE_NODE .../engine_cli.js"`) gets the Node binary in front, so it never tries to
    execute the .js file."""
    return [node(), *cmd] if cmd and cmd[0].endswith(".js") else cmd


def engine_command() -> list[str]:
    """$E1_ENGINE (split as a shell would) or node on E1's bundle."""
    env = os.environ.get("E1_ENGINE")
    return with_node(shlex.split(env)) if env else [node(), str(ENGINE_BUNDLE)]


def bundle_path(cmd: list[str]) -> Path:
    js = [c for c in cmd if c.endswith(".js")]
    if len(js) != 1:
        raise SystemExit(f"E5: cannot find the engine bundle in the engine command {cmd}; "
                         "E5 runs only on E1's experiments/e1/out/bundle/engine_cli.js")
    return Path(js[0])


def check_engine_pin(cmd: list[str] | None = None) -> list[str]:
    """The engine command, after checking that it runs E1's bundle byte for byte (exit otherwise)."""
    cmd = cmd or engine_command()
    path = bundle_path(cmd)
    if not path.exists():
        raise SystemExit(f"E5: engine bundle {path} is missing (copy E1's; never rebuild it)")
    digest = sha256_file(path)
    if digest != ENGINE_SHA256:
        raise SystemExit(f"E5: engine bundle {path} has sha256 {digest}, not E1's {ENGINE_SHA256}; "
                         "E5 runs only on E1's bundle (never rebuild it, never run smoke.sh)")
    return cmd


def engine(items: list[dict]) -> dict[str, dict]:
    """common.run_engine on E1's pinned bundle."""
    return common.run_engine(items, check_engine_pin())


# --- The questions bridge -----------------------------------------------------------------------


def questions_command() -> list[str]:
    env = os.environ.get("E5_QUESTIONS")
    return with_node(shlex.split(env)) if env else [node(), str(QUESTIONS_BUNDLE)]


def check_questions_pin(cmd: list[str] | None = None) -> list[str]:
    cmd = cmd or questions_command()
    path = bundle_path(cmd)
    want = bundles()["questions_cli"]["sha256"]
    if not path.exists():
        raise SystemExit(f"E5: questions bridge {path} is missing; build it from commit "
                         f"{bundles()['questions_cli']['commit']} (README) or copy it")
    digest = sha256_file(path)
    if digest != want:
        raise SystemExit(f"E5: questions bridge {path} has sha256 {digest}, not the frozen {want}")
    return cmd


def questions(items: list[dict], cmd: list[str] | None = None) -> dict[str, dict]:
    """Runs the questions bridge on [{id, keyword?, markdown?, question?}] and returns {id: row}."""
    if not items:
        return {}
    cmd = check_questions_pin(cmd)
    payload = "".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items)
    proc = subprocess.run(cmd, input=payload.encode("utf-8"), capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"questions_cli failed ({proc.returncode}): "
                           f"{proc.stderr.decode('utf-8', 'replace')[-2000:]}")
    out = {}
    for line in proc.stdout.decode("utf-8").split("\n"):
        if line.strip():
            row = json.loads(line)
            out[row["id"]] = row
    missing = [i["id"] for i in items if i["id"] not in out]
    if missing:
        raise RuntimeError(f"questions_cli returned no result for {len(missing)} items, e.g. {missing[:3]}")
    return out


def tool_covered(cov: dict) -> bool:
    """The tool's view (current engine): the page covers the question (question-coverage >= 0.9)."""
    return bool(cov["applicable"]) and cov["score"] >= COVERED


# --- Edit-text rules (PLAN_E5 "The edit texts") -----------------------------------------------


def content_words(query: str) -> list[str]:
    """The words common.content_terms stems: lowercased, stopwords dropped (all words if none is left)."""
    words = common.tokens(query)
    return [w for w in words if w not in common.STOPWORDS] or words


def surface(query: str) -> dict[str, str]:
    """{key term: q's own surface word for it (its first occurrence, lowercased)}."""
    out: dict[str, str] = {}
    for w in content_words(query):
        out.setdefault(common.stem(w), w)
    return out


def page_pool_df(pages: list[dict]) -> tuple[dict[str, int], int]:
    """Document frequency of every stemmed term over a page pool: each distinct normalized text
    (by sha256) counted once, text only. Returns (df, pool size)."""
    seen: set[str] = set()
    df: dict[str, int] = {}
    for p in pages:
        digest = common.sha256_text(p["text"])
        if digest in seen:
            continue
        seen.add(digest)
        for t in {common.stem(w) for w in common.tokens(p["text"])}:
            df[t] = df.get(t, 0) + 1
    return df, len(seen)


def keyword_terms(query: str, df: dict[str, int]) -> list[str]:
    """k's terms: the two key terms of q in the fewest pool pages, in q's order; ties go to the
    term that comes first in q; one or two key terms are all kept."""
    terms = common.content_terms(query)
    if len(terms) <= 2:
        return list(terms)
    rank = sorted(range(len(terms)), key=lambda i: (df.get(terms[i], 0), i))[:2]
    return [terms[i] for i in sorted(rank)]


def keyword(query: str, df: dict[str, int]) -> str:
    forms = surface(query)
    return " ".join(forms[t] for t in keyword_terms(query, df))


def text_9a(query: str) -> str:
    """9A's text: every key term of q as q writes it (first surface word, lowercased), q's order."""
    forms = surface(query)
    return " ".join(forms[t] for t in common.content_terms(query))


def titled_markdown(title: str, text: str) -> str:
    """The page the way the workspace sees a draft with a title: '# <title>', a blank line, the
    text; the text alone when there is no title (C-SEO)."""
    return f"# {title.strip()}\n\n{text}" if title and title.strip() else text


def first_h2(eng: dict) -> str | None:
    """The page's existing first H2 (E1's engine artifacts), or None."""
    for h in eng["artifacts"]["headings"]:
        if h["depth"] == 2:
            return h["text"]
    return None


def loose(s: str | None) -> str:
    """A text compared ignoring case, runs of spaces and a final question mark."""
    return " ".join((s or "").lower().rstrip().rstrip("?").split())


def is_q(x: str | None, query: str) -> bool | None:
    """The edit text is the query itself, ignoring case, spaces and a final '?' (then a 9K, 9A, 9G
    or 9L version makes arm 9's edit, up to the heading's case). None when there is no edit text."""
    return None if x is None else loose(x) == loose(query)


def same_as_first_h2(x: str, eng: dict) -> bool:
    h = first_h2(eng)
    return h is not None and h.strip().lower() == x.strip().lower()


def query_order(query_id: str) -> str:
    """E5's batch order (PLAN_E5 "Runs and compute", stats S7d): sha256 of the query id."""
    return hashlib.sha256(query_id.encode("utf-8")).hexdigest()
