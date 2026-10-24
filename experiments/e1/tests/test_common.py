"""Tests for the shared E1 helpers (key-term twin, word count, offsets)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import common  # noqa: E402


class KeyTermTwinTest(unittest.TestCase):
    # Expected values were produced by the engine's contentTerms (question-coverage.ts).
    GOLDEN = {
        "Why does my espresso taste bitter?": ["espresso", "tast", "bitter"],
        "How do you evaluate a RAG system?": ["evaluat", "rag", "system"],
        "what is the difference between taking and takes studies": ["differenc", "between", "tak", "study"],
        "What is it?": ["what", "is", "it"],
        "stopping needs boxes shed bring flies": ["stop", "need", "box", "shed", "bring", "fly"],
    }

    def test_matches_engine_content_terms(self):
        for query, terms in self.GOLDEN.items():
            self.assertEqual(common.content_terms(query), terms, query)

    def test_share_of_terms_in_text(self):
        terms = common.content_terms("Why does my espresso taste bitter?")
        self.assertEqual(common.terms_present(terms, "Bitter espresso is common."), {"espresso", "bitter"})
        self.assertAlmostEqual(common.term_share(terms, "Bitter espresso is common."), 2 / 3)

    def test_key_term_occurrences_count_every_hit(self):
        terms = common.content_terms("espresso taste")
        self.assertEqual(common.key_term_count(terms, "Espresso tastes. The espresso tasted fine."), 4)


class WordsTest(unittest.TestCase):
    def test_counts_words_not_markup_or_urls(self):
        text = "## A heading\n\nOne [two](https://example.com/a-b-c) three's ![img](x.png) 4.5 items."
        self.assertEqual(common.count_words(text), 7)


class SentenceStartTest(unittest.TestCase):
    def test_sentence_start_positions(self):
        text = "First one. Second here!\n- item\n## Head"
        self.assertTrue(common.starts_sentence(text, 0))
        self.assertTrue(common.starts_sentence(text, text.index("Second")))
        self.assertTrue(common.starts_sentence(text, text.index("item")))
        self.assertTrue(common.starts_sentence(text, text.index("Head")))
        self.assertFalse(common.starts_sentence(text, text.index("one")))


class Sha256DrawTest(unittest.TestCase):
    def test_index_is_sha256_mod_m(self):
        import hashlib

        q = "why is the sky blue"
        expected = int(hashlib.sha256(q.encode("utf-8")).hexdigest(), 16) % 5
        self.assertEqual(common.sha_index(q, 5), expected)


if __name__ == "__main__":
    unittest.main()
