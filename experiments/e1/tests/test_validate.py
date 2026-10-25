"""Tests for validate.py: each of the six validity checks of PREREG_E1.md, and the metrics."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import validate as v  # noqa: E402
from helpers import check, fake_engine  # noqa: E402

TEXT = (
    "## Grind size\n\nEspresso tastes bitter when the grind is too fine. "
    "Water at 93 degrees helps.\n\n- Dose: 18 g\n- Yield: 36 g\n\nSee [the study](https://journal.org/s)."
)
QUERY = "why does espresso taste bitter"


def edit(old, new, text=TEXT, field="text"):
    start = text.index(old)
    return {"field": field, "start": start, "end": start + len(old), "replacement": new}


def apply(edits, text=TEXT):
    for e in sorted(edits, key=lambda e: e["start"], reverse=True):
        text = text[: e["start"]] + e["replacement"] + text[e["end"] :]
    return text


def span(old, text=TEXT):
    s = text.index(old)
    return {"field": "text", "start": s, "end": s + len(old)}


class Check1OutsideSpansTest(unittest.TestCase):
    def test_edit_inside_a_span_passes(self):
        e = [edit("Grind size", "Why does grind size matter?")]
        self.assertIsNone(v.check_outside_spans(TEXT, apply(e), "T", "T", e, [span("Grind size")], insert_only=False))

    def test_text_changed_outside_the_spans_fails(self):
        e = [edit("Grind size", "Why grind?")]
        edited = apply(e).replace("helps", "aids")
        msg = v.check_outside_spans(TEXT, edited, "T", "T", e, [span("Grind size")], insert_only=False)
        self.assertIn("outside the edited spans", msg)

    def test_edit_beyond_its_span_fails(self):
        e = [edit("Grind size\n\nEspresso", "Grind\n\nEspresso")]
        msg = v.check_outside_spans(TEXT, apply(e), "T", "T", e, [span("Grind size")], insert_only=False)
        self.assertIn("outside the edited spans", msg)

    def test_title_change_needs_a_title_span(self):
        msg = v.check_outside_spans(TEXT, TEXT, "T", "T2", [], [], insert_only=False)
        self.assertIn("title changed", msg)
        title_span = [{"field": "title", "start": 0, "end": 1}]
        e = [{"field": "title", "start": 0, "end": 1, "replacement": "T2"}]
        self.assertIsNone(v.check_outside_spans(TEXT, TEXT, "T", "T2", e, title_span, insert_only=False))

    def test_additive_arms_may_only_insert(self):
        s = "Water at 93 degrees helps."
        ok = [edit(s, "Water at 93 degrees helps, as 70% of tasters agree ([source](https://d.org)).")]
        self.assertIsNone(v.check_outside_spans(TEXT, apply(ok), "T", "T", ok, [span(s)], insert_only=True))
        bad = [edit(s, "Hot water helps.")]
        self.assertIn("insert", v.check_outside_spans(TEXT, apply(bad), "T", "T", bad, [span(s)], insert_only=True))


class Check2OwnFeatureTest(unittest.TestCase):
    def test_engine_arm_score_must_rise(self):
        before = fake_engine(TEXT, {"question-headings": check(0.0)})
        up = fake_engine(TEXT, {"question-headings": check(1.0)})
        same = fake_engine(TEXT, {"question-headings": check(0.0)})
        self.assertIsNone(v.check_own_feature("2", before, up, QUERY, ("", TEXT), ("", TEXT)))
        self.assertIn("did not rise", v.check_own_feature("2", before, same, QUERY, ("", TEXT), ("", TEXT)))

    def test_not_applicable_after_the_edit_fails(self):
        before = fake_engine(TEXT, {"lists": check(0.5)})
        after = fake_engine(TEXT, {"lists": check(0, applicable=False)})
        self.assertIn("not applicable", v.check_own_feature("3", before, after, QUERY, ("", TEXT), ("", TEXT)))

    def test_arm1_needs_fewer_unresolved_openers(self):
        before = fake_engine(TEXT, {"standalone-paragraphs": check(0.5, metrics={"unresolvedOpeners": 2})})
        after = fake_engine(TEXT, {"standalone-paragraphs": check(0.5, metrics={"unresolvedOpeners": 1})})
        self.assertIsNone(v.check_own_feature("1", before, after, QUERY, ("", TEXT), ("", TEXT)))
        self.assertIsNotNone(v.check_own_feature("1", before, before, QUERY, ("", TEXT), ("", TEXT)))

    def test_feature_arms_11_to_14(self):
        e = fake_engine(TEXT)
        dated = "Updated: May 2, 2024\n\n" + TEXT
        self.assertIsNone(v.check_own_feature("14", e, fake_engine(dated), QUERY, ("", TEXT), ("", dated)))
        self.assertIsNotNone(v.check_own_feature("14", e, e, QUERY, ("", TEXT), ("", TEXT)))
        defined = "Espresso is a brewed coffee.\n\n" + TEXT
        self.assertIsNone(v.check_own_feature("11", e, fake_engine(defined), QUERY, ("", TEXT), ("", defined)))
        split = TEXT.replace("- Dose", "## Dose\n\n- Dose")
        self.assertIsNone(v.check_own_feature("13", e, fake_engine(split), QUERY, ("", TEXT), ("", split)))
        t12 = "## Grind\n\nShort para."
        e12 = fake_engine(t12)
        self.assertIsNone(v.check_own_feature("12", e12, e12, QUERY, ("Guide", t12), ("Why espresso tastes bitter", t12)))
        self.assertIsNotNone(v.check_own_feature("12", e12, e12, QUERY, ("Guide", t12), ("Guide", t12)))

    def test_arm7_without_a_donor_url_needs_the_donor_named_not_a_link(self):
        # Replication set: the donor has no URL, so cited-sources cannot rise; the feature is
        # the attribution by the donor's name in every edited claim.
        donor = {"title": "", "url": None, "text": "Comet watch 2031: best nights to look up\n\nBody."}
        s = "Water at 93 degrees helps."
        e = [edit(s, "Water at 93 degrees helps (source: Comet watch 2031: best nights to look up).")]
        flat = fake_engine(TEXT, {"cited-sources": check(0.0)})
        args = (flat, flat, QUERY, ("", TEXT), ("", apply(e)))
        self.assertIsNone(v.check_own_feature("7", *args, donor=donor, edits=e))
        unnamed = [edit(s, "Water at 93 degrees helps (source: a report).")]
        msg = v.check_own_feature("7", *args[:4], ("", apply(unnamed)), donor=donor, edits=unnamed)
        self.assertIn("(source: Comet watch 2031: best nights to look up)", msg)
        self.assertIsNotNone(v.check_own_feature("7", *args, donor=donor, edits=[]))

    def test_arm7_with_a_donor_url_still_needs_cited_sources_to_rise(self):
        donor = {"title": "Donor", "url": "https://donor.org/a", "text": "Body."}
        s = "Water at 93 degrees helps."
        e = [edit(s, "Water at 93 degrees helps ([source](https://donor.org/a)).")]
        flat = fake_engine(TEXT, {"cited-sources": check(0.0)})
        up = fake_engine(TEXT, {"cited-sources": check(1.0)})
        self.assertIn("did not rise", v.check_own_feature("7", flat, flat, QUERY, ("", TEXT), ("", apply(e)),
                                                          donor=donor, edits=e))
        self.assertIsNone(v.check_own_feature("7", flat, up, QUERY, ("", TEXT), ("", apply(e)), donor=donor, edits=e))

    def test_arm9_is_a_feature_arm(self):
        # The copied sentence may miss question-coverage's 8-40-word, 60% bar, so the score need
        # not rise: the feature is the query as an H2 directly under the title, then a page sentence.
        page = "# Espresso\n\n" + TEXT
        sentence = "Water at 93 degrees helps."
        added = f"# Espresso\n\n## {QUERY}\n\n{sentence}\n\n" + TEXT
        flat = fake_engine(page, {"question-coverage": check(0.0)})
        self.assertIsNone(v.check_own_feature("9", flat, flat, QUERY, ("", page), ("", added)))
        wrong_heading = added.replace(f"## {QUERY}", "## Why espresso is bitter")
        self.assertIn("H2", v.check_own_feature("9", flat, flat, QUERY, ("", page), ("", wrong_heading)))
        new_sentence = added.replace(sentence, "Water at 90 degrees is best.")
        self.assertIn("verbatim", v.check_own_feature("9", flat, flat, QUERY, ("", page), ("", new_sentence)))

    def test_placebo_keeps_every_check_within_002_and_the_key_terms(self):
        before = fake_engine(TEXT, {"lists": check(0.5), "tables": check(0, applicable=False)})
        near = fake_engine(TEXT, {"lists": check(0.51), "tables": check(0, applicable=False)})
        far = fake_engine(TEXT, {"lists": check(0.6), "tables": check(0, applicable=False)})
        self.assertIsNone(v.check_placebo(before, near, QUERY, ["bitter espresso"], ["espresso, bitter"]))
        self.assertIn("lists", v.check_placebo(before, far, QUERY, ["bitter espresso"], ["espresso, bitter"]))
        self.assertIn("key terms", v.check_placebo(before, near, QUERY, ["bitter espresso"], ["espresso"]))
        self.assertIn("key terms", v.check_placebo(before, near, QUERY, ["espresso"], ["bitter espresso"]))


class PlaceboChangesSomethingTest(unittest.TestCase):
    def test_an_unchanged_paraphrase_is_not_a_placebo(self):
        eng = fake_engine(TEXT)
        result = v.validate(arm="P2", original=("T", TEXT), edited=("T", TEXT), edits=[],
                            spans=[span("Grind size")], eng_orig=eng, eng_edit=eng, query=QUERY,
                            target=("T", TEXT), donor=None)
        self.assertEqual(result["failures"], ["Reword the spans: the answer left every span unchanged."])


class Check3NoNewFactsTest(unittest.TestCase):
    def test_new_number_url_and_name_fail(self):
        corpus = v.corpus(("T", TEXT))
        self.assertIsNone(v.check_no_new_facts("T\n" + TEXT + " Use 18 g at 93 degrees.", corpus))
        self.assertIn("'25'", v.check_no_new_facts("Pull for 25 seconds.", corpus))
        self.assertIn("https://new.org", v.check_no_new_facts("See https://new.org.", corpus))
        self.assertIn("'James Hoffmann'", v.check_no_new_facts("Ask James Hoffmann about it.", corpus))

    def test_a_capitalized_sequence_at_sentence_start_drops_its_first_word(self):
        corpus = v.corpus(("", "We visited New York."))
        self.assertIsNone(v.check_no_new_facts("Then New York. The City", corpus))
        self.assertIsNone(v.check_no_new_facts("## Grind Size\n\nOk.", corpus))

    def test_title_case_heading_words_found_in_lower_case_are_allowed(self):
        corpus = v.corpus(("Kit guide", "Brands publish transparency scores for every kit."))
        self.assertIsNone(v.check_no_new_facts("## How do Transparency Scores work?\n\nOk.", corpus))
        self.assertIsNone(v.check_no_new_facts("Kit guide\n## Which Brands Publish Transparency Scores?", corpus))
        self.assertIsNone(v.check_no_new_facts("Which Brands Publish Transparency Scores\nOk.", corpus, titled=True))

    def test_title_case_heading_words_absent_from_the_sources_still_fail(self):
        corpus = v.corpus(("Kit guide", "Every kit is listed with its transparency scores."))
        self.assertIn("'FTC Listed'", v.check_no_new_facts("## Is the kit FTC Listed?\n\nOk.", corpus))
        self.assertIn("'FTC Listed'", v.check_no_new_facts("Is the kit FTC Listed?\nOk.", corpus, titled=True))

    def test_body_prose_keeps_the_verbatim_rule(self):
        corpus = v.corpus(("Kit guide", "Brands publish transparency scores for every kit."))
        self.assertIn("'Transparency Scores'",
                      v.check_no_new_facts("## Kits\n\nRead the Transparency Scores here.", corpus))
        self.assertIn("'Transparency Scores'",
                      v.check_no_new_facts("Kit guide\nRead the Transparency Scores here.", corpus))
        self.assertIsNone(v.check_no_new_facts("## Kits\n\nTransparency Scores matter.", corpus))

    def test_donor_and_query_widen_the_allowed_text(self):
        donor = {"title": "D", "text": "Experts at Coffee Lab measured 70% extraction.", "url": "https://d.org/x"}
        c = v.corpus(("T", TEXT), donor=donor, query=QUERY)
        self.assertIsNone(v.check_no_new_facts("Coffee Lab found 70% ([d](https://d.org/x)).", c))

    def test_arm2_heading_vocabulary(self):
        orig_eng = fake_engine(TEXT)
        good = [edit("Grind size", "Why does a fine grind size taste bitter?")]
        bad = [edit("Grind size", "Why does grind size ruin crema?")]
        self.assertIsNone(v.check_heading_vocabulary(TEXT, orig_eng, good))
        self.assertIn("ruin", v.check_heading_vocabulary(TEXT, orig_eng, bad))

    def test_arm12_adds_only_key_terms_and_function_words(self):
        good = [{"field": "title", "start": 0, "end": 5, "replacement": "Why espresso tastes bitter: guide"}]
        bad = [{"field": "title", "start": 0, "end": 5, "replacement": "Ultimate espresso guide"}]
        self.assertIsNone(v.check_query_wording("guide", TEXT, good, QUERY))
        self.assertIn("ultimate", v.check_query_wording("guide", TEXT, bad, QUERY))


class Check4NothingRemovedTest(unittest.TestCase):
    def test_removed_heading_list_item_row_or_link_fails(self):
        e0 = fake_engine(TEXT)
        no_link = TEXT.replace("[the study](https://journal.org/s)", "the study")
        self.assertIn("link", v.check_nothing_removed("1", TEXT, no_link, e0, fake_engine(no_link), []))
        no_item = TEXT.replace("\n- Yield: 36 g", "")
        self.assertIn("list item", v.check_nothing_removed("1", TEXT, no_item, e0, fake_engine(no_item), []))
        no_heading = TEXT.replace("## Grind size", "Grind size")
        self.assertIn("heading", v.check_nothing_removed("1", TEXT, no_heading, e0, fake_engine(no_heading), []))

    def test_converting_arms_are_exempt_inside_their_spans(self):
        e0 = fake_engine(TEXT)
        reworded = TEXT.replace("Grind size", "Why grind?")
        self.assertIsNone(v.check_nothing_removed("2", TEXT, reworded, e0, fake_engine(reworded), [span("Grind size")]))
        tabled = TEXT.replace("- Dose: 18 g\n- Yield: 36 g", "| Item | Detail |\n| --- | --- |\n| Dose | 18 g |\n| Yield | 36 g |")
        self.assertIsNone(v.check_nothing_removed("4", TEXT, tabled, e0, fake_engine(tabled), [span("- Dose: 18 g\n- Yield: 36 g")]))
        self.assertIsNotNone(v.check_nothing_removed("3", TEXT, reworded, e0, fake_engine(reworded), [span("Grind size")]))

    def test_table_rows_must_survive(self):
        t = "Intro.\n\n| A | B |\n| --- | --- |\n| x | 1 |\n| y | 2 |"
        e0 = fake_engine(t)
        cut = t.replace("\n| y | 2 |", "")
        self.assertIn("table row", v.check_nothing_removed("1", t, cut, e0, fake_engine(cut), []))


class StepAndPlaceboRulesTest(unittest.TestCase):
    def test_an_all_step_may_reuse_what_earlier_steps_added(self):
        before = "## why 2016 matters\n\n" + TEXT  # an earlier step added the query, with a number
        e = [edit("Grind size", "Why does a fine grind size taste bitter?", text=before)]
        edited = apply(e, before)
        result = v.validate(arm="2", original=("T", before), edited=("T", edited), edits=e,
                            spans=[span("Grind size", before)],
                            eng_orig=fake_engine(before, {"question-headings": check(0.0)}),
                            eng_edit=fake_engine(edited, {"question-headings": check(0.5)}),
                            query=QUERY, target=("T", TEXT), donor=None, step=True)
        self.assertEqual(result["failures"], [])

    def test_a_placebo_may_reword_a_heading_inside_its_spans(self):
        reworded = TEXT.replace("Grind size", "Size of the grind")
        self.assertIsNone(v.check_nothing_removed("P8", TEXT, reworded, fake_engine(TEXT), fake_engine(reworded),
                                                  [span("Grind size")]))
        self.assertIsNone(v.check_nothing_removed("P_ALL", TEXT, reworded, fake_engine(TEXT), fake_engine(reworded),
                                                  [span("Grind size")]))


class Check5LengthTest(unittest.TestCase):
    def test_ratio_arms(self):
        orig = ("", " ".join(["w"] * 100))
        self.assertIsNone(v.check_length("2", orig, ("", " ".join(["w"] * 109)), [], [])[0])
        self.assertIn("1.11", v.check_length("2", orig, ("", " ".join(["w"] * 111)), [], [])[0])
        self.assertIn("0.94", v.check_length("3", orig, ("", " ".join(["w"] * 94)), [], [])[0])

    def test_additive_arms_record_added_words(self):
        orig = ("", " ".join(["w"] * 100))
        msg, added = v.check_length("5", orig, ("", " ".join(["w"] * 112)), [], [])
        self.assertEqual((msg, added), (None, 12))
        self.assertIsNotNone(v.check_length("9", orig, ("", " ".join(["w"] * 116)), [], [])[0])

    def test_placebo_uses_span_words_and_all_has_its_own_range(self):
        orig = ("", "x")
        self.assertIsNone(v.check_length("P5", orig, orig, ["a b c d e f g h i j"], ["a b c d e f g h i j k"])[0])
        self.assertIsNotNone(v.check_length("P5", orig, orig, ["a b c d e f g h i j"], ["a b c d e f g h i j k l"])[0])
        base = ("", " ".join(["w"] * 100))
        self.assertIsNone(v.check_length("ALL", base, ("", " ".join(["w"] * 160)), [], [])[0])
        self.assertIsNotNone(v.check_length("ALL", base, ("", " ".join(["w"] * 89)), [], [])[0])


class Check6ContentWordsTest(unittest.TestCase):
    def test_list_conversion_keeps_the_content_words(self):
        before = ["Use a scale, a timer, and fresh beans."]
        self.assertIsNone(v.check_content_words(before, ["Use:\n\n- a scale\n- a timer\n- fresh beans"]))
        self.assertIn("content words", v.check_content_words(before, ["Use:\n\n- a scale\n- a clock\n- old beans"]))

    def test_numbered_list_markers_are_not_content_words(self):
        before = ["Use a scale, a timer, and fresh beans."]
        self.assertIsNone(v.check_content_words(before, ["Use:\n\n1. a scale\n2. a timer\n3. fresh beans"]))
        self.assertIsNone(v.check_content_words(before, ["Use:\n\n1) a scale\n2) a timer\n3) fresh beans"]))
        self.assertIn("content words", v.check_content_words(before, ["Use:\n\n1. a scale\n2. a clock\n3. old beans"]))

    def test_other_markdown_is_not_counted(self):
        before = ["Use a scale, a timer, and fresh beans."]
        self.assertIsNone(v.check_content_words(before, ["Use:\n\n* **a scale**\n+ _a timer_\n  - fresh beans"]))
        # Numbers inside the prose still count.
        self.assertIn("content words", v.check_content_words(["Add 3 eggs, flour, and milk."], ["Add:\n\n- eggs\n- flour\n- milk"]))


class MetricsTest(unittest.TestCase):
    def test_edit_distance_length_ratio_and_key_term_delta(self):
        m = v.metrics(QUERY, ("", "a b c espresso"), ("", "a x c espresso espresso"))
        self.assertEqual(m["edit_distance"], 2)
        self.assertAlmostEqual(m["length_ratio"], 5 / 4)
        self.assertEqual(m["key_terms_delta"], 1)


class Arm4TableConversionTest(unittest.TestCase):
    """PLAN_E3.md amendment 1. The shape of E1's four arm 4 pages: a section whose only reason to
    need a table is one Key: value list (bold or plain keys, no comparison wording); after the
    tables check's own edit the list is a table and the check has nothing left to flag."""

    RUN = "- **Ristretto:** a short shot, 1 to 1.5\n- **Espresso**: the usual shot, 1 to 2\n- Lungo: a long shot, 1 to 3"
    TABLE = ("| Item | Detail |\n| --- | --- |\n| Ristretto | a short shot, 1 to 1.5 |\n"
             "| Espresso | the usual shot, 1 to 2 |\n| Lungo | a long shot, 1 to 3 |")
    PAGE = ("## Brew ratios\n\nA shot is named by how much water runs through the same dose of ground coffee, "
            "and baristas keep a few ratios in mind when they dial in a new bag of beans.\n\n"
            f"{RUN}\n\nAdjust the grind after each shot until the taste is balanced and sweet.")

    def case(self, replacement=None, edit_end_extra=0, flagged=True, parsed=True):
        page = self.PAGE
        e = edit(self.RUN, self.TABLE if replacement is None else replacement, page)
        e["end"] += edit_end_extra
        edited = apply([e], page)
        suggestion = {"kind": "edit", "start": e["start"], "end": e["start"] + len(self.RUN), "after": self.TABLE}
        eng0 = fake_engine(page, {"tables": check(0.0, suggestions=[suggestion] if flagged else [])})
        eng1 = fake_engine(edited, {"tables": check(0, applicable=False)})
        if not parsed:
            eng1["artifacts"]["tables"] = []
        return page, edited, [e], eng0, eng1

    def validate(self, page, edited, edits, eng0, eng1, step=False):
        spans = [{"field": "text", "start": x["start"], "end": x["end"]} for x in edits]
        return v.validate(arm="4", original=("T", page), edited=("T", edited), edits=edits, spans=spans,
                          eng_orig=eng0, eng_edit=eng1, query=QUERY, target=("T", page), donor=None, step=step)

    def test_a_correct_conversion_passes_although_the_check_is_then_not_applicable(self):
        self.assertEqual(self.validate(*self.case())["failures"], [])

    def test_an_all_step_keeps_the_e1_rule(self):
        failures = self.validate(*self.case(), step=True)["failures"]
        self.assertEqual(failures, ["After the edit the tables check is not applicable."])

    def test_a_changed_cell_fails(self):
        changed = self.TABLE.replace("a long shot", "a very long shot")
        self.assertIn("After the edit the tables check is not applicable.",
                      self.validate(*self.case(replacement=changed))["failures"])

    def test_a_dropped_row_fails(self):
        dropped = self.TABLE.replace("\n| Lungo | a long shot, 1 to 3 |", "")
        self.assertIn("After the edit the tables check is not applicable.",
                      self.validate(*self.case(replacement=dropped))["failures"])

    def test_a_wider_span_than_the_flagged_run_fails(self):
        page, edited, edits, eng0, eng1 = self.case(edit_end_extra=len("\n\nAdjust"))
        self.assertFalse(v.converted_to_table(eng0, eng1, edits))

    def test_a_run_the_check_did_not_flag_fails(self):
        page, edited, edits, eng0, eng1 = self.case(flagged=False)
        self.assertFalse(v.converted_to_table(eng0, eng1, edits))

    def test_a_table_the_parser_does_not_read_fails(self):
        page, edited, edits, eng0, eng1 = self.case(parsed=False)
        self.assertFalse(v.converted_to_table(eng0, eng1, edits))

    def test_other_arms_and_an_applicable_check_keep_their_rules(self):
        page, edited, edits, eng0, eng1 = self.case()
        msg = v.check_own_feature("3", fake_engine(page, {"lists": check(0.5)}),
                                  fake_engine(edited, {"lists": check(0, applicable=False)}), QUERY,
                                  ("T", page), ("T", edited), edits=edits, table_conversion=True)
        self.assertIn("not applicable", msg)
        flat = fake_engine(edited, {"tables": check(0.0)})
        self.assertIn("did not rise", v.check_own_feature("4", eng0, flat, QUERY, ("T", page), ("T", edited),
                                                          edits=edits, table_conversion=True))

    def test_split_key_value_matches_the_engine(self):
        self.assertEqual(v.split_key_value("**Dose:** 18 g"), ("Dose", "18 g"))
        self.assertEqual(v.split_key_value("**Dose**: 18 g"), ("Dose", "18 g"))
        self.assertEqual(v.split_key_value("Dose: 18 g"), ("Dose", "18 g"))
        self.assertIsNone(v.split_key_value("**Dose:**: 18 g"))
        self.assertIsNone(v.split_key_value("Dose:"))
        self.assertIsNone(v.split_key_value("one two three four five six: too long a key"))
        self.assertEqual(v.key_value_table([("a|b", "c")]), "| Item | Detail |\n| --- | --- |\n| a\\|b | c |")


