"""E5's page versions (experiments/PLAN_E5.md r2, "Versions"), in E1's versions.jsonl schema.

Subcommands (all write to --data, default experiments/e5/data):

  build         the deterministic versions on both sets: original, 9, 9P, 9K, 9A, 9G
                (no model writes them). Writes versions.jsonl and make_versions.json.
  ql            after the edit job: merges its q_L.jsonl into edit_texts.jsonl, adds the 9L rows to
                applicability.jsonl and the 9L versions to versions.jsonl.
  merge-edits   after the edit job: adds its edit_versions.jsonl rows (12 and P12 on the new
                queries, 12K and P12K) to versions.jsonl. The job's originals must equal E5's.

E1's own arm 12 and P12 versions on its main queries are copied into versions.jsonl by `build`
(E1's fields verbatim, valid and invalid rows alike) and re-answered in E5's tier 3 (PLAN_E5
amendment 2, "One run for arm 12 too"); merge-edits keeps them and refuses an edit job that
rebuilt any of them.

Rules (E1's functions with their base arms, feasibility F3):
- Arm 9 with an edit text x (9 with q, 9K with q', 9L with q_L, 9A with the 9A text, 9G with q_G):
  deterministic_arms.arm9(text, eng, x), validated by validate.validate as arm '9' with x as the
  query (the heading is '## x', check 3 allows x's words); metrics with the true q.
- 9P: E2's arm9p (PLAN_E2 amendment 1) with E2's validity (differs from the original; the heading
  adds no key term of q beyond S's), on every query where arm 9 is applicable.
- Only applicable (query, arm) pairs get a row (E5's applicability.jsonl).
- The originals and arm 9 are rebuilt and must equal E1's (E1's queries) and E3's (originals of the
  new queries) byte for byte; 9P must equal E2's where E2 has it. The counts that differ are in
  make_versions.json (expected 0).

Extra fields on every row, beyond E1's schema:
- stratum ('e1', 'e3', 'e3-four', 'replication'), n_key_terms (|K(q)|), template (q''s template on
  9K and 12K, 'local-model' on 9L, else null);
- edit_text: the text the edit was made from (q for 9 and 12, q' for 9K and 12K, q_L, the 9A text,
  q_G); null for the original and the placebos 9P, P12, P12K;
- same_sentence_as_9 (9K, 9L, 9A, 9G): the version copies the same page sentence as arm 9 (only
  the heading differs); null elsewhere;
- edit_text_is_q: the edit text is q itself, ignoring case, spaces and a final '?' (true for 9 and
  12 by definition; on a 9K, 9L, 9A or 9G row it flags a version that makes arm 9's edit, up to the
  heading's case); null where edit_text is null;
- tool_gate: the tool's own view, on the CURRENT engine (the questions bridge): question-coverage
  with edit_text on the original text is applicable and under 0.9 (the tool would suggest the
  edit); tool_covers_edit_text and tool_covers_q: the tool counts the edited page as covering
  edit_text and q (question-coverage 0.9 or more). Null where edit_text is null.

Usage: python3 -I experiments/e5/make_versions.py build
       python3 -I experiments/e5/make_versions.py ql --q-l data/q_L.jsonl
       python3 -I experiments/e5/make_versions.py merge-edits --edits data/edit_versions.jsonl
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import e5_common as e5  # noqa: E402
from e5_common import common  # noqa: E402

import applicability as appl_mod  # noqa: E402
import deterministic_arms as da  # noqa: E402
import validate  # noqa: E402

_spec = importlib.util.spec_from_file_location("e2_make_versions", e5.E2_DIR / "make_versions.py")
e2mv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e2mv)

DETERMINISTIC = ["original", "9", "9P", "9K", "9A", "9G"]
NINE_TEXT = {"9": "query", "9K": "q_prime", "9L": "q_L", "9A": "text_9A", "9G": "q_G"}
EDIT_ARMS = ["12", "P12", "12K", "P12K"]
EXTRA = ["stratum", "n_key_terms", "template", "edit_text", "edit_text_is_q", "same_sentence_as_9", "tool_gate",
         "tool_covers_edit_text", "tool_covers_q"]
REUSED_E1 = ("12", "P12")  # E1's versions, copied on E1's main queries and re-answered in tier 3
E1_FIELDS = ["version_id", "query_id", "set", "arm", "text", "title", "valid", "attempts", "excluded_reason",
             "edit_distance", "length_ratio", "key_terms_delta", "added_words", "skipped_steps"]


class Context:
    """E5's pages, edit texts, applicability and the engine on every original."""

    def __init__(self, data: Path, engine=None, questions=None):
        self.data = data
        self.engine = engine or e5.engine
        self.questions = questions or e5.questions
        pages = common.read_jsonl(data / "pages.jsonl")
        self.targets = {p["query_id"]: p for p in pages if p["role"] == "target"}
        self.texts = {t["query_id"]: t for t in common.read_jsonl(data / "edit_texts.jsonl")}
        self.app = {(r["query_id"], str(r["arm"])): r["applicable"]
                    for r in common.read_jsonl(data / "applicability.jsonl")}
        engs = {r["query_id"]: r for r in common.read_jsonl(data / "engine_original.jsonl")}
        missing = [q for q in self.targets if q not in engs]
        if missing:
            raise SystemExit(f"make_versions: engine_original.jsonl has no row for {missing[:3]}; run applicability.py")
        self.eng0 = engs

    def original(self, qid):
        t = self.targets[qid]
        return (t["title"], t["text"])

    def row(self, qid, arm, version, valid, reason, added=0, attempts=1, **extra) -> dict:
        t, x = self.targets[qid], self.texts[qid]
        r = {"version_id": f"{qid}:{arm}", "query_id": qid, "set": t["set"], "arm": arm, "text": version[1],
             "title": version[0], "valid": valid, "attempts": attempts, "excluded_reason": reason,
             **validate.metrics(t["query"], self.original(qid), version), "added_words": added,
             "skipped_steps": []}
        r |= {"stratum": x["stratum"], "n_key_terms": x["n_key_terms"], "template": None, "edit_text": None,
              "edit_text_is_q": None, "same_sentence_as_9": None, "tool_gate": None, "tool_covers_edit_text": None,
              "tool_covers_q": None}
        r |= extra
        r["edit_text_is_q"] = e5.is_q(r["edit_text"], t["query"])
        return r


