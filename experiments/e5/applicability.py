"""E5's applicability tables (experiments/PLAN_E5.md r2, "Applicability and validity").

All engine output comes from E1's pinned engine bundle (e5_common.engine), with the true query q
as the target question, so E5's rules are E1's.

data/applicability.jsonl, one row per (query, arm) {query_id, arm, applicable, reason}:
- E1's queries (main, replication): E1's frozen rows, verbatim (every arm). The rule is also
  recomputed for arms 9 and 12 and must give E1's rows (checked, counted).
- E3's new queries (e3, e3-four): arms 9 and 12 by E1's rules (experiments/e3/admit.py's
  all_applicability, without E3's restriction; E3's own table is never copied: it marks both
  arms not run).
- 9K, 9A, 9G, and 9L once q_L exists: arm 9's row, and the edit text exists and differs from the
  page's existing first H2 (ignoring case). Before the edit job writes q_L, no 9L row is written.
- 12K (main set only): missing_terms(q', title, text) is not empty. No 12K rows on the
  replication set (not run there).

data/edit_applicability.jsonl: the table the edit job's editor reads (arms 12 and 12K only): arm
12 on the new queries by E1's rule (E1's queries keep E1's arm 12 and P12 versions, which E5 does
not rebuild; make_versions.py copies them and E5 re-answers them in tier 3, PLAN_E5 amendment 2)
and 12K as above.
data/edit_questions.jsonl: {query_id, edit_question} = q' for every main-set query (editor.py
--edit-questions).
data/engine_original.jsonl: the engine on every E5 target (E1's rows for E1's targets are
reproduced byte for byte; checked).
data/applicability.json: counts per set, stratum and arm, and the checks above.

Usage: python3 -I experiments/e5/applicability.py [--data experiments/e5/data] [--e1-data experiments/e1/data]
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

sys.path.insert(0, str(e5.E3_DIR))
import admit  # noqa: E402  (E3's twin of E1's applicability rules)
import deterministic_arms as da  # noqa: E402

EDIT_TEXT_FIELD = {"9K": "q_prime", "9L": "q_L", "9A": "text_9A", "9G": "q_G"}
NINE_FAMILY = ["9K", "9L", "9A", "9G"]
NOT_RUN_12K = "not run on the replication set (PLAN_E5)"
E1_TWELVE = ("E1's arm 12 and P12 versions are reused and re-answered in E5's tier 3 "
             "(E5 rebuilds arm 12 on the new queries only)")


def engine_rows(targets: list[dict], engine=None) -> dict[str, dict]:
    """{query_id: engine output} on every target with q as the target question."""
    engine = engine or e5.engine
    out = engine([{"id": t["page_id"], "markdown": t["text"], "question": t["query"]} for t in targets])
    return {t["query_id"]: out[t["page_id"]] for t in targets}


def rule_rows(target: dict, eng: dict, has_donor: bool) -> dict[str, dict]:
    """E1's rule for arms 9 and 12 on one target ({arm: row})."""
    rows = admit.all_applicability(target["query_id"], target["set"], eng, has_donor, da.features(target, eng))
    return {r["arm"]: r for r in rows if r["arm"] in ("9", "12")}


def nine_family_row(qid: str, arm: str, nine: dict, text: dict, eng: dict) -> dict | None:
    """9K/9L/9A/9G: arm 9's rule, plus an edit text that differs from the first H2. None for 9L
    before q_L exists."""
    x = text[EDIT_TEXT_FIELD[arm]]
    if arm == "9L" and text.get("q_L_status") == "pending":
        return None
    if not nine["applicable"]:
        ok, reason = False, f"arm 9 is not applicable: {nine['reason']}"
    elif not x or not x.strip():
        reason = {"9G": "no page question (pageQuestions is empty)",
                  "9L": f"no local-model question ({text.get('q_L_status')})"}.get(arm, "no edit text")
        ok = False
    elif e5.same_as_first_h2(x, eng):
        ok, reason = False, "the edit text is the page's first H2 already"
    else:
        ok, reason = True, None
    return {"query_id": qid, "arm": arm, "applicable": ok, "reason": reason}


def twelve_k_row(qid: str, target: dict, text: dict, eng: dict) -> dict:
    missing = da.missing_terms(text["q_prime"], target.get("title", ""), target["text"], eng)
    return {"query_id": qid, "arm": "12K", "applicable": bool(missing),
            "reason": None if missing else
            "feature already present: every key term of q' is in the title, first heading or first paragraph"}


