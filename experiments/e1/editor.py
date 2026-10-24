"""E1 editor: builds every edited version of each target page (PREREG_E1.md, Arms and Editor).

For each admitted query it writes versions.jsonl rows (the interface shared with Task 20b):
{version_id, query_id, set, arm, text, title, valid, attempts, excluded_reason, edit_distance,
length_ratio, key_terms_delta, added_words}, for the original, arms 1-14, the placebos P2, P3, P5,
P6, P7, P8, P10, P12, ALL and P_ALL.

- Deterministic arms 4, 9, 11, 13, 14 come from deterministic_arms.py; no model writes them.
- LLM arms and placebos: the prompt (prompts/<arm>.txt, committed verbatim) receives the spans
  that the arm's engine check reports on the original and returns JSON {span_id: replacement};
  `splice` puts the replacements in. Gemma-4-31B-it, temperature 0, at most 4,096 new tokens; an
  answer cut off at that limit counts as failed.
- Every edit runs the six validity checks (validate.py). A failing edit is regenerated once with
  the validator's messages appended to the prompt, plus hints for placebos (each span's measured
  word count and allowed range, the query words to put back or remove) and arm 1 (the spans that
  still open with a pointer); a second failure excludes the (query, arm) pair.
- Placebo prompts give each span's word count, its allowed range (validate.placebo_word_range)
  and the query key-term words it must keep or must not gain; arm 1's prompt names each span's
  pointer word.
- A placebo P_A paraphrases exactly the spans A edited (for arms 5-7, the sentences A's insertion
  attaches to) and is built only when A's edit is valid.
- ALL applies the applicable tool-check edits in the order 3, 4, 2, 1, 8, 9, 10, 5, 6, 7 (on the
  replication set ALL-text: 8, 9, 5, 6, 7), recomputing spans with the engine after each step and
  validating each step. A step that fails twice (a deterministic step: once) is skipped and
  recorded in the row's `skipped_steps`, and ALL goes on from the version before it (r3
  amendment 9). ALL is invalid only when every step it attempted failed or was skipped ("invalid:
  every step failed") or the whole version fails check 3 or 5; when no step was attempted it is "not
  applicable: no step applied" (amendment 5). P_ALL paraphrases the union of the original spans
  ALL's kept LLM steps touched.
- Arm 7 whose editor answers NONE is not applicable: its row has valid=false and
  excluded_reason starting "not applicable" (an ALL step 7 that answers NONE is skipped instead).
  Neither "not applicable" reason is a validity exclusion (r3 amendments 5 and 9).

Run on Explorer (edit.sbatch) with --backend vllm, or locally with --backend fake (a fake editor
that returns fixed replacements) for the smoke set. The engine runs as a subprocess
(common.run_engine; set E1_ENGINE to override the command).
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
import deterministic_arms as da  # noqa: E402
import validate  # noqa: E402
from validate import ENGINE_CHECK, splice  # noqa: E402

PROMPTS_DIR = common.PROMPTS_DIR
LLM_ARMS = ["1", "2", "3", "5", "6", "7", "8", "10", "12"]
DETERMINISTIC_ARMS = ["4", "9", "11", "13", "14"]
PLACEBO_ARMS = ["2", "3", "5", "6", "7", "8", "10", "12"]
ALL_ORDER = ["3", "4", "2", "1", "8", "9", "10", "5", "6", "7"]
ALL_TEXT_ORDER = ["8", "9", "5", "6", "7"]  # replication set: ALL restricted to arms 5-9
DONOR_ARMS = {"5", "6", "7"}
PROMPT_NAMES = [f"arm{a}" for a in LLM_ARMS] + [f"p{a}" for a in PLACEBO_ARMS] + ["p_all"]
EDITOR_MODEL = "google/gemma-4-31B-it"
MAX_NEW_TOKENS = 4096
QUOTE_MAX_WORDS = 40
OPENER_FINDING = "points back to earlier text"
# The engine's opener list (standalone-paragraphs.ts, UNRESOLVED_OPENER) and the marks that may
# precede the first word (its LEADING_PUNCTUATION, plus Markdown emphasis and link brackets).
POINTER_OPENER = re.compile(r"(?:this|that|these|those|it|they|such|the above|as mentioned)(?![^\W_])", re.I)
LEADING_MARKS = re.compile(r"^[\s\"'“‘(*_\[]+")
CUT_OFF = "The answer was cut off at the token limit. Return only the JSON object, with short replacements."

# --- Spans ------------------------------------------------------------------------------------


def _merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for s, e in sorted(r for r in ranges if r[1] > r[0]):
        if out and s < out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def _span_dicts(text: str, ranges, title: str | None = None) -> list[dict]:
    spans = [{"id": "title", "field": "title", "start": 0, "end": len(title), "text": title}] if title else []
    spans += [{"id": f"s{i}", "field": "text", "start": s, "end": e, "text": text[s:e]}
              for i, (s, e) in enumerate(_merge(ranges), start=1)]
    return spans


def spans_for_arm(arm: str, page: dict, eng: dict) -> list[dict]:
    """The spans an LLM arm edits: the issue ranges its engine check reports on this text."""
    text = page["text"]
    if arm == "12":
        title = page.get("title") or ""
        return _span_dicts(text, da.lead_spans(text, eng), title=title if title.strip() else None)
    findings = eng["checks"].get(ENGINE_CHECK[arm], {}).get("findings", [])
    if arm == "1":
        findings = [f for f in findings if OPENER_FINDING in f["message"]]
    ranges = [(f["start"], f["end"]) for f in findings]
    if arm == "6":
        # The quotation is added as a new paragraph, so an inline quote's span grows to its paragraph.
        paragraphs = eng["artifacts"]["paragraphs"]
        grown = []
        for s, e in ranges:
            p = next((p for p in paragraphs if p["start"] <= s < p["end"]), None)
            grown.append((min(s, p["start"]), max(e, p["end"])) if p else (s, e))
        ranges = grown
    return _span_dicts(text, ranges)


def placebo_spans(arm: str, text: str, eng: dict, arm_spans: list[dict], edits: list[dict]) -> list[dict]:
    """P_A's spans in original coordinates: the spans A changed, or for arms 5-7 the sentences
    A's insertions attach to."""
    title_span = next((s for s in arm_spans if s["field"] == "title"), None)
    title = title_span["text"] if title_span and any(e["field"] == "title" for e in edits) else None
    text_edits = [e for e in edits if e["field"] == "text"]
    if arm not in DONOR_ARMS:
        return _span_dicts(text, [(e["start"], e["end"]) for e in text_edits], title=title)
    sentences = [s for p in eng["artifacts"]["paragraphs"] for s in p["sentences"]]
    ranges = []
    for e in text_edits:
        ops = difflib.SequenceMatcher(None, text[e["start"] : e["end"]], e["replacement"], autojunk=False).get_opcodes()
        for op, i1, _, _, _ in ops:
            if op != "insert":
                continue
            pos = e["start"] + i1
            hit = next((s for s in sentences if s["start"] < pos <= s["end"]), None) or next(
                (s for s in sentences if pos <= s["start"] < e["end"]), None)
            ranges.append((hit["start"], hit["end"]) if hit else (e["start"], e["end"]))
    return _span_dicts(text, ranges)


