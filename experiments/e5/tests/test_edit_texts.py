"""E5's edit-text rules (PLAN_E5 "The edit texts") and the applicability helpers, on synthetic pages."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import e5_common as e5  # noqa: E402
import edit_texts  # noqa: E402
from e5_common import common  # noqa: E402

import applicability as appl  # noqa: E402


def page(qid, set_, role, text, query="how do I clean espresso machines", title="T", pid=None):
    return {"page_id": pid or f"{qid}-{role}-{len(text)}", "query_id": qid, "set": set_, "query": query,
            "url": "", "source": "live", "title": title, "text": text, "words": 0, "tokens_max": 0,
            "cut": False, "sha256": common.sha256_text(text), "role": role}


def fake_questions(items):
    out = {}
    for i in items:
        if "keyword" in i:
            out[i["id"]] = {"id": i["id"], "keyword_question": {"text": i["keyword"], "template": "kept"}}
        else:
            out[i["id"]] = {"id": i["id"], "page_questions": [{"text": "What is it?", "origin": "topic"}]}
    return out


class Surface(unittest.TestCase):
    def test_surface_is_the_first_lowercased_occurrence(self):
        self.assertEqual(e5.surface("Cleaning machines: CLEAN the Machine?"),
                         {"clean": "cleaning", "machin": "machines"})

    def test_text_9a_has_every_key_term_and_no_stopword(self):
        self.assertEqual(e5.text_9a("How do I clean my espresso machines?"), "clean espresso machines")

    def test_all_stopword_query_keeps_its_words(self):
        self.assertEqual(e5.text_9a("what is it"), "what is it")


class Keyword(unittest.TestCase):
    def test_two_rarest_terms_in_query_order(self):
        df = {"clean": 50, "espresso": 3, "machin": 7}
        self.assertEqual(e5.keyword_terms("how do I clean espresso machines", df), ["espresso", "machin"])
        self.assertEqual(e5.keyword("how do I clean espresso machines", df), "espresso machines")

    def test_ties_go_to_the_earlier_term(self):
        df = {"clean": 3, "espresso": 3, "machin": 3}
        self.assertEqual(e5.keyword_terms("clean espresso machines", df), ["clean", "espresso"])
        df = {"clean": 9, "espresso": 3, "machin": 3}
        self.assertEqual(e5.keyword_terms("clean espresso machines", df), ["espresso", "machin"])

    def test_one_or_two_terms_are_all_kept(self):
        self.assertEqual(e5.keyword("best espresso", {}), "best espresso")
        self.assertEqual(e5.keyword("espresso", {}), "espresso")

    def test_pool_counts_each_distinct_text_once_and_text_only(self):
        pages = [page("q1", "main", "target", "espresso here", title="machine"),
                 page("q2", "main", "target", "espresso here", pid="dup"),
                 page("q3", "main", "competitor", "machines and espresso")]
        df, n = e5.page_pool_df(pages)
        self.assertEqual(n, 2)
        self.assertEqual(df["espresso"], 2)
        self.assertEqual(df["machin"], 1)  # the title "machine" is not counted


class Build(unittest.TestCase):
    def test_rows_follow_the_contract(self):
        pages = [page("geo-1", "main", "target", "Espresso machines need cleaning."),
                 page("geo-1", "main", "competitor", "Espresso is coffee."),
                 page("geo-2", "e3-four", "target", "Clean the espresso machine weekly.", query="clean espresso"),
                 page("c-1", "replication", "target", "Machines.", query="machines espresso", title="")]
        rows, summary = edit_texts.build(pages, fake_questions)
        self.assertEqual([r["query_id"] for r in rows], ["geo-1", "geo-2", "c-1"])
        r = rows[0]
        self.assertEqual(set(edit_texts.FIELDS) - set(r), set())
        self.assertEqual((r["set"], r["stratum"]), ("main", "e1"))
        self.assertEqual((rows[1]["set"], rows[1]["stratum"]), ("main", "e3-four"))
        self.assertEqual((rows[2]["set"], rows[2]["stratum"]), ("replication", "replication"))
        self.assertEqual(r["key_terms"], ["clean", "espresso", "machin"])
        self.assertEqual(r["n_key_terms"], 3)
        self.assertIsNone(r["q_L"])
        self.assertEqual(r["q_L_status"], "pending")
        self.assertEqual(r["q_G"], "What is it?")
        self.assertEqual(summary["queries"], {"e1": 1, "e3-four": 1, "replication": 1})

    def test_titled_markdown(self):
        self.assertEqual(e5.titled_markdown("Espresso", "Body."), "# Espresso\n\nBody.")
        self.assertEqual(e5.titled_markdown("  ", "Body."), "Body.")

    def test_e5_pages_leave_out_timing_and_smoke(self):
        e1 = [page("a", "main", "target", "x"), page("t", "timing", "target", "y"), page("s", "smoke", "target", "z")]
        e3 = [page("b", "e3", "target", "w")]
        self.assertEqual([p["query_id"] for p in edit_texts.e5_pages(e1, e3)], ["a", "b"])


def eng_with_h2(text):
    return {"artifacts": {"headings": [{"depth": 1, "text": "Title"}, {"depth": 2, "text": text}]}}


class NineFamily(unittest.TestCase):
    nine_ok = {"applicable": True, "reason": None}

    def test_first_h2_rule_ignores_case(self):
        text = {"q_prime": "Espresso Machines", "text_9A": "x", "q_G": None, "q_L": None, "q_L_status": "pending"}
        row = appl.nine_family_row("q", "9K", self.nine_ok, text, eng_with_h2("espresso machines"))
        self.assertFalse(row["applicable"])
        self.assertIn("first H2", row["reason"])

    def test_needs_arm_9(self):
        text = {"q_prime": "a b", "text_9A": "a b", "q_G": "What?", "q_L": None, "q_L_status": "pending"}
        row = appl.nine_family_row("q", "9A", {"applicable": False, "reason": "covered"}, text, eng_with_h2("x"))
        self.assertFalse(row["applicable"])
        self.assertTrue(row["reason"].startswith("arm 9 is not applicable"))

    def test_9g_without_a_page_question_and_9l_before_the_edit_job(self):
        text = {"q_prime": "a", "text_9A": "a", "q_G": None, "q_L": None, "q_L_status": "pending"}
        self.assertFalse(appl.nine_family_row("q", "9G", self.nine_ok, text, eng_with_h2("x"))["applicable"])
        self.assertIsNone(appl.nine_family_row("q", "9L", self.nine_ok, text, eng_with_h2("x")))
        text |= {"q_L": "What is a?", "q_L_status": "ok"}
        self.assertTrue(appl.nine_family_row("q", "9L", self.nine_ok, text, eng_with_h2("x"))["applicable"])
        text |= {"q_L": None, "q_L_status": "no line ends in '?'"}
        self.assertFalse(appl.nine_family_row("q", "9L", self.nine_ok, text, eng_with_h2("x"))["applicable"])

    def test_query_order_is_sha256_of_the_query_id(self):
        import hashlib
        self.assertEqual(e5.query_order("geo-test-1"), hashlib.sha256(b"geo-test-1").hexdigest())


class Pins(unittest.TestCase):
    def test_engine_pin_refuses_another_bundle(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            fake = Path(d) / "engine_cli.js"
            fake.write_text("console.log(1)\n")
            with self.assertRaises(SystemExit):
                e5.check_engine_pin(["node", str(fake)])

    @unittest.skipUnless(e5.ENGINE_BUNDLE.exists(), "E1's engine bundle is not built here")
    def test_e1_bundle_passes_the_pin(self):
        self.assertEqual(e5.check_engine_pin(["node", str(e5.ENGINE_BUNDLE)])[1], str(e5.ENGINE_BUNDLE))


if __name__ == "__main__":
    unittest.main()