def edit_text(ctx: Context, qid: str, arm: str) -> str | None:
    if arm == "9":
        return ctx.targets[qid]["query"]
    return ctx.texts[qid][NINE_TEXT[arm]]


def build_nine(ctx: Context, qid: str, arm: str, x: str) -> tuple[dict | None, dict | None]:
    """(task, row): a task to validate when arm 9 with x builds, else an invalid row."""
    original = ctx.original(qid)
    text, eng = original[1], ctx.eng0[qid]
    edits, reason = da.arm9(text, eng, x)
    template = ctx.texts[qid]["template"] if arm == "9K" else ("local-model" if arm == "9L" else None)
    same = None
    if arm != "9":
        q = ctx.targets[qid]["query"]
        same = da.arm9_sentence(text, eng, x) == da.arm9_sentence(text, eng, q)
    extra = {"edit_text": x, "template": template, "same_sentence_as_9": same}
    if edits is None:
        return None, ctx.row(qid, arm, original, False, f"invalid: {reason}", **extra)
    edited = (original[0], validate.splice(text, edits))
    return {"key": f"{qid}|{arm}", "qid": qid, "arm": arm, "x": x, "edits": edits, "edited": edited,
            "extra": extra}, None


def validate_nine(ctx: Context, tasks: list[dict]) -> list[dict]:
    """E1's arm 9 validation (validate.validate, arm '9', x as the query) of every task."""
    engs = ctx.engine([{"id": t["key"], "markdown": t["edited"][1], "question": t["x"]} for t in tasks])
    rows = []
    for t in tasks:
        qid = t["qid"]
        original = ctx.original(qid)
        spans = [{"field": e["field"], "start": e["start"], "end": e["end"]} for e in t["edits"]]
        res = validate.validate(arm="9", original=original, edited=t["edited"], edits=t["edits"], spans=spans,
                                eng_orig=ctx.eng0[qid], eng_edit=engs[t["key"]], query=t["x"], target=original,
                                donor=None)
        reason = None if res["valid"] else "invalid: " + " | ".join(res["failures"])
        # As E1's editor writes them: an excluded version records no added words.
        added = res["added_words"] if res["valid"] else 0
        rows.append(ctx.row(qid, t["arm"], t["edited"], res["valid"], reason, added, **t["extra"]))
    return rows


