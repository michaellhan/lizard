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
        self.assertEqual(P.spec_of({"players": 6, "stack": 100})[0].key, "lz4_6max_100bb")
        self.assertFalse(P.spec_of({"players": 6, "stack": 100, "straddle": True, "pf_sb_limp": True})[0].key.endswith("_l"))
        self.assertEqual(P.spec_of({"players": 2, "stack": 100, "pf_sb_limp": True})[0].key, "lz4_2max_100bb")
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
                         "lz4_6max_100bb")

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

    def test_chart_sizes(self):
        # every raise as the charts size it (pf_engine.build sizing="chart"), for Practice's and Analyze's grade; named
        c = P.chart_sized(P.Spec(6, (100.0,), rake=(0.05, 3.0)))
        self.assertEqual(c.key, "lz4_6max_100bb_r5c3_ch")
        self.assertIn(c, P.stored_games())
        self.assertIn("at the charts' raise sizes", " ".join(c.tree_notes()))
        self.assertEqual(P.Spec(6, (100.0,)).tree_notes(), [])
        root, pos = c.build()

        def at(nd, *moves):
            for m in moves:
                nd = nd.children[nd.names.index(m)]
            return nd
        # the BTN opens 2.5, the SB folds, the BB 3bets to 10bb (4x), the BTN 4bets to 23bb
        btn = at(self.first_in(c, "BTN")[0], "raise", "fold", "raise")
        self.assertAlmostEqual(btn.line[-1][2], 10.0)
        self.assertAlmostEqual(at(btn, "raise").line[-1][2], 23.0)
        # UTG opens, the BTN 3bets to 7.5bb: UTG's 4bet is 17bb (2.3x to the half big blind, half to even), and the
        # small blind's cold 4bet adds UTG's 2.5bb: 20bb (the tree's own: 17.25bb either way)
        utg = at(root, "raise", "fold", "fold", "raise")
        self.assertEqual(utg.line[-1][:2], ("BTN", "raise"))
        self.assertAlmostEqual(utg.line[-1][2], 7.5)
        self.assertEqual(pos[utg.player], "SB")
        self.assertAlmostEqual(at(utg, "raise").line[-1][2], 20.0)
        self.assertAlmostEqual(at(utg, "fold", "fold", "raise").line[-1][2], 17.0)
        # a squeeze adds a caller's chips beyond its blind: the SB calls UTG's open, the BB squeezes to 12bb (not 12.5);
        # a 4bet over it would leave under 1.25 pots behind once called, so the charts go all-in there, and so does this
        sq = at(root, "raise", "fold", "fold", "fold", "call", "raise")
        self.assertAlmostEqual(sq.line[-1][2], 12.0)
        self.assertNotIn("raise", sq.names)
        self.assertEqual(at(sq, "all-in").line[-1][2], 100.0)
        # what the request asks: the tree option as Practice sends it reaches the stored game's key; sizes go with it
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "pf_tree": {"sizing": "chart"}})[0].key, "lz4_6max_100bb_ch")
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "pf_sizes": {"open": 2.2},
                                    "pf_tree": {"sizing": "chart"}})[0].key, "lz4_6max_100bb_ch")
        self.assertIn("'tree' or 'chart'", P.spec_of({"players": 6, "pf_tree": {"sizing": "odd"}})[1])

    def test_chart_sizes_are_the_charts(self):
        # each raise and all-in of the chart-sized trees is the charts' own (gto/advisor.py's preflop answer), on a sample
        # of nodes at four table sizes and depths: the size to the cent, an all-in where the charts go all-in
        import random
        from gto.advisor import Advisor
        adv = Advisor()
        rnd = random.Random(1)
        for n, stack in ((6, 100.0), (6, 200.0), (5, 40.0), (2, 100.0)):
            root, pos = P.chart_sized(P.Spec(n, (stack,))).build()
            decs = [nd for nd in G.walk(root) if nd.kind == "dec" and ("raise" in nd.names or "all-in" in nd.names)]
            for nd in rnd.sample(decs, min(40, len(decs))):
                pre = [dict(pos=p, action=a, **({"to": to} if a == "raise" else {})) for p, a, to in nd.line]
                r = adv.advise(dict(players=n, stack=stack, board="", preflop=pre, flop=[], turn=[], river=[],
                                    hero=pos[nd.player], hole="7c2d"))
                theirs = next(a for a in r["actions"] if a["action"] in ("raise", "all-in"))
                name = "raise" if "raise" in nd.names else "all-in"
                self.assertEqual(theirs["action"], name, nd.line)
                if name == "raise":
                    to = nd.children[nd.names.index(name)].line[-1][2]
                    self.assertAlmostEqual(theirs["amount_bb"], to, places=2, msg=nd.line)

    def test_straddle_from_any_seat(self):
        # on the first seat it is pf_game's straddle exactly; on another (a Mississippi straddle) the straddler posts 2bb,
        # the action starts left of the big blind with it skipped, and it acts last once everyone else has had a move
        self.assertEqual(sorted(nd.line for nd in G.walk(P.Spec(6, (100.0,), straddle=True).build()[0])),
                         sorted(nd.line for nd in G.walk(G.build(G.SIX, 100.0, straddle=True))))
        spec, why = P.spec_of({"players": 6, "stack": 100, "straddle": "btn"})
        self.assertIsNone(why)
        self.assertEqual((spec.straddler, spec.key), ("BTN", "lz4_6max_100bb_sBTN"))
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "straddle": "UTG"})[0].key, "lz4_6max_100bb_s")
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "straddle": True})[0].key, "lz4_6max_100bb_s")
        # the tree option names the seat where the setup has a straddle; without one it's ignored
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "straddle": True,
                                    "pf_tree": {"straddler": "CO"}})[0].key, "lz4_6max_100bb_sCO")
        self.assertEqual(P.spec_of({"players": 6, "stack": 100, "pf_tree": {"straddler": "CO"}})[0].key, "lz4_6max_100bb")
        self.assertIn("can't straddle", P.spec_of({"players": 6, "straddle": "BB"})[1])
        self.assertIn("a straddle from the BTN", " ".join(spec.tree_notes()))
        self.assertIn("straddle from the BTN, acting last", spec.label())
        root, pos = spec.build()
        nd, order = root, []
        while nd.kind == "dec":
            order.append(pos[nd.player])
            nd = nd.children[nd.names.index("fold")]
        self.assertEqual(order, ["UTG", "HJ", "CO", "SB", "BB"])      # folded to the straddler, who wins
        self.assertEqual(nd.active, (pos.index("BTN"),))
        o = root.children[root.names.index("raise")]
        self.assertAlmostEqual(o.line[-1][2], 5.0)                     # 2.5x the straddle
        while pos[o.player] != "BB":
            o = o.children[o.names.index("fold")]
        x = o.children[o.names.index("raise")]                        # the BB 3bets UTG's open: the BTN is next, then UTG
        self.assertEqual(pos[x.player], "BTN")
        self.assertEqual(pos[x.children[x.names.index("fold")].player], "UTG")
        for spec in (P.Spec(4, (40.0,), straddle=True, straddler="BTN"), P.Spec(5, (60.0,), straddle=True, straddler="CO")):
            g = spec.game()
            g.solve(1500)
            self.assertLess(1000 * sum(g.exploitability(per_seat=True)) / spec.players, 1.5, spec.key)

    def test_five_bet_rules(self):
        # the 5bet: all-in (the default, the tree before), none (facing a 4bet, call or fold), or a size x the 4bet with
        # the 6bet all-in; each converges
        def most(spec):
            return max(sum(1 for _, a, _ in nd.line if a in ("raise", "all-in")) for nd in G.walk(spec.build()[0]))
        self.assertEqual(P.spec_of({"players": 6, "pf_tree": {"five": "jam"}})[0].key, "lz4_6max_100bb")
        none = P.spec_of({"players": 3, "stack": 200, "pf_tree": {"five": "none"}})[0]
        sized = P.spec_of({"players": 3, "stack": 200, "pf_tree": {"five": 2.2}})[0]
        self.assertEqual((none.key, sized.key), ("lz4_3max_200bb_5x0", "lz4_3max_200bb_5x2.2"))
        self.assertEqual((most(P.Spec(3, (200.0,))), most(none), most(sized)), (4, 3, 5))
        self.assertIn("no 5bet", " ".join(none.tree_notes()))
        self.assertIn("a 5bet to 2.2x the 4bet", " ".join(sized.tree_notes()))
        fives = [nd for nd in G.walk(sized.build()[0])
                 if sum(1 for _, a, _ in nd.line if a in ("raise", "all-in")) == 4 and nd.line[-1][1] == "raise"]
        self.assertTrue(fives)
        for nd in fives:
            tos = [to for _, a, to in nd.line if a in ("raise", "all-in")]
            self.assertGreaterEqual(tos[-1], tos[-2] * 2.2 - 1e-9, nd.line)
        self.assertIn("1.8 to 3.5x", P.spec_of({"players": 6, "pf_tree": {"five": 9}})[1])
        for spec in (none, sized):
            g = spec.game()
            g.solve(1500)
            self.assertLess(1000 * sum(g.exploitability(per_seat=True)) / spec.players, 1.5, spec.key)

    def test_no_raise_over_three_all_ins(self):
        # at unequal stacks a deeper seat could raise over three shorter all-ins (the charts' sizes go all-in sooner),
        # a 4-way showdown the terminal values don't price: up to three go to a showdown, as a call's cap has it; equal
        # stacks never reach it, so their trees (and every stored game) are unchanged
        for stacks in ((100.0, 90.0, 110.0, 100.0, 85.0, 120.0), (40.0, 60.0, 80.0, 100.0, 120.0, 140.0)):
            for chart in (False, True):
                spec = P.Spec(6, stacks, chart=chart)
                root, _ = spec.build()
                self.assertEqual([nd.line for nd in G.walk(root) if nd.kind != "dec" and len(nd.active) > 3], [], spec.key)
                spec.game()                                   # (built and priced)
        self.assertEqual(P.chart_sized(P.Spec(6, (100.0,))).nodes(), 5091)

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
        self.assertNotIn("pf_3bet", r)    # before any 3bet
        x = P.answer(self.Adv, {**st, "preflop_solve": {"export": True}})
        self.assertEqual(x["study"], "pf_export")
        P._HELD.clear()
        r2 = P.answer(self.Adv, {**st, "preflop": [{"pos": "BTN", "action": "raise", "to": 2.5}],
                                 "preflop_solve": {"load": x["blob"], "iterations": x["iterations"]}})
        self.assertEqual(r2["study"], "node")
        self.assertTrue(r2["pf_solve"]["cached"])
        # the export keeps each class's mix in 1/255 steps (pf_study.pack), so a mixed class moves by up to 0.002
        np.testing.assert_allclose([c["freq"] for c in r2["actions"]], [c["freq"] for c in r["actions"]], atol=0.002)
        # at or after a 3bet the node says the model is least certain there (docs/ACCURACY.md section 18.7)
        r3 = P.answer(self.Adv, {**st, "preflop": [{"pos": "BTN", "action": "raise", "to": 2.5},
                                                   {"pos": "SB", "action": "raise", "to": 10}], "preflop_solve": True})
        self.assertEqual((r3["study"], r3["actor"], r3["pf_3bet"]), ("node", "BB", P.AFTER_3BET))

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
        # the games solved longer (STORED_ITERS_OF) within 1.8: 4-max and 5-max 40bb level off at 1.60 and 1.65 (3,000
        # iterations moved them 0.05 mbb, where a live solve's stall rule stops too; see STORED_ITERS_OF); the figure in
        # their header shown. The games at the charts' raise sizes (`_ch`, 110 of them) are within 1.5 at 1,500
        for spec in P.stored_games():
            blob = P.read_stored(spec.key)
            self.assertIsNotNone(blob, spec.key)
            PS.unpack(spec.game(), blob)
            bound = 1.8 if spec.key in P.STORED_ITERS_OF else PS.TARGET_MBB
            self.assertLess(PS.stored_mbb(blob), bound, spec.key)
        for spec in (P.Spec(2, (20.0,)), P.Spec(6, (100.0,), rake=(0.05, 3.0))):
            s = P.Solve(spec, P.read_stored(spec.key))
            self.assertTrue(s.stored and s.done)

    def test_a_page_in_place_of_a_stored_file_is_no_file(self):
        # a dev server answers a missing file with the app's page (200, HTML): that's no stored solve, not a broken one
        import tempfile
        key = P.Spec(6, (100.0,)).key
        real = P.STORE_DIR
        with tempfile.TemporaryDirectory() as d:
            Path(d, key + ".bin").write_bytes(b"<!doctype html><html></html>")
            P.STORE_DIR = d
            try:
                self.assertIsNone(P.read_stored(key))
            finally:
                P.STORE_DIR = real
        self.assertIsNotNone(P.read_stored(key))

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


