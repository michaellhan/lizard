"""engine/pf_solve.py's stored games with antes and straddles, and the full-ring games with neither (forced_games, built by
scripts/pf/build_stored.py --forced):

- the set: a straddle at 3 to 9 players and 50 to 200bb (raked or not), a big-blind ante's share at 2 to 9 players and
  20 to 100bb, 7 to 9 players with neither at the grid's depths (raked or not), each at the tree's and the charts' sizes, keyed as engine/pf_solve.Spec.key keys them;
- a request as the page sends it (Study's setup, Practice's and Analyze's grade with the charts' sizes) asks the very key
  of the stored game, so it's answered from the file at once, never "pf_unsolved";
- every built file is its game's tree, within its bound, its iterations those of the build's log;
- the stored answer is a live solve's: the same iterations give the same strategy to the file's 1/255 steps, and a live
  solve run to its own stop gives the same first-in ranges within the tolerances docs/ACCURACY.md section 18.13 measured.

Under a minute (the live solves are of the two smallest built games). Run:
    .venv/bin/python -m unittest scripts/engine/test_pf_forced.py
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import gto.native  # noqa: E402,F401
from gto import pf_game as G  # noqa: E402
from gto import pf_study as PS  # noqa: E402
from engine import pf_solve as P  # noqa: E402
import importlib.util  # noqa: E402

# scripts/pf/build_stored.py under its own name: scripts/pf_icm has a build_stored.py too (test_pf_icm_stored imports
# that one), and a plain import would leave whichever loaded first in sys.modules for both in one discover run
_spec = importlib.util.spec_from_file_location("pf_build_stored", ROOT / "scripts" / "pf" / "build_stored.py")
B = importlib.util.module_from_spec(_spec)
sys.modules["pf_build_stored"] = B
_spec.loader.exec_module(B)


class Adv:
    should_stop = None


def request(spec, chart=None):
    """The request the page sends for this game: Study's (the tree's sizes) or the grade's (the charts')."""
    st = {"players": spec.players, "stack": spec.stacks[0], "bb": 1.0, "study": True, "preflop_solve": True,
          "preflop": [], "street": "preflop", "board": ""}
    if spec.ante:
        st["ante"] = spec.ante
    if spec.straddle:
        st["straddle"] = True
    if spec.rake:
        st["rake"], st["rake_cap"] = spec.rake
    if spec.chart if chart is None else chart:
        st["pf_tree"] = {"sizing": "chart"}
    return st


def built_specs():
    return [s for s in P.forced_games() if s.key in P.FORCED_BUILT]


class TheSet(unittest.TestCase):
    def test_the_games(self):
        games = P.forced_games()
        # 240 with an ante or a straddle, then 132 full-ring games with neither (7 to 9 players, 2026-11-26)
        self.assertEqual(len(games), 240 + 132)
        self.assertEqual(len({s.key for s in games}), 240 + 132)
        self.assertFalse({s.key for s in games} & {s.key for s in P.stored_games()})
        self.assertEqual([P.stored_ante(n) for n in P.ANTE_PLAYERS], [0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.13, 0.11])
        keys = {s.key for s in games}
        for k in ("lz4_6max_100bb_s", "lz4_6max_100bb_s_r5c3_ch", "lz4_9max_200bb_s", "lz4_3max_50bb_s_r5c3",
                  "lz4_9max_40bb_a0.11_ch", "lz4_8max_25bb_a0.13", "lz4_2max_20bb_a0.5_ch", "lz4_6max_100bb_a0.17"):
            self.assertIn(k, keys)
        for k in ("lz4_2max_100bb_s", "lz4_6max_125bb_a0.17", "lz4_6max_30bb_a0.17_r5c3", "lz4_6max_100bb_sBTN"):
            self.assertNotIn(k, keys)
        # the most played first: the straddled 100bb and 200bb games, then the antes at tournament depths
        self.assertEqual(games[0].key, "lz4_3max_100bb_s_ch")
        self.assertTrue(all(s.straddle and s.stack in (100.0, 200.0) for s in games[:56]))
        self.assertTrue(all(s.ante and s.stack <= 60.0 for s in games[56:56 + 96]))
        self.assertTrue(all(s.ante or s.straddle for s in games[:240]))
        # the full-ring games: every grid depth at 7 to 9 players, raked or not, at both sizes; 9-max 100bb first
        ring = games[240:]
        self.assertTrue(all(not s.ante and not s.straddle and s.players in (7, 8, 9) for s in ring))
        self.assertEqual({(s.players, s.stack, s.rake, s.chart) for s in ring},
                         {(n, d, r, c) for n in (7, 8, 9) for d in P.STORED_DEPTHS for r in P.STORED_RAKES for c in (False, True)})
        self.assertEqual(ring[0].key, "lz4_9max_100bb_ch")
        for k in ("lz4_9max_100bb", "lz4_7max_20bb_r5c3_ch", "lz4_8max_200bb_r5c3"):
            self.assertIn(k, keys)

    def test_only_built_games_are_stored(self):
        self.assertTrue(set(P.FORCED_BUILT) <= P.FORCED_KEYS)
        self.assertTrue(set(P.FORCED_BUILT) <= P.STORED_KEYS)
        self.assertFalse((P.FORCED_KEYS - set(P.FORCED_BUILT)) & P.STORED_KEYS)

    def test_words(self):
        s = P.Spec(6, (100.0,), straddle=True)
        self.assertEqual(s.forced_words(), f"a 2bb straddle from the UTG ({P.FORCED_NOTE})")
        self.assertEqual(P.Spec(3, (100.0,), straddle=True).forced_words(), f"a 2bb straddle from the BTN ({P.FORCED_NOTE})")
        self.assertEqual(P.Spec(9, (40.0,), ante=0.11).forced_words(), f"a 0.11bb ante a seat ({P.FORCED_NOTE})")
        self.assertIsNone(P.Spec(6, (100.0,)).forced_words())
        # a full-ring game has no forced words, only the 7-9 handed tree's limits
        self.assertIsNone(P.Spec(9, (100.0,)).forced_words())
        self.assertEqual(P.Spec(9, (100.0,)).limits(), P.LIMITS_7UP)


class Built(unittest.TestCase):
    def test_some_are_built(self):
        # the sample built and checked with the code (docs/ACCURACY.md section 18.13); the rest land by --install
        for k in ("lz4_4max_100bb_s", "lz4_6max_100bb_s_ch", "lz4_9max_100bb_s", "lz4_3max_40bb_a0.33",
                  "lz4_6max_30bb_a0.17_ch", "lz4_9max_40bb_a0.11", "lz4_6max_100bb_a0.17_ch"):
            self.assertIn(k, P.FORCED_BUILT)

    def test_a_request_asks_the_stored_key(self):
        # Study's request (the tree's sizes) and the grade's (the charts') each name the stored game's key
        for spec in built_specs():
            got, why = P.spec_of(request(spec))
            self.assertIsNone(why, spec.key)
            self.assertEqual(got.key, spec.key)
            self.assertIn(got.key, P.STORED_KEYS)
        # Practice's ante is sent to the cent and its straddle as true; a site's big-blind ante is sent as the stored
        # share (grading.ts pfSiteGame): each the stored key
        self.assertEqual(P.spec_of({"players": 6, "stack": 30, "ante": 0.17})[0].key, "lz4_6max_30bb_a0.17")
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "straddle": True, "rake": 0.05, "rake_cap": 3,
                                    "pf_tree": {"sizing": "chart"}})[0].key, "lz4_6max_100bb_s_r5c3_ch")
        # (in chips: a 200/400 game with a 50 ante is 0.125bb a seat, not the stored 0.13)
        self.assertEqual(P.spec_of({"players": 8, "stack": 10000, "bb": 400, "ante": 50})[0].key, "lz4_8max_25bb_a0.125")

    def test_every_built_file_is_its_games_tree_within_its_bound(self):
        log = B.last_lines(str(Path(P.STORE_DIR) / B.FORCED_LOG))
        for spec in built_specs():
            with self.subTest(spec.key):
                blob = P.read_stored(spec.key)
                self.assertIsNotNone(blob)
                PS.unpack(spec.game(), blob)
                self.assertLess(PS.stored_mbb(blob), B.bound(spec, P.FORCED_BUILT[spec.key]))
                self.assertEqual(P.FORCED_BUILT[spec.key], log[spec.key]["iterations"])
                self.assertAlmostEqual(PS.stored_mbb(blob), log[spec.key]["mbb"], places=3)

    def test_answered_from_the_file(self):
        for key in ("lz4_6max_100bb_s_ch", "lz4_9max_40bb_a0.11", "lz4_6max_100bb_a0.17_ch"):
            spec = next(s for s in built_specs() if s.key == key)
            r = P.answer(Adv, request(spec))
            self.assertEqual(r["study"], "node", r)
            self.assertTrue(r["pf_solve"]["stored"] and r["pf_solve"]["done"])
            self.assertEqual(r["pf_solve"]["iterations"], P.FORCED_BUILT[key])
            self.assertIn(P.FORCED_NOTE, r["pf_forced"])
            self.assertAlmostEqual(sum(x["freq"] for x in r["actions"]), 1.0, places=2)
        # a full-ring game: answered from its file, with the 7-9 handed tree's limits and no forced words
        for key in ("lz4_9max_100bb_ch", "lz4_7max_40bb"):
            spec = next(s for s in built_specs() if s.key == key)
            r = P.answer(Adv, request(spec))
            self.assertEqual(r["study"], "node", r)
            self.assertTrue(r["pf_solve"]["stored"] and r["pf_solve"]["done"])
            self.assertNotIn("pf_forced", r)
            self.assertEqual(r["pf_limits"], P.LIMITS_7UP)
        # a game of the set not built yet is offered as unsolved, as any other
        missing = sorted(P.FORCED_KEYS - set(P.FORCED_BUILT))
        if missing:
            spec = next(s for s in P.forced_games() if s.key == missing[0])
            self.assertEqual(P.answer(Adv, request(spec))["study"], "pf_unsolved")


class SameAsLive(unittest.TestCase):
    """The stored answer is a live solve of the same game."""

    SMALL = ("lz4_4max_100bb_s", "lz4_3max_40bb_a0.33")

    def test_same_iterations_same_strategy(self):
        # the build's DCFR is the live solve's: run as many iterations, the strategy is the file's to its 1/255 steps
        for key in self.SMALL:
            spec = next(s for s in built_specs() if s.key == key)
            g = spec.game()
            for t in range(1, P.FORCED_BUILT[key] + 1):
                g.iterate(t)
            stored = PS.unpack(g, P.read_stored(key))
            live = g.average()
            reach = g._down(live)
            # (classes the player never brings to a node are stored as folds: compared where they're reached)
            for d, k in enumerate(g.dec):
                on = reach[k, g.player[d]] > 1e-7
                self.assertLessEqual(float(np.abs(stored[d][:, on] - live[d][:, on]).max(initial=0.0)), 2.5 / 255, key)

    def test_a_live_solve_to_its_stop_gives_the_stored_mixes(self):
        # a live solve (the worker's Solve button) stops at its target, its stall rule or MAX_ITERS, short of the build's
        # iterations: first in, each action's share of the range (by combos) and each class's mix on average are the
        # stored ones within the tolerances section 18.13 measured. (A single class can differ by far more, 0.18 to 0.41
        # over the sample: a class near indifference between two moves, whose mix the two runs settle differently.)
        for key in self.SMALL:
            spec = next(s for s in built_specs() if s.key == key)
            stored = P.Solve(spec, P.read_stored(key))
            live = P.Solve(spec)
            live.run(120.0)
            self.assertTrue(live.done, key)
            a, b = stored.game.average(), live.game.average()
            g = live.game
            reach = g._down(b)
            share = mean = 0.0
            for d, k in enumerate(g.dec):
                if any(act in ("raise", "all-in", "call") for _, act, _ in g.nodes_all[k].line):
                    continue                    # first in: every class reaches it
                on = reach[k, g.player[d]] > 1e-7
                diff = a[d][:, on] - b[d][:, on]
                w = G.PRIOR[on] / G.PRIOR[on].sum()
                share = max(share, float(np.abs(diff @ w).max()))
                mean = max(mean, float(np.abs(diff).max(0).mean()))
            self.assertLess(share, LIVE_SHARE_TOL, key)
            self.assertLess(mean, LIVE_MEAN_TOL, key)


# first in, between the stored game and a live solve to its own stop (section 18.13): the largest gap in an action's share
# of the range by combos (measured 0.0008 to 0.0022 over five sample games), and in a class's mix averaged over the
# classes (0.0010 to 0.0025)
LIVE_SHARE_TOL = 0.005
LIVE_MEAN_TOL = 0.005


if __name__ == "__main__":
    unittest.main()