def build_9p(ctx: Context, qid: str) -> dict:
    """E2's 9P (PLAN_E2 amendment 1) with E2's validity."""
    t = ctx.targets[qid]
    text, eng, query = t["text"], ctx.eng0[qid], t["query"]
    edits, why = da.arm9p(text, eng, query)
    if edits is None:
        return ctx.row(qid, "9P", ctx.original(qid), False, f"invalid: {why}")
    version = validate.splice(text, edits)
    reason = e2mv.differs(text, version)
    if reason is None:
        sp = da.arm9p_sentence(text, eng, query)
        reason = e2mv.check_9p(query, da.first_words(sp, common.count_words(query)), sp)
    w0, w1 = validate.page_words(ctx.original(qid)), validate.page_words((t["title"], version))
    return ctx.row(qid, "9P", (t["title"], version), reason is None, reason, max(0, w1 - w0))


def add_tool_view(ctx: Context, rows: list[dict]) -> None:
    """tool_gate, tool_covers_edit_text and tool_covers_q from the current engine (questions bridge)."""
    items = []
    for r in rows:
        if r["edit_text"] is None:
            continue
        qid = r["query_id"]
        items += [{"id": f"g|{r['version_id']}", "markdown": ctx.targets[qid]["text"], "question": r["edit_text"]},
                  {"id": f"e|{r['version_id']}", "markdown": r["text"], "question": r["edit_text"]},
                  {"id": f"q|{r['version_id']}", "markdown": r["text"], "question": ctx.targets[qid]["query"]}]
    out = ctx.questions(items)
    for r in rows:
        if r["edit_text"] is None:
            continue
        gate = out[f"g|{r['version_id']}"]["coverage"]
        r["tool_gate"] = bool(gate["applicable"]) and gate["score"] < e5.COVERED
        r["tool_covers_edit_text"] = e5.tool_covered(out[f"e|{r['version_id']}"]["coverage"])
        r["tool_covers_q"] = e5.tool_covered(out[f"q|{r['version_id']}"]["coverage"])


def nine_family_rows(ctx: Context, arms: list[str]) -> list[dict]:
    rows, tasks = [], []
    for qid in ctx.targets:
        for arm in arms:
            if not ctx.app.get((qid, arm), False):
                continue
            task, row = build_nine(ctx, qid, arm, edit_text(ctx, qid, arm))
            if task:
                tasks.append(task)
            else:
                rows.append(row)
    rows += validate_nine(ctx, tasks)
    return rows


def is_reused_e1(r: dict) -> bool:
    """One of E1's arm 12 or P12 versions on its main queries, copied by `build`."""
    return r["arm"] in REUSED_E1 and r["stratum"] == "e1"


def reuse_e1_twelve(ctx: Context, e1_versions: list[dict]) -> list[dict]:
    """E1's arm 12 and P12 rows on E1's main queries (stratum e1), E1's fields verbatim, plus E5's
    extra fields (edit_text q for 12, null for the placebo P12)."""
    out = []
    for v in e1_versions:
        qid = v["query_id"]
        if v["arm"] not in REUSED_E1 or qid not in ctx.texts or ctx.texts[qid]["stratum"] != "e1":
            continue
        x, q = ctx.texts[qid], ctx.targets[qid]["query"]
        edit = q if v["arm"] == "12" else None
        out.append({f: v[f] for f in E1_FIELDS} | {
            "stratum": "e1", "n_key_terms": x["n_key_terms"], "template": None, "edit_text": edit,
            "edit_text_is_q": e5.is_q(edit, q), "same_sentence_as_9": None, "tool_gate": None,
            "tool_covers_edit_text": None, "tool_covers_q": None})
    return out