class RangeEdge(unittest.TestCase):
    """Classes outside a flop library spot's range aren't valued above the class with the next better kicker inside it
    (pf_model.LowerEdgeLibraryModel; docs/ACCURACY.md section 18.6). Upstream's edge join had QTo meet 0.580 of the pot
    against the BB's range where QJo met 0.535, and the 6-max 100bb solve opened QTo from the HJ and folded QJo."""
    RK = "23456789TJQKA"

    def inversions(self, params: M.Params, gap: float = 0.02):
        from gto.pf_libvals import SPOTS
        from gto.pf_classes import CLASSES, CLASS_INDEX, PAIR_COMPAT
        m = M.flop_model(100.0, params)
        out = []
        for sid, v in SPOTS.items():
            k = G.spot_key_of(v["line"], v["seats"])
            S = m.lib.share(k)
            side, other = ("ip", "oop") if k[1] else ("oop", "ip")
            P_ = PAIR_COMPAT * np.asarray(v[other]["range"], float)[None, :]
            fa = (P_ / P_.sum(1, keepdims=True) * S).sum(1)
            inside = np.asarray(v[side]["w"]) > 0
            for h in CLASSES:
                if len(h) != 3 or self.RK.index(h[1]) + 1 >= self.RK.index(h[0]):
                    continue
                better = h[0] + self.RK[self.RK.index(h[1]) + 1] + h[2]
                i, j = CLASS_INDEX[h], CLASS_INDEX[better]
                if not inside[i] and inside[j] and fa[i] > fa[j] + gap:
                    out.append((sid, h, better))
        return out

    def test_no_class_past_the_edge_beats_its_better_kicker(self):
        import dataclasses
        # on the exact equity table, 3bp_bb_btn's A2o (past the edge) is 2.1 points of flop share over A3o (inside at
        # 2.4% weight), past the 2-point gap; it was 1.5 points on the 3,000-board table (docs/ACCURACY.md section 31)
        self.assertLessEqual(set(self.inversions(M.load_params())), {("3bp_bb_btn", "A2o", "A3o")})
        # upstream's join (ext 0) at the same corrections: the test sees the fault it guards against
        self.assertGreater(len(self.inversions(dataclasses.replace(M.load_params(), ext=0.0))), 20)

    def test_stored_first_in_ranges_keep_the_better_kicker(self):
        # the inversions the 2026-11-16 audit found in lz1's 6-max 100bb solve (the better hand folded, the worse raised)
        pairs = {"HJ": [("QJo", "QTo")], "CO": [("QTo", "Q9o"), ("K9o", "Q9o")],
                 "BTN": [("A3o", "A2o"), ("Q8o", "Q7o"), ("K7o", "Q7o")], "SB": [("K7o", "K6o")]}
        spec = P.Spec(6, (100.0,))
        s = P.Solve(spec, P.read_stored(spec.key))
        pos = spec.positions()
        for seat, ps in pairs.items():
            cells = s.node([{"pos": p, "action": "fold"} for p in pos[:pos.index(seat)]])["grid"]["cells"]
            f = lambda h: cells[h]["f"][0] if h in cells else 0.0
            for better, worse in ps:
                self.assertGreaterEqual(f(better) + 0.1, f(worse), f"{seat} {better} {f(better):.2f} vs {worse} {f(worse):.2f}")


