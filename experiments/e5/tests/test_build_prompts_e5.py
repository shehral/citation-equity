"""E5's prompt builder: E1's prompt, E5 keys and tiers, batch order and protection of running batches."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import build_prompts_e5 as bp5  # noqa: E402
import e5_common as e5  # noqa: E402

import build_prompts as bp  # noqa: E402  (E1's)


def pages(qid, set_):
    rows = [{"page_id": f"{qid}-t", "query_id": qid, "set": set_, "query": f"question {qid}", "title": "T",
             "text": "Target text.", "role": "target"}]
    rows += [{"page_id": f"{qid}-c{i}", "query_id": qid, "set": set_, "query": f"question {qid}", "title": f"C{i}",
              "text": f"Competitor {i}.", "role": "competitor"} for i in range(3)]
    return rows


def version(qid, set_, arm, valid=True, text="Target text."):
    return {"version_id": f"{qid}:{arm}", "query_id": qid, "set": set_, "arm": arm, "title": "T", "text": text,
            "valid": valid}


class Build(unittest.TestCase):
    def setUp(self):
        self.pages = pages("q1", "main") + pages("q2", "e3") + pages("q3", "replication")
        self.versions = [version("q1", "main", a) for a in ("original", "9", "9P", "9K", "9A", "12K", "P12K", "12", "P12")]
        self.versions += [version("q2", "e3", a) for a in ("original", "9", "12", "P12", "9L")]
        self.versions += [version("q3", "replication", a) for a in ("original", "9", "9G")]
        self.versions += [version("q3", "replication", "9K", valid=False)]
        self.appl = [{"query_id": "q1", "arm": "9A", "applicable": False, "reason": "x"}]

    def test_keys_tiers_batches_and_prompts(self):
        rows, refused = bp5.build(self.pages, self.versions, self.appl, judges=["gemma-4-12b", "qwen3.8-27b"],
                                  seeds=range(1, 3))
        self.assertEqual(refused, [])
        by = {(r["judge"], r["version_id"], r["seed"]): r for r in rows}
        r = by[("gemma-4-12b", "q1:9K", 2)]
        self.assertEqual(r["key"], "e5|gemma-4-12b|q1:9K|2")
        self.assertEqual((r["tier"], r["batch"], r["set"], r["e5_set"], r["stratum"]),
                         (1, "e5-main.gemma-4-12b.tier1", "main", "main", "e1"))
        self.assertEqual(by[("gemma-4-12b", "q1:12K", 1)]["batch"], "e5-main.gemma-4-12b.tier2-12K")
        self.assertEqual(by[("gemma-4-12b", "q1:P12K", 1)]["batch"], "e5-main.gemma-4-12b.tier2-12K")
        self.assertEqual(by[("qwen3.8-27b", "q2:12", 1)]["batch"], "e5-main.qwen3.8-27b.tier3-12")
        self.assertEqual(by[("qwen3.8-27b", "q2:P12", 1)]["tier"], 3)
        self.assertEqual(by[("gemma-4-12b", "q2:9L", 1)]["batch"], "e5-main.gemma-4-12b.tier2-9L")
        self.assertEqual(by[("gemma-4-12b", "q2:9L", 1)]["tier"], 2)
        self.assertEqual(by[("gemma-4-12b", "q3:9G", 1)]["batch"], "e5-replication.gemma-4-12b.tier3")
        # E1's own 12 and P12 on an E1 query: re-answered in tier 3, in the locally built tier3 file
        self.assertEqual((by[("gemma-4-12b", "q1:12", 1)]["tier"], by[("gemma-4-12b", "q1:12", 1)]["batch"]),
                         (3, "e5-main.gemma-4-12b.tier3"))
        self.assertEqual(by[("qwen3.8-27b", "q1:P12", 2)]["batch"], "e5-main.qwen3.8-27b.tier3")
        self.assertNotIn(("gemma-4-12b", "q1:9A", 1), by)  # not applicable
        self.assertNotIn(("gemma-4-12b", "q3:9K", 1), by)  # invalid
        # E1's prompt, byte for byte
        comps = [p for p in self.pages if p["query_id"] == "q1" and p["role"] == "competitor"]
        want = bp.build_prompt("question q1", bp.arrange("question q1", 2, {"title": "T", "text": "Target text."}, comps))
        self.assertEqual(r["prompt"], want)

    def test_batch_order_is_sha_of_query_with_versions_adjacent(self):
        rows, _ = bp5.build(self.pages, self.versions, [], judges=["gemma-4-12b"])
        files = bp5.batch_files(rows)
        for lines in files.values():
            qids = [l["queryId"] for l in lines]
            blocks = [q for i, q in enumerate(qids) if i == 0 or qids[i - 1] != q]
            self.assertEqual(len(blocks), len(set(blocks)), "a query's lines are split")
            self.assertEqual(blocks, sorted(blocks, key=e5.query_order))
        line = files["e5-main.gemma-4-12b.tier1"][0]
        self.assertEqual((line["temperature"], line["numCtx"], line["model"]), (0.5, 32768, "google/gemma-4-12B-it"))

    def test_shards_hold_complete_queries_in_order(self):
        lines = [{"queryId": q, "key": f"{q}{i}"} for q, n in (("a", 3), ("b", 3), ("c", 2), ("d", 4)) for i in range(n)]
        parts = bp5.shard({"e5-main.gemma-4-12b.tier1": lines}, 2)
        self.assertEqual(sorted(parts), ["e5-main.gemma-4-12b.tier1-p1of2", "e5-main.gemma-4-12b.tier1-p2of2"])
        joined = parts["e5-main.gemma-4-12b.tier1-p1of2"] + parts["e5-main.gemma-4-12b.tier1-p2of2"]
        self.assertEqual(joined, lines)
        first = {l["queryId"] for l in parts["e5-main.gemma-4-12b.tier1-p1of2"]}
        second = {l["queryId"] for l in parts["e5-main.gemma-4-12b.tier1-p2of2"]}
        self.assertEqual(first & second, set())
        self.assertEqual(bp5.shard({"x": lines}, 1), {"x": lines})

    def test_refused_query_leaves_every_version(self):
        rows, refused = bp5.build(self.pages, self.versions, [], judges=["gemma-4-12b"],
                                  count_tokens=lambda p: 40_000 if "question q2" in p else 10)
        self.assertEqual([r["query_id"] for r in refused], ["q2"])
        self.assertNotIn("q2", {r["query_id"] for r in rows})

    def test_12_on_e1_is_tier3_and_on_replication_an_error(self):
        self.assertEqual(bp5.tier_and_batch("12", "e1"), (3, "tier3"))
        self.assertEqual(bp5.tier_and_batch("P12", "e1"), (3, "tier3"))
        self.assertEqual(bp5.tier_and_batch("P12", "e3-four"), (3, "tier3-12"))
        for arm in ("12", "P12"):
            with self.assertRaises(ValueError):
                bp5.tier_and_batch(arm, "replication")

    def test_main_refuses_an_earlier_experiments_data_folder(self):
        for d in (e5.E1_DIR / "data", e5.E3_DIR / "data" / "new"):
            with self.assertRaises(SystemExit):
                bp5.main(["--data", str(d), "--tokens", "none"])

    def test_an_existing_batch_is_never_changed(self):
        with tempfile.TemporaryDirectory() as d:
            files = {"e5-main.gemma-4-12b.tier1": [{"key": "a", "queryId": "q"}]}
            bp5.write_batches(Path(d), files)
            bp5.write_batches(Path(d), files)  # identical: fine
            with self.assertRaises(SystemExit):
                bp5.write_batches(Path(d), {"e5-main.gemma-4-12b.tier1": [{"key": "b", "queryId": "q"}]})


if __name__ == "__main__":
    unittest.main()
