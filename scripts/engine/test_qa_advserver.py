"""The QA sweep's advisor process (scripts/qa/advserver.py): it says which hands' 3-way solves its cache evicted, and on
macOS it runs with the allocator's large-block cache off.

- A 3-way solve of an earlier street (Advisor._mw_lines) is what a later street of the hand is narrowed through; where the
  solve cache evicts it (Advisor._keep, least recently used past QA_CACHE_MB) the next street falls back to the betting
  rules. The sweep asked such a hand's later streets as if the process still held them (docs/QA.md, issue F); the reply's
  `dropped` names the boards, so it asks them again.
- macOS libmalloc kept freed large blocks resident, so a stored preflop solve dropped after a request stayed in the RSS
  and the next solve's working set stacked on it: peaks of 1.1-1.2 GB that weren't live data (issue C).
  MallocLargeCache=0 turns that off; it's read at process start, so advserver.py starts itself again with it.
- And the freed pages of libmalloc's small-block regions stay in the RSS until the system takes them back (they're clean:
  it takes them without writing anything), so a process's RSS after a run of solves is mostly memory it doesn't hold, and
  a big read lands on top of it: the process restarts past a lower cap (700 MB after a reply; 500 before a preflop
  request, py.ts) and reports its physical footprint, what it holds, beside its RSS.

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


def load_advserver():
    """scripts/qa/advserver.py imported afresh without the libraries (QA_NOLIB=1). It reads its environment at import, and
    another test file (test_size_match.py) imports it with the library, so neither takes the other's module or env."""
    sys.path.insert(0, str(ROOT / "scripts" / "qa"))
    sys.modules.pop("advserver", None)
    was = os.environ.get("QA_NOLIB")
    os.environ["QA_NOLIB"] = "1"
    try:
        import advserver
    finally:
        if was is None:
            os.environ.pop("QA_NOLIB", None)
        else:
            os.environ["QA_NOLIB"] = was
    sys.modules.pop("advserver", None)
    return advserver


class Evictions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.S = load_advserver()

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
        self.assertGreater(ready["mem_mb"], 0)
        self.assertGreater(ready["rss_mb"], 0)


class Memory(unittest.TestCase):
    """memory(): the footprint now and at its most, the RSS beside them; over_cap() reads the RSS."""

    @classmethod
    def setUpClass(cls):
        cls.S = load_advserver()

    @staticmethod
    def held(large_cache):
        """memory() before, while holding and after freeing a 300 MB array, in a process with MallocLargeCache as given."""
        env = {k: v for k, v in os.environ.items() if k != "MallocLargeCache"}
        env.update(QA_NOLIB="1", **({"MallocLargeCache": large_cache} if large_cache is not None else {}))
        code = ("import json, sys; sys.path.insert(0, 'scripts/qa'); import numpy as np, advserver as S; m0 = S.memory(); "
                "a = np.ones(300 * 2 ** 20 // 8); m1 = S.memory(); del a; print(json.dumps([m0, m1, S.memory()]))")
        out = subprocess.run([sys.executable, "-B", "-c", code], capture_output=True, text=True, env=env, cwd=str(ROOT),
                             timeout=120)
        return json.loads(out.stdout.strip().splitlines()[-1])

    @unittest.skipUnless(sys.platform == "darwin", "the physical footprint is macOS's")
    def test_the_footprint_follows_what_the_process_holds(self):
        m0, m1, m2 = self.held("0")
        self.assertGreater(m1["now"] - m0["now"], 250)
        self.assertLess(m2["now"] - m0["now"], 50)                 # given back
        self.assertGreaterEqual(m2["peak"], m1["now"] - 1)          # and the most it held kept
        self.assertGreater(m1["rss_now"], 0)
        self.assertLessEqual(m1["now"], m1["peak"] + 1)

    @unittest.skipUnless(sys.platform == "darwin", "the allocator's cache is macOS's")
    def test_with_the_large_block_cache_on_a_freed_block_stays_held(self):
        # (why the process runs with it off: the block a dropped stored solve frees is still the process's memory)
        m0, _, m2 = self.held(None)
        self.assertGreater(m2["now"] - m0["now"], 250)

    def test_the_cap_restarts_a_process_before_its_next_request_can_pass_1gb(self):
        # the sweep's case: a process at 822 MB of RSS, 160 MB of it held, went on under the 900 MB cap, and its next
        # request, a stored preflop solve's read, took it to 1166 MB
        bye = self.S.over_cap({"now": 160, "peak": 570, "rss_now": 822, "rss_peak": 840})
        self.assertIn("over the cap", bye)
        self.assertIsNone(self.S.over_cap({"now": 150, "peak": 400, "rss_now": 450, "rss_peak": 600}))
        # (in the default matrix a config's postflop request added up to 431 MB, and a preflop one, up to 494, restarts the
        # process past 500 first: py.ts)
        self.assertLessEqual(self.S.CAP, 1024 - 300)


if __name__ == "__main__":
    unittest.main()