class HandOrder(unittest.TestCase):
    """The opener facing a 3bet plays pairs and suited hands in rank order (engine/pf_order.py: pairs from 77, suited
    hands T-high or better with a 7 or better kicker, within 20 points; PokerData's 6-max 100bb solve has none out of
    order over all 15 seat pairs). lz2 had 7-9 a game: its 3bet and 4bet pots valued each class from a sample of flops
    shared by every class, so a rank the sample dealt more often lifted every hand holding it, and the class-level
    solve took each step as a real gap (UTG facing the BTN's 3bet folded 99 85% and called 88 66%). The smoothing
    (pf_model.smooth_shares, s2 and s3) fixes it. Held out: no fit sees hand order (docs/ACCURACY.md section 18.7)."""

    def test_family_smooth_flattens_a_sawtooth_and_keeps_a_trend(self):
        from gto.pf_classes import CLASS_INDEX
        pairs = [CLASS_INDEX[r + r] for r in "23456789TJQKA"]
        x = np.zeros(169)
        x[pairs] = np.linspace(-0.1, 0.2, 13)
        np.testing.assert_allclose(M.family_smooth(x, 1.0)[pairs], x[pairs], atol=1e-9)
        y = x.copy()
        y[pairs] += 0.05 * (-1) ** np.arange(13)
        self.assertLess(np.abs(M.family_smooth(y, 1.0) - x)[pairs].max(), 0.025)   # a sawtooth of 0.05
        np.testing.assert_allclose(M.family_smooth(y, 0.0), y)

    def pair_shares(self, params):
        """The opener's pot share with each pair from 77, calling the BTN's 3bet and 4betting it (against the
        library's BTN 3bet range)."""
        from gto.pf_libvals import SPOTS
        from gto.pf_classes import CLASS_INDEX, PAIR_COMPAT
        m = M.flop_model(100.0, params)
        ra = np.asarray(SPOTS["3bp_btn_co"]["ip"]["range"], float)
        idx = [CLASS_INDEX[r + r] for r in "789TJQKA"]
        Q = PAIR_COMPAT * ra[:, None]
        call = (Q / Q.sum(0, keepdims=True) * (1 - m.share((2, True, "BTN", "UTG")))).sum(0)[idx]
        P_ = PAIR_COMPAT * ra[None, :]
        four = (P_ / P_.sum(1, keepdims=True) * m.share((3, False, "UTG", "BTN"))).sum(1)[idx]
        return call, four

    def test_pairs_meet_more_of_the_pot_by_rank_or_nearly(self):
        import dataclasses
        def drop(x):    # the most a pair meets less of the pot than the pair below it
            return max(0.0, -float(np.diff(x).min()))
        call, four = self.pair_shares(M.load_params())
        call0, four0 = self.pair_shares(dataclasses.replace(M.load_params(), s2=0.0, s3=0.0))
        # unsmoothed (lz2's values): 88 met 0.021 more of a 3bet pot than 99, 77 0.054 more of a 4bet pot than 88
        self.assertGreater(drop(call0), 0.015)
        self.assertGreater(drop(four0), 0.04)
        # smoothed (s2 = s3 = 0.5): in order calling the 3bet; 77 over 88 in a 4bet pot halved (0.023), which the
        # solve then plays in order (77 and 88 both fold to the BTN's 3bet; HandOrder's stored-game test)
        self.assertTrue((np.diff(call) > 0).all(), call)
        self.assertLess(drop(four), 0.5 * drop(four0) + 0.001)

    def test_stored_6max_100bb_plays_the_opener_vs_3bet_in_order(self):
        from engine.pf_order import out_of_order_vs_3bet
        for rake in (None, (0.05, 3.0)):
            spec = P.Spec(6, (100.0,), rake=rake)
            bad = out_of_order_vs_3bet(P.Solve(spec, P.read_stored(spec.key)))
            pairs = {k: [b for b in v if b[0][0] == b[0][1]] for k, v in bad.items()}
            self.assertEqual({k: v for k, v in pairs.items() if v}, {}, spec.key)
            self.assertLessEqual(sum(map(len, bad.values())), MAX_OUT_OF_ORDER, f"{spec.key}: {bad}")