class OriginMap:
    """Tracks, for the text after several splices, which original range each character came from,
    so the spans ALL's later steps edit can be mapped back to the original (for P_ALL)."""

    def __init__(self, text: str):
        self.text = text
        self.origin = [(i, i + 1) for i in range(len(text))]
        self.length = len(text)

    def _point(self, pos: int) -> tuple[int, int]:
        if pos < len(self.origin):
            p = self.origin[pos][0]
        else:
            p = self.origin[-1][1] if self.origin else self.length
        return (p, p)

    def to_original(self, start: int, end: int) -> tuple[int, int]:
        if start == end:
            return self._point(start)
        chars = self.origin[start:end]
        return (min(c[0] for c in chars), max(c[1] for c in chars))

    def apply(self, edits: list[dict]) -> None:
        text, origin, pos = [], [], 0
        for e in sorted(edits, key=lambda e: e["start"]):
            text.append(self.text[pos : e["start"]])
            origin += self.origin[pos : e["start"]]
            interval = self.to_original(e["start"], e["end"])
            text.append(e["replacement"])
            origin += [interval] * len(e["replacement"])
            pos = e["end"]
        text.append(self.text[pos:])
        origin += self.origin[pos:]
        self.text, self.origin = "".join(text), origin


# --- Prompts ----------------------------------------------------------------------------------


donor_name = validate.donor_name  # how a donor is named in an attribution (arms 5-7)


def donor_attribution(donor: dict | None) -> str:
    """The attribution instruction for arms 5 and 7: a link to the donor's URL, or its name."""
    if not donor:
        return ""
    if donor.get("url"):
        url = donor["url"]
        return (f'a Markdown link to the source\'s URL, either by turning a few existing words into the link '
                f'text, as in "[a 2020 study]({url})", or by adding a short link such as "([source]({url}))"')
    return f'the source\'s name in parentheses, such as "(source: {donor_name(donor)})" (the source has no URL)'


def _words(n: int) -> str:
    return "1 word" if n == 1 else f"{n} words"


def _range(lo: int, hi: int) -> str:
    return f"exactly {_words(lo)}" if lo == hi else f"{lo} to {hi} words"


