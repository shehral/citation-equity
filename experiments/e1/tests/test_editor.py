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
                                          "excluded_reason", "edit_distance", "length_ratio", "key_terms_delta"}, True)


if __name__ == "__main__":
    unittest.main()
