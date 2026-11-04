"""E5's deterministic versions (make_versions.py) on a synthetic page, with E1's pinned engine and
a fake questions bridge."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import e5_common as e5  # noqa: E402
import make_versions as mv  # noqa: E402
from e5_common import common  # noqa: E402

QUERY = "how do I clean espresso machines"
TEXT = ("Espresso is a strong coffee drink brewed under high pressure in a few seconds.\n\n"
        "To clean espresso machines, run hot water through the group head every day after use.\n\n"
        "## Beans\n\nFresh beans make the best shots for a good morning at home or at work.\n\n"
        + "Roast dates matter because flavour fades within weeks of roasting, so buy small bags often. " * 8
        + "\n")


def fake_questions(items):
    out = {}
    for i in items:
        covered = i["question"] == "covered question"
        out[i["id"]] = {"id": i["id"], "coverage": {"applicable": True, "score": 1.0 if covered else 0.0}}
    return out


def write_folder(d: Path, appl_arms: dict, page_set: str = "e3") -> None:
    target = {"page_id": "t", "query_id": "geo-x", "set": page_set, "query": QUERY, "url": "", "source": "live",
              "title": "Espresso guide", "text": TEXT, "words": 0, "tokens_max": 0, "cut": False,
              "sha256": common.sha256_text(TEXT), "role": "target"}
    common.write_jsonl(d / "pages.jsonl", [target])
    text = {"query_id": "geo-x", "set": "main", "stratum": e5.STRATUM[page_set], "query": QUERY,
            "key_terms": common.content_terms(QUERY), "n_key_terms": 3, "k": "clean machines",
            "k_terms": ["clean", "machin"], "q_prime": "clean machines", "template": "kept",
            "text_9A": "clean espresso machines", "q_G": "What is espresso?", "q_G_origin": "topic",
            "q_L": None, "q_L_status": "pending"}
    common.write_jsonl(d / "edit_texts.jsonl", [text])
    common.write_jsonl(d / "applicability.jsonl",
                       [{"query_id": "geo-x", "arm": a, "applicable": ok, "reason": None} for a, ok in appl_arms.items()])
    eng = e5.engine([{"id": "t", "markdown": TEXT, "question": QUERY}])["t"]
    common.write_jsonl(d / "engine_original.jsonl", [{"id": "t", "query_id": "geo-x",
                                                      **{k: v for k, v in eng.items() if k != "id"}}])


@unittest.skipUnless(e5.ENGINE_BUNDLE.exists(), "E1's engine bundle is not built here")
class Build(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, arms):
        write_folder(self.d, arms)
        return {r["arm"]: r for r in mv.build(mv.Context(self.d, questions=fake_questions))}

    def test_rows_and_extra_fields(self):
        rows = self.build({"9": True, "9K": True, "9A": True, "9G": False})
        self.assertEqual(set(rows), {"original", "9", "9P", "9K", "9A"})
        for r in rows.values():
            self.assertEqual(set(mv.E1_FIELDS + mv.EXTRA) - set(r), set())
            self.assertEqual(r["stratum"], "e3")
        nine, nk = rows["9"], rows["9K"]
        self.assertTrue(nine["valid"], nine["excluded_reason"])
        self.assertTrue(nine["text"].startswith(f"## {QUERY}\n\n"))
        self.assertTrue(nk["valid"], nk["excluded_reason"])
        self.assertTrue(nk["text"].startswith("## clean machines\n\n"))
        self.assertEqual(nk["edit_text"], "clean machines")
        self.assertEqual(nk["template"], "kept")
        self.assertIs(nk["same_sentence_as_9"], True)  # both copy the sentence with clean + machines
        self.assertIs(nk["tool_gate"], True)
        self.assertIs(nk["tool_covers_q"], False)
        # metrics with the true query: the 9K heading adds clean and machines, two of q's key terms
        self.assertEqual(nk["key_terms_delta"] - nine["key_terms_delta"], -1)
        self.assertIsNone(rows["original"]["edit_text"])
        self.assertIsNone(rows["9P"]["tool_gate"])
        self.assertIsNone(nine["same_sentence_as_9"])
        self.assertIs(nine["edit_text_is_q"], True)
        self.assertIs(nk["edit_text_is_q"], False)
        self.assertIsNone(rows["original"]["edit_text_is_q"])
        self.assertIsNone(rows["9P"]["edit_text_is_q"])

    def e1_twelve(self):
        """E1-style 12 and P12 rows for the folder's query (as in E1's versions.jsonl)."""
        base = {"query_id": "geo-x", "set": "main", "title": "Espresso guide", "attempts": 1, "edit_distance": 3,
                "length_ratio": 1.01, "key_terms_delta": 2, "added_words": 3, "skipped_steps": []}
        return [base | {"version_id": "geo-x:12", "arm": "12", "text": "## Clean\n\n" + TEXT, "valid": True,
                        "excluded_reason": None},
                base | {"version_id": "geo-x:P12", "arm": "P12", "text": "## Tidy\n\n" + TEXT, "valid": False,
                        "excluded_reason": "invalid: x"},
                base | {"version_id": "geo-x:9", "arm": "9", "text": "ignored", "valid": True, "excluded_reason": None}]

    def test_e1_twelve_is_copied_on_e1_queries_and_kept_by_merge_edits(self):
        write_folder(self.d, {"9": False, "12": True}, page_set="main")
        ctx = mv.Context(self.d, questions=fake_questions)
        rows = mv.build(ctx, self.e1_twelve())
        by = {r["arm"]: r for r in rows}
        self.assertEqual(set(by), {"original", "12", "P12"})
        for arm, e1row in (("12", self.e1_twelve()[0]), ("P12", self.e1_twelve()[1])):
            self.assertEqual({f: by[arm][f] for f in mv.E1_FIELDS}, e1row)  # E1's fields verbatim
            self.assertEqual(set(mv.E1_FIELDS + mv.EXTRA) - set(by[arm]), set())
            self.assertTrue(mv.is_reused_e1(by[arm]))
        self.assertEqual((by["12"]["edit_text"], by["12"]["edit_text_is_q"]), (QUERY, True))
        self.assertIsNone(by["P12"]["edit_text"])
        self.assertIs(by["12"]["tool_gate"], True)
        # merge-edits: the edit job's 12K rows are added, E1's 12 and P12 stay
        k = {f: self.e1_twelve()[0][f] for f in mv.E1_FIELDS} | {"version_id": "geo-x:12K", "arm": "12K"}
        merged, added = mv.merge_edit_rows(ctx, rows, [k])
        self.assertEqual([r["arm"] for r in merged], ["original", "12", "P12", "12K"])
        self.assertEqual(added[0]["edit_text"], "clean machines")
        merged_again, _ = mv.merge_edit_rows(ctx, merged, [k])  # a second merge replaces the job's rows only
        self.assertEqual(merged_again, merged)
        # an edit job that rebuilt E1's own 12 is refused
        with self.assertRaises(SystemExit):
            mv.merge_edit_rows(ctx, rows, [k | {"version_id": "geo-x:12", "arm": "12"}])

    def test_e1_twelve_is_not_copied_on_new_queries(self):
        write_folder(self.d, {"9": False})
        rows = mv.build(mv.Context(self.d, questions=fake_questions), self.e1_twelve())
        self.assertEqual([r["arm"] for r in rows], ["original"])

    def test_not_applicable_pairs_get_no_row(self):
        rows = self.build({"9": False, "9K": False, "9A": False, "9G": False})
        self.assertEqual(set(rows), {"original"})

    def test_q_l_must_come_from_the_same_keyword(self):
        texts = [{"query_id": "a", "k": "x y"}]
        with self.assertRaises(SystemExit):
            mv.merge_q_l(texts, [{"query_id": "a", "k": "x z", "q_L": "Q?", "status": "ok"}])
        out = mv.merge_q_l(texts, [{"query_id": "a", "k": "x y", "q_L": "Q?", "status": "ok"}])
        self.assertEqual((out[0]["q_L"], out[0]["q_L_status"]), ("Q?", "ok"))


class PinsFirst(unittest.TestCase):
    def test_a_wrong_bundle_stops_before_any_file_is_rewritten(self):
        import os
        from unittest import mock

        import applicability
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            fake = d / "engine_cli.js"
            fake.write_text("// not E1's bundle\n")
            texts = d / "edit_texts.jsonl"
            texts.write_text('{"query_id": "a", "k": "x y"}\n')
            (d / "q_L.jsonl").write_text('{"query_id": "a", "k": "x y", "q_L": "Q?", "status": "ok"}\n')
            before = texts.read_bytes()
            with mock.patch.dict(os.environ, {"E1_ENGINE": f"node {fake}"}):
                with self.assertRaises(SystemExit):
                    mv.main(["--data", str(d), "ql", "--q-l", str(d / "q_L.jsonl")])
                with self.assertRaises(SystemExit):
                    applicability.main(["--data", str(d), "--e1-data", str(d / "e1x")])
            self.assertEqual(texts.read_bytes(), before)
            self.assertFalse((d / "applicability.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