class OffPathValues(unittest.TestCase):
    """A move a class never makes is valued by the class's best response after it (engine/pf_offpath.py), not by the fold
    pf_study.pack stores for it at its later nodes. The heads-up 100bb solve raises T8s and never limps it, so its limp was
    priced as limp-then-fold to the big blind's 3.5bb iso-raise: 0.352bb against its raise's 1.0, and Practice graded the
    chart's 99% limp a 0.65bb Blunder; AA's limp read 1.19bb, barely above QTo's 0.863 (QTo limps). The QA sweep found it
    (docs/QA.md, issue B). Only those EVs move: the mixes, the EVs of moves a class makes and the range's are the same."""

    @classmethod
    def setUpClass(cls):
        spec = P.Spec(2, (100.0,))
        cls.hu = P.Solve(spec, P.read_stored(spec.key))

    @staticmethod
    def stored(s, line):
        """The node as pf_study.Solve reads it, the stored fold kept (what the answers were before pf_offpath)."""
        s._vals = None
        s._values = PS.Solve._values.__get__(s)
        s._at = PS.Solve._at.__get__(s)
        try:
            return s.node(line)
        finally:
            del s._values, s._at
            s._vals = None

    def test_a_limp_the_solve_never_makes_is_worth_its_best_response(self):
        n = self.hu.node([])
        self.assertEqual(n["grid"]["actions"], ["raise", "call", "fold"])
        ev = lambda h, a: n["grid"]["cells"][h]["ev"][a]
        self.assertGreater(ev("AA", 1), ev("QTo", 1) + 1.0)          # (3.263 against 0.863; stored 1.19)
        self.assertLess(ev("T8s", 0) - ev("T8s", 1), 0.15)          # (0.100; stored 0.648)
        old = self.stored(self.hu, [])["grid"]["cells"]
        self.assertGreater(old["T8s"]["ev"][0] - old["T8s"]["ev"][1], 0.6)   # (the fault itself, read the old way)

    def test_only_the_evs_of_moves_not_made_change(self):
        lines = [[], [{"pos": "SB", "action": "raise", "to": 3}],
                 [{"pos": "SB", "action": "call"}, {"pos": "BB", "action": "raise", "to": 3.5}]]
        for line in lines:
            a, b = self.hu.node(line), self.stored(self.hu, line)
            with self.subTest(line=line):
                self.assertEqual(a["range_ev_bb"], b["range_ev_bb"])
                for x, y in zip(a["actions"], b["actions"]):
                    self.assertEqual((x["action"], x["freq"], x["combos"]), (y["action"], y["freq"], y["combos"]))
                    if x["ev_bb"] is not None:
                        self.assertAlmostEqual(x["ev_bb"], y["ev_bb"], delta=0.002)
                self.assertEqual(a["grid"]["cells"].keys(), b["grid"]["cells"].keys())
                for c, x in a["grid"]["cells"].items():
                    y = b["grid"]["cells"][c]
                    self.assertEqual(x["f"], y["f"], c)
                    for i, f in enumerate(x["f"]):
                        if f * x["w"] >= 0.01:
                            self.assertAlmostEqual(x["ev"][i], y["ev"][i], delta=0.002, msg=f"{c} {i}")

    def test_a_move_no_one_makes_keeps_its_stored_value(self):
        """The seats behind a move under UNTRAINED_SHARE of the range never trained against it, so the hands after it aren't
        filled (pfGrade.ts untrainedMoves leaves such a move to the chart by the pattern its stored value gives): the small
        blind's limp-3bet over the big blind's iso-raise (0.0% of its range)."""
        line = [{"pos": "SB", "action": "call"}, {"pos": "BB", "action": "raise", "to": 3.5}]
        a, b = self.hu.node(line), self.stored(self.hu, line)
        self.assertEqual(a["grid"]["actions"][0], "raise")
        self.assertLess(a["actions"][0]["freq"], 0.005)
        for c, x in a["grid"]["cells"].items():
            self.assertAlmostEqual(x["ev"][0], b["grid"]["cells"][c]["ev"][0], delta=1e-9, msg=c)

    def test_a_call_with_a_squeeze_behind_is_within_the_noise(self):
        """6-max 20bb at the charts' sizes, the small blind with AJo facing the CO's open (the big blind can squeeze behind):
        the chart calls 97.8%, the solve jams, and the stored jam-call gap of 0.446bb in a 4bb pot (past the preflop solve's
        noise, web/src/grading/grade.ts pfNoisePct) was graded a Mistake; filled, it is 0.288bb. On lz4 (the exact equity
        table) the gaps are 0.505bb stored and 0.332bb filled, 0.02bb past the noise (0.31bb): the fill still takes 0.17bb
        off, and the grade stops at Inaccuracy anyway, the chart playing the call 10% or more (grade.ts CHART_PARTS)."""
        spec = P.chart_sized(P.Spec(6, (20.0,)))
        s = P.Solve(spec, P.read_stored(spec.key))
        n = s.node([{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"},
                    {"pos": "CO", "action": "raise", "to": 2.5}, {"pos": "BTN", "action": "fold"}])
        self.assertEqual(n["grid"]["actions"], ["all-in", "call", "fold"])
        ev = n["grid"]["cells"]["AJo"]["ev"]
        pot = n["pot_bb"]
        noise = pot * (4 + 2.75 * np.log(pot)) / 100
        before = self.stored(s, [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"},
                                 {"pos": "CO", "action": "raise", "to": 2.5}, {"pos": "BTN", "action": "fold"}])
        ev0 = before["grid"]["cells"]["AJo"]["ev"]
        self.assertGreater((ev0[0] - ev0[1]) - (ev[0] - ev[1]), 0.1)
        self.assertLess(ev[0] - ev[1], noise + 0.05)

    def test_the_tournament_solve_reads_the_same_values(self):
        from engine import pf_icm_study, pf_offpath
        self.assertTrue(issubclass(pf_icm_study.Solve, pf_offpath.OffPathValues))
        self.assertTrue(issubclass(P.Solve, pf_offpath.OffPathValues))

    def test_solving_and_exploitability_are_the_games_own(self):
        """values() runs only while an answer is read: a pass that updates regrets or best-responds is Game._up's."""
        from engine import pf_offpath
        g = self.hu.game
        s = g.average()
        reach = g._down(s, skip=0)
        with pf_offpath.answering(g):
            a = g._up(reach, s, br=0)
            filled = g._up(g._down(s), s)
        np.testing.assert_array_equal(a, G.Game._up(g, reach, s, br=0))
        self.assertNotIn("_up", g.__dict__)
        self.assertFalse(np.array_equal(filled, G.Game._up(g, g._down(s), s)))


# lz4 (the exact equity table): 2 unraked, 7 at 5% capped at 3bb, every one a suited ace from A7s to ATs facing a blind's
# 3bet, choosing between a 4bet bluff and a fold whose EVs are within 0.1bb of each other (A7s 4bets 99% at +0.07bb where
# A9s 4bets 51% at -0.01bb), none a pair (docs/ACCURACY.md section 31); lz3 had 3 and 4, lz2 12 and 7
MAX_OUT_OF_ORDER = 7


if __name__ == "__main__":
    unittest.main()
