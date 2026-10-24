"""Tests for draw.py: query admission and the sha256 target/donor/competitor rules."""

import contextlib
import io
import json
import sys
import tempfile
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


class TimingTest(unittest.TestCase):
    """PREREG_E1 r3 amendment 8: the timing smoke uses the last qualifying five-page query in
    dataset order, held out of the main set; its outcomes are discarded."""

    def rows(self, five):
        out = []
        for k in range(8):
            out += query(f"q{k}", n_usable=5 if k in five else 4, order=k)
        return out

    def test_timing_is_the_last_five_page_query_in_dataset_order(self):
        qid, pages = draw.draw_timing(self.rows({0, 2, 5}))
        self.assertEqual(qid, "q5")
        self.assertEqual(len(pages), 5)

    def test_no_five_page_query_means_no_timing_query(self):
        self.assertIsNone(draw.draw_timing(self.rows(set())))

    def test_the_timing_query_is_held_out_of_main_even_when_main_has_room(self):
        out, summary = draw.admit_main(self.rows({0, 2, 5}), target=80, floor=2, hold_out={"q5"})
        self.assertEqual([qid for qid, _ in out], ["q0", "q2"])
        # It was still found: the fallback rule counts every five-page query fetched.
        self.assertEqual(summary["five_page"], 3)
        self.assertEqual(summary["held_out"], ["q5"])

    def test_the_timing_query_is_held_out_of_the_four_page_fallback_too(self):
        out, summary = draw.admit_main(self.rows({7}), target=80, floor=60, hold_out={"q7"})
        self.assertTrue(summary["fallback"])
        self.assertNotIn("q7", [qid for qid, _ in out])
        self.assertEqual(len(out), 7)

    def test_cli_writes_the_timing_set_and_records_its_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            cand, out, summ = Path(tmp) / "c.jsonl", Path(tmp) / "pages.jsonl", Path(tmp) / "admission.json"
            common.write_jsonl(cand, self.rows({0, 2, 5}))
            with contextlib.redirect_stdout(io.StringIO()):
                draw.main(["--candidates", str(cand), "--out", str(out), "--summary", str(summ), "--target", "2",
                           "--floor", "1"])
            pages = common.read_jsonl(out)
            summary = json.loads(summ.read_text())
        timing = [p for p in pages if p["set"] == "timing"]
        self.assertEqual({p["query_id"] for p in timing}, {"q5"})
        self.assertEqual(sorted(p["role"] for p in timing), ["competitor"] * 3 + ["donor", "target"])
        self.assertEqual(timing, draw.page_rows("q5", draw._usable(query("q5", order=5)), set_="timing"))
        self.assertEqual({p["query_id"] for p in pages if p["set"] == "main"}, {"q0", "q2"})
        self.assertEqual(summary["timing"], {"query_id": "q5", "query": "what is q5", "pages": 5})
        self.assertEqual(summary["main"]["held_out"], ["q5"])


if __name__ == "__main__":
    unittest.main()