def _quoted(words) -> str:
    return ", ".join(f'"{w}"' for w in words)


def term_forms(terms: list[str], text: str) -> dict[str, str]:
    """{key term: the first word of `text`, as written, that stems to it}."""
    forms: dict[str, str] = {}
    for w in re.findall(r"[^\W_]+", text):
        t = common.stem(w.lower())
        if t in terms and t not in forms:
            forms[t] = w
    return forms


def span_targets(query: str, spans: list[dict]) -> str:
    """For placebo prompts: each span's word count and allowed range (check 5) and the query's
    key-term words it must keep or must not gain (check 2)."""
    terms = common.content_terms(query)
    asked = term_forms(terms, query)
    lines, total = [], 0
    for s in spans:
        n = common.count_words(s["text"])
        total += n
        if n == 0:  # no word count to aim for (never "exactly 0 words"); the total below still binds
            line = f'- {s["id"]}: 0 counted words now.'
        else:
            lo, hi = validate.placebo_word_range(n)
            aim = "" if lo == hi else f", as close to {n} as you can"
            line = f'- {s["id"]}: {_words(n)} now. Write {_range(lo, hi)}{aim}.'
        has = term_forms(terms, s["text"])
        if has:
            line += f" Keep, spelled exactly as here: {_quoted(has[t] for t in terms if t in has)}."
        absent = [asked.get(t, t) for t in terms if t not in has]
        if absent:
            line += f" Do not add: {_quoted(absent)} (nor any other form of {'it' if len(absent) == 1 else 'them'})."
        lines.append(line)
    if total:  # check 5 sums the spans the answer changes
        lo, hi = validate.placebo_word_range(total)
        lines.append(f"- The spans you change, together, must keep their word count: all of them have "
                     f"{_words(total)} now, so if you change every span, write {_range(lo, hi)} in all.")
    return "\n".join(lines)


def opener(text: str) -> str:
    """The pointer word a paragraph opens with (else its first word)."""
    lead = LEADING_MARKS.sub("", text)
    m = POINTER_OPENER.match(lead)
    return m.group(0) if m else (lead.split() or [""])[0]


def opener_lines(spans: list[dict]) -> str:
    return "\n".join(f'- {s["id"]} opens with "{opener(s["text"])}"' for s in spans) or "(none)"


def render(name: str, query: str, title: str, page: str, spans: list[dict], donor: dict | None,
           missing_terms: list[str]) -> str:
    """prompts/<name>.txt with {{placeholders}} filled in one pass (values are never re-read)."""
    template = (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
    blocks = "\n\n".join(f'<span id="{s["id"]}">\n{s["text"]}\n</span>' for s in spans) or "(none)"
    values = {
        "query": query, "title": title, "page": page, "spans": blocks,
        "donor_title": (donor or {}).get("title") or "", "donor_url": (donor or {}).get("url") or "(none)",
        "donor_text": (donor or {}).get("text") or "", "donor_name": donor_name(donor) if donor else "",
        "donor_attribution": donor_attribution(donor), "missing_terms": ", ".join(missing_terms) or "(none)",
        "span_targets": span_targets(query, spans), "openers": opener_lines(spans),
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], template)


def with_feedback(prompt: str, failures: list[str], hints=()) -> str:
    lines = "\n".join(f"- {f}" for f in failures)
    details = "".join(f"\n- {h}" for h in hints)
    if details:
        details = f"\n\nWhat to fix:{details}"
    return (f"{prompt}\n\nYour previous answer failed these checks:\n{lines}{details}\n"
            "Return a corrected answer in the same format.")


def _placebo_hints(query: str, spans: list[dict], edits: list[dict]) -> list[str]:
    """Each changed span's measured word count against its range, the query words it dropped or
    gained, and the total that check 5 measures."""
    terms = common.content_terms(query)
    by_range = {(s["field"], s["start"], s["end"]): s for s in spans}
    hints, before, after = [], 0, 0
    for e in edits:
        s = by_range.get((e["field"], e["start"], e["end"]))
        if s is None:
            continue
        n, m = common.count_words(s["text"]), common.count_words(e["replacement"])
        before, after = before + n, after + m
        if n == 0:
            hint = f'{s["id"]}: your version has {_words(m)}; the original has 0 counted words.'
        else:
            lo, hi = validate.placebo_word_range(n)
            hint = (f'{s["id"]}: your version has {_words(m)}; it must have {_range(lo, hi)} '
                    f"(the original has {_words(n)}).")
        had, has = term_forms(terms, s["text"]), term_forms(terms, e["replacement"])
        lost = [had[t] for t in terms if t in had and t not in has]
        gained = [has[t] for t in terms if t in has and t not in had]
        if lost:
            hint += f" Put back {_quoted(lost)}, spelled as in the original."
        if gained:
            hint += f" Remove {_quoted(gained)}: the original span has no form of {'it' if len(gained) == 1 else 'them'}."
        hints.append(hint)
    if hints and before:
        lo, hi = validate.placebo_word_range(before)
        hints.append(f"The changed spans together have {_words(after)}; together they must have {_range(lo, hi)} "
                     f"(the originals have {_words(before)}).")
    return hints


