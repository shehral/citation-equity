"""E3 admission and applicability (experiments/PLAN_E3.md, changes 1 and 2), with E1's own rules.

From E1's candidates.jsonl (normalize.py's output) it admits, in dataset order:
- set "e3": every main-candidate query with five usable pages that E1 did not use (E1's 80 main
  queries and the timing query are left out), with E1's target, donor and competitor draw
  (draw.page_rows). The plan expects 72.
- set "e3-four": every main-candidate query with exactly four usable pages, with the same draw minus
  the donor (draw.assign_roles gives no donor to a four-page query). These run arms 2, 4, 8 and 10 only.
E1's admission is recomputed with draw.py's functions and must match E1's pages.jsonl when that is
present, so no E1 query is admitted again.

Applicability: E1's rules (applicability.ts and e1_lib.ts allApplicability, here as a Python twin
checked against E1's applicability.jsonl in the tests) on the engine output of each new target: E1's
engine_original.jsonl where it has the page, else the engine bridge (common.run_engine, the bundle
E1's editor runs). Arms E3 does not run are written as not applicable, so no later step builds them:
for "e3" every arm but 2, 4, 5, 6, 7, 8 and 10 (and ALL), for "e3-four" every arm but 2, 4, 8 and 10.

Writes, in --out (default experiments/e3/data): pages.jsonl (E1's page schema), admission_e3.json,
engine_original.jsonl and applicability.jsonl. Prints the counts and, per arm, the applicable new targets.

Usage: python3 -I experiments/e3/admit.py [--e1-data experiments/e1/data] [--out experiments/e3/data]
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.dont_write_bytecode = True
E3_DIR = Path(__file__).resolve().parent
E1_DIR = E3_DIR.parent / "e1"
sys.path.insert(0, str(E1_DIR))

import common  # noqa: E402
import deterministic_arms as da  # noqa: E402
import draw  # noqa: E402
from e1_common import write_json  # noqa: E402

E3_ARMS = ["2", "4", "5", "6", "7", "8", "10"]
FOUR_PAGE_ARMS = ["2", "4", "8", "10"]
SET_ARMS = {"e3": E3_ARMS, "e3-four": FOUR_PAGE_ARMS}
NOT_RUN = {"e3": "not run in E3", "e3-four": "not run on four-page queries (E3: arms 2, 4, 8 and 10 only)"}
EXPECTED_FIVE = 72

# --- applicability: a twin of e1_lib.ts (engineArmApplicability, allApplicability) -----------------

ENGINE_CHECK = {"1": "standalone-paragraphs", "2": "question-headings", "3": "lists", "4": "tables",
                "5": "statistics", "6": "expert-quotes", "7": "cited-sources", "8": "direct-answer-lead",
                "9": "question-coverage", "10": "comparisons"}
DONOR_ARMS = {"5", "6", "7"}
REPLICATION_ARMS = {"5", "6", "7", "9", "11", "12", "14"}
ALL_ORDER = ["3", "4", "2", "1", "8", "9", "10", "5", "6", "7"]
ALL_TEXT_ORDER = ["8", "9", "5", "6", "7"]
OPENER = "points back to earlier text"


def to_fixed(x: float, digits: int = 3) -> str:
    """JavaScript's Number.prototype.toFixed for x >= 0: the exact value, ties rounded up."""
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def engine_arm_applicability(arm: str, eng: dict, has_donor: bool) -> tuple[bool, str | None]:
    """Arms 1-10 (PREREG_E1 Applicability), rule for rule as e1_lib.ts engineArmApplicability."""
    cid = ENGINE_CHECK.get(arm)
    c = eng["checks"].get(cid) if cid else None
    if not cid or not c or not c.get("applicable"):
        return False, f"the {cid} check is not applicable"
    if c["score"] >= 0.9:
        return False, f"the {cid} check scores {to_fixed(c['score'])} (0.9 or more)"
    if arm in DONOR_ARMS and not has_donor:
        return False, "no donor (four-page query)"
    if arm == "4":
        if not any(s.get("kind") == "edit" and s.get("after") is not None for s in c.get("suggestions", [])):
            return False, "no Key: value list for the tables check to convert"
    elif arm == "1":
        if not any(OPENER in f["message"] for f in c.get("findings", [])):
            return False, "no paragraph opens with a pointer to earlier text"
    elif not c.get("findings"):
        return False, f"the {cid} check reports no span"
    return True, None


