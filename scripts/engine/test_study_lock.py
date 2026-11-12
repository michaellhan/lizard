"""engine/study_lock.py through the real Advisor at the worker's own configs: the lock lands on the node Study shows, in
the tree Study built, on each street and in the path's variants, and what it refuses it refuses in words.

Small budgets: what's tested here is which tree and node, not how far a solve converges (that's
scripts/benchmarks/nodelock_bench.py), so a test here doesn't wait on a settled solve.

Run: .venv/bin/python -m unittest scripts/engine/test_study_lock.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import nodelock as nl  # noqa: E402
from engine import study_lock as sl  # noqa: E402
from gto.advisor import Advisor  # noqa: E402
from gto.cards import cards  # noqa: E402
from gto.solver import Cancelled, Config, Decision  # noqa: E402

RAISES = {"flop": [0.5], "turn": [0.75], "river": [0.75]}
FAST = dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32, turn_buckets=True,
            bucket_river_step=3, river_classes=True, river_strength=32,
            bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 0.75, 1.25]}, raise_sizes=RAISES)
ACCURATE = dict(n_turns=4, leaf_turns=4, leaf_rivers_flop=8, n_rivers_from_flop=8, river_classes=True, river_buckets=64,
                turn_buckets=True, bucket_river_step=1, river_strength=32,
                bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 0.75, 1.25]}, raise_sizes=RAISES)


def advisor(cfg, settled=None) -> Advisor:
    """As the worker makes them (solver/gto/static/worker.js), with no library."""
    a = Advisor(Config(**cfg))
    a.root_sizes = {"river": {"bet": [0.33, 0.75, 1.25, 2.5]}}
    a.hu_settled = settled
    a.expl_target = settled or 0.1
    return a


PRE = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
       {"pos": "BTN", "action": "raise", "to": 2.5}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
FLOP = [{"pos": "BB", "action": "check"}, {"pos": "BTN", "action": "bet", "to": 2}, {"pos": "BB", "action": "call"}]
TURN = [{"pos": "BB", "action": "check"}, {"pos": "BTN", "action": "check"}]
HAND = dict(players=6, stack=100, preflop=PRE, study=True)
RIVER = dict(HAND, board="Kd7c2h5s9d", flop=FLOP, turn=TURN)
ON_TURN = dict(HAND, board="Kd7c2h5s", flop=FLOP)
ON_FLOP = dict(HAND, board="Kd7c2h")
SECOND = dict(HAND, board="Kd7c2h", flop=[{"pos": "BB", "action": "check"}])


def request(state, mix, hands="all", budget=1.0, **more):
    return dict(state, budget=budget, prior_budget=0.5, nodelock=dict(mix=mix, hands=hands, **more))


class Shared(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False

    def answer(self, state, mix, hands="all", post=None, budget=1.0, **more):
        return sl.answer(self.adv, request(state, mix, hands, budget, **more), post)


class TheTree(Shared):
    def test_a_river_node_at_its_root(self):
        r = self.answer(RIVER, {"check": 0.5, "bet 75%": 0.5})
        self.assertNotIn("error", r)
        n = r["node_lock"]
        self.assertEqual((r["study"], r["street"], r["actor"], r["opponent"], r["position"]),
                         ("nodelock", "river", "BB", "BTN", "OOP"))
        self.assertEqual(n["line"], [])
        self.assertEqual(n["seats"], ["BB", "BTN"])
        self.assertEqual(n["actions"], ["check", "bet 33%", "bet 75%", "bet 125%", "bet 250%"])
        held = next(c for c in n["changes"] if c["at"] == "locked")
        self.assertAlmostEqual(held["locked"][0], 0.5, places=6)
        self.assertAlmostEqual(held["locked"][2], 0.5, places=6)
        self.assertEqual(held["locked"][1], 0.0)

    def test_the_line_is_this_streets_actions_only(self):
        """The second decision of the flop: one action name, no card, on a tree with turn classes and buckets below."""
        r = self.answer(SECOND, {"check": 0.5, "bet 33%": 0.5})
        n = r["node_lock"]
        self.assertEqual((n["line"], n["seat"], n["player"]), (["check"], "BTN", 1))
        self.assertEqual([c["at"] for c in n["changes"]], ["before", "locked", "after", "after"])
        self.assertEqual(n["changes"][0]["seat"], "BB")
        self.assertIn("one card per class", n["abstraction"])
        self.assertIn("buckets", n["abstraction"])

    def test_the_tree_is_the_solve_on_screen(self):
        """Same config object's sizes and same tree: the shape check would have refused otherwise, and a wrong shape is."""
        got = {}
        solve = nl.solve_locked

        def spy(*a, **k):
            got.update(k)
            return solve(*a, **k)
        sl.solve_locked = spy
        try:
            r = self.answer(ON_TURN, {"check": 1.0})
            self.assertNotIn("error", r)
            self.assertIsNotNone(got["same_tree"])
            self.assertEqual(r["node_lock"]["locked"]["root_pot"], r["node_lock"]["unlocked"]["root_pot"])
            sl.solve_locked = lambda *a, **k: solve(*a, **dict(k, same_tree="another"))
            self.assertEqual(self.answer(ON_TURN, {"check": 1.0})["lock_error"], "invalid")
        finally:
            sl.solve_locked = solve

    def test_the_abstraction_never_stops_a_combo_at_the_node_on_screen(self):
        """Why the panel doesn't need the mode to offer a single combo: both speeds, all three streets."""
        for cfg in (FAST, ACCURATE):
            adv = advisor(cfg, 0.2)
            adv.should_stop = lambda: False
            for state in (ON_FLOP, ON_TURN, RIVER):
                st = request(state, {"check": 1.0}, budget=0.5)
                found = sl._study(adv, st, flop=state is ON_FLOP)
                node = found["node"]
                self.assertIsInstance(node, Decision)
                self.assertFalse(node.bucketed)
                self.assertEqual(node.B, 1)
                self.assertEqual(node.boards[0], tuple(cards(state["board"])))

    def test_a_turn_the_flop_tree_plays_as_another_card(self):
        """5s on the flop's tree is its class's played card or isn't: the turn's Study solve never asks. Each of a rank's
        cards answers on its own board, with no card in the line."""
        adv = advisor(FAST, 0.2)
        adv.should_stop = lambda: False
        flop = sl._study(adv, request(ON_FLOP, {"check": 1.0}, budget=0.5), flop=True)
        played = [c for c, _ in flop["sol"].ctx.turn_classes(tuple(cards("Kd7c2h")), set(cards("Kd7c2h")))]
        members = dict(flop["sol"].ctx.turn_classes(tuple(cards("Kd7c2h")), set(cards("Kd7c2h"))))
        cls = next(cs for c, cs in members.items() if len(cs) > 1)
        other = next(c for c in cls if c not in played)
        board = "Kd7c2h" + name(other)
        r = sl.answer(adv, request(dict(HAND, board=board, flop=FLOP), {"check": 1.0}, budget=0.5))
        self.assertNotIn("error", r)
        self.assertEqual(r["node_lock"]["line"], [])
        self.assertEqual(r["board"].replace(" ", ""), board)

    def test_a_rare_line_solved_again_from_the_node(self):
        """Study solves a line the street's solve rarely takes again from the node: its root is the node, with the bets
        on it, and the lock follows."""
        flop = [{"pos": "BB", "action": "bet", "to": 25}]
        adv = advisor(FAST, 0.2)
        adv.should_stop = lambda: False
        st = dict(HAND, board="Kd7c2h", flop=flop)
        plain = adv.advise(dict(st, budget=1.0, prior_budget=0.5))
        self.assertEqual(plain["actor"], "BTN")
        names = [a["action"] for a in plain["actions"]]
        r = sl.answer(adv, request(st, {names[0]: 1.0}, budget=1.0))
        self.assertNotIn("error", r)
        self.assertEqual(r["node_lock"]["seat"], "BTN")
        self.assertEqual(r["node_lock"]["actions"], names)
        self.assertEqual(r["node_lock"]["line"], [])
        self.assertIn("solve starts at this node", r["node_lock"]["scope"])

    def test_a_pot_heads_up_this_street(self):
        pre = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "raise", "to": 2.5},
               {"pos": "BTN", "action": "call"}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
        flop = [{"pos": "BB", "action": "check"}, {"pos": "CO", "action": "bet", "to": 4}, {"pos": "BTN", "action": "fold"}]
        adv = advisor(FAST, 0.2)
        adv.should_stop = lambda: False
        st = dict(HAND, preflop=pre, board="Kd7c2h", flop=flop)
        plain = adv.advise(dict(st, budget=1.0, prior_budget=0.5))
        self.assertEqual(plain.get("actor"), "BB", plain)
        names = [a["action"] for a in plain["actions"]]
        r = sl.answer(adv, request(st, {names[0]: 1.0}, budget=1.0))
        self.assertNotIn("error", r, r)
        self.assertEqual(r["node_lock"]["line"], [])
        self.assertIn("solve starts at this node", r["node_lock"]["scope"])


