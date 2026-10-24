"""E1 query admission and roles (PREREG_E1.md, Data 6-7 and the replication and smoke sets).

Reads candidates.jsonl (normalize.py) and writes pages.jsonl, the shared page interface:
{page_id, query_id, set, query, url, source, title, text, words, tokens_max, cut, sha256, role},
plus admission.json with the counts behind each admission decision.

Roles: the target is index int(sha256(query.encode("utf-8")).hexdigest(), 16) mod m over the
query's usable pages in source order, leaving en.wikipedia.org pages out of the draw whenever
another usable page exists. The donor is the same rule on query + "|donor" over the remaining
pages (only when 5 pages are usable). The other 3 pages are competitors.

Usage: python3 -I draw.py [--candidates data/candidates.jsonl] [--out data/pages.jsonl]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402

MAIN_TARGET, MAIN_FLOOR, REPLICATION_N = 80, 60, 60
FALLBACK_SPLITS = ("test", "val")
FALLBACK_HOURS = 6
PAGE_KEYS = ("query_id", "set", "query", "url", "source", "title", "text", "words", "tokens_max", "cut", "sha256")


def _is_wikipedia(p: dict) -> bool:
    return (urlsplit(p.get("url") or "").hostname or "").lower() == "en.wikipedia.org"


def _draw(key: str, pages: list[int], all_pages: list[dict]) -> int:
    pool = [i for i in pages if not _is_wikipedia(all_pages[i])] or pages
    return pool[common.sha_index(key, len(pool))]


def assign_roles(query: str, pages: list[dict]) -> list[str]:
    """Roles for a query's usable pages (given in source order)."""
    idx = list(range(len(pages)))
    roles = ["competitor"] * len(pages)
    target = _draw(query, idx, pages)
    roles[target] = "target"
    if len(pages) == 5:
        roles[_draw(query + "|donor", [i for i in idx if i != target], pages)] = "donor"
    return roles


def _grouped(rows: list[dict]) -> list[tuple[str, list[dict]]]:
    """(query_id, rows in source order), queries in dataset order."""
    groups: dict[str, list[dict]] = {}
    for r in sorted(rows, key=lambda r: (r["order"], r["url_index"])):
        groups.setdefault(r["query_id"], []).append(r)
    return list(groups.items())


def _usable(pages: list[dict]) -> list[dict]:
    return [p for p in pages if p["usable"]]


def _time(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def admit_main(rows: list[dict], target: int = MAIN_TARGET, floor: int = MAIN_FLOOR):
    """Data 6: five-page queries in dataset order, up to `target`. If fewer than `floor` five-page
    queries were found within the test and val splits and the first 6 hours of fetching, queries
    with 4 usable pages are admitted too, in dataset order."""
    groups = _grouped(rows)
    times = [t for r in rows if (t := _time(r.get("fetched_at"))) is not None]
    start = min(times) if times else None

    def in_window(pages: list[dict]) -> bool:
        first = min((t for p in pages if (t := _time(p.get("fetched_at"))) is not None), default=None)
        in_time = start is None or first is None or first <= start + timedelta(hours=FALLBACK_HOURS)
        return pages[0]["split"] in FALLBACK_SPLITS and in_time

    five = [(q, _usable(p)) for q, p in groups if len(_usable(p)) == 5]
    window = sum(1 for q, p in groups if len(_usable(p)) == 5 and in_window(p))
    fallback = window < floor
    if fallback:
        admitted = [(q, _usable(p)) for q, p in groups if len(_usable(p)) >= 4][:target]
    else:
        admitted = five[:target]
    summary = {"queries_seen": len(groups), "five_page": len(five), "five_page_in_window": window,
               "fallback": fallback, "admitted": len(admitted), "target": target, "floor": floor,
               "four_page_admitted": sum(1 for _, p in admitted if len(p) == 4),
               "below_floor": len(admitted) < floor}
    return admitted, summary


def admit_all_five(rows: list[dict], limit: int) -> list[tuple[str, list[dict]]]:
    """The first `limit` queries in dataset order whose 5 pages are all usable."""
    return [(q, p) for q, p in _grouped(rows) if len(p) == 5 and len(_usable(p)) == 5][:limit]


def page_rows(qid: str, pages: list[dict]) -> list[dict]:
    """pages.jsonl rows for one admitted query (its usable pages, in source order)."""
    roles = assign_roles(pages[0]["query"], pages)
    return [{"page_id": f"{qid}-p{p['url_index']}", **{k: p[k] for k in PAGE_KEYS}, "role": role}
            for p, role in zip(pages, roles)]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--candidates", action="append", help="candidates JSONL (repeatable)")
    ap.add_argument("--out", default=str(common.DATA / "pages.jsonl"))
    ap.add_argument("--summary", default=str(common.DATA / "admission.json"))
    ap.add_argument("--target", type=int, default=MAIN_TARGET)
    ap.add_argument("--floor", type=int, default=MAIN_FLOOR)
    ap.add_argument("--replication", type=int, default=REPLICATION_N)
    args = ap.parse_args(argv)

    paths = args.candidates or [str(common.DATA / "candidates.jsonl")]
    rows = [r for p in paths for r in common.read_jsonl(p)]
    by_set = {s: [r for r in rows if r["set"] == s] for s in ("main", "replication", "smoke")}
    out, summary = [], {}
    if by_set["main"]:
        admitted, summary["main"] = admit_main(by_set["main"], args.target, args.floor)
        out += [r for q, p in admitted for r in page_rows(q, p)]
    if by_set["replication"]:
        admitted = admit_all_five(by_set["replication"], args.replication)
        summary["replication"] = {"admitted": len(admitted), "limit": args.replication}
        out += [r for q, p in admitted for r in page_rows(q, p)]
    if by_set["smoke"]:
        admitted = [(q, p) for q, p in _grouped(by_set["smoke"])]
        summary["smoke"] = {"admitted": len(admitted)}
        out += [r for q, p in admitted for r in page_rows(q, p)]
    common.write_jsonl(args.out, out)
    Path(args.summary).write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