def all_applicability(query_id: str, set_name: str, eng: dict, has_donor: bool, features: list[dict]) -> list[dict]:
    """The frozen rows of one target, arms 1-14 and ALL, as e1_lib.ts allApplicability."""
    rows = []
    for n in range(1, 15):
        arm = str(n)
        if set_name == "replication" and arm not in REPLICATION_ARMS:
            ok, reason = False, "not run on the replication set"
        elif n <= 10:
            ok, reason = engine_arm_applicability(arm, eng, has_donor)
        else:
            f = next((x for x in features if x["arm"] == arm), None)
            ok, reason = (f["applicable"], f["reason"]) if f else (False, "no feature row")
        rows.append({"query_id": query_id, "arm": arm, "applicable": ok, "reason": reason})
    order = ALL_TEXT_ORDER if set_name == "replication" else ALL_ORDER
    any_step = any(engine_arm_applicability(a, eng, has_donor)[0] for a in order)
    rows.append({"query_id": query_id, "arm": "ALL", "applicable": any_step,
                 "reason": None if any_step else "no applicable step"})
    return rows


def restrict(rows: list[dict], set_name: str) -> list[dict]:
    """E3's rows: the arms the set does not run become not applicable."""
    keep = SET_ARMS[set_name]
    return [r if r["arm"] in keep else r | {"applicable": False, "reason": NOT_RUN[set_name]} for r in rows]


def applicability(pages: list[dict], engines: dict[str, dict]) -> list[dict]:
    """E3 applicability rows for every target in `pages` (engines keyed by page_id)."""
    donors = {p["query_id"] for p in pages if p["role"] == "donor"}
    out = []
    for p in pages:
        if p["role"] != "target":
            continue
        eng = engines[p["page_id"]]
        rows = all_applicability(p["query_id"], p["set"], eng, p["query_id"] in donors, da.features(p, eng))
        out += restrict(rows, p["set"]) if p["set"] in SET_ARMS else rows
    return out


def engine_rows(targets: list[dict], e1_engine: dict[str, dict], engine=None) -> tuple[list[dict], int]:
    """engine_original.jsonl rows ({id: page_id, query_id, wordCount, checks, artifacts}) for the
    targets: E1's row where E1 has the page, else the engine bridge. Returns (rows, reused)."""
    missing = [t for t in targets if t["page_id"] not in e1_engine]
    fresh = (engine or common.run_engine)(
        [{"id": t["page_id"], "markdown": t["text"], "question": t["query"]} for t in missing]) if missing else {}
    rows = []
    for t in targets:
        r = e1_engine.get(t["page_id"]) or fresh[t["page_id"]]
        rows.append({"id": t["page_id"], "query_id": t["query_id"],
                     **{k: v for k, v in r.items() if k not in ("id", "query_id")}})
    return rows, len(targets) - len(missing)


# --- admission -----------------------------------------------------------------------------------


def admit(rows: list[dict], e1_main_ids: set[str] | None = None, target: int = draw.MAIN_TARGET,
          floor: int = draw.MAIN_FLOOR) -> tuple[list[dict], dict]:
    """(pages rows, summary) for E3's two sets, from the main candidates in `rows`. `target` and
    `floor` are E1's admission settings (draw.py), recomputed to know which queries E1 used."""
    main = [r for r in rows if r["set"] == "main"]
    timing = draw.draw_timing(main)
    hold_out = {timing[0]} if timing else set()
    e1_admitted, e1_summary = draw.admit_main(main, target, floor, hold_out)
    e1_ids = {q for q, _ in e1_admitted}
    if e1_main_ids is not None and e1_ids != e1_main_ids:
        raise ValueError(f"E1's admission recomputed from the candidates ({len(e1_ids)} queries) differs from "
                         f"E1's pages.jsonl ({len(e1_main_ids)}); the candidates are not the ones E1 used")
    if e1_summary["fallback"]:
        raise ValueError("E1 admitted four-page queries (the fallback); E3's four-page set assumes it did not")
    used = e1_ids | hold_out
    five, four = [], []
    for qid, pages in draw._grouped(main):
        usable = draw._usable(pages)
        if qid in used:
            continue
        if len(usable) == 5:
            five.append((qid, usable))
        elif len(usable) == 4:
            four.append((qid, usable))
    out = [r for q, p in five for r in draw.page_rows(q, p, set_="e3")]
    out += [r for q, p in four for r in draw.page_rows(q, p, set_="e3-four")]
    groups = draw._grouped(main)
    summary = {
        "queries_seen": len(groups),
        "five_page": sum(1 for _, p in groups if len(draw._usable(p)) == 5),
        "four_page": sum(1 for _, p in groups if len(draw._usable(p)) == 4),
        "e1_main": len(e1_ids), "timing": sorted(hold_out),
        "e3": {"admitted": len(five), "expected": EXPECTED_FIVE, "pages_per_query": 5,
               "arms": E3_ARMS, "query_ids": [q for q, _ in five]},
        "e3-four": {"admitted": len(four), "pages_per_query": 4, "arms": FOUR_PAGE_ARMS,
                    "query_ids": [q for q, _ in four]},
    }
    return out, summary