def _opener_hints(spans: list[dict], edits: list[dict], text: str, eng: dict) -> list[str]:
    """Arm 1: the paragraphs of the edited text that still open with a pointer, by span id."""
    findings = [f for f in eng["checks"].get(ENGINE_CHECK["1"], {}).get("findings", [])
                if OPENER_FINDING in f["message"]]
    text_edits = [e for e in edits if e["field"] == "text"]

    def moved(pos: int, inside: bool) -> int:  # an original offset in the edited text
        return pos + sum(len(e["replacement"]) - (e["end"] - e["start"]) for e in text_edits
                         if e["end"] <= pos and (inside or e["start"] < pos))

    where = [(s["id"], moved(s["start"], False), moved(s["end"], True)) for s in spans if s["field"] == "text"]
    hints = []
    for f in findings:
        sid = next((i for i, a, b in where if a <= f["start"] < b), None)
        named = re.search(r'opens with "([^"]+)"', f["message"])
        word = named.group(1) if named else opener(text[f["start"] :])
        start = " ".join(text[f["start"] : f["end"]].split()[:8])
        hints.append(f'{sid or "A paragraph"} still opens with "{word}" ("{start} ..."): make its first words the '
                     f'subject that "{word}" stands for, as in the example, and do not start it with a pointer word.')
    return hints


def retry_hints(task: dict, edits: list[dict], edited, eng) -> list[str]:
    """Details for the regenerate message beyond the validator's own messages."""
    if validate.is_placebo(task["arm"]):
        return _placebo_hints(task["query"], task["spans"], edits)
    if task["arm"] == "1" and eng is not None:
        return _opener_hints(task["spans"], edits, edited[1], eng)
    return []


def prompt_name(arm: str) -> str:
    if arm == "P_ALL":
        return "p_all"
    return f"p{arm[1:]}" if arm.startswith("P") else f"arm{arm}"


# --- Responses --------------------------------------------------------------------------------


