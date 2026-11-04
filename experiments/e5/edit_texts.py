"""E5's edit texts (experiments/PLAN_E5.md r2, "The edit texts"), computed from the query, the page
pool and the original page only, before any E5 answer exists.

One row per (set, query) in data/edit_texts.jsonl:
{query_id, set ('main'|'replication'), stratum ('e1'|'e3'|'e3-four'|'replication'), query,
 key_terms, n_key_terms, k, k_terms, q_prime, template, text_9A, q_G, q_G_origin, q_L, q_L_status}

- key_terms: K(q) = E1's common.content_terms(q) (stemmed, q's order).
- k: the two key terms in the fewest pages of the set's page pool (q's order; ties to the term
  that comes first in q; one or two key terms are all kept), written as q's own surface word for
  each (first occurrence, lowercased). The pool is the pages.jsonl rows of the set's admitted
  queries (main: E1 main, E3 e3 and e3-four; replication: E1's replication rows), the timing query
  excluded, text only, each distinct normalized text (by sha256) counted once.
- q_prime, template: the tool's keywordQuestion(k) on the questions bridge (k as returned,
  lowercase, when no template fits: template 'kept').
- text_9A: every key term as q writes it, in q's order, single spaces, no stopwords.
- q_G, q_G_origin: the first of the engine's pageQuestions on '# <title>', a blank line and the
  text (the text alone when the title is empty, as on C-SEO); null when the list is empty.
- q_L: null and q_L_status 'pending' until the edit job writes it (make_versions.py ql).

Also writes data/pages.jsonl (the E5 page set: E1's main and replication rows and E3's e3 and
e3-four rows, the timing query left out) and data/edit_texts.json (counts and the sha256 of the
jsonl; the table's hash is part of the freeze).

Usage: python3 -I experiments/e5/edit_texts.py [--e1-data experiments/e1/data]
           [--e3-data experiments/e3/data] [--data experiments/e5/data]
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

E1_SETS = ("main", "replication")
E3_SETS = ("e3", "e3-four")
FIELDS = ["query_id", "set", "stratum", "query", "key_terms", "n_key_terms", "k", "k_terms", "q_prime",
          "template", "text_9A", "q_G", "q_G_origin", "q_L", "q_L_status"]


def e5_pages(e1_pages: list[dict], e3_pages: list[dict]) -> list[dict]:
    """E5's pages: E1's main and replication rows, then E3's e3 and e3-four rows (timing left out)."""
    pages = [p for p in e1_pages if p["set"] in E1_SETS] + [p for p in e3_pages if p["set"] in E3_SETS]
    ids = [p["page_id"] for p in pages]
    if len(set(ids)) != len(ids):
        raise ValueError("a page_id occurs twice across E1's and E3's pages")
    return pages


def build(pages: list[dict], questions=None) -> tuple[list[dict], dict]:
    """(rows, summary) for every target query of `pages` (E5's page set)."""
    questions = questions or e5.questions
    pools: dict[str, list[dict]] = {s: [] for s in e5.E5_SETS}
    for p in pages:
        pools[e5.E5_SET_OF[p["set"]]].append(p)
    dfs = {s: e5.page_pool_df(pools[s]) for s in e5.E5_SETS}
    targets = [p for p in pages if p["role"] == "target"]
    rows = []
    for t in targets:
        e5_set = e5.E5_SET_OF[t["set"]]
        q = t["query"]
        df = dfs[e5_set][0]
        terms = common.content_terms(q)
        rows.append({"query_id": t["query_id"], "set": e5_set, "stratum": e5.STRATUM[t["set"]], "query": q,
                     "key_terms": terms, "n_key_terms": len(terms), "k": e5.keyword(q, df),
                     "k_terms": e5.keyword_terms(q, df), "q_prime": None, "template": None,
                     "text_9A": e5.text_9a(q), "q_G": None, "q_G_origin": None, "q_L": None,
                     "q_L_status": "pending"})
    ids = [r["query_id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise ValueError("a query has two targets")
    out = questions([{"id": f"k|{r['query_id']}", "keyword": r["k"]} for r in rows]
                    + [{"id": f"g|{t['query_id']}", "markdown": e5.titled_markdown(t["title"], t["text"])}
                       for t in targets])
    for r in rows:
        kq = out[f"k|{r['query_id']}"]["keyword_question"]
        r["q_prime"], r["template"] = kq["text"], kq["template"]
        pq = out[f"g|{r['query_id']}"]["page_questions"]
        if pq:
            r["q_G"], r["q_G_origin"] = pq[0]["text"], pq[0]["origin"]
    summary = {
        "queries": dict(Counter(r["stratum"] for r in rows)),
        "pool_pages": {s: dfs[s][1] for s in e5.E5_SETS},
        "pool_rows": {s: len(pools[s]) for s in e5.E5_SETS},
        "templates": {s: dict(Counter(r["template"] for r in rows if r["set"] == s)) for s in e5.E5_SETS},
        "q_prime_equals_k": {s: sum(r["q_prime"] == r["k"] for r in rows if r["set"] == s) for s in e5.E5_SETS},
        "q_G": {s: dict(Counter(r["q_G_origin"] or "none" for r in rows if r["set"] == s)) for s in e5.E5_SETS},
    }
    return rows, summary


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--e1-data", default=str(e5.E1_DIR / "data"))
    ap.add_argument("--e3-data", default=str(e5.E3_DIR / "data"))
    ap.add_argument("--data", default=str(e5.DATA))
    args = ap.parse_args(argv)
    data = Path(args.data)
    for other in (args.e1_data, args.e3_data):
        if data.resolve() == Path(other).resolve():
            ap.error("--data is E1's or E3's data folder; E5 writes to its own")
    e5.refuse_foreign_data(data, ap)
    pages = e5_pages(common.read_jsonl(Path(args.e1_data) / "pages.jsonl"),
                     common.read_jsonl(Path(args.e3_data) / "pages.jsonl"))
    rows, summary = build(pages)
    common.write_jsonl(data / "pages.jsonl", pages)
    common.write_jsonl(data / "edit_texts.jsonl", [{f: r[f] for f in FIELDS} for r in rows])
    summary["sha256"] = e5.sha256_file(data / "edit_texts.jsonl")
    summary["pages_sha256"] = e5.sha256_file(data / "pages.jsonl")
    summary["questions_bridge"] = e5.bundles()["questions_cli"]
    e5.write_json(data / "edit_texts.json", summary)
    print(f"edit_texts: {len(rows)} queries ({summary['queries']}); pool pages {summary['pool_pages']}; "
          f"templates {summary['templates']}; sha256 {summary['sha256']}")


if __name__ == "__main__":
    main()