def applicable_counts(rows: list[dict], pages: list[dict]) -> dict:
    set_of = {p["query_id"]: p["set"] for p in pages if p["role"] == "target"}
    counts = {s: {a: 0 for a in arms} for s, arms in SET_ARMS.items()}
    for r in rows:
        s = set_of.get(r["query_id"])
        if s in counts and r["arm"] in counts[s] and r["applicable"]:
            counts[s][r["arm"]] += 1
    return counts


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--e1-data", default=str(E1_DIR / "data"))
    ap.add_argument("--out", default=str(E3_DIR / "data"))
    args = ap.parse_args(argv)
    e1, out = Path(args.e1_data), Path(args.out)
    if out.resolve() == e1.resolve():
        ap.error("--out is E1's data folder; E3 writes to its own")
    e1_pages_path = e1 / "pages.jsonl"
    e1_main = ({p["query_id"] for p in common.read_jsonl(e1_pages_path) if p["set"] == "main"}
               if e1_pages_path.exists() else None)
    pages, summary = admit(common.read_jsonl(e1 / "candidates.jsonl"), e1_main)
    common.write_jsonl(out / "pages.jsonl", pages)

    e1_engine_path = e1 / "engine_original.jsonl"
    e1_engine = {r["id"]: r for r in common.read_jsonl(e1_engine_path)} if e1_engine_path.exists() else {}
    targets = [p for p in pages if p["role"] == "target"]
    eng_rows, reused = engine_rows(targets, e1_engine)
    common.write_jsonl(out / "engine_original.jsonl", eng_rows)
    appl = applicability(pages, {r["id"]: r for r in eng_rows})
    common.write_jsonl(out / "applicability.jsonl", appl)

    counts = applicable_counts(appl, pages)
    summary["engine"] = {"targets": len(targets), "from_e1_engine_original": reused,
                         "from_engine_bridge": len(targets) - reused}
    summary["applicable"] = counts
    write_json(out / "admission_e3.json", summary)

    print(f"admit: {summary['queries_seen']} main candidate queries; {summary['five_page']} with five usable pages "
          f"({summary['e1_main']} in E1's main set, {len(summary['timing'])} timing), "
          f"{summary['four_page']} with four")
    for s in SET_ARMS:
        print(f"  {s}: {summary[s]['admitted']} queries admitted")
    if summary["e3"]["admitted"] != EXPECTED_FIVE:
        print(f"  note: the plan expects {EXPECTED_FIVE} five-page queries, admitted {summary['e3']['admitted']}")
    print(f"  engine: {reused} targets from E1's engine_original.jsonl, {len(targets) - reused} from the bridge")
    arms = E3_ARMS
    print("  applicable new targets per arm: " + ", ".join(
        f"{a}: {counts['e3'][a] + counts['e3-four'].get(a, 0)}"
        f" ({counts['e3'][a]} e3" + (f" + {counts['e3-four'][a]} e3-four)" if a in FOUR_PAGE_ARMS else ")")
        for a in arms))
    print(f"admit: {len(pages)} pages in {out / 'pages.jsonl'}, {len(appl)} applicability rows")


if __name__ == "__main__":
    main()
