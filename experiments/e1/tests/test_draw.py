"""Tests for draw.py: query admission and the sha256 target/donor/competitor rules."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import common  # noqa: E402
import draw  # noqa: E402


def page(qid, i, usable=True, url=None, set_="main", split="test", order=0, query=None, fetched_at="2026-10-24T00:00:00Z"):
    return {"query_id": qid, "set": set_, "split": split, "row_idx": order, "order": order,
            "query": query or f"what is {qid}", "url_index": i, "url": url or f"https://site{i}.org/{qid}",
            "source": "live", "title": f"T{i}", "text": "x", "words": 300, "tokens_max": 400, "cut": False,
            "sha256": "0" * 64, "usable": usable, "unusable_reason": None if usable else "no", "status": 200,
            "fetched_at": fetched_at}


def query(qid, n_usable=5, order=0, **kw):
    return [page(qid, i, usable=i <= n_usable, order=order, **kw) for i in range(1, 6)]


class RolesTest(unittest.TestCase):
    def test_target_and_donor_follow_the_sha256_rule(self):
        q = "why is the sky blue"
        pages = query("q1", query=q)
        roles = draw.assign_roles(q, pages)
        t = common.sha_index(q, 5)
        self.assertEqual(roles[t], "target")
        rest = [i for i in range(5) if i != t]
        d = rest[common.sha_index(q + "|donor", 4)]
        self.assertEqual(roles[d], "donor")
        self.assertEqual(sorted(roles), ["competitor"] * 3 + ["donor", "target"])

    def test_wikipedia_is_never_the_target_when_another_page_exists(self):
        for n in range(30):
            q = f"query number {n}"
            pages = query("q", query=q)
            for p in pages[:4]:
                p["url"] = f"https://en.wikipedia.org/wiki/{p['url_index']}"
            roles = draw.assign_roles(q, pages)
            self.assertEqual(roles[4], "target", q)

    def test_all_wikipedia_still_draws(self):
        q = "all wiki"
        pages = query("q", query=q)
        for p in pages:
            p["url"] = "https://en.wikipedia.org/wiki/x"
        roles = draw.assign_roles(q, pages)
        self.assertEqual(roles[common.sha_index(q, 5)], "target")

    def test_four_pages_have_no_donor(self):
        q = "four"
        roles = draw.assign_roles(q, query("q", query=q)[:4])
        self.assertEqual(sorted(roles), ["competitor"] * 3 + ["target"])


class AdmissionTest(unittest.TestCase):
    def test_main_admits_five_page_queries_in_dataset_order_up_to_target(self):
        rows = []
        for k in range(10):
            rows += query(f"q{k}", n_usable=5 if k % 2 == 0 else 4, order=k)
        out, summary = draw.admit_main(rows, target=3, floor=2)
        self.assertEqual([qid for qid, _ in out], ["q0", "q2", "q4"])
        self.assertFalse(summary["fallback"])

    def test_fallback_admits_four_page_queries_when_below_the_floor(self):
        rows = []
        for k in range(6):
            rows += query(f"q{k}", n_usable=5 if k == 2 else 4, order=k)
        out, summary = draw.admit_main(rows, target=4, floor=3)
        self.assertTrue(summary["fallback"])
        self.assertEqual([(qid, len(p)) for qid, p in out], [("q0", 4), ("q1", 4), ("q2", 5), ("q3", 4)])

    def test_fallback_window_ignores_train_and_late_fetches(self):
        rows = query("a", order=0) + query("b", order=1, split="train") + \
            query("c", order=2, fetched_at="2026-10-24T07:00:00Z")
        _, summary = draw.admit_main(rows, target=3, floor=2)
        self.assertEqual(summary["five_page_in_window"], 1)
        self.assertTrue(summary["fallback"])

    def test_replication_takes_first_n_with_all_five_usable(self):
        rows = []
        for k in range(5):
            rows += query(f"c{k}", n_usable=5 if k != 1 else 3, order=k, set_="replication")
        out = draw.admit_all_five(rows, limit=3)
        self.assertEqual([qid for qid, _ in out], ["c0", "c2", "c3"])

    def test_pages_rows_have_the_interface_fields(self):
        rows = query("q0", order=0)
        out = draw.page_rows("q0", rows)
        self.assertEqual(set(out[0]), {"page_id", "query_id", "set", "query", "url", "source", "title", "text",
                                       "words", "tokens_max", "cut", "sha256", "role"})
        self.assertEqual(out[0]["page_id"], "q0-p1")


if __name__ == "__main__":
    unittest.main()