class KeptLocks(Shared):
    def test_a_lock_kept_from_another_node_of_the_solve_is_held_too(self):
        """Hold BB's first flop decision, then BTN's after the check with the first kept: both mixes are played."""
        first = self.answer(ON_FLOP, {"check": 0.3, "bet 33%": 0.7})
        n1 = first["node_lock"]
        self.assertEqual((n1["line"], n1["player"], n1["also"]), ([], 0, []))
        kept = dict(root=n1["root"], line=n1["line"], player=n1["player"], mix={"check": 0.3, "bet 33%": 0.7})
        r = self.answer(SECOND, {"check": 0.5, "bet 33%": 0.5}, also=[kept])
        self.assertNotIn("error", r, r)
        n = r["node_lock"]
        self.assertEqual(n["root"], n1["root"])
        self.assertEqual([(x["line"], x["seat"], x["player"]) for x in n["also"]], [([], "BB", 0)])
        self.assertIn("BB", n["also"][0]["words"])
        before = n["changes"][0]
        self.assertEqual((before["at"], before["seat"]), ("before", "BB"))
        self.assertAlmostEqual(before["locked"][0], 0.3, places=5)
        self.assertAlmostEqual(before["locked"][1], 0.7, places=5)
        held = next(c for c in n["changes"] if c["at"] == "locked")
        self.assertAlmostEqual(held["locked"][0], 0.5, places=5)

    def test_a_kept_lock_from_another_solve_is_refused(self):
        r = self.answer(SECOND, {"check": 1.0}, also=[dict(root="0" * 16, line=[], player=0, mix={"check": 1.0})])
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("another solve", r["error"])

    def test_a_kept_lock_on_this_node_or_off_the_tree(self):
        first = self.answer(ON_FLOP, {"check": 1.0})["node_lock"]
        same = dict(root=first["root"], line=[], player=0, mix={"check": 1.0})
        self.assertIn("held already", self.answer(ON_FLOP, {"check": 0.5, "bet 33%": 0.5}, also=[same])["error"])
        off = dict(root=first["root"], line=["bet 999%"], player=1, mix={"fold": 1.0})
        self.assertEqual(self.answer(ON_FLOP, {"check": 1.0}, also=[off])["lock_error"], "invalid")


