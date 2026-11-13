"""engine/pf_engine.py and engine/pf_solve.py: Lizard's preflop solver.

- With every stack equal it is upstream's game exactly (pf_game: the same tree, every value the same).
- Each seat's own stack: nobody puts in more than it has, a heads-up game is zero-sum to the chip, side pots and an
  uncalled excess go where they should, and a seat covered by everyone plays as if the deeper stacks were its own.
- It converges: exploitability falls to the target on small games with unequal stacks, and keeps falling on a 9-handed
  game.
- The worker's protocol (engine.pf_solve.answer): unsolved, progress, export and load, a node, refusals in words.
- Against the published 6-max 100bb solves (solver/tests/preflop_refs.py, pf_equilibrium.report, as docs/ACCURACY.md
  section 18.4 measures): the stored calibrated solve is nearer them than upstream's stored solve of the same game, and
  engine/pf_calib.py's recorded measurement says the calibration beat upstream's model in and out of sample.

~1 minute. Run: .venv/bin/python -m unittest scripts/engine/test_pf_engine.py
"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT / "solver" / "scripts"))
sys.path.insert(0, str(ROOT))

import gto.native  # noqa: E402,F401
from gto import pf_game as G, pf_study as PS  # noqa: E402
from gto.preflop import SEATS  # noqa: E402
from engine import pf_engine as E, pf_model as M, pf_solve as P  # noqa: E402


def upstream_model(d):
    return PS.flop_model(d)


def random_strategy(g, seed=1):
    rng = np.random.default_rng(seed)
    s = rng.random(g.average().shape) * g.valid[:, :, None]
    return s / s.sum(1, keepdims=True)


class SameAsUpstream(unittest.TestCase):
    def test_equal_stacks_are_pf_game(self):
        for n, stack, ante, strad, rake in ((6, 100.0, 0.0, False, (0.05, 4.0)), (3, 40.0, 0.125, False, None),
                                            (6, 50.0, 0.12, True, (0.05, 3.0)), (2, 100.0, 0.0, False, None)):
            spec = PS.Spec(n, stack, ante, strad, rake)
            g0 = spec.game()
            pos = spec.positions()
            r1 = E.build(pos, [stack] * n, max_players=3, ante=ante, straddle=strad, sb_limp=n == 2)
            g1 = E.Game(r1, pos, upstream_model, [stack] * n, rake=rake, ante=ante)
            self.assertEqual(g0.N, g1.N)
            self.assertEqual([nd.names for nd in g0.nodes_all], [nd.names for nd in g1.nodes_all])
            s = random_strategy(g0)
            V0, V1 = g0._up(g0._down(s), s), g1._up(g1._down(s), s)
            self.assertLess(float(np.abs(V0 - V1).max()), 1e-9, spec.key)

    def test_default_params_are_the_library_model(self):
        m = M.CalibratedModel(M.Params())
        lib = PS.flop_model(100.0)
        for key in ((1, True, "BTN", "BB"), (2, False, "BB", "BTN"), (3, True, "BTN", "SB")):
            self.assertLess(float(np.abs(m.share(key) - lib.share(key)).max()), 1e-12)


class OwnStacks(unittest.TestCase):
    GAMES = ((6, [100, 35, 220, 60, 15, 100]), (3, [12, 40, 25]), (2, [30, 100]), (9, [100, 80, 60, 40, 30, 20, 150, 10, 100]))

    def game(self, n, stacks, **kw):
        pos = list(SEATS[n])
        r = E.build(pos, stacks, max_players=3 if n <= 6 else 2, cold4=n <= 6, sb_limp=n == 2, **kw)
        return E.Game(r, pos, upstream_model, stacks, **{k: v for k, v in kw.items() if k == "ante"})

    def test_nobody_bets_more_than_it_has(self):
        for n, stacks in self.GAMES:
            g = self.game(n, stacks)
            for nd in g.nodes_all:
                if nd.kind != "dec":
                    self.assertLessEqual(float((nd.inv - np.array(stacks, float)).max()), 1e-9)

    def test_heads_up_is_zero_sum(self):
        for stacks in ([30, 100], [100, 30], [12, 12.5]):
            g = self.game(2, stacks)
            self.assertAlmostEqual(float(g.values(random_strategy(g)).sum()), 0.0, places=9)

    def test_near_zero_sum_with_three(self):
        # three-way pots are normalised over the three ranges with card removal by class pairs, as upstream's are
        # (pf_game: -0.003 to -0.004 bb a hand at random), so the sum is near zero, not exact
        for n, stacks in self.GAMES:
            g = self.game(n, stacks)
            self.assertLess(abs(float(g.values(random_strategy(g)).sum())), 0.05)

    def test_layers(self):
        # A raises to 50, B (30) calls all-in, C folded 10: main pot 30+30+10, A's 20 uncalled
        self.assertEqual(E.layers(np.array([50.0, 30.0, 10.0]), (0, 1)), [(70.0, (0, 1)), (20.0, (0,))])
        # three all-in at 15, 40, 100: main 45, side 50 between the two deeper, 60 back to the deepest
        self.assertEqual(E.layers(np.array([15.0, 40.0, 100.0]), (0, 1, 2)),
                         [(45.0, (0, 1, 2)), (50.0, (1, 2)), (60.0, (2,))])

    def test_short_stack_calls_all_in_for_less(self):
        # SB at 30 raises: nothing below puts more than 30 in from either player, and there is an all-in to call
        g = self.game(2, [30, 100])
        node = g.root.children[g.root.names.index("raise")]
        self.assertTrue(any("all-in" in nd.names for nd in G.walk(node) if nd.kind == "dec"))
        for nd in G.walk(node):
            if nd.kind != "dec":
                self.assertLessEqual(float(nd.inv.max()), 30.0 + 1e-9)

    def test_covered_seat_plays_as_deeper(self):
        # heads-up the BB at 300bb covering a 40bb SB is the 40bb game: same tree, same values
        a = self.game(2, [40.0, 40.0])
        b = self.game(2, [40.0, 300.0])
        self.assertEqual([nd.names for nd in a.nodes_all], [nd.names for nd in b.nodes_all])
        s = random_strategy(a)
        self.assertLess(float(np.abs(a.values(s) - b.values(s)).max()), 1e-9)

    def test_small_blind_complete_when_asked(self):
        # 3+ players: the small blind folded to may complete only when asked, not with a straddle; heads-up it always may
        def sb_names(spec):
            root, pos = spec.build()
            nd = root
            while nd.kind == "dec" and pos[nd.player] != "SB":
                nd = nd.children[nd.names.index("fold")]
            return nd.names
        self.assertNotIn("call", sb_names(P.Spec(6, (100.0,))))
        self.assertIn("call", sb_names(P.Spec(6, (100.0,), sb_limp=True)))
        self.assertNotIn("call", sb_names(P.Spec(6, (100.0,), straddle=True, sb_limp=True)))
        self.assertIn("call", sb_names(P.Spec(2, (100.0,))))
        # its own game: its own key and label, and the request's flag reaches it (left out with a straddle, and heads-up)
        on, _ = P.spec_of({"players": 6, "stack": 100, "pf_sb_limp": True})
        self.assertTrue(on.key.endswith("_l"))
        self.assertIn("may complete", on.label())
        self.assertEqual(P.spec_of({"players": 6, "stack": 100})[0].key, "lz1_6max_100bb")
        self.assertFalse(P.spec_of({"players": 6, "stack": 100, "straddle": True, "pf_sb_limp": True})[0].key.endswith("_l"))
        self.assertEqual(P.spec_of({"players": 2, "stack": 100, "pf_sb_limp": True})[0].key, "lz1_2max_100bb")
        # after the complete the big blind checks or raises to Sizes.iso
        root, pos = on.build()
        nd = root
        while pos[nd.player] != "SB":
            nd = nd.children[nd.names.index("fold")]
        bb = nd.children[nd.names.index("call")]
        self.assertEqual(pos[bb.player], "BB")
        self.assertIn("raise", bb.names)

    def test_nine_handed_tree_is_small(self):
        r = E.build(list(SEATS[9]), [100.0] * 9, max_players=2, cold4=False)
        self.assertLess(sum(1 for _ in G.walk(r)), 6000)


class TreeOptions(unittest.TestCase):
    """The tree builder's options (2026-11-13): open-limps and over-limps from any seat, a position's own open, 3-way
    flops and cold calls switched either way; with none asked the trees are the ones before."""

    @staticmethod
    def first_in(spec, who):
        root, pos = spec.build()
        nd = root
        while nd.kind == "dec" and pos[nd.player] != who:
            nd = nd.children[nd.names.index("fold")]
        return nd, pos

    def test_defaults_unchanged(self):
        self.assertEqual(P.Spec(6, (100.0,)).nodes(), 11010)
        self.assertEqual(P.Spec(9, (100.0,)).nodes(), 4795)
        for n in (6, 9):
            on = P.Spec(n, (100.0,), flop3=n <= 6, cold=n <= 6)
            self.assertEqual(on.key, P.Spec(n, (100.0,)).key)
            self.assertEqual(on.nodes(), P.Spec(n, (100.0,)).nodes())
        # the request's options at their table size's defaults are the default game (one key, one stored file)
        self.assertEqual(P.spec_of({"players": 6, "pf_tree": {"flop3": True, "cold": True, "opens": {"UTG": 2.5}}})[0].key,
                         "lz1_6max_100bb")

    def test_open_limps(self):
        spec = P.Spec(4, (100.0,), open_limps=True)
        self.assertTrue(spec.key.endswith("_L"))
        nd, pos = self.first_in(spec, "CO")
        self.assertEqual(nd.names, ["fold", "call", "raise"])
        lim = nd.children[1]
        self.assertEqual(pos[lim.player], "BTN")
        self.assertIn("call", lim.names)                       # an over-limp
        iso = lim.children[lim.names.index("raise")]
        self.assertAlmostEqual(iso.line[-1][2], 2.5 + 1.0)     # the open plus 1bb a limper
        x = lim.children[lim.names.index("call")]              # CO, BTN limp: with the big blind three are in, so the
        self.assertEqual((pos[x.player], x.names), ("SB", ["fold", "raise"]))   # small blind can't complete
        x = x.children[0]
        # the big blind checks behind limpers (no fold), and raises over them to Sizes.iso + 1bb a limper past the first
        self.assertEqual((pos[x.player], x.names), ("BB", ["call", "raise"]))
        self.assertAlmostEqual(x.children[1].line[-1][2], G.Sizes().iso + 1.0)
        # at most three see a limped flop: UTG, CO and the SB limp, and the big blind is the fourth only by checking
        for nd in G.walk(spec.build()[0]):
            if nd.kind == "show" and nd.n_raises == 0:
                self.assertLessEqual(len(nd.active), 3)
        # never with a straddle, never heads-up (the small blind's complete is always there)
        self.assertNotIn("call", self.first_in(P.Spec(4, (100.0,), straddle=True, open_limps=True), "BTN")[0].names)
        self.assertFalse(P.spec_of({"players": 2, "pf_tree": {"open_limps": True}})[0].open_limps)

    def test_open_limps_converge(self):
        spec = P.Spec(3, (40.0,), open_limps=True)
        g = spec.game()
        g.solve(1500)
        self.assertLess(1000 * sum(g.exploitability(per_seat=True)) / 3, 1.5)

    def test_opens_by_position(self):
        spec, why = P.spec_of({"players": 6, "pf_tree": {"opens": {"UTG": 2.2, "btn": 2.0}}})
        self.assertIsNone(why)
        self.assertEqual(spec.opens, (("UTG", 2.2), ("BTN", 2.0)))
        for who, want in (("UTG", 2.2), ("HJ", 2.5), ("BTN", 2.0), ("SB", 3.0)):
            nd, pos = self.first_in(spec, who)
            self.assertAlmostEqual(nd.children[nd.names.index("raise")].line[-1][2], want, msg=who)
        # a 3bet scales from the open it faces: the BB over the BTN's 2bb, 4.8x
        nd, pos = self.first_in(spec, "BTN")
        o = nd.children[nd.names.index("raise")]
        o = o.children[o.names.index("fold")]
        self.assertAlmostEqual(o.children[o.names.index("raise")].line[-1][2], 2.0 * 4.8)
        self.assertIn("opens UTG 2.2bb, BTN 2bb", spec.label())
        for st, word in (({"opens": {"BB": 3}}, "doesn't open"), ({"opens": {"UTG": 9}}, "2 to 5bb"),
                         ({"limps": True}, "unknown tree option")):
            self.assertIn(word, P.spec_of({"players": 6, "pf_tree": st})[1])

    def test_three_way_and_cold_switches(self):
        # 7 to 9 players can have the full tree's 3-way flops and cold calls; 6-max can do without them
        self.assertEqual(P.Spec(7, (100.0,), flop3=True).nodes(), 6585)
        self.assertEqual(P.Spec(7, (100.0,), flop3=True, cold=True).nodes(), 30667)
        self.assertEqual(P.Spec(6, (100.0,), flop3=False, cold=False).nodes(), 1135)
        self.assertTrue(any(nd.kind == "show" and len(nd.active) == 3 for nd in G.walk(P.Spec(7, (100.0,), flop3=True).build()[0])))
        self.assertEqual(P.Spec(7, (100.0,), flop3=True).limits(), "nobody cold 4bets or cold-calls a 3bet")
        self.assertEqual(P.Spec(6, (100.0,), flop3=False).limits(), "at most two see a flop")
        self.assertIsNone(P.Spec(7, (100.0,), flop3=True, cold=True).limits())
        self.assertEqual(P.Spec(9, (100.0,)).limits(), P.LIMITS_7UP)

    def test_memory_estimate(self):
        # the measured peaks it was fitted to (pf_solve.MB_BASE, MB_PER_WORK), within 20%
        for spec, mb in ((P.Spec(6, (100.0,)), 749), (P.Spec(9, (100.0,)), 588)):
            self.assertLess(abs(spec.estimate_mb() - mb) / mb, 0.2, spec.key)
        self.assertGreater(P.Spec(9, (100.0,), flop3=True, cold=True).estimate_mb(), P.MAX_MB_BROWSER)


class Converges(unittest.TestCase):
    def test_small_games_reach_target(self):
        for n, stacks, limp in ((2, [30, 100], False), (3, [12, 40, 25], False), (3, [100, 100, 100], False), (3, [40, 40, 40], True)):
            spec = P.Spec(n, tuple(stacks), sb_limp=limp)
            g = spec.game()
            g.solve(1500)
            mbb = 1000 * sum(g.exploitability(per_seat=True)) / n
            self.assertLess(mbb, 1.5, spec.key)

    def test_nine_handed_falls(self):
        spec = P.Spec(9, (100.0,))
        g = spec.game()
        g.solve(100)
        e1 = sum(g.exploitability(per_seat=True))
        g.solve(200, start=101)
        e2 = sum(g.exploitability(per_seat=True))
        self.assertLess(e2, e1 * 0.7)


class Protocol(unittest.TestCase):
    class Adv:
        should_stop = staticmethod(lambda: False)

    def test_unsolved_run_node_export_load(self):
        st = {"players": 3, "stack": 40, "stacks": {"BTN": 40, "SB": 18, "BB": 60}, "study": True}
        r = P.answer(self.Adv, {**st, "preflop": [], "preflop_solve": True})
        self.assertEqual(r["study"], "pf_unsolved")
        self.assertTrue(r["key"].startswith(P.MODEL_TAG + "_"))
        while True:
            r = P.answer(self.Adv, {**st, "preflop_solve": {"run": 5}})
            self.assertEqual(r["study"], "pf_progress")
            if r["pf_solve"]["done"]:
                break
        r = P.answer(self.Adv, {**st, "preflop": [{"pos": "BTN", "action": "raise", "to": 2.5}], "preflop_solve": True})
        self.assertEqual(r["study"], "node")
        self.assertEqual(r["actor"], "SB")
        self.assertEqual(r["stack_bb"], 17.5)
        self.assertEqual(r["pf_model"], P.MODEL)
        self.assertIn("all-in", [a["action"] for a in r["actions"]])
        x = P.answer(self.Adv, {**st, "preflop_solve": {"export": True}})
        self.assertEqual(x["study"], "pf_export")
        P._HELD.clear()
        r2 = P.answer(self.Adv, {**st, "preflop": [{"pos": "BTN", "action": "raise", "to": 2.5}],
                                 "preflop_solve": {"load": x["blob"], "iterations": x["iterations"]}})
        self.assertEqual(r2["study"], "node")
        self.assertTrue(r2["pf_solve"]["cached"])
        self.assertEqual([c["freq"] for c in r2["actions"]], [c["freq"] for c in r["actions"]])

    def test_unsolved_names_its_memory(self):
        r = P.answer(self.Adv, {"players": 7, "stack": 100, "study": True, "preflop": [], "preflop_solve": True,
                                "pf_tree": {"flop3": True}})
        self.assertEqual(r["study"], "pf_unsolved")
        self.assertEqual(r["nodes"], 6585)
        self.assertEqual(r["estimate_mb"], round(P.MB_BASE + P.MB_PER_WORK * 6585 * 7))
        self.assertEqual(r["max_mb"], P.MAX_MB_BROWSER)

    def test_browser_refuses_a_tree_past_its_heap(self):
        st = {"players": 9, "stack": 100, "study": True, "pf_tree": {"flop3": True, "cold": True}, "preflop_solve": {"run": 1}}
        plat = sys.platform
        try:
            sys.platform = "emscripten"
            r = P.answer(self.Adv, st)
        finally:
            sys.platform = plat
        self.assertEqual(r["study"], "pf_none")
        self.assertIn("MB", r["reason"])

    def test_refusals(self):
        for st, word in (({"players": 10}, "2 to 9"), ({"players": 6, "stacks": {"BTN": 2}}, "stacks of"),
                         ({"players": 6, "payouts": [50, 30, 20]}, "tournament"),
                         ({"players": 6, "stacks": {"XX": 40}}, "not a seat")):
            r = P.answer(self.Adv, {**st, "study": True, "preflop_solve": True})
            self.assertEqual(r["study"], "pf_none")
            self.assertIn(word, r["reason"])


class StoredGrid(unittest.TestCase):
    def test_every_stored_game_has_a_file_near_equilibrium(self):
        # the strategy as stored (quantized) within the 1.5 mbb a live solve stops at, each file unpacking on its own tree;
        # the games solved longer (STORED_ITERS_OF) within 1.7: 4-max and 5-max 40bb level off at 1.60 and 1.65 (3,000
        # iterations moved them 0.05 mbb, where a live solve's stall rule stops too), the figure in their header shown
        for spec in P.stored_games():
            blob = P.read_stored(spec.key)
            self.assertIsNotNone(blob, spec.key)
            PS.unpack(spec.game(), blob)
            bound = 1.7 if spec.key in P.STORED_ITERS_OF else PS.TARGET_MBB
            self.assertLess(PS.stored_mbb(blob), bound, spec.key)
        for spec in (P.Spec(2, (20.0,)), P.Spec(6, (100.0,), rake=(0.05, 3.0))):
            s = P.Solve(spec, P.read_stored(spec.key))
            self.assertTrue(s.stored and s.done)

    def test_stored_iterations_are_the_builds(self):
        # a stored solve says the iterations it was built with: the build log's last line for its key
        import json
        last = {}
        with open(Path(P.STORE_DIR) / f"{P.MODEL_TAG}_built.jsonl") as f:
            for line in f:
                r = json.loads(line)
                last[r["key"]] = r["iterations"]
        for spec in P.stored_games():
            self.assertEqual(P.STORED_ITERS_OF.get(spec.key, PS.STORED_ITERS), last[spec.key], spec.key)
        spec = P.Spec(4, (40.0,))
        self.assertEqual(P.Solve(spec, P.read_stored(spec.key)).iters, last[spec.key])


class AgainstPublished(unittest.TestCase):
    def score(self, solve):
        import pf_equilibrium
        rows, (mae, n_miss), hands, n_bad = pf_equilibrium.report(solve.game)
        return mae * 100, n_miss

    def test_stored_calibrated_is_nearer_than_upstreams(self):
        rake = (0.05, 3.0)
        up = PS.Solve(PS.Spec(6, 100.0, rake=rake), PS._read_stored("6max_100bb_r5c3"))
        spec = P.Spec(6, (100.0,), rake=rake)
        ours = P.Solve(spec, P.read_stored(spec.key))
        (e0, m0), (e1, m1) = self.score(up), self.score(ours)
        self.assertLess(e1, e0 - 0.3, f"calibrated {e1:.2f} points against upstream's {e0:.2f}")
        self.assertLessEqual(m1, m0)

    def test_recorded_calibration_beat_upstream(self):
        from engine import pf_calib
        m = pf_calib.MEASURED
        self.assertLess(m["mae_points"], m["base_mae_points"])
        self.assertLess(m["held_out_mae_points"], m["held_out_base_points"])
        self.assertEqual(M.load_params(), M.Params.of(pf_calib.PARAMS))


if __name__ == "__main__":
    unittest.main()