class ValidateTest(unittest.TestCase):
    def test_collects_every_failure(self):
        e = [edit("Grind size", "Why does grind size matter in Rome Italy?")]
        edited = apply(e)
        eng0 = fake_engine(TEXT, {"question-headings": check(0.0)})
        eng1 = fake_engine(edited, {"question-headings": check(0.0)})
        result = v.validate(arm="2", original=("T", TEXT), edited=("T", edited), edits=e,
                            spans=[span("Grind size")], eng_orig=eng0, eng_edit=eng1, query=QUERY,
                            target=("T", TEXT), donor=None)
        joined = " | ".join(result["failures"])
        self.assertFalse(result["valid"])
        self.assertIn("did not rise", joined)
        self.assertIn("Rome Italy", joined)

    def test_arm7_on_the_replication_set_validates_by_name(self):
        donor = {"title": "", "url": None, "text": "Comet watch 2031: best nights to look up\n\nBody."}
        s = "Water at 93 degrees helps."
        page = TEXT + "\n\n" + "A well pulled shot of coffee carries a thin layer of crema on top. " * 6
        e = [edit(s, "Water at 93 degrees helps (source: Comet watch 2031: best nights to look up).", page)]
        edited = apply(e, page)
        flat = fake_engine(page, {"cited-sources": check(0.0)})
        result = v.validate(arm="7", original=("T", page), edited=("T", edited), edits=e, spans=[span(s, page)],
                            eng_orig=flat, eng_edit=fake_engine(edited, {"cited-sources": check(0.0)}),
                            query=QUERY, target=("T", page), donor=donor)
        self.assertEqual(result["failures"], [])


if __name__ == "__main__":
    unittest.main()
