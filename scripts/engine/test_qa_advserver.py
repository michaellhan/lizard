"""The QA sweep's advisor process (scripts/qa/advserver.py): it says which hands' 3-way solves its cache evicted, and on
macOS it runs with the allocator's large-block cache off.

- A 3-way solve of an earlier street (Advisor._mw_lines) is what a later street of the hand is narrowed through; where the
  solve cache evicts it (Advisor._keep, least recently used past QA_CACHE_MB) the next street falls back to the betting
  rules. The sweep asked such a hand's later streets as if the process still held them (docs/QA.md, issue F); the reply's
  `dropped` names the boards, so it asks them again.
- macOS libmalloc kept freed large blocks resident, so a stored preflop solve dropped after a request stayed in the RSS
  and the next solve's working set stacked on it: peaks of 1.1-1.2 GB that weren't live data (issue C).
  MallocLargeCache=0 turns that off; it's read at process start, so advserver.py starts itself again with it.

Run: .venv/bin/python -m unittest scripts/engine/test_qa_advserver.py   (about 10 s)
"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "scripts" / "qa" / "advserver.py"


class Evictions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["QA_NOLIB"] = "1"
        sys.path.insert(0, str(ROOT / "scripts" / "qa"))
        import advserver
        cls.S = advserver

    def setUp(self):
        self.a = self.S.advs["fast"]
        self.saved = (self.a.cache_mb, dict(self.a._held), dict(self.a._mw_lines), dict(self.a._mw_cache), dict(self.a._cache))
        self.a._held.clear()
        self.S.EVICTED.clear()

    def tearDown(self):
        mb, held, lines, mw, cache = self.saved
        self.a.cache_mb = mb
        for d, was in ((self.a._held, held), (self.a._mw_lines, lines), (self.a._mw_cache, mw), (self.a._cache, cache)):
            d.clear()
            d.update(was)
        self.S.EVICTED.clear()

    def test_an_evicted_3way_solve_is_reported_by_its_board(self):
        a = self.a
        a.cache_mb = 150
        flop = object()     # a 3-way flop solve, read for the hand's turn
        a._mw_cache["flop"] = flop
        a._mw_lines[((45, 30, 27), "BB", (1, 2), (), (), ())] = (flop, ["UTG", "BTN", "BB"], 1.0)
        a._held[(a, "_mw_cache", "flop")] = 120 * 2 ** 20
        a._cache["turn"] = object()
        a._held[(a, "_cache", "turn")] = 60 * 2 ** 20
        a._cache["river"] = object()
        a._held[(a, "_cache", "river")] = 60 * 2 ** 20
        a._keep("_cache", "river", None)
        self.assertEqual(a._mw_lines, {})
        self.assertEqual(self.S.EVICTED, {"Kd9h8s"})

    def test_nothing_evicted_nothing_reported(self):
        a = self.a
        a.cache_mb = 150
        a._cache["turn"] = object()
        a._held[(a, "_cache", "turn")] = 60 * 2 ** 20
        a._keep("_cache", "turn", None)
        self.assertEqual(self.S.EVICTED, set())


@unittest.skipUnless(sys.platform == "darwin", "the allocator's cache is macOS's")
class Allocator(unittest.TestCase):
    def test_it_runs_with_the_large_block_cache_off(self):
        env = {k: v for k, v in os.environ.items() if k != "MallocLargeCache"}
        env.update(QA_NOLIB="1")
        out = subprocess.run([sys.executable, "-B", str(SERVER)], input="", capture_output=True, text=True, env=env,
                             cwd=str(ROOT), timeout=120)
        ready = json.loads(next(line for line in out.stdout.splitlines() if line.startswith("{")))
        self.assertTrue(ready["ready"])
        self.assertEqual(ready["large_cache"], "0")


if __name__ == "__main__":
    unittest.main()