def build(pages: list[dict], texts: list[dict], e1_applicability: list[dict], engs: dict[str, dict]):
    """(applicability rows, editor rows, summary)."""
    targets = {p["query_id"]: p for p in pages if p["role"] == "target"}
    donors = {p["query_id"] for p in pages if p["role"] == "donor"}
    e1_rows = defaultdict(list)
    for r in e1_applicability:
        e1_rows[r["query_id"]].append(r)
    rows, editor_rows = [], []
    mismatch = []
    by_text = {t["query_id"]: t for t in texts}
    for qid, target in targets.items():
        eng, text = engs[qid], by_text[qid]
        rule = rule_rows(target, eng, qid in donors)
        stratum = e5.STRATUM[target["set"]]
        if stratum in ("e1", "replication"):
            if qid not in e1_rows:
                raise ValueError(f"E1 query {qid} has no row in E1's applicability table")
            mine = e1_rows[qid]
            rows += [dict(r) for r in mine]
            frozen = {r["arm"]: r for r in mine}
            for arm in ("9", "12"):
                if (frozen[arm]["applicable"], frozen[arm]["reason"]) != (rule[arm]["applicable"], rule[arm]["reason"]):
                    mismatch.append(f"{qid}:{arm}")
            nine, twelve = frozen["9"], frozen["12"]
        else:
            nine, twelve = rule["9"], rule["12"]
            rows += [nine, twelve]
        for arm in NINE_FAMILY:
            row = nine_family_row(qid, arm, nine, text, eng)
            if row:
                rows.append(row)
        if text["set"] == "main":
            k_row = twelve_k_row(qid, target, text, eng)
            rows.append(k_row)
            editor_rows.append(k_row)
            if stratum == "e1":
                editor_rows.append({"query_id": qid, "arm": "12", "applicable": False,
                                    "reason": f"not applicable: {E1_TWELVE}"})
            else:
                editor_rows.append(dict(twelve))
    stratum_of = {qid: e5.STRATUM[t["set"]] for qid, t in targets.items()}
    counts: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in rows:
        if r["arm"] in ("9", "12", *NINE_FAMILY, "12K"):
            c = counts[stratum_of[r["query_id"]]][r["arm"]]
            c[0] += 1
            c[1] += bool(r["applicable"])
    summary = {
        "applicable": {s: {a: {"rows": n, "applicable": k} for a, (n, k) in sorted(arms.items())}
                       for s, arms in sorted(counts.items())},
        "e1_rule_mismatches": mismatch,
        "reasons": {a: dict(Counter(r["reason"] for r in rows if r["arm"] == a and not r["applicable"]))
                    for a in (*NINE_FAMILY, "12K")},
    }
    return rows, editor_rows, summary


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(e5.DATA))
    ap.add_argument("--e1-data", default=str(e5.E1_DIR / "data"))
    args = ap.parse_args(argv)
    data, e1 = Path(args.data), Path(args.e1_data)
    if data.resolve() == e1.resolve():
        ap.error("--data is E1's data folder; E5 writes to its own")
    e5.refuse_foreign_data(data, ap)
    e5.check_engine_pin()  # before any file is written: a wrong bundle stops here
    pages = common.read_jsonl(data / "pages.jsonl")
    texts = common.read_jsonl(data / "edit_texts.jsonl")
    targets = [p for p in pages if p["role"] == "target"]
    engs = engine_rows(targets)
    e1_engine_path = e1 / "engine_original.jsonl"
    reproduced = None
    if e1_engine_path.exists():
        frozen = {r["id"]: r for r in common.read_jsonl(e1_engine_path)}
        strip = lambda r: {k: v for k, v in r.items() if k not in ("id", "query_id")}  # noqa: E731
        e1_targets = [t for t in targets if t["page_id"] in frozen]
        differ = [t["query_id"] for t in e1_targets if strip(engs[t["query_id"]]) != strip(frozen[t["page_id"]])]
        if differ:
            raise SystemExit(f"applicability: the pinned engine differs from E1's engine_original.jsonl on "
                             f"{len(differ)} targets, e.g. {differ[:3]}")
        reproduced = len(e1_targets)
    rows, editor_rows, summary = build(pages, texts, common.read_jsonl(e1 / "applicability.jsonl"), engs)
    if summary["e1_rule_mismatches"]:
        raise SystemExit(f"applicability: E1's rule recomputed differs from E1's frozen rows: "
                         f"{summary['e1_rule_mismatches'][:5]}")
    common.write_jsonl(data / "engine_original.jsonl",
                       [{"id": t["page_id"], "query_id": t["query_id"],
                         **{k: v for k, v in engs[t["query_id"]].items() if k != "id"}} for t in targets])
    common.write_jsonl(data / "applicability.jsonl", rows)
    common.write_jsonl(data / "edit_applicability.jsonl", editor_rows)
    common.write_jsonl(data / "edit_questions.jsonl",
                       [{"query_id": t["query_id"], "edit_question": t["q_prime"]} for t in texts if t["set"] == "main"])
    summary["engine"] = {"sha256": e5.ENGINE_SHA256, "e1_targets_reproduced": reproduced,
                         "targets": len(targets)}
    summary["edit_texts_sha256"] = e5.sha256_file(data / "edit_texts.jsonl")
    e5.write_json(data / "applicability.json", summary)
    for s, arms in summary["applicable"].items():
        print(f"applicability {s}: " + ", ".join(f"{a} {c['applicable']}/{c['rows']}" for a, c in arms.items()))
    print(f"applicability: {len(rows)} rows, {len(editor_rows)} editor rows; E1 targets reproduced: {reproduced}")


if __name__ == "__main__":
    main()
