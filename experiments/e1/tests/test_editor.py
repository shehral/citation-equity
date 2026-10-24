"""Tests for editor.py: spans, prompts, response parsing and splicing, placebo spans, the ALL
offset map and the generate-validate-regenerate loop (with a fake editor and a fake engine)."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import editor  # noqa: E402
import validate  # noqa: E402
from helpers import check, fake_engine  # noqa: E402

TEXT = (
    "This matters a lot. Espresso tastes bitter when over extracted.\n\n"
    "## Grind size\n\nA fine grind slows the water. It said \"go slower now please\" once.\n\n"
    "## Water\n\nHot water extracts faster."
)
QUERY = "why does espresso taste bitter"
DONOR = {"title": "Donor", "url": "https://donor.org/a",
         "text": "Baristas agree. Experts say \"bitterness comes from over extraction\" in tests. 70% of shots run long."}


def rng(sub, text=TEXT):
    s = text.index(sub)
    return {"start": s, "end": s + len(sub), "message": "m"}


class SpansTest(unittest.TestCase):
    def test_arm1_keeps_only_opener_findings(self):
        eng = fake_engine(TEXT, {"standalone-paragraphs": check(0.5, findings=[
            dict(rng("This matters a lot. Espresso tastes bitter when over extracted."),
                 message='It opens with "This", which points back to earlier text, so ...'),
            dict(rng("Hot water extracts faster."), message="It has 4 words, too short ...")])})
        spans = editor.spans_for_arm("1", {"title": "T", "text": TEXT}, eng)
        self.assertEqual([s["text"] for s in spans], ["This matters a lot. Espresso tastes bitter when over extracted."])
        self.assertEqual(spans[0]["id"], "s1")

    def test_arm6_expands_an_inline_quote_to_its_paragraph(self):
        eng = fake_engine(TEXT, {"expert-quotes": check(0.5, findings=[rng('"go slower now please"')])})
        spans = editor.spans_for_arm("6", {"title": "T", "text": TEXT}, eng)
        self.assertEqual(spans[0]["text"], 'A fine grind slows the water. It said "go slower now please" once.')

    def test_arm12_uses_title_first_heading_and_first_paragraph(self):
        spans = editor.spans_for_arm("12", {"title": "Guide", "text": TEXT}, fake_engine(TEXT))
        self.assertEqual([(s["id"], s["field"], s["text"]) for s in spans], [
            ("title", "title", "Guide"),
            ("s1", "text", "This matters a lot. Espresso tastes bitter when over extracted."),
            ("s2", "text", "Grind size")])

    def test_overlapping_findings_merge(self):
        a, b = rng("A fine grind slows the water."), rng("slows the water. It said")
        eng = fake_engine(TEXT, {"lists": check(0.5, findings=[a, b])})
        spans = editor.spans_for_arm("3", {"title": "T", "text": TEXT}, eng)
        self.assertEqual([s["text"] for s in spans], ['A fine grind slows the water. It said'])


class PromptTest(unittest.TestCase):
    def test_every_arm_and_placebo_has_a_prompt_without_em_dashes(self):
        for name in editor.PROMPT_NAMES:
            body = (editor.PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
            self.assertNotIn("\u2014", body, name)
            self.assertIn("{{spans}}", body, name)
            self.assertIn("JSON", body, name)
        for name in ("arm5", "arm6", "arm7"):
            self.assertIn("{{donor_text}}", (editor.PROMPTS_DIR / f"{name}.txt").read_text(), name)

    def test_render_fills_every_placeholder_once(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 4, "text": "This"}]
        out = editor.render("arm5", query=QUERY, title="T {{query}}", page="Cost is $5 {{title}}", spans=spans,
                            donor=DONOR, missing_terms=[])
        self.assertNotRegex(out, r"\{\{(?!query\}\}|title\}\})\w+\}\}")
        self.assertIn('<span id="s1">\nThis\n</span>', out)
        self.assertIn("T {{query}}", out)  # page text is never re-substituted
        self.assertIn("https://donor.org/a", out)

    def test_a_donor_without_a_url_is_attributed_by_name(self):
        named = {"title": "", "url": None, "text": "Comet watch 2031: best nights to look up\nMore text here."}
        self.assertEqual(editor.donor_name(named), "Comet watch 2031: best nights to look up")
        self.assertEqual(editor.donor_name({"title": "Sample Lakes - Example Encyclopedia", "url": "https://encyclopedia.example.org/x",
                                            "text": "t"}), "Example Encyclopedia")
        out = editor.render("arm7", query=QUERY, title="T", page="p", spans=[], donor=named, missing_terms=[])
        self.assertIn("(source: Comet watch 2031: best nights to look up)", out)
        self.assertNotIn("](", out.split("Source document")[0].split("The change:")[1])
        linked = editor.render("arm7", query=QUERY, title="T", page="p", spans=[], donor=DONOR, missing_terms=[])
        self.assertIn("([source](https://donor.org/a))", linked)

    def test_feedback_is_appended(self):
        base = editor.render("arm2", query=QUERY, title="T", page="p", spans=[], donor=None, missing_terms=[])
        retry = editor.with_feedback(base, ["The question-headings check did not rise (0.000 -> 0.000)."])
        self.assertTrue(retry.startswith(base))
        self.assertIn("did not rise", retry)


class ParseTest(unittest.TestCase):
    spans = [{"id": "s1", "field": "text", "start": 0, "end": 4, "text": "This"},
             {"id": "title", "field": "title", "start": 0, "end": 5, "text": "Guide"}]

    def test_json_replacements_become_edits(self):
        edits, outcome = editor.parse_response("2", '```json\n{"s1": "Coffee", "title": "Guide"}\n```', self.spans, None)
        self.assertIsNone(outcome)
        self.assertEqual(edits, [{"field": "text", "start": 0, "end": 4, "replacement": "Coffee"}])

    def test_bad_answers_give_a_message(self):
        self.assertIn("JSON", editor.parse_response("2", "no json here", self.spans, None)[1])
        self.assertIn("s9", editor.parse_response("2", '{"s9": "x"}', self.spans, None)[1])
        self.assertIn("string", editor.parse_response("2", '{"s1": 3}', self.spans, None)[1])

    def test_arm7_none(self):
        self.assertEqual(editor.parse_response("7", "NONE", self.spans, DONOR), ([], "NONE"))
        self.assertEqual(editor.parse_response("7", "{}", self.spans, DONOR), ([], "NONE"))

    def test_arm6_splices_a_verbatim_donor_quote(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 4, "text": "This"}]
        ok = '{"s1": {"quote": "bitterness comes from over extraction", "speaker": "Experts"}}'
        edits, outcome = editor.parse_response("6", ok, spans, DONOR)
        self.assertIsNone(outcome)
        self.assertEqual(edits[0]["replacement"], 'This\n\nAccording to Experts, "bitterness comes from over extraction"')
        bad = '{"s1": {"quote": "bitterness comes from roasting", "speaker": "Experts"}}'
        self.assertIn("verbatim", editor.parse_response("6", bad, spans, DONOR)[1])
        long = '{"s1": {"quote": "%s", "speaker": "X"}}' % " ".join(["w"] * 41)
        self.assertIn("40", editor.parse_response("6", long, spans, dict(DONOR, text=" ".join(["w"] * 50)))[1])


class PlaceboSpansTest(unittest.TestCase):
    def test_rewrite_arms_use_the_changed_spans(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 4, "text": "This"},
                 {"id": "s2", "field": "text", "start": 10, "end": 14, "text": "abcd"}]
        edits = [{"field": "text", "start": 10, "end": 14, "replacement": "ABCD"}]
        out = editor.placebo_spans("2", TEXT, fake_engine(TEXT), spans, edits)
        self.assertEqual([(s["start"], s["end"]) for s in out], [(10, 14)])

    def test_additive_arms_use_the_sentence_the_insertion_attaches_to(self):
        s = TEXT.index("A fine grind slows the water.")
        para_end = TEXT.index(" once.") + len(" once.")
        edits = [{"field": "text", "start": s, "end": para_end,
                  "replacement": TEXT[s:para_end] + '\n\nAccording to X, "q"'}]
        out = editor.placebo_spans("6", TEXT, fake_engine(TEXT), [], edits)
        self.assertEqual([TEXT[x["start"]:x["end"]] for x in out], ['It said "go slower now please" once.'])


class OriginMapTest(unittest.TestCase):
    def test_maps_spans_of_later_steps_back_to_the_original(self):
        m = editor.OriginMap("abcdefghij")
        m.apply([{"field": "text", "start": 0, "end": 0, "replacement": "XY"},       # insert at top
                 {"field": "text", "start": 4, "end": 6, "replacement": "EEEE"}])    # "ef" -> "EEEE"
        self.assertEqual(m.text, "XYabcdEEEEghij")
        self.assertEqual(m.to_original(6, 10), (4, 6))   # the replaced span
        self.assertEqual(m.to_original(0, 2), (0, 0))    # inserted text maps to its insertion point
        self.assertEqual(m.to_original(10, 12), (6, 8))


def toy_engine(items):
    """A fake engine: question-headings = share of H2 headings ending in '?'."""
    out = {}
    for item in items:
        md = item["markdown"]
        heads = re.findall(r"(?m)^## (.*)$", md)
        findings = [rng(h, md) for h in heads if not h.endswith("?")]
        eng = fake_engine(md, {"question-headings": check(sum(h.endswith("?") for h in heads) / max(1, len(heads)),
                                                          applicable=len(heads) >= 2, findings=findings)})
        out[item["id"]] = {"id": item["id"], **eng}
    return out


class LoopTest(unittest.TestCase):
    def page(self, role, i):
        return {"page_id": f"q1-p{i}", "query_id": "q1", "set": "smoke", "query": QUERY, "url": None,
                "source": "sample", "title": "T", "text": TEXT if role == "target" else "Donor text.",
                "words": 30, "tokens_max": 40, "cut": False, "sha256": "0" * 64, "role": role}

    def test_regenerates_once_with_the_validator_message_then_records_attempts(self):
        pages = [self.page("target", 1), self.page("donor", 2)]
        applicability = [{"query_id": "q1", "arm": "2", "applicable": True, "reason": None}]

        class Backend:
            def __init__(self):
                self.prompts = []

            def generate(self, jobs):
                self.prompts += [j["prompt"] for j in jobs]
                out = []
                for j in jobs:
                    if "failed these checks" in j["prompt"]:
                        body = {s["id"]: s["text"].rstrip("?") + "?" for s in j["spans"]}
                    else:
                        body = {s["id"]: s["text"] for s in j["spans"]}  # no change: check 2 fails
                    out.append((editor.json.dumps(body), "stop"))
                return out

        backend = Backend()
        rows = editor.run(pages, applicability, backend, arms=["2"], engine=toy_engine, placebos=False, do_all=False)
        by_arm = {r["arm"]: r for r in rows}
        self.assertEqual(by_arm["original"]["valid"], True)
        self.assertEqual((by_arm["2"]["valid"], by_arm["2"]["attempts"]), (True, 2))
        self.assertIn("## Grind size?", by_arm["2"]["text"])
        self.assertEqual(len(backend.prompts), 2)
        self.assertIn("did not rise", backend.prompts[1])

    def test_a_cut_off_answer_counts_as_failed_and_two_failures_exclude(self):
        pages = [self.page("target", 1)]
        applicability = [{"query_id": "q1", "arm": "2", "applicable": True, "reason": None}]

        class Cut:
            def generate(self, jobs):
                return [('{"s1": "Why', "length") for _ in jobs]

        rows = editor.run(pages, applicability, Cut(), arms=["2"], engine=toy_engine, placebos=False, do_all=False)
        row = next(r for r in rows if r["arm"] == "2")
        self.assertEqual((row["valid"], row["attempts"]), (False, 2))
        self.assertIn("token limit", row["excluded_reason"])

    def test_p_all_paraphrases_the_original_spans_of_alls_llm_steps(self):
        pages = [self.page("target", 1)]
        applicability = [{"query_id": "q1", "arm": a, "applicable": True, "reason": None} for a in ("2", "ALL")]

        class Backend:
            def __init__(self):
                self.jobs = []

            def generate(self, jobs):
                self.jobs += jobs
                out = []
                for j in jobs:
                    if j["arm"] == "2":
                        out.append((editor.json.dumps({s["id"]: s["text"] + "?" for s in j["spans"]}), "stop"))
                    else:
                        out.append((editor.json.dumps({s["id"]: s["text"].replace("Grind size", "Size of grind")
                                                       for s in j["spans"]}), "stop"))
                return out

        backend = Backend()
        rows = editor.run(pages, applicability, backend, arms=[], engine=toy_engine, placebos=True, do_all=True)
        by_arm = {r["arm"]: r for r in rows}
        self.assertTrue(by_arm["ALL"]["valid"], by_arm["ALL"]["excluded_reason"])
        p_all = next(j for j in backend.jobs if j["arm"] == "P_ALL")
        self.assertEqual([s["text"] for s in p_all["spans"]], ["Grind size", "Water"])

    def test_interface_fields(self):
        rows = editor.run([self.page("target", 1)], [], editor.FakeBackend(), arms=[], engine=toy_engine,
                          placebos=False, do_all=False)
        self.assertEqual(set(rows[0]) >= {"version_id", "query_id", "arm", "text", "title", "valid", "attempts",
                                          "excluded_reason", "edit_distance", "length_ratio", "key_terms_delta",
                                          "skipped_steps"}, True)


# A synthetic query (not from GEO-bench): "save" stems to "sav", and the plural "Crewmen" does not stem to
# the key term "crewman".
SAVES = "how much do ferry crewman save"


class PlaceboPromptTest(unittest.TestCase):
    spans = [{"id": "s1", "field": "text", "start": 0, "end": 1,
              "text": "Most deckhands save their money from overtime on every single crossing they work each month here."},
             {"id": "s2", "field": "text", "start": 2, "end": 3, "text": "Pay plans differ."}]

    def test_every_placebo_prompt_takes_the_span_targets(self):
        for name in [n for n in editor.PROMPT_NAMES if n.startswith("p")]:
            body = (editor.PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
            self.assertIn("{{span_targets}}", body, name)
            self.assertNotIn("within 10%", body, name)  # replaced by the exact per-span ranges

    def test_word_range_matches_the_validators_own_check(self):
        for n in range(0, 400):
            lo, hi = validate.placebo_word_range(n)
            ok = lambda m: validate.check_length("P3", ("", ""), ("", ""), [" ".join(["w"] * n)],  # noqa: E731
                                                 [" ".join(["w"] * m)])[0] is None
            self.assertTrue(ok(lo) and ok(hi), n)
            if n:
                self.assertFalse(ok(lo - 1), n)
                self.assertFalse(ok(hi + 1), n)
        self.assertEqual(validate.placebo_word_range(19), (18, 20))
        self.assertEqual(validate.placebo_word_range(130), (117, 143))
        self.assertEqual(validate.placebo_word_range(2), (2, 2))

    def test_the_prompt_gives_each_spans_word_count_range_and_key_words(self):
        out = editor.render("p3", query=SAVES, title="T", page="p", spans=self.spans, donor=None, missing_terms=[])
        self.assertNotRegex(out, r"\{\{\w+\}\}")
        line1 = next(line for line in out.split("\n") if line.startswith("- s1:"))
        self.assertIn("16 words", line1)
        self.assertIn("15 to 17 words", line1)
        self.assertIn('"save"', line1)
        self.assertIn('"ferry"', line1.split("Do not add")[1])
        self.assertIn('"crewman"', line1.split("Do not add")[1])
        line2 = next(line for line in out.split("\n") if line.startswith("- s2:"))
        self.assertIn("exactly 3 words", line2)
        self.assertIn('"ferry", "crewman", "save"', line2)
        total = next(line for line in out.split("\n") if line.startswith("- The spans you change"))
        self.assertIn("19 words", total)
        self.assertIn("18 to 20 words", total)
        self.assertNotIn("All spans together", out)  # check 5 sums only the changed spans

    def test_a_span_with_no_counted_words_gets_no_word_count(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 1, "text": "https://example.com/a"},
                 {"id": "s2", "field": "text", "start": 2, "end": 3, "text": "Pay plans differ."}]
        out = editor.render("p3", query=SAVES, title="T", page="p", spans=spans, donor=None, missing_terms=[])
        line1 = next(line for line in out.split("\n") if line.startswith("- s1:"))
        self.assertEqual(line1.split(" Do not add")[0], "- s1: 0 counted words now.")
        self.assertNotRegex(out, r"exactly 0 words|0 to 0 words")
        self.assertIn("exactly 3 words", next(line for line in out.split("\n") if line.startswith("- s2:")))

    def test_spans_with_no_counted_words_at_all_get_no_total(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 1, "text": "https://example.com/a"}]
        out = editor.render("p3", query=SAVES, title="T", page="p", spans=spans, donor=None, missing_terms=[])
        self.assertNotIn("The spans you change", out)
        self.assertNotRegex(out, r"exactly 0 words|0 to 0 words")

    def test_key_words_are_given_as_written_in_the_span(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 1, "text": "Ferry Crewmen often save fares."}]
        out = editor.render("p2", query=SAVES, title="T", page="p", spans=spans, donor=None, missing_terms=[])
        line = next(line for line in out.split("\n") if line.startswith("- s1:"))
        self.assertIn('"Ferry", "save"', line)
        self.assertIn('"crewman"', line.split("Do not add")[1])  # "Crewmen" does not stem to "crewman"

    def test_the_regenerate_hints_give_the_measured_count_and_the_range(self):
        task = {"arm": "P3", "query": SAVES, "spans": self.spans}
        short = "Most deckhands bank money from overtime on each crossing worked monthly."
        edits = [{"field": "text", "start": 0, "end": 1, "replacement": short}]
        hints = editor.retry_hints(task, edits, None, None)
        text = "\n".join(hints)
        self.assertIn("s1", text)
        self.assertIn("11 words", text)
        self.assertIn("15 to 17 words", text)
        self.assertIn('"save"', text)  # dropped: put it back
        self.assertIn("together", text)

    def test_the_regenerate_hints_give_no_range_for_a_span_with_no_counted_words(self):
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 1, "text": "https://example.com/a"}] + self.spans[1:]
        edits = [{"field": "text", "start": 0, "end": 1, "replacement": "See https://example.com/a"},
                 {"field": "text", "start": 2, "end": 3, "replacement": "Plans differ."}]
        hints = editor.retry_hints({"arm": "P3", "query": SAVES, "spans": spans}, edits, None, None)
        self.assertEqual(hints[0], "s1: your version has 1 word; the original has 0 counted words.")
        self.assertIn("it must have exactly 3 words", hints[1])
        self.assertNotRegex("\n".join(hints), r"exactly 0 words|0 to 0 words")
        only = editor.retry_hints({"arm": "P3", "query": SAVES, "spans": spans[:1]}, edits[:1], None, None)
        self.assertEqual(only, ["s1: your version has 1 word; the original has 0 counted words."])  # no total

    def test_hints_follow_the_failures_in_the_regenerate_prompt(self):
        retry = editor.with_feedback("PROMPT", ["The paraphrase must keep ..."], ["s1 has 11 words; write 15 to 17."])
        self.assertTrue(retry.startswith("PROMPT"))
        self.assertLess(retry.index("must keep"), retry.index("s1 has 11 words"))
        self.assertTrue(retry.rstrip().endswith("Return a corrected answer in the same format."))


OPEN_TEXT = ("Espresso is a coffee drink.\n\n## Grind size\n\n"
             "Those who skip the warm-up pull sour shots. This means the first shot is wasted.\n\n"
             "## Water\n\nHot water extracts faster.")
POINTER = re.compile(r"^(?:This|That|These|Those|It|They|Such)\b")


def opener_engine(items):
    """question-headings as in toy_engine, plus standalone-paragraphs flagging pointer openers."""
    out = toy_engine(items)
    for item in items:
        eng = out[item["id"]]
        md = item["markdown"]
        paras = eng["artifacts"]["paragraphs"]
        flagged = [p for p in paras if POINTER.match(md[p["start"]:p["end"]])]
        findings = [{"start": p["start"], "end": p["end"],
                     "message": f'It opens with "{POINTER.match(md[p["start"]:p["end"]]).group(0)}", which points '
                                "back to earlier text, so a reader who sees only this paragraph cannot tell."}
                    for p in flagged]
        eng["checks"]["standalone-paragraphs"] = check(1 - len(flagged) / max(1, len(paras)), findings=findings,
                                                       metrics={"unresolvedOpeners": len(flagged)})
    return out


class Arm1PromptTest(unittest.TestCase):
    def test_the_prompt_has_a_worked_example_and_names_each_spans_opener(self):
        body = (editor.PROMPTS_DIR / "arm1.txt").read_text(encoding="utf-8")
        self.assertIn("{{openers}}", body)
        self.assertIn("Before:", body)
        self.assertIn("After:", body)
        spans = [{"id": "s1", "field": "text", "start": 0, "end": 1, "text": "Those who skip the warm-up pull sour shots."},
                 {"id": "s2", "field": "text", "start": 2, "end": 3, "text": "“It is rare,” he said."}]
        out = editor.render("arm1", query=QUERY, title="T", page="p", spans=spans, donor=None, missing_terms=[])
        self.assertIn('- s1 opens with "Those"', out)
        self.assertIn('- s2 opens with "It"', out)

    def test_the_regenerate_message_names_the_paragraphs_that_still_open_with_a_pointer(self):
        pages = [{"page_id": "q1-p1", "query_id": "q1", "set": "smoke", "query": QUERY, "url": None, "source": "sample",
                  "title": "T", "text": OPEN_TEXT, "words": 30, "tokens_max": 40, "cut": False, "sha256": "0" * 64,
                  "role": "target"}]
        applicability = [{"query_id": "q1", "arm": "1", "applicable": True, "reason": None}]

        class Backend:
            def __init__(self):
                self.prompts = []

            def generate(self, jobs):
                self.prompts += [j["prompt"] for j in jobs]
                out = []
                for j in jobs:
                    if "failed these checks" in j["prompt"]:
                        body = {s["id"]: s["text"].replace("Those who", "Baristas who") for s in j["spans"]}
                    else:  # the timing smoke's mistake: rewrites the second sentence, keeps "Those"
                        body = {s["id"]: s["text"].replace("This means the", "So the") for s in j["spans"]}
                    out.append((editor.json.dumps(body), "stop"))
                return out

        backend = Backend()
        rows = editor.run(pages, applicability, backend, arms=["1"], engine=opener_engine, placebos=False, do_all=False)
        row = next(r for r in rows if r["arm"] == "1")
        self.assertEqual((row["valid"], row["attempts"]), (True, 2), row["excluded_reason"])
        self.assertIn("Baristas who skip", row["text"])
        retry = backend.prompts[1]
        hint = retry.split("failed these checks")[1]
        self.assertIn('s1 still opens with "Those"', hint)
        self.assertIn("Those who skip the warm-up", hint)


def table_engine(items):
    """opener_engine plus a tables check that suggests a table and never rises (arm 4's step fails)."""
    out = opener_engine(items)
    for item in items:
        md, sub = item["markdown"], "Hot water extracts faster."
        at = md.find(sub)
        suggestions = [{"kind": "edit", "start": at, "end": at + len(sub),
                        "after": "| Water | Speed |\n| --- | --- |\n| Hot | faster |"}] if at >= 0 else []
        out[item["id"]]["checks"]["tables"] = check(0.5, suggestions=suggestions)
    return out


class AllSkipTest(unittest.TestCase):
    def page(self):
        return {"page_id": "q1-p1", "query_id": "q1", "set": "smoke", "query": QUERY, "url": None, "source": "sample",
                "title": "T", "text": OPEN_TEXT, "words": 30, "tokens_max": 40, "cut": False, "sha256": "0" * 64,
                "role": "target"}

    class Backend:
        """Arm 2 steps never change anything (check 2 fails twice); arm 1 steps name the subject."""

        def __init__(self, fix_arm1=True):
            self.jobs, self.fix_arm1 = [], fix_arm1

        def generate(self, jobs):
            self.jobs += jobs
            out = []
            for j in jobs:
                if j["arm"] == "1" and self.fix_arm1:
                    body = {s["id"]: s["text"].replace("Those who", "Baristas who") for s in j["spans"]}
                else:
                    body = {s["id"]: s["text"] for s in j["spans"]}
                out.append((editor.json.dumps(body), "stop"))
            return out

    def run_all(self, backend):
        applicability = [{"query_id": "q1", "arm": a, "applicable": True, "reason": None} for a in ("1", "2", "ALL")]
        rows = editor.run([self.page()], applicability, backend, arms=[], engine=opener_engine, placebos=True,
                          do_all=True)
        return {r["arm"]: r for r in rows}

    def test_a_step_that_fails_twice_is_skipped_and_recorded(self):
        backend = self.Backend()
        by_arm = self.run_all(backend)
        row = by_arm["ALL"]
        self.assertTrue(row["valid"], row["excluded_reason"])
        self.assertIsNone(row["excluded_reason"])
        self.assertIn("Baristas who skip", row["text"])
        self.assertIn("## Grind size\n", row["text"])  # the skipped step left the headings alone
        self.assertEqual([s["step"] for s in row["skipped_steps"]], ["2"])
        self.assertIn("question-headings check did not rise", row["skipped_steps"][0]["reason"])
        self.assertEqual(row["attempts"], 2)
        p_all = next(j for j in backend.jobs if j["arm"] == "P_ALL")  # only the kept LLM step's spans
        self.assertEqual([s["text"] for s in p_all["spans"]],
                         ["Those who skip the warm-up pull sour shots. This means the first shot is wasted."])

    def test_all_is_excluded_when_every_step_was_skipped(self):
        row = self.run_all(self.Backend(fix_arm1=False))["ALL"]
        self.assertFalse(row["valid"])
        self.assertEqual(row["excluded_reason"], "invalid: every step failed")
        self.assertEqual([s["step"] for s in row["skipped_steps"]], ["2", "1"])

    def test_all_with_no_step_attempted_is_not_applicable(self):
        # ALL is applicable, but none of its steps is (r3 amendment 5): nothing was tried.
        backend = self.Backend()
        rows = editor.run([self.page()], [{"query_id": "q1", "arm": "ALL", "applicable": True, "reason": None}],
                          backend, arms=[], engine=opener_engine, placebos=True, do_all=True)
        row = next(r for r in rows if r["arm"] == "ALL")
        self.assertFalse(row["valid"])
        self.assertEqual(row["excluded_reason"], "not applicable: no step applied")
        self.assertEqual(row["skipped_steps"], [])
        self.assertEqual(backend.jobs, [])
        self.assertNotIn("P_ALL", [r["arm"] for r in rows])

    def test_a_deterministic_step_that_fails_once_is_skipped_and_recorded(self):
        backend = self.Backend()
        applicability = [{"query_id": "q1", "arm": a, "applicable": True, "reason": None}
                         for a in ("1", "4", "ALL")]
        rows = editor.run([self.page()], applicability, backend, arms=[], engine=table_engine, placebos=False,
                          do_all=True)
        row = next(r for r in rows if r["arm"] == "ALL")
        self.assertTrue(row["valid"], row["excluded_reason"])
        self.assertEqual([s["step"] for s in row["skipped_steps"]], ["4"])
        self.assertIn("tables check did not rise", row["skipped_steps"][0]["reason"])
        self.assertIn("Hot water extracts faster.", row["text"])  # the skipped step's edit is not kept
        self.assertNotIn("| Water |", row["text"])
        self.assertIn("Baristas who skip", row["text"])  # the next step went on from the version before
        self.assertEqual(row["attempts"], 1)  # a deterministic step has one attempt, no regenerate
        self.assertEqual([j["arm"] for j in backend.jobs], ["1"])

    def test_every_row_carries_skipped_steps(self):
        by_arm = self.run_all(self.Backend())
        self.assertEqual(set(by_arm), {"original", "ALL", "P_ALL"})
        for arm, row in by_arm.items():
            self.assertIsInstance(row["skipped_steps"], list, arm)
        self.assertEqual(by_arm["original"]["skipped_steps"], [])
        self.assertEqual(by_arm["P_ALL"]["skipped_steps"], [])
        self.assertEqual([s["step"] for s in by_arm["ALL"]["skipped_steps"]], ["2"])


if __name__ == "__main__":
    unittest.main()