def build(ctx: Context, e1_versions: list[dict] = ()) -> list[dict]:
    """The deterministic versions (original, 9, 9P, 9K, 9A, 9G), and E1's own 12 and P12 on E1's
    main queries when E1's versions are given, in query then version order."""
    rows = [ctx.row(qid, "original", ctx.original(qid), True, None) for qid in ctx.targets]
    rows += nine_family_rows(ctx, ["9", "9K", "9A", "9G"])
    rows += [build_9p(ctx, qid) for qid in ctx.targets if ctx.app.get((qid, "9"), False)]
    rows += reuse_e1_twelve(ctx, list(e1_versions))
    add_tool_view(ctx, rows)
    return order(rows)


ARM_ORDER = {a: i for i, a in enumerate(["original", "9", "9P", "9K", "9L", "9A", "9G", "12", "P12", "12K", "P12K"])}


def order(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["set"] != "main", r["set"], r["query_id"], ARM_ORDER.get(r["arm"], 99)))


def compare(rows: list[dict], earlier: list[dict], arms: tuple[str, ...]) -> dict:
    """How many of E5's rows for `arms` differ from an earlier run's row with the same version_id,
    in E1's fields (text, title and validity included)."""
    mine = {r["version_id"]: r for r in rows if r["arm"] in arms}
    out = {}
    for arm in arms:
        theirs = [v for v in earlier if v["arm"] == arm and v["version_id"] in mine]
        differ = [v["version_id"] for v in theirs if any(mine[v["version_id"]][f] != v[f] for f in E1_FIELDS)]
        text_differ = [v["version_id"] for v in theirs if (mine[v["version_id"]]["title"], mine[v["version_id"]]["text"])
                       != (v["title"], v["text"])]
        out[arm] = {"compared": len(theirs), "rows_differ": len(differ), "texts_differ": len(text_differ),
                    "examples": differ[:5]}
    return out


def summarize(rows: list[dict]) -> dict:
    counts: dict = defaultdict(lambda: defaultdict(lambda: {"versions": 0, "valid": 0}))
    for r in rows:
        c = counts[r["stratum"]][r["arm"]]
        c["versions"] += 1
        c["valid"] += r["valid"]
    reasons = defaultdict(Counter)
    for r in rows:
        if not r["valid"]:
            reasons[r["arm"]][(r["excluded_reason"] or "")[:120]] += 1
    return {"counts": {s: dict(a) for s, a in sorted(counts.items())},
            "invalid_reasons": {a: dict(c.most_common(5)) for a, c in sorted(reasons.items())}}


def cmd_build(args) -> None:
    data = Path(args.data)
    ctx = Context(data)
    e1v = common.read_jsonl(Path(args.e1_data) / "versions.jsonl")
    e3v = common.read_jsonl(Path(args.e3_data) / "versions.jsonl")
    e2v = common.read_jsonl(Path(args.e2_data) / "versions.jsonl")
    rows = build(ctx, e1v)
    checks = {}
    checks["e1"] = compare(rows, e1v, ("original", "9", *REUSED_E1))
    checks["e3"] = compare(rows, e3v, ("original",))
    checks["e2"] = compare(rows, e2v, ("9P",))
    if args.replication_9p_from_e2:
        # PLAN_E5 "Versions": on the replication set, 9P is E2's existing version where it exists.
        e2 = {v["version_id"]: v for v in e2v if v["set"] == "replication" and v["arm"] == "9P"}
        for r in rows:
            if r["version_id"] in e2:
                r |= {f: e2[r["version_id"]][f] for f in E1_FIELDS}
    common.write_jsonl(data / "versions.jsonl", rows)
    summary = summarize(rows) | {"rebuilt_vs_earlier": checks,
                                 "applicability_sha256": e5.sha256_file(data / "applicability.jsonl"),
                                 "edit_texts_sha256": e5.sha256_file(data / "edit_texts.jsonl"),
                                 "versions_sha256": e5.sha256_file(data / "versions.jsonl"),
                                 "engine_sha256": e5.ENGINE_SHA256,
                                 "questions_bridge_sha256": e5.bundles()["questions_cli"]["sha256"]}
    e5.write_json(data / "make_versions.json", summary)
    for s, arms in summary["counts"].items():
        print(f"make_versions {s}: " + ", ".join(f"{a} {c['valid']}/{c['versions']}" for a, c in arms.items()))
    print(f"rebuilt vs earlier runs: {checks}")


