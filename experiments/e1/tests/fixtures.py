"""Hand-made E1 fixtures in the shared JSONL formats (Task 20a writes the real files).

Four synthetic smoke queries, each with a target, a donor and three competitors, and a set of
edited versions. All text is written for this project.

Run: python3 -I experiments/e1/tests/fixtures.py <data dir>   (writes pages, versions, applicability)
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

QUERIES = {
    "s1": "Why does my espresso taste bitter?",
    "s2": "How to fix sour espresso shots?",
    "s3": "What is retrieval-augmented generation?",
    "s4": "Difference between RAG and fine-tuning?",
}

# Arms each fixture query gets a version for (besides the original).
FIXTURE_ARMS = ["1", "2", "P2", "4", "5", "P5", "9", "11", "ALL", "P_ALL"]


def _page(query_id: str, i: int, role: str, title: str, text: str) -> dict:
    return {
        "page_id": f"{query_id}-p{i}",
        "query_id": query_id,
        "set": "smoke",
        "query": QUERIES[query_id],
        "url": f"https://example.org/{query_id}/{i}" if i != 2 else f"https://en.wikipedia.org/wiki/{query_id}",
        "source": "wayback" if i == 4 else "sample",
        "title": title,
        "text": text,
        "words": len(text.split()),
        "tokens_max": len(text.split()) * 2,
        "cut": False,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "role": role,
    }


def pages() -> list[dict]:
    rows = []
    for qid, query in QUERIES.items():
        topic = query.rstrip("?")
        roles = {1: "target", 2: "competitor", 3: "donor", 4: "competitor", 5: "competitor"}
        for i, role in roles.items():
            text = (
                f"# {topic} (page {i})\n\n"
                f"This page answers: {topic.lower()}. It covers the main causes, with notes from page {i}.\n\n"
                f"## Details\n\nA second paragraph about {topic.lower()} with a figure of {10 * i}% and a tip.\n"
            )
            rows.append(_page(qid, i, role, f"{topic} - page {i}", text))
    return rows


def versions() -> list[dict]:
    rows = []
    for page in pages():
        if page["role"] != "target":
            continue
        qid = page["query_id"]
        rows.append(_version(qid, "original", page["title"], page["text"]))
        for arm in FIXTURE_ARMS:
            text = page["text"] + f"\n\nEdited for arm {arm}.\n"
            row = _version(qid, arm, page["title"], text)
            if qid == "s2" and arm == "5":
                row |= {"valid": False, "attempts": 2, "excluded_reason": "check 3: new number"}
            rows.append(row)
    return rows


def _version(qid: str, arm: str, title: str, text: str) -> dict:
    return {
        "version_id": f"{qid}:{arm}",
        "query_id": qid,
        "arm": arm,
        "text": text,
        "title": title,
        "valid": True,
        "attempts": 1,
        "excluded_reason": None,
        "edit_distance": 0 if arm == "original" else 20,
        "length_ratio": 1.0 if arm == "original" else 1.04,
        "key_terms_delta": 0 if arm == "original" else 1,
    }


def applicability() -> list[dict]:
    rows = []
    for qid in QUERIES:
        for arm in [str(a) for a in range(1, 15)]:
            applicable = arm in FIXTURE_ARMS and not (qid == "s4" and arm == "11")
            rows.append({"query_id": qid, "arm": arm, "applicable": applicable,
                         "reason": "fixture" if applicable else "fixture: not applicable"})
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def write_fixture(data_dir: Path) -> None:
    """Writes pages.jsonl, versions.jsonl and applicability.jsonl; s4's arm-11 version is not applicable."""
    vs = [v for v in versions() if v["version_id"] != "s4:11"]
    write_jsonl(data_dir / "pages.jsonl", pages())
    write_jsonl(data_dir / "versions.jsonl", vs)
    write_jsonl(data_dir / "applicability.jsonl", applicability())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: fixtures.py <data dir>")
    write_fixture(Path(sys.argv[1]))