def _json_object(text: str):
    body = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip())
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        value = json.loads(body[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse_response(arm: str, text: str, spans: list[dict], donor: dict | None):
    """(edits, outcome): outcome None when the answer parsed, "NONE" for arm 7's no-support answer,
    otherwise a message saying what was wrong (fed back on the regenerate)."""
    if arm == "7" and text.strip().strip("`").strip() == "NONE":
        return [], "NONE"
    obj = _json_object(text)
    if obj is None:
        return [], "The answer must be one JSON object mapping span ids to replacements."
    if arm == "7" and not obj:
        return [], "NONE"
    by_id = {s["id"]: s for s in spans}
    unknown = [k for k in obj if k not in by_id]
    if unknown:
        return [], f"Unknown span id {unknown[0]!r}; use only the ids given ({', '.join(by_id)})."
    if arm == "6":
        if len(obj) != 1:
            return [], "Pick exactly one span and one quotation."
        sid, value = next(iter(obj.items()))
        if not isinstance(value, dict) or not isinstance(value.get("quote"), str) or not isinstance(value.get("speaker"), str):
            return [], 'The value must be {"quote": "<exact passage>", "speaker": "<name>"}.'
        quote, speaker = _norm_ws(value["quote"]), _norm_ws(value["speaker"])
        if not quote or not speaker:
            return [], "Give both the quotation and the speaker."
        if re.search(r"[\"“”]", quote):
            return [], "Pick a passage that has no double quote marks inside it."
        if quote not in _norm_ws((donor or {}).get("text") or ""):
            return [], "The quotation must be copied verbatim from the source document."
        if common.count_words(quote) > QUOTE_MAX_WORDS:
            return [], f"The quotation must be {QUOTE_MAX_WORDS} words or fewer."
        s = by_id[sid]
        return [{"field": s["field"], "start": s["start"], "end": s["end"],
                 "replacement": f'{s["text"]}\n\nAccording to {speaker}, "{quote}"'}], None
    edits = []
    for sid, value in obj.items():
        if not isinstance(value, str):
            return [], f"The replacement for {sid!r} must be a string."
        s = by_id[sid]
        if value != s["text"]:
            edits.append({"field": s["field"], "start": s["start"], "end": s["end"], "replacement": value})
    return sorted(edits, key=lambda e: (e["field"], e["start"])), None


# --- Backends ---------------------------------------------------------------------------------


class FakeBackend:
    """A fake editor for the local smoke run: fixed replacements, no model.
    Arm 2 appends "?" to each heading; arm 7 answers NONE; every other arm returns its spans
    unchanged (so its validators fail and the regenerate path runs)."""

    def generate(self, jobs: list[dict]) -> list[tuple[str, str]]:
        out = []
        for j in jobs:
            if j["arm"] == "7":
                out.append(("NONE", "stop"))
            elif j["arm"] == "2":
                out.append((json.dumps({s["id"]: s["text"].rstrip(" ?.:") + "?" for s in j["spans"]}), "stop"))
            else:
                out.append((json.dumps({s["id"]: s["text"] for s in j["spans"]}), "stop"))
        return out


class VllmBackend:
    """Gemma-4-31B-it in one vLLM process (Explorer), temperature 0, 4,096 new tokens."""

    def __init__(self, model: str, tp: int, max_model_len: int, max_tokens: int = MAX_NEW_TOKENS,
                 no_thinking: bool = True):
        from vllm import LLM  # imported here so the rest runs without a GPU

        self.llm = LLM(model=model, max_model_len=max_model_len, gpu_memory_utilization=0.9, seed=1,
                       enforce_eager=True, tensor_parallel_size=tp)
        self.max_tokens = max_tokens
        self.kwargs = {"chat_template_kwargs": {"enable_thinking": False}} if no_thinking else {}

    def generate(self, jobs: list[dict]) -> list[tuple[str, str]]:
        from vllm import SamplingParams

        if not jobs:
            return []
        params = SamplingParams(temperature=0.0, max_tokens=self.max_tokens, seed=1)
        outs = self.llm.chat([[{"role": "user", "content": j["prompt"]}] for j in jobs], params, **self.kwargs)
        return [(o.outputs[0].text, o.outputs[0].finish_reason) for o in outs]


# --- The loop ---------------------------------------------------------------------------------


def _edited(version, edits):
    title, text = version
    return (splice(title, [e for e in edits if e["field"] == "title"]),
            splice(text, [e for e in edits if e["field"] == "text"]))


def _engine_items(pairs):
    return [{"id": key, "markdown": version[1], "question": query} for key, version, query in pairs]


def edit_round(tasks: list[dict], backend, engine, log: list) -> dict:
    """Generates, splices and validates each task, regenerating a failure once.
    Returns {key: {status: valid|excluded|none, attempts, edited, edits, eng, failures}}."""
    results, pending = {}, []
    for t in tasks:
        t["prompt_now"] = t["prompt"]
        pending.append(t)
    for attempt in (1, 2):
        if not pending:
            break
        outs = backend.generate([{"key": t["key"], "arm": t["arm"], "spans": t["spans"], "prompt": t["prompt_now"]}
                                 for t in pending])
        failed, candidates = [], []
        for t, (answer, finish) in zip(pending, outs):
            log.append({"key": t["key"], "attempt": attempt, "prompt": t["prompt_now"], "answer": answer,
                        "finish_reason": finish})
            if finish == "length":
                failed.append((t, [CUT_OFF], None, []))
                continue
            edits, outcome = parse_response(t["arm"], answer, t["spans"], t.get("donor"))
            if outcome == "NONE":
                results[t["key"]] = {"status": "none", "attempts": attempt, "edited": t["before"], "edits": [],
                                     "eng": None, "failures": []}
                continue
            if outcome:
                failed.append((t, [outcome], None, []))
                continue
            candidates.append((t, edits, _edited(t["before"], edits)))
        engs = engine(_engine_items([(f"{t['key']}#{attempt}", ed, t["query"]) for t, _, ed in candidates]))
        for t, edits, edited in candidates:
            eng = engs[f"{t['key']}#{attempt}"]
            res = validate.validate(arm=t["arm"], original=t["before"], edited=edited, edits=edits, spans=t["spans"],
                                    eng_orig=t["eng_before"], eng_edit=eng, query=t["query"], target=t["target"],
                                    donor=t.get("donor"), step=t.get("step", False))
            if res["valid"]:
                results[t["key"]] = {"status": "valid", "attempts": attempt, "edited": edited, "edits": edits,
                                     "eng": eng, "failures": [], "added_words": res["added_words"]}
            else:
                failed.append((t, res["failures"], edited, retry_hints(t, edits, edited, eng)))
        pending = []
        for t, failures, edited, hints in failed:
            t["last_failures"], t["last_edited"] = failures, edited or t.get("last_edited")
            if attempt == 1:
                t["prompt_now"] = with_feedback(t["prompt"], failures, hints)
                pending.append(t)
            else:
                results[t["key"]] = {"status": "excluded", "attempts": 2, "edited": t["last_edited"] or t["before"],
                                     "edits": [], "eng": None, "failures": failures}
    return results


def validate_deterministic(tasks: list[dict], engine) -> dict:
    """Deterministic edits are validated once (nothing to regenerate)."""
    engs = engine(_engine_items([(t["key"], t["edited"], t["query"]) for t in tasks]))
    out = {}
    for t in tasks:
        eng = engs[t["key"]]
        spans = [{"field": e["field"], "start": e["start"], "end": e["end"]} for e in t["edits"]]
        res = validate.validate(arm=t["arm"], original=t["before"], edited=t["edited"], edits=t["edits"], spans=spans,
                                eng_orig=t["eng_before"], eng_edit=eng, query=t["query"], target=t["target"],
                                donor=t.get("donor"), step=t.get("step", False))
        out[t["key"]] = {"status": "valid" if res["valid"] else "excluded", "attempts": 1, "edited": t["edited"],
                         "edits": t["edits"], "eng": eng, "failures": res["failures"],
                         "added_words": res["added_words"]}
    return out


def deterministic_edits(arm: str, text: str, eng: dict, query: str):
    if arm == "4":
        return da.arm4(text, eng)
    if arm == "9":
        return da.arm9(text, eng, query)
    if arm == "11":
        return da.arm11(text, eng, query)
    if arm == "13":
        return da.arm13(text, eng)
    return da.arm14(text, eng)


def run(pages: list[dict], applicability: list[dict], backend, arms=None, engine=None, placebos=True,
        do_all=True, log: list | None = None) -> list[dict]:
    """All versions for the given pages (any mix of sets); returns versions.jsonl rows."""
    engine = engine or common.run_engine
    log = log if log is not None else []
    arms = list(LLM_ARMS + DETERMINISTIC_ARMS) if arms is None else [str(a) for a in arms]
    app = {(r["query_id"], str(r["arm"])): r["applicable"] for r in applicability}
    queries: dict[str, dict] = {}
    for p in pages:
        q = queries.setdefault(p["query_id"], {"donor": None})
        if p["role"] == "target":
            q["target"] = p
        elif p["role"] == "donor":
            q["donor"] = {"title": p["title"], "text": p["text"], "url": p["url"]}
    queries = {k: v for k, v in queries.items() if "target" in v}
    eng0 = engine(_engine_items([(qid, (q["target"]["title"], q["target"]["text"]), q["target"]["query"])
                                 for qid, q in queries.items()]))

    rows: list[dict] = []

    def original(qid):
        t = queries[qid]["target"]
        return (t["title"], t["text"])

    def row(qid, arm, version, valid, attempts, reason, added=0, skipped=()):
        t = queries[qid]["target"]
        return {"version_id": f"{qid}:{arm}", "query_id": qid, "set": t["set"], "arm": arm, "text": version[1],
                "title": version[0], "valid": valid, "attempts": attempts, "excluded_reason": reason,
                **validate.metrics(t["query"], original(qid), version), "added_words": added,
                "skipped_steps": list(skipped)}

    def result_row(qid, arm, res):
        if res["status"] == "valid":
            return row(qid, arm, res["edited"], True, res["attempts"], None, res.get("added_words", 0))
        if res["status"] == "none":
            return row(qid, arm, res["edited"], False, res["attempts"], "not applicable: the editor returned NONE")
        return row(qid, arm, res["edited"], False, res["attempts"], "invalid: " + " | ".join(res["failures"]))

    def llm_task(qid, arm, before, eng_before, spans, step=False):
        q, t = queries[qid], queries[qid]["target"]
        name = prompt_name(arm)
        missing = da.missing_terms(t["query"], before[0], before[1], eng_before) if arm == "12" else []
        donor = q["donor"] if arm in DONOR_ARMS else None  # placebos never see the donor
        return {"key": f"{qid}|{arm}" + ("|step" if step else ""), "qid": qid, "arm": arm, "spans": spans,
                "prompt": render(name, t["query"], before[0], before[1], spans, donor, missing),
                "before": before, "eng_before": eng_before, "query": t["query"], "target": original(qid),
                "donor": donor, "step": step}

    for qid in queries:
        rows.append(row(qid, "original", original(qid), True, 1, None))

    def ok(qid, arm):
        return app.get((qid, arm), False) and (arm not in DONOR_ARMS or queries[qid]["donor"] is not None)

    # Deterministic arms.
    det = []
    for arm in [a for a in DETERMINISTIC_ARMS if a in arms]:
        for qid in queries:
            if not ok(qid, arm):
                continue
            edits, reason = deterministic_edits(arm, original(qid)[1], eng0[qid], queries[qid]["target"]["query"])
            if edits is None:
                rows.append(row(qid, arm, original(qid), False, 1, f"invalid: {reason}"))
                continue
            det.append({"key": f"{qid}|{arm}", "qid": qid, "arm": arm, "edits": edits, "before": original(qid),
                        "edited": _edited(original(qid), edits), "eng_before": eng0[qid],
                        "query": queries[qid]["target"]["query"], "target": original(qid), "donor": None})
    det_results = validate_deterministic(det, engine)
    for t in det:
        rows.append(result_row(t["qid"], t["arm"], det_results[t["key"]]))

    # LLM arms.
    tasks, arm_spans = [], {}
    for arm in [a for a in LLM_ARMS if a in arms]:
        for qid in queries:
            if not ok(qid, arm):
                continue
            spans = spans_for_arm(arm, queries[qid]["target"], eng0[qid])
            if not spans:
                rows.append(row(qid, arm, original(qid), False, 1, "invalid: the check reports no span to edit"))
                continue
            arm_spans[(qid, arm)] = spans
            tasks.append(llm_task(qid, arm, original(qid), eng0[qid], spans))
    llm_results = edit_round(tasks, backend, engine, log)
    for t in tasks:
        rows.append(result_row(t["qid"], t["arm"], llm_results[t["key"]]))

    # Placebos.
    if placebos:
        ptasks = []
        for t in tasks:
            res = llm_results[t["key"]]
            if t["arm"] not in PLACEBO_ARMS or res["status"] != "valid":
                continue
            qid = t["qid"]
            spans = placebo_spans(t["arm"], original(qid)[1], eng0[qid], arm_spans[(qid, t["arm"])], res["edits"])
            if spans:
                ptasks.append(llm_task(qid, f"P{t['arm']}", original(qid), eng0[qid], spans))
        presults = edit_round(ptasks, backend, engine, log)
        for t in ptasks:
            rows.append(result_row(t["qid"], t["arm"], presults[t["key"]]))

    if do_all:
        rows += run_all(queries, eng0, app, ok, backend, engine, log, row, llm_task, placebos)
    return rows


def run_all(queries, eng0, app, ok, backend, engine, log, row, llm_task, placebos) -> list[dict]:
    """ALL (and P_ALL): the applicable tool-check edits in the fixed order, step by step. A step
    that fails validation is skipped and recorded (r3 amendment 9)."""
    state = {}
    for qid, q in queries.items():
        if not app.get((qid, "ALL"), False):
            continue
        t = q["target"]
        state[qid] = {"version": (t["title"], t["text"]), "eng": eng0[qid], "map": OriginMap(t["text"]),
                      "llm": [], "steps": 0, "attempts": 1, "skipped": [], "added": 0,
                      "order": ALL_TEXT_ORDER if t["set"] == "replication" else ALL_ORDER}
    for arm in ALL_ORDER:
        det, tasks = [], []
        for qid, s in state.items():
            # On the replication set, arm 8 is not run alone but is a step of ALL-text, so the
            # table marks it "not run"; the step then rests on the engine re-check below.
            step_ok = ok(qid, arm) or (arm == "8" and queries[qid]["target"]["set"] == "replication")
            if arm not in s["order"] or not step_ok:
                continue
            c = s["eng"]["checks"].get(ENGINE_CHECK[arm], {})
            if not c.get("applicable") or c.get("score", 0) >= 0.9:
                continue  # the earlier steps already fixed what this check flags
            query = queries[qid]["target"]["query"]
            if arm in DETERMINISTIC_ARMS:
                edits, _ = deterministic_edits(arm, s["version"][1], s["eng"], query)
                if edits:
                    det.append({"key": f"{qid}|ALL{arm}", "qid": qid, "arm": arm, "edits": edits,
                                "before": s["version"], "edited": _edited(s["version"], edits),
                                "eng_before": s["eng"], "query": query, "target": (queries[qid]["target"]["title"],
                                                                                   queries[qid]["target"]["text"]),
                                "donor": None, "step": True})
            else:
                spans = spans_for_arm(arm, {"title": s["version"][0], "text": s["version"][1]}, s["eng"])
                if spans:
                    tasks.append(llm_task(qid, arm, s["version"], s["eng"], spans, step=True))
        results = {**validate_deterministic(det, engine), **edit_round(tasks, backend, engine, log)}
        for t in det + tasks:
            s, res = state[t["qid"]], results[t["key"]]
            if res["status"] == "none":
                continue
            if res["status"] != "valid":  # skipped: the next step starts from this step's input
                s["skipped"].append({"step": t["arm"], "reason": "invalid: " + " | ".join(res["failures"])})
                s["attempts"] = max(s["attempts"], res["attempts"])
                continue
            text_edits = [e for e in res["edits"] if e["field"] == "text"]
            if t["arm"] in LLM_ARMS:
                # The spans this step's placebo would paraphrase (for 5-7, the sentences the
                # insertion attaches to), mapped back to the original for P_ALL.
                touched = placebo_spans(t["arm"], s["version"][1], s["eng"], t["spans"], text_edits)
                s["llm"] += [s["map"].to_original(x["start"], x["end"]) for x in touched]
            s["map"].apply(text_edits)
            s["version"], s["eng"] = res["edited"], res["eng"]
            s["steps"] += 1
            s["attempts"] = max(s["attempts"], res["attempts"])
    rows, ptasks = [], []
    for qid, s in state.items():
        t = queries[qid]["target"]
        original = (t["title"], t["text"])
        if s["steps"] == 0:  # r3 amendments 5 and 9: nothing tried is not applicable; all failed is invalid
            reason = "invalid: every step failed" if s["skipped"] else "not applicable: no step applied"
            rows.append(row(qid, "ALL", s["version"], False, s["attempts"], reason, skipped=s["skipped"]))
            continue
        res = validate.validate_all(original, s["version"], t["query"], original, queries[qid]["donor"])
        reason = None if res["valid"] else "invalid: " + " | ".join(res["failures"])
        rows.append(row(qid, "ALL", s["version"], res["valid"], s["attempts"], reason, skipped=s["skipped"]))
        if res["valid"] and placebos and s["llm"]:
            spans = _span_dicts(t["text"], s["llm"])
            if spans:
                ptasks.append(llm_task(qid, "P_ALL", original, eng0[qid], spans))
    presults = edit_round(ptasks, backend, engine, log)
    for t in ptasks:
        res = presults[t["key"]]
        reason = None if res["status"] == "valid" else "invalid: " + " | ".join(res["failures"])
        rows.append(row(t["qid"], "P_ALL", res["edited"], res["status"] == "valid", res["attempts"], reason))
    return rows


SETS = ["main", "replication", "smoke", "timing"]


def select_pages(pages: list[dict], sets: list[str] | None) -> list[dict]:
    """The pages of the named sets; by default every set except the timing smoke (r3 amendment 8),
    which is edited only when named, so its versions never mix into a main run's versions.jsonl."""
    return [p for p in pages if (p["set"] in sets if sets else p["set"] != "timing")]


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pages", default=str(common.DATA / "pages.jsonl"))
    ap.add_argument("--applicability", default=str(common.DATA / "applicability.jsonl"))
    ap.add_argument("--out", default=str(common.DATA / "versions.jsonl"))
    ap.add_argument("--log", default=str(common.DATA / "editor_log.jsonl"), help="every prompt and answer (local only)")
    ap.add_argument("--set", action="append", choices=SETS,
                    help="sets to edit (repeatable; default all but timing, which runs only when named)")
    ap.add_argument("--arms", help="comma-separated arms to run (default all); placebos follow their arm")
    ap.add_argument("--no-placebos", action="store_true")
    ap.add_argument("--no-all", action="store_true", help="skip ALL and P_ALL")
    ap.add_argument("--backend", choices=["vllm", "fake"], required=True)
    ap.add_argument("--model", default=EDITOR_MODEL)
    ap.add_argument("--tp", type=int, default=1)
    ap.add_argument("--max-model-len", type=int, default=20480)
    ap.add_argument("--thinking", action="store_true", help="leave the chat template's thinking mode on")
    return ap


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    pages = select_pages(common.read_jsonl(args.pages), args.set)
    applicability = common.read_jsonl(args.applicability)
    backend = FakeBackend() if args.backend == "fake" else VllmBackend(
        args.model, args.tp, args.max_model_len, no_thinking=not args.thinking)
    t0, log = time.time(), []
    rows = run(pages, applicability, backend, arms=args.arms.split(",") if args.arms else None,
               placebos=not args.no_placebos, do_all=not args.no_all, log=log)
    common.write_jsonl(args.out, rows)
    common.write_jsonl(args.log, log)
    summary: dict[str, dict] = {}
    for r in rows:
        s = summary.setdefault(r["arm"], {"versions": 0, "valid": 0, "not_applicable": 0, "attempts_2": 0})
        s["versions"] += 1
        s["valid"] += r["valid"]
        s["not_applicable"] += bool(r["excluded_reason"] and r["excluded_reason"].startswith("not applicable"))
        s["attempts_2"] += r["attempts"] == 2
    print(json.dumps({"backend": args.backend, "model": args.model if args.backend == "vllm" else None,
                      "seconds": round(time.time() - t0, 1), "prompts": len(log), "per_arm": summary}, indent=1))


if __name__ == "__main__":
    main()