# --- after the edit job ------------------------------------------------------------------------


def merge_q_l(texts: list[dict], q_l: list[dict]) -> list[dict]:
    """edit_texts rows with q_L and q_L_status from the edit job's q_L.jsonl."""
    by_id = {r["query_id"]: r for r in q_l}
    missing = [t["query_id"] for t in texts if t["query_id"] not in by_id]
    if missing:
        raise SystemExit(f"make_versions ql: q_L.jsonl has no row for {len(missing)} queries, e.g. {missing[:3]}")
    out = []
    for t in texts:
        r = by_id[t["query_id"]]
        if r["k"] != t["k"]:
            raise SystemExit(f"make_versions ql: {t['query_id']} q_L was written for keyword {r['k']!r}, not {t['k']!r}")
        out.append(t | {"q_L": r["q_L"], "q_L_status": r["status"]})
    return out


def cmd_ql(args) -> None:
    data = Path(args.data)
    texts = merge_q_l(common.read_jsonl(data / "edit_texts.jsonl"), common.read_jsonl(Path(args.q_l)))
    common.write_jsonl(data / "edit_texts.jsonl", texts)
    ctx = Context(data)
    by_text = {t["query_id"]: t for t in texts}
    appl_rows = [r for r in common.read_jsonl(data / "applicability.jsonl") if r["arm"] != "9L"]
    nine = {r["query_id"]: r for r in appl_rows if r["arm"] == "9"}
    new = [appl_mod.nine_family_row(qid, "9L", nine[qid], by_text[qid], ctx.eng0[qid]) for qid in ctx.targets]
    common.write_jsonl(data / "applicability.jsonl", appl_rows + new)
    ctx = Context(data)
    rows = [r for r in common.read_jsonl(data / "versions.jsonl") if r["arm"] != "9L"]
    nine_l = nine_family_rows(ctx, ["9L"])
    add_tool_view(ctx, nine_l)
    rows = order(rows + nine_l)
    common.write_jsonl(data / "versions.jsonl", rows)
    status = Counter(t["q_L_status"] for t in texts)
    summary = {"q_L_status": dict(status), "q_L_equals_q": sum(t["q_L"] == t["query"] for t in texts),
               "9L": summarize(nine_l)["counts"], "edit_texts_sha256": e5.sha256_file(data / "edit_texts.jsonl"),
               "versions_sha256": e5.sha256_file(data / "versions.jsonl")}
    e5.write_json(data / "make_versions_ql.json", summary)
    print(f"make_versions ql: q_L {dict(status)}; 9L {summary['9L']}")


