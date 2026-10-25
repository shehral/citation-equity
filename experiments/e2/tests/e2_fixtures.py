"""Hand-made E1-shaped inputs for the E2 tests (experiments/PLAN_E2.md). All text is written for
this project; nothing comes from GEO-bench or C-SEO Bench.

`e1_data(folder)` writes pages.jsonl, versions.jsonl (original and arm 9), applicability.jsonl and
engine_original.jsonl (the tests' fake engine) the way E1's pipeline lays them out.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

E2 = Path(__file__).resolve().parents[1]
E1 = E2.parent / "e1"
for p in (E1, E1 / "tests"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import deterministic_arms as da  # noqa: E402
import validate  # noqa: E402
from helpers import fake_engine  # noqa: E402

# query_id: (set, query)
QUERIES = {
    "m1": ("main", "what is espresso extraction"),
    "m2": ("main", "why does bread dough rise"),
    "m3": ("main", "how do ferries dock"),  # its arm 9 is invalid in E1
    "r1": ("replication", "what is a tide pool"),
    "t1": ("timing", "what is cold brew"),  # never part of E2
}
TEXTS = {
    "m1": ("# Espresso guide\n\nCoffee is brewed daily by many people here. Espresso extraction pulls flavor. "
           "Water boils quite fast.\n\n## Grind\n\nA fine grind slows the water."),
    "m2": ("Bakers knead for ten minutes. Yeast makes dough rise by releasing a little gas. Ovens vary. Most home kitchens stay warm enough for this in summer.\n\n"
           "## Proofing\n\nWarm rooms help."),
    "m3": "Ferries dock at piers. Ropes hold them.",
    "r1": "Tide pools form on rocky shores. Crabs hide there. The sea returns to the pools twice every day.",
    "t1": "Cold brew steeps for hours. It is smooth.",
}


def _page(qid: str, i: int, role: str) -> dict:
    set_name, query = QUERIES[qid]
    text = TEXTS[qid] if role == "target" else f"Page {i} about {query}. It has a short note."
    return {"page_id": f"{qid}-p{i}", "query_id": qid, "set": set_name, "query": query,
            "url": f"https://example.org/{qid}/{i}", "source": "sample", "title": f"{qid} page {i}",
            "text": text, "words": len(text.split()), "tokens_max": 2 * len(text.split()), "cut": False,
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "role": role}


def pages() -> list[dict]:
    roles = {1: "target", 2: "competitor", 3: "donor", 4: "competitor", 5: "competitor"}
    return [_page(q, i, r) for q in QUERIES for i, r in roles.items()]


def _row(page: dict, arm: str, text: str, valid=True, reason=None) -> dict:
    original = (page["title"], page["text"])
    return {"version_id": f"{page['query_id']}:{arm}", "query_id": page["query_id"], "set": page["set"],
            "arm": arm, "text": text, "title": page["title"], "valid": valid, "attempts": 1,
            "excluded_reason": reason, **validate.metrics(page["query"], original, (page["title"], text)),
            "added_words": 0, "skipped_steps": []}


def versions() -> list[dict]:
    rows = []
    for p in pages():
        if p["role"] != "target":
            continue
        rows.append(_row(p, "original", p["text"]))
        edits, _ = da.arm9(p["text"], fake_engine(p["text"]), p["query"])
        text = validate.splice(p["text"], edits)
        if p["query_id"] == "m3":
            rows.append(_row(p, "9", text, valid=False, reason="invalid: test exclusion"))
        else:
            rows.append(_row(p, "9", text))
    return rows


def applicability() -> list[dict]:
    return [{"query_id": q, "arm": a, "applicable": True, "reason": None} for q in QUERIES for a in ("9", "12", "ALL")]


def engine_rows() -> list[dict]:
    return [{"id": p["page_id"], **fake_engine(p["text"])} for p in pages() if p["role"] == "target"]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def e1_data(folder: Path, with_engine: bool = True) -> None:
    write_jsonl(folder / "pages.jsonl", pages())
    write_jsonl(folder / "versions.jsonl", versions())
    write_jsonl(folder / "applicability.jsonl", applicability())
    if with_engine:
        write_jsonl(folder / "engine_original.jsonl", engine_rows())


def fake_run_engine(items: list[dict]) -> dict[str, dict]:
    """common.run_engine's shape, from the tests' fake engine."""
    return {i["id"]: {"id": i["id"], **fake_engine(i["markdown"])} for i in items}