def name(c):
    return "23456789TJQKA"[c // 4] + "cdhs"[c % 4]


class TheNumbers(Shared):
    def test_measures_on_one_scale(self):
        r = self.answer(RIVER, {"check": 0.5, "bet 75%": 0.5})
        n = r["node_lock"]
        for side in ("locked", "unlocked"):
            self.assertAlmostEqual(sum(n[side]["value"]), 0.0, places=4)
        self.assertGreater(n["locked"]["lock_cost"][0], 0.0)
        self.assertEqual(n["locked"]["lock_cost"][1], 0.0)
        self.assertEqual(r["solver"]["iterations"], n["locked"]["iterations"])
        self.assertAlmostEqual(r["solver"]["exploitability_pct"], max(n["locked"]["exploitability_pct"], 0), places=3)

    def test_a_hand_scoped_lock(self):
        r = self.answer(RIVER, {"check": 1.0}, hands={"classes": ["AA", "KK"], "combos": ["7h7s"]})
        n = r["node_lock"]
        self.assertEqual(n["hands"], {"classes": ["AA", "KK"], "combos": ["7h7s"]})
        self.assertLess(n["share_held"], 1.0)
        self.assertIn("AA, KK, 7h7s", n["words"])

    def test_a_whole_range_share_is_all_of_it(self):
        self.assertAlmostEqual(self.answer(RIVER, {"check": 1.0})["node_lock"]["share_held"], 1.0, places=6)

    def test_an_action_that_goes_unplayed_says_so(self):
        n = self.answer(RIVER, {"check": 1.0})["node_lock"]
        self.assertTrue(n["untrained"])
        dead = [c for c in n["changes"] if c["at"] == "after" and c["line"] != ["check"]]
        self.assertTrue(dead)
        for c in dead:
            self.assertIsNone(c["locked"])
            self.assertEqual(c["reach"]["locked"], 0.0)

    def test_notes_say_what_was_left_as_it_was(self):
        n = self.answer(ON_FLOP, {"check": 0.5, "bet 33%": 0.5})
        self.assertIn("earlier streets don't react", n["node_lock"]["scope"])
        self.assertTrue(any("solved live" in x for x in n["notes"]))
        turn = self.answer(ON_TURN, {"check": 1.0}, hands={"classes": ["AA"]})
        self.assertIn("approximate", turn["node_lock"]["abstraction"])

    def test_progress_comes_as_it_goes(self):
        heard = []
        self.answer(RIVER, {"check": 0.5, "bet 75%": 0.5}, post=heard.append)
        self.assertTrue(heard)
        self.assertEqual(heard[0]["study"], "nodelock_progress")
        self.assertEqual(heard[-1]["of"], sl.ITERATIONS)


class Refused(Shared):
    def test_a_bad_mix_is_invalid_in_words(self):
        r = self.answer(RIVER, {"check": 0.5})
        self.assertEqual(r["lock_error"], "invalid")
        self.assertIn("sum", r["error"])

    def test_no_mix(self):
        self.assertEqual(self.answer(RIVER, {})["lock_error"], "invalid")

    def test_preflop(self):
        r = sl.answer(self.adv, request(dict(players=6, stack=100, study=True), {"raise": 1.0}))
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("postflop", r["error"])

    def test_multiway_says_so_without_solving(self):
        pre = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "raise", "to": 2.5},
               {"pos": "BTN", "action": "call"}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
        r = self.answer(dict(HAND, preflop=pre, board="Kd7c2h"), {"check": 1.0})
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("heads-up", r["error"])
        self.assertNotIn("_multiway_solve", self.adv.__dict__)

    def test_nobody_to_act(self):
        r = self.answer(dict(HAND, board="Kd7c2h", flop=TURN), {"check": 1.0})
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("Nobody acts", r["error"])

    def test_actions_the_live_tree_doesnt_have(self):
        r = self.answer(RIVER, {"check": 0.5, "bet 60%": 0.5})
        self.assertEqual(r["lock_error"], "refused")
        self.assertEqual(r["live_actions"], ["check", "bet 33%", "bet 75%", "bet 125%", "bet 250%"])

    def test_the_page_and_the_tree_disagree_on_the_seat(self):
        r = self.answer(RIVER, {"check": 1.0}, expect={"actor": "BTN"})
        self.assertEqual(r["lock_error"], "invalid")

    def test_a_tournament(self):
        st = dict(RIVER, payouts=[50, 30, 20], stacks=dict(UTG=100, HJ=100, CO=100, BTN=100, SB=100, BB=100))
        r = self.answer(st, {"check": 1.0})
        self.assertEqual(r["lock_error"], "refused", r)
        self.assertIn("cash games", r["error"])

    def test_cancelled_goes_through_and_leaves_the_advisor_as_it_was(self):
        adv = advisor(FAST, 0.2)
        adv.should_stop = lambda: True
        with self.assertRaises(Cancelled):
            sl.answer(adv, request(RIVER, {"check": 1.0}))
        self.assertFalse({"_solve_cached", "_study_node", "_from_library", "_multiway_solve"} & set(adv.__dict__))

    def test_cancelled_mid_lock(self):
        adv = advisor(FAST, 0.2)
        ok = [True]
        adv.should_stop = lambda: not ok[0]
        run = sl.solve_locked

        def stop(*a, **k):
            ok[0] = False
            return run(*a, **k)
        sl.solve_locked = stop
        try:
            with self.assertRaises(Cancelled):
                sl.answer(adv, request(RIVER, {"check": 1.0}))
        finally:
            sl.solve_locked = run


