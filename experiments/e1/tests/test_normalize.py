"""Tests for normalize.py: cleaning, usable-page rules, the cap and per-URL source choice."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import normalize  # noqa: E402

PAGE = "https://www.example.com/guide/espresso"


def words(n: int, word: str = "espresso") -> str:
    return " ".join([word] * n)


class CleanTest(unittest.TestCase):
    def test_removes_images_including_linked_images(self):
        text = "Before ![a cup](https://cdn.x/cup.png) after.\n\n[![logo](l.png)](https://other.org/)\n\nEnd."
        self.assertEqual(normalize.clean(text, PAGE), "Before  after.\n\nEnd.")

    def test_removes_footnote_markers_and_definition_block(self):
        text = "A claim.[^1] Another.[^note]\n\n## Notes\n\n[^1]: Smith 2020.\n    more of note 1\n[^note]: Second.\n\nTail."
        self.assertEqual(normalize.clean(text, PAGE), "A claim. Another.\n\n## Notes\n\nTail.")

    def test_own_site_links_become_text_and_other_sites_stay(self):
        text = (
            "See [our grinder guide](https://example.com/grinders), [the FAQ](/faq), "
            '[top](#top) and [a study](https://journal.org/x "Title").'
        )
        self.assertEqual(
            normalize.clean(text, PAGE),
            'See our grinder guide, the FAQ, top and [a study](https://journal.org/x "Title").',
        )

    def test_urls_with_balanced_parentheses(self):
        page = "https://wiki.example.org/wiki/Lakes"
        text = ('and [kestrels](https://wiki.example.org/wiki/Kestrel_(bird) "Kestrel (bird)") '
                "nest here and [x](https://other.org/a_(b))")
        self.assertEqual(normalize.clean(text, page), "and kestrels nest here and [x](https://other.org/a_(b))")

    def test_wayback_links_are_unwrapped_before_the_site_test(self):
        text = (
            "[home](https://web.archive.org/web/20230101000000/https://www.example.com/) and "
            "[ext](https://web.archive.org/web/20230101000000id_/https://other.org/p)"
        )
        self.assertEqual(normalize.clean(text, PAGE), "home and [ext](https://other.org/p)")


class TitleTest(unittest.TestCase):
    def test_generic_titles(self):
        for title in ["", "Home", "Example", "www.example.com", "Log in | Example", "Sign In",
                      "404 Not Found", "Just a moment...", "Access Denied", "Before you continue",
                      "Page not found - Example"]:
            self.assertTrue(normalize.generic_title(title, PAGE), title)

    def test_real_titles(self):
        for title in ["Why does espresso taste bitter?", "Error correction codes explained",
                      "Espresso guide | Example"]:
            self.assertFalse(normalize.generic_title(title, PAGE), title)


class UsableTest(unittest.TestCase):
    def test_rules_a_b_c(self):
        q = "why does espresso taste bitter"
        good = words(240) + " taste bitter " + words(10)
        self.assertEqual(normalize.usable("Bitter espresso", good, q, PAGE, title_rule=True), (True, None))
        self.assertEqual(normalize.usable("Bitter espresso", words(100), q, PAGE, title_rule=True)[1],
                         "fewer than 250 words (100)")
        self.assertEqual(normalize.usable("Coffee", words(300, "coffee"), q, PAGE, title_rule=True)[1],
                         "contains 0 of 3 query key terms")
        self.assertEqual(normalize.usable("Home", good, q, PAGE, title_rule=True)[1], "generic title 'Home'")
        self.assertEqual(normalize.usable("", good, q, None, title_rule=False), (True, None))


class CapTest(unittest.TestCase):
    count = staticmethod(lambda t: len(t.split()))

    def test_short_page_is_not_cut(self):
        self.assertEqual(normalize.cap("a b c", self.count, limit=10), ("a b c", False))

    def test_cuts_at_last_heading_before_the_limit(self):
        text = "w w w\n\n## One\n\nw w w\n\n## Two\n\nw w w w w w\n\n## Three\n\nw"
        # Prefix before "## Two" is 8 tokens; before "## Three" it is 16.
        self.assertEqual(normalize.cap(text, self.count, limit=12), ("w w w\n\n## One\n\nw w w", True))

    def test_falls_back_to_last_paragraph_boundary_without_a_heading(self):
        text = "a a a\n\nb b b\n\nc c c c c c"
        self.assertEqual(normalize.cap(text, self.count, limit=7), ("a a a\n\nb b b", True))

    def test_a_heading_at_offset_zero_is_not_a_cut_point(self):
        text = "## Top\n\na a a\n\nb b b b b b"
        self.assertEqual(normalize.cap(text, self.count, limit=7), ("## Top\n\na a a", True))

    def test_approx_counter_is_words_times_1_35(self):
        self.assertEqual(normalize.approx_tokens("one two three four"), 6)  # ceil(5.4)


class ChooseTest(unittest.TestCase):
    def rec(self, source, ok=True, text=None, title="Bitter espresso guide"):
        body = text if text is not None else words(260) + " taste bitter"
        return {"query_id": "geo-test-1", "set": "main", "split": "test", "row_idx": 1, "order": 1,
                "query": "why does espresso taste bitter", "url_index": 1, "url": PAGE, "source": source,
                "ok": ok, "status": 200 if ok else 403, "reason": None if ok else "HTTP 403",
                "title": title if ok else "", "text": body if ok else "", "fetched_at": "2026-10-24T00:00:00Z"}

    def test_live_usable_wins(self):
        rows, log, need = normalize.process([self.rec("live"), self.rec("wayback")], normalize.approx_tokens)
        self.assertEqual([(r["source"], r["usable"]) for r in rows], [("live", True)])
        self.assertEqual(len(log), 2)
        self.assertEqual(need, [])

    def test_wayback_used_when_live_fails(self):
        rows, _, need = normalize.process([self.rec("live", ok=False), self.rec("wayback")], normalize.approx_tokens)
        self.assertEqual([(r["source"], r["usable"]) for r in rows], [("wayback", True)])
        self.assertEqual(need, [])

    def test_failed_live_without_wayback_is_listed(self):
        rows, log, need = normalize.process([self.rec("live", text=words(50))], normalize.approx_tokens)
        self.assertEqual(rows[0]["usable"], False)
        self.assertEqual(rows[0]["unusable_reason"], "fewer than 250 words (50)")
        self.assertEqual([n["url"] for n in need], [PAGE])
        self.assertEqual(set(log[0]), {"url", "source", "status", "words", "tokens", "fetched_at", "sha256",
                                       "query_id", "url_index"})

    def test_page_fields(self):
        rows, _, _ = normalize.process([self.rec("live")], normalize.approx_tokens)
        r = rows[0]
        self.assertEqual(r["words"], 262)
        self.assertEqual(r["cut"], False)
        self.assertEqual(r["tokens_max"], normalize.approx_tokens(r["text"]))
        self.assertEqual(len(r["sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
