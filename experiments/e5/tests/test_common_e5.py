"""e5_common: the Node prefix for a bare bundle path and the guard against earlier experiments' data."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(E5))

import e5_common as e5  # noqa: E402


class NodePrefix(unittest.TestCase):
    def test_unset_ce_node_still_runs_node(self):
        # README step 2 with an unset $CE_NODE: E1_ENGINE=" /x/engine_cli.js" splits to the .js alone
        with mock.patch.dict(os.environ, {"E1_ENGINE": " /x/engine_cli.js", "E5_QUESTIONS": "/y/questions_cli.js"}):
            os.environ.pop("CE_NODE", None)
            self.assertEqual(e5.engine_command(), ["node", "/x/engine_cli.js"])
            self.assertEqual(e5.questions_command(), ["node", "/y/questions_cli.js"])
        with mock.patch.dict(os.environ, {"E1_ENGINE": "/x/engine_cli.js", "CE_NODE": "/opt/node22/bin/node"}):
            self.assertEqual(e5.engine_command(), ["/opt/node22/bin/node", "/x/engine_cli.js"])

    def test_an_explicit_node_is_kept(self):
        with mock.patch.dict(os.environ, {"E1_ENGINE": "/opt/n/node /x/engine_cli.js"}):
            self.assertEqual(e5.engine_command(), ["/opt/n/node", "/x/engine_cli.js"])
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("E1_ENGINE", None)
            os.environ.pop("CE_NODE", None)
            self.assertEqual(e5.engine_command(), ["node", str(e5.ENGINE_BUNDLE)])


class ForeignData(unittest.TestCase):
    def test_earlier_folders_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for bad in (e5.E1_DIR / "data", e5.E2_DIR / "data", e5.E3_DIR / "data" / "new",
                        root / "data" / "e1", root / "data" / "e3" / "new", root / "code" / "e1" / "data"):
                self.assertIsNotNone(e5.foreign_data(bad), bad)
                with self.assertRaises(SystemExit):
                    e5.refuse_foreign_data(bad)
            for good in (e5.DATA, e5.DATA / "smoke", root / "data" / "e5", root):
                self.assertIsNone(e5.foreign_data(good), good)
                e5.refuse_foreign_data(good)


class Loose(unittest.TestCase):
    def test_is_q(self):
        self.assertIs(e5.is_q("How do I clean espresso machines?", "how do I clean  espresso machines"), True)
        self.assertIs(e5.is_q("clean machines", "how do I clean espresso machines"), False)
        self.assertIsNone(e5.is_q(None, "q"))


if __name__ == "__main__":
    unittest.main()
