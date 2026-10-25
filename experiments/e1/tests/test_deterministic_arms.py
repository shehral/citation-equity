"""Tests for deterministic_arms.py: arms 4, 9, 11, 13 and 14, and the arm 11-14 feature rules."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import deterministic_arms as da  # noqa: E402
from helpers import check, fake_engine  # noqa: E402

QUERY = "what is espresso extraction"


def splice(text, edits):
    for e in sorted(edits, key=lambda e: e["start"], reverse=True):
        text = text[: e["start"]] + e["replacement"] + text[e["end"] :]
    return text


class Arm4Test(unittest.TestCase):
    def test_uses_the_tables_checks_own_after_text(self):
        md = "Intro.\n\n- Dose: 18 g\n- Yield: 36 g\n- Time: 28 s\n\nEnd."
        start = md.index("- Dose")
        end = md.index("\n\nEnd")
        table = "| Item | Detail |\n| --- | --- |\n| Dose | 18 g |"
        eng = fake_engine(md, {"tables": check(0, suggestions=[{"kind": "edit", "start": start, "end": end, "after": table},
                                                              {"kind": "advisory", "start": 0, "end": 6}])})
        edits, reason = da.arm4(md, eng)
        self.assertIsNone(reason)
        self.assertEqual(splice(md, edits), f"Intro.\n\n{table}\n\nEnd.")

    def test_not_applicable_without_an_edit(self):
        md = "Intro."
        eng = fake_engine(md, {"tables": check(0, suggestions=[{"kind": "advisory", "start": 0, "end": 6}])})
        self.assertEqual(da.arm4(md, eng), (None, "no Key: value list for the tables check to convert"))


class Arm9Test(unittest.TestCase):
    def test_inserts_the_query_heading_and_best_overlap_sentence_at_the_top(self):
        md = "Coffee is brewed. Espresso extraction pulls flavor. Extraction of espresso is fast.\n\n## More\n\nText."
        edits, reason = da.arm9(md, fake_engine(md), QUERY)
        self.assertIsNone(reason)
        self.assertEqual(splice(md, edits),
                         f"## {QUERY}\n\nEspresso extraction pulls flavor.\n\n" + md)

    def test_goes_after_a_leading_h1(self):
        md = "# Title\n\nEspresso extraction matters."
        edits, _ = da.arm9(md, fake_engine(md), QUERY)
        self.assertTrue(splice(md, edits).startswith(f"# Title\n\n## {QUERY}\n\nEspresso extraction matters.\n\n"))



# E2 (experiments/PLAN_E2.md): two versions of arm 9 that share its sentence choice.
E2_QUERY = "what is espresso extraction"  # 4 words; key terms "espresso", "extract"
E2_MD = (
    "# Title\n\n"
    "Coffee is brewed daily by many people here. Espresso extraction pulls flavor. Water boils quite fast. "
    "Extraction takes time.\n\n## More\n\nText."
)


class Arm9WTest(unittest.TestCase):
    def test_the_query_as_a_plain_paragraph_then_arm_9s_sentence_at_arm_9s_position(self):
        edits, reason = da.arm9w(E2_MD, fake_engine(E2_MD), E2_QUERY)
        self.assertIsNone(reason)
        self.assertEqual(splice(E2_MD, edits),
                         f"# Title\n\n{E2_QUERY}\n\nEspresso extraction pulls flavor.\n\n" + E2_MD[len("# Title\n\n"):])

    def test_differs_from_arm_9_only_by_the_heading_markup(self):
        for md in (E2_MD, "Plain start. Espresso extraction pulls flavor."):
            nine, _ = da.arm9(md, fake_engine(md), E2_QUERY)
            w, _ = da.arm9w(md, fake_engine(md), E2_QUERY)
            self.assertEqual(splice(md, nine).replace(f"## {E2_QUERY}", E2_QUERY, 1), splice(md, w))

    def test_no_prose_sentence(self):
        md = "- only a list"
        self.assertEqual(da.arm9w(md, fake_engine(md), E2_QUERY), (None, "the page has no prose sentence"))


class Arm9PTest(unittest.TestCase):
    # Amendment 1: S must be body text (one line, 8+ words, capital or digit start, ., ! or ? end).
    P_MD = (
        "# Title\n\n"
        "Coffee is brewed daily by many people in this town. Espresso extraction pulls flavor. "
        "Water boils quite fast on a big gas stove today. Extraction takes time.\n\n## More\n\nText."
    )

    def test_the_fewest_key_terms_body_sentence_closest_in_length_earliest_on_ties(self):
        # Arm 9's sentence has 4 words; the two body sentences without key terms both have 10.
        edits, reason = da.arm9p(self.P_MD, fake_engine(self.P_MD), E2_QUERY)
        self.assertIsNone(reason)
        self.assertEqual(splice(self.P_MD, edits),
                         "# Title\n\n## Coffee is brewed daily\n\nCoffee is brewed daily by many people in this town.\n\n"
                         + self.P_MD[len("# Title\n\n"):])

    def test_page_furniture_and_fragments_are_never_s(self):
        md = ("Espresso extraction pulls flavor. Comment\nCorporate Communications Address for the press office here. "
              "short words only here without a capital start at all. Too short. "
              "Milk foams well when it is cold and fresh from the fridge.")
        self.assertEqual(da.arm9p_sentence(md, fake_engine(md), E2_QUERY),
                         "Milk foams well when it is cold and fresh from the fridge.")
        self.assertFalse(da.is_body_sentence("Comment\nCorporate Communications Address for the press office here."))
        self.assertFalse(da.is_body_sentence("Seven words is not quite enough here."))
        self.assertTrue(da.is_body_sentence("\u201cEight words, quoted, still count as body text here.\u201d"))

    def test_no_body_sentence_means_no_9p(self):
        md = "Espresso extraction pulls flavor. Water boils fast."
        self.assertEqual(da.arm9p(md, fake_engine(md), E2_QUERY), (None, da.NO_BODY_SENTENCE))

    def test_the_heading_takes_the_first_n_words_as_the_pipeline_counts_them(self):
        md = "Espresso extraction pulls flavor. Fresh [beans](https://x.org/b) give the best cups, said Ana."
        edits, _ = da.arm9p(md, fake_engine(md), E2_QUERY)
        self.assertTrue(splice(md, edits).startswith(
            "## Fresh beans give the\n\nFresh [beans](https://x.org/b) give the best cups, said Ana.\n\n"))
        self.assertEqual(da.first_words("Hi, it's 4.5 now!", 3), "Hi it's 4.5")
        self.assertEqual(da.first_words("Too short.", 4), "Too short")

    def test_with_one_body_sentence_it_is_that_one(self):
        md = "Espresso extraction pulls a lot of flavor from the beans."
        self.assertEqual(da.arm9p_sentence(md, fake_engine(md), E2_QUERY), md)

    def test_no_prose_sentence(self):
        md = "- only a list"
        self.assertEqual(da.arm9p(md, fake_engine(md), E2_QUERY), (None, "the page has no prose sentence"))

    def test_arm_9_keeps_its_choice(self):
        self.assertEqual(da.arm9_sentence(E2_MD, fake_engine(E2_MD), E2_QUERY), "Espresso extraction pulls flavor.")

class Arm11Test(unittest.TestCase):
    def test_copies_the_first_definition_sentence_under_the_title(self):
        md = "Many people love coffee.\n\n## Basics\n\nThe extraction is the process of dissolving solubles. Espresso is strong."
        edits, reason = da.arm11(md, fake_engine(md), QUERY)
        self.assertIsNone(reason)
        self.assertEqual(splice(md, edits), "The extraction is the process of dissolving solubles.\n\n" + md)

    def test_a_demonstrative_opener_is_not_a_definition(self):
        self.assertFalse(da.is_definition("These extractions are important for flavor.", ["extraction"]))
        self.assertTrue(da.is_definition("Espresso extraction is the dissolving of solubles.", ["extraction"]))
        self.assertTrue(da.is_definition("An extraction is a process.", ["extraction"]))

    def test_not_applicable_without_a_definition(self):
        md = "Many people love coffee. Nobody defines anything here."
        self.assertEqual(da.arm11(md, fake_engine(md), QUERY), (None, "no sentence of the form '<key term> is/are'"))

    def test_feature_present_when_the_page_already_opens_with_it(self):
        md = "Espresso is a concentrated coffee.\n\nMore text."
        self.assertEqual(da.arm11(md, fake_engine(md), QUERY), (None, "feature already present: the page opens with a definition"))


class Arm13Test(unittest.TestCase):
    def test_splits_a_long_section_at_the_paragraph_nearest_the_middle(self):
        para = lambda w, n: " ".join([w] * n) + "."
        md = f"## Long part\n\n{para('alpha', 150)}\n\n{para('beta', 100)}\n\n{para('gamma', 200)}\n\n## Short\n\nOk."
        edits, reason = da.arm13(md, fake_engine(md))
        self.assertIsNone(reason)
        out = splice(md, edits)
        # 450 body words: the boundary before "gamma" has 250 before it (closest to 225).
        self.assertIn(f"{para('beta', 100)}\n\n## gamma gamma gamma gamma gamma gamma gamma gamma\n\ngamma", out)

    def test_not_applicable_when_no_section_is_over_400_words(self):
        md = "## A\n\nShort section."
        self.assertEqual(da.arm13(md, fake_engine(md)), (None, "feature already present: no section over 400 words"))


class Arm14Test(unittest.TestCase):
    def test_shows_the_pages_own_date_under_the_title(self):
        md = "Intro paragraph here.\n\nBy Jane. Last updated on March 3, 2024.\n\nBody."
        edits, reason = da.arm14(md, fake_engine(md))
        self.assertIsNone(reason)
        self.assertEqual(splice(md, edits), "Updated: March 3, 2024\n\n" + md)

    def test_iso_dates_and_no_date(self):
        md = "Text.\n\nPublished: 2023-05-01\n\nMore."
        self.assertEqual(da.find_date(md)[0], "2023-05-01")
        self.assertEqual(da.arm14("Just text with 2024 in it.", fake_engine("x")), (None, "no publication or update date found"))

    def test_feature_present_when_the_date_is_already_at_the_top(self):
        md = "Updated: May 2, 2024\n\nBody."
        self.assertEqual(da.arm14(md, fake_engine(md)), (None, "feature already present: the date is under the title"))


class Arm12FeatureTest(unittest.TestCase):
    def test_missing_terms_of_title_first_heading_and_first_paragraph(self):
        md = "Espresso basics here.\n\n## Grinding\n\nMore about extraction later."
        self.assertEqual(da.missing_terms(QUERY, "Coffee guide", md, fake_engine(md)), ["extraction"])
        md2 = "Espresso extraction basics."
        self.assertEqual(da.missing_terms(QUERY, "", md2, fake_engine(md2)), [])


class FeaturesTest(unittest.TestCase):
    def test_rows_for_arms_11_to_14(self):
        md = "Espresso extraction basics.\n\n## A\n\nShort."
        page = {"title": "Guide", "text": md, "query": QUERY}
        rows = da.features(page, fake_engine(md))
        self.assertEqual([r["arm"] for r in rows], ["11", "12", "13", "14"])
        self.assertEqual(rows[1], {"arm": "12", "applicable": False,
                                   "reason": "feature already present: every key term is in the title, first heading or first paragraph"})


if __name__ == "__main__":
    unittest.main()