class ReachBack(Shared):
    """reach "back": the lock on the node on screen held in the street before's solve, which re-solves around it, so
    that street's ranges react (engine/nodelock.py's OneStreetBack has the exact-game checks)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.turn = sl.answer(cls.adv, request(ON_TURN, {"check": 0.0, "bet 75%": 1.0}, reach="back"))

    def test_a_turn_lock_moves_the_flop_on_the_hands_line(self):
        r = self.turn
        self.assertNotIn("error", r)
        n = r["node_lock"]
        self.assertEqual(n["reach"], "flop")
        self.assertEqual(n["line"][:3], ["check", "bet 33%", "call"])
        self.assertEqual(len(n["line"]), 4)             # and the turn card, or its class's played card
        self.assertTrue(n["words"].endswith("held from the flop"), n["words"])
        on = n["earlier"]["on_line"]
        self.assertEqual([x["line"] for x in on], [[], ["check"], ["check", "bet 33%"]])
        self.assertEqual([x["seat"] for x in on], ["BB", "BTN", "BB"])
        for x in on + n["earlier"]["moved"]:
            for mix in (x["unlocked"], x["locked"]):
                self.assertAlmostEqual(sum(mix), 1.0, delta=1e-4)
            self.assertAlmostEqual(x["moved"], 100 * max(abs(a - b) for a, b in zip(x["unlocked"], x["locked"])), places=6)
        # the flop re-solved around the lock: something on it moves (how far depends on how far the flop's own solve got
        # in its budget; test_nodelock.py OneStreetBack has the exact game, where it's points)
        self.assertGreater(max(x["moved"] for x in on + n["earlier"]["moved"]), 0.0)
        self.assertTrue(all(min(x["share"]) >= sl.MOVED_SHARE for x in n["earlier"]["moved"]))

    def test_it_is_labelled_that_trees_numbers_and_approximate(self):
        r = self.turn
        self.assertTrue(r["solver"]["approximate"])
        self.assertIn("flop's solve", r["node_lock"]["scope"])
        self.assertIn("approximate", r["node_lock"]["scope"])
        self.assertLess(r["node_lock"]["locked"]["exploitability_pct"], 1.0)
        # (a whole-range lock can cost only its player, up to the solve's distance from equilibrium)
        self.assertGreater(r["node_lock"]["locked"]["lock_cost"][0] + 0.01 * r["node_lock"]["root_pot"], 0)

    def test_a_river_lock_is_held_in_the_turns_tree_with_its_card_class(self):
        r = self.answer(RIVER, {"check": 0.0, "bet 75%": 1.0}, reach="back")
        self.assertNotIn("error", r)
        n = r["node_lock"]
        self.assertEqual((n["reach"], r["street"]), ("turn", "river"))
        self.assertEqual(n["line"][:2], ["check", "check"])
        if n["line"][2] != "9d":
            self.assertTrue([x for x in r["notes"] if x.startswith("9d is played as")], r["notes"])
        self.assertEqual(len([x for x in r["notes"] if "is played as" in x or "stands for its class" in x]), 1, r["notes"])

    def test_refused_on_the_flop(self):
        r = self.answer(ON_FLOP, {"check": 1.0}, reach="back")
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("preflop", r["error"])

    def test_refused_for_hands_and_kept_locks(self):
        r = self.answer(ON_TURN, {"check": 1.0}, hands={"classes": ["AA"]}, reach="back")
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("whole range", r["error"])
        r = self.answer(ON_TURN, {"check": 1.0}, reach="back", also=[{"line": [], "mix": {"check": 1.0}}])
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("Kept locks", r["error"])

    def test_actions_the_earlier_tree_doesnt_have(self):
        r = self.answer(ON_TURN, {"check": 0.5, "bet 125%": 0.5}, reach="back")
        self.assertEqual(r["lock_error"], "refused", r)
        self.assertIn("the flop's tree plays this node", r["error"].lower())
        self.assertIn("check", r["live_actions"])
        self.assertNotIn("bet 125%", r["live_actions"])

    def test_an_unknown_reach_is_invalid(self):
        r = self.answer(ON_TURN, {"check": 1.0}, reach="forward")
        self.assertEqual(r["lock_error"], "invalid")


class TheLibrary(unittest.TestCase):
    """A stand-in for the flop library: on the flop it mustn't be asked, on a later street it stays."""

    def test_on_the_flop_it_is_left_out_and_on_the_turn_it_stays(self):
        adv = advisor(FAST, 0.2)
        adv.should_stop = lambda: False
        with sl._Capture(adv, True):
            self.assertIsNone(adv._from_library("anything"))
        self.assertNotIn("_from_library", adv.__dict__)
        with sl._Capture(adv, False):
            self.assertNotIn("_from_library", adv.__dict__)


class Plain(unittest.TestCase):
    def test_measure_plain_is_measure_with_no_locks(self):
        from gto.solver import solve
        board, cfg = cards("2c7d9hJsKd"), Config(bet_sizes={s: [1.0] for s in ("flop", "turn", "river")},
                                                 raise_sizes={s: [] for s in ("flop", "turn", "river")}, max_raises=0)
        from gto.ranges import parse_range
        r0, r1 = parse_range("KK,65s"), parse_range("QQ")
        a = solve(board, r0, r1, 10.0, 100.0, cfg=cfg, max_iters=300, time_budget=5.0)
        b = nl.solve_locked(board, r0, r1, 10.0, 100.0, [], cfg=cfg, max_iters=300, time_budget=5.0)
        m, n = nl.measure_plain(a), b.measure()
        self.assertAlmostEqual(m["value"][0], n["value"][0], places=3)
        self.assertAlmostEqual(m["exploitability_pct"], n["exploitability_pct"], places=2)
        self.assertEqual(nl.tree_shape(a.root), nl.tree_shape(b.root))


if __name__ == "__main__":
    unittest.main()