def merge_edit_rows(ctx: Context, rows: list[dict], edits: list[dict]) -> tuple[list[dict], list[dict]]:
    """(versions with the edit job's rows merged, the added rows). The job's rows replace any earlier
    merge; E1's reused 12 and P12 stay as they are, and a job row with one of their ids is refused."""
    mine = {r["version_id"]: r for r in rows}
    bad = [e["version_id"] for e in edits if e["arm"] == "original"
           and any(e[f] != mine[e["version_id"]][f] for f in E1_FIELDS)]
    if bad:
        raise SystemExit(f"make_versions merge-edits: the edit job's originals differ from E5's for {bad[:3]}")
    unknown = sorted({e["arm"] for e in edits} - {"original", *EDIT_ARMS})
    if unknown:
        raise SystemExit(f"make_versions merge-edits: unexpected arms {unknown} in the edit job's versions")
    reused = {r["version_id"] for r in rows if is_reused_e1(r)}
    rebuilt = [e["version_id"] for e in edits if e["version_id"] in reused]
    if rebuilt:
        raise SystemExit(f"make_versions merge-edits: the edit job rebuilt E1's own arm 12 or P12 versions "
                         f"{rebuilt[:3]}; E5 reuses E1's (edit_applicability.jsonl marks them not applicable)")
    q_prime = {qid: t["q_prime"] for qid, t in ctx.texts.items()}
    added = []
    for e in edits:
        if e["arm"] == "original":
            continue
        qid, x = e["query_id"], ctx.texts[e["query_id"]]
        r = {f: e[f] for f in E1_FIELDS} | {
            "stratum": x["stratum"], "n_key_terms": x["n_key_terms"],
            "template": x["template"] if e["arm"] == "12K" else None,
            "edit_text": {"12": ctx.targets[qid]["query"], "12K": q_prime[qid]}.get(e["arm"]),
            "same_sentence_as_9": None, "tool_gate": None, "tool_covers_edit_text": None, "tool_covers_q": None}
        r["edit_text_is_q"] = e5.is_q(r["edit_text"], ctx.targets[qid]["query"])
        added.append(r)
    add_tool_view(ctx, added)
    return order([r for r in rows if r["arm"] not in EDIT_ARMS or is_reused_e1(r)] + added), added


def cmd_merge_edits(args) -> None:
    data = Path(args.data)
    ctx = Context(data)
    rows, added = merge_edit_rows(ctx, common.read_jsonl(data / "versions.jsonl"), common.read_jsonl(Path(args.edits)))
    common.write_jsonl(data / "versions.jsonl", rows)
    summary = {"merged": summarize(added)["counts"], "invalid_reasons": summarize(added)["invalid_reasons"],
               "e1_reused_kept": dict(Counter(r["arm"] for r in rows if is_reused_e1(r))),
               "edits_sha256": e5.sha256_file(Path(args.edits)), "versions_sha256": e5.sha256_file(data / "versions.jsonl")}
    e5.write_json(data / "make_versions_edits.json", summary)
    print(f"make_versions merge-edits: {summary['merged']}; E1's reused rows kept {summary['e1_reused_kept']}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(e5.DATA))
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="the deterministic versions (original, 9, 9P, 9K, 9A, 9G)")
    b.add_argument("--e1-data", default=str(e5.E1_DIR / "data"))
    b.add_argument("--e2-data", default=str(e5.E2_DIR / "data"))
    b.add_argument("--e3-data", default=str(e5.E3_DIR / "data"))
    b.add_argument("--no-replication-9p-from-e2", dest="replication_9p_from_e2", action="store_false",
                   help="build every replication 9P here instead of taking E2's (they are checked to be equal)")
    q = sub.add_parser("ql", help="merge q_L and build 9L (after the edit job)")
    q.add_argument("--q-l", required=True, help="the edit job's q_L.jsonl")
    m = sub.add_parser("merge-edits", help="add the edit job's 12, P12, 12K and P12K versions")
    m.add_argument("--edits", required=True, help="the edit job's edit_versions.jsonl")
    args = ap.parse_args(argv)
    data = Path(args.data).resolve()
    for d in (e5.E1_DIR / "data", e5.E2_DIR / "data", e5.E3_DIR / "data"):
        if data == d.resolve():
            ap.error("--data is E1's, E2's or E3's data folder; E5 writes to its own")
    e5.refuse_foreign_data(data, ap)
    # Both pins before any file is rewritten (ql rewrites edit_texts.jsonl and applicability.jsonl
    # before its first engine call).
    e5.check_engine_pin()
    e5.check_questions_pin()
    {"build": cmd_build, "ql": cmd_ql, "merge-edits": cmd_merge_edits}[args.cmd](args)


if __name__ == "__main__":
    main()
