"""The 3-way library's spots served as built after the charts moved under them (engine/mw_near.py).

A fake library index of the four published spots (engine/mw_built.py's fingerprints, pot, stack and seats; no entries:
nothing here reads one), so this runs in about a second with no library download. The walk tests below (LibraryLines,
BuiltPrior) use a fake stored solve of Qs7s6d holding the library's three first decisions, and stub the solves (they
record what was asked), so they run in a few seconds too.

Run: .venv/bin/python -m unittest scripts/engine/test_mw_near.py
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gto.advisor as A  # noqa: E402
from gto import flop_library as fl  # noqa: E402
from gto import multiway_solver as MW  # noqa: E402
from gto import mw_library as ML  # noqa: E402
from gto.cards import cards as parse_cards  # noqa: E402
from gto.solver import MEMBER_FULL  # noqa: E402
from engine import mw_built, mw_near, mw_quick  # noqa: E402,F401
from test_mw_narrowing import PRE, worker_fast  # noqa: E402


def fake_library(spots=None):
    idx = {"format": ML.FORMAT, "tree": ML.tree_key(ML.library_config()),
           "spots": spots if spots is not None else [
               {"id": sid, "line": b["line"], "seats": b["seats"], "pot": b["pot"], "stack": b["stack"],
                "fp": b["fp"], "label": sid, "flops": {}} for sid, b in mw_built.SPOTS.items()]}
    raw = json.dumps(idx).encode()
    return ML.MWLibrary(lambda path: raw if path == ML.INDEX else None)


def today(sid):
    st = ML.spot_setup(mw_built.SPOTS[sid]["line"])
    return st["ranges"], st["pot"], st["stack"]


class ServedAsBuilt(unittest.TestCase):
    def setUp(self):
        mw_near._NOW.clear()
        mw_near._BUILT.clear()

    def test_todays_ranges_of_a_moved_spot_read_it_as_built(self):
        lib = fake_library()
        for sid in mw_built.SPOTS:
            with self.subTest(spot=sid):
                ranges, pot, stack = today(sid)
                self.assertIsNone(lib.spot([fl.range_fp(r) for r in ranges], pot, stack))   # (upstream misses it)
                spot, b = lib._pick(ranges, pot, stack, 6)
                self.assertEqual(spot["id"], sid)
                self.assertEqual(b["built"], {"commit": mw_built.COMMIT, "date": mw_built.DATE,
                                              "seats": mw_built.SPOTS[sid]["seats"]})
                self.assertLessEqual(sum(b["dist"]), mw_near.NEAR_DIST)
                self.assertGreaterEqual(min(b["cover"]), mw_near.NEAR_COVER)
                # (custom ranges, players None: never borrowed)
                self.assertEqual(lib._pick(ranges, pot, stack, None), (None, None))

    def test_other_ranges_are_not_read_as_it(self):
        lib = fake_library()
        ranges, pot, stack = today("mw_co_btn_bb")
        other = [np.asarray(r, dtype=float).copy() for r in ranges]
        other[0] = other[0] * 0.999      # (near, but not what the spot's line gives today)
        self.assertEqual(lib._pick(other, pot, stack, 6), (None, None))
        self.assertEqual(lib._pick(ranges, pot + 1.0, stack, 6), (None, None))

    def test_a_spot_whose_ranges_moved_too_far_is_left_to_the_live_solve(self):
        saved = mw_near.NEAR_DIST
        mw_near.NEAR_DIST = 0.1
        try:
            ranges, pot, stack = today("mw_co_btn_bb")
            self.assertEqual(fake_library()._pick(ranges, pot, stack, 6), (None, None))
        finally:
            mw_near.NEAR_DIST = saved

    def test_a_spot_today_reproduces_is_upstreams(self):
        """A spot whose fingerprints today's code gives is found by upstream's exact match, never as built."""
        sid = "mw_co_btn_bb"
        ranges, pot, stack = today(sid)
        b = mw_built.SPOTS[sid]
        lib = fake_library([{"id": sid, "line": b["line"], "seats": b["seats"], "pot": pot, "stack": stack,
                             "fp": [fl.range_fp(r) for r in ranges], "label": sid, "flops": {}}])
        spot, bw = lib._pick(ranges, pot, stack, 6)
        self.assertEqual(spot["id"], sid)
        self.assertIsNone(bw)

    def test_its_own_ranges_stand_in_where_upstream_reads_a_spots_ranges(self):
        sp = next(s for s in fake_library().index()["spots"] if s["id"] == "mw_btn_sb_bb")
        st = ML._spot_ranges(sp)
        self.assertIsNotNone(st)
        self.assertEqual([fl.range_fp(r) for r in st["ranges"]], sp["fp"])
        self.assertIsNone(ML._spot_ranges.mw_near_upstream(sp))     # (today's code alone no longer gives them)


class Labels(unittest.TestCase):
    def test_the_text_names_the_range_that_moved_and_by_how_much(self):
        b = {"built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]},
             "dist": (0.1495, 0.0, 0.0), "cover": (0.9657, 1.0, 1.0)}
        self.assertEqual(mw_near.built_text(b), "this spot as built on the charts of 2026-11-16, which have changed "
                                                "since: BB's range differs from this pot's by 7.5% of its weight; CO "
                                                "and BTN's are the same")

    def test_a_spot_served_as_built_is_marked_without_another_tables_label(self):
        class Sol:
            label = "CO open, BTN and BB call"
            borrowed = None
        b = {"spot": {"id": "mw_co_btn_bb"}, "cover": (0.9657, 1.0, 1.0), "dist": (0.1495, 0.0, 0.0),
             "built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]}}
        s = ML.MWLibrary._mark(Sol(), b)
        self.assertEqual(s.label, "CO open, BTN and BB call")
        self.assertEqual(s.borrowed["built"]["date"], "2026-11-16")
        self.assertEqual(s.borrowed["dist"], [0.1495, 0.0, 0.0])
        # (another table's pot keeps upstream's mark)
        s2 = ML.MWLibrary._mark(Sol(), {k: v for k, v in b.items() if k != "built"})
        self.assertTrue(s2.label.startswith("6-max "))
        self.assertNotIn("built", s2.borrowed)

    def test_the_solutions_text_is_the_built_text(self):
        sol = ML.LibraryMWSolution.__new__(ML.LibraryMWSolution)
        sol.borrowed = {"spot": "mw_co_btn_bb", "cover": [0.9657, 1.0, 1.0], "dist": [0.1495, 0.0, 0.0],
                        "built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]}}
        self.assertTrue(sol.borrowed_text().startswith("this spot as built on the charts of 2026-11-16"))


    def test_the_pots_own_seats_are_named(self):
        """HJ opens, CO and BB call reads the spot built on HJ opens, BTN and BB call: the text names CO."""
        b = {"built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "HJ", "BTN"],
                       "pot_seats": ["BB", "HJ", "CO"]},
             "dist": (0.1646, 0.0, 0.0), "cover": (0.979, 1.0, 1.0)}
        self.assertEqual(mw_near.built_text(b), "this spot as built on the charts of 2026-11-16, which have changed "
                                                "since: BB's range differs from this pot's by 8.2% of its weight; HJ "
                                                "and CO's are the same; CO sits where the spot's BTN did")


# ----------------------------------------------------------------------------- the walk through a library spot
BOARD = "Qs7s6d"
CHECK = lambda p: {"pos": p, "action": "check"}          # noqa: E731
BET = lambda p, to: {"pos": p, "action": "bet", "to": to}  # noqa: E731
CALL = lambda p: {"pos": p, "action": "call"}              # noqa: E731
QUICK = dict(players=6, stack=100, board=BOARD, preflop=PRE, budget=1.5, prior_budget=0.3, quick=True)
FAST = dict(players=6, stack=100, board=BOARD, preflop=PRE, budget=8, prior_budget=3)
BUILT = {"spot": "mw_utg_btn_bb", "cover": [0.977, 1.0, 1.0], "dist": [0.1424, 0.0, 0.0],
         "built": {"commit": mw_built.COMMIT, "date": mw_built.DATE, "seats": ["BB", "UTG", "BTN"]}}


def stored_solve(built=True):
    """A stored 3-way solve of Qs7s6d as the library reads one (mw_library.LibraryMWSolution): the first three
    decisions (BB first, then UTG checked to, then BTN checked to twice), every hand mixing check, bet 33% and bet 75%
    alike; the line past a bet isn't stored (UNSTORED). Served as built where `built`."""
    board = parse_cards(BOARD)
    bm = np.prod([1.0 - MEMBER_FULL[c] for c in board], axis=0)
    active = np.nonzero(bm > 0)[0]
    n = len(active)
    names = ["check", "bet 33%", "bet 75%"]
    nodes, evs = {}, {}
    for player, path in ((0, ()), (1, ("check",)), (2, ("check", "check"))):
        d = MW.Decision.__new__(MW.Decision)
        d.bd, d.player, d.names = None, player, list(names)
        d.children = [ML.UNSTORED] * len(names)
        d.ssum = np.full((1, len(names), n), 1.0 / len(names), dtype=np.float32)
        d.regret = d.ssum.copy()
        d.pot_now, d.c, d.street, d.amounts = 8.0, [0.0] * 3, "flop", [None, 2.64, 6.0]
        nodes[path], evs[id(d)] = d, np.zeros((len(names), n))
    nodes[()].children[0] = nodes[("check",)]
    nodes[("check",)].children[0] = nodes[("check", "check")]
    sol = ML.LibraryMWSolution(nodes, evs, active, np.ones((3, 1, n)),
                               {"iters": 300, "expl": 0.1, "pot": 8.0, "stack": 97.5, "spot": "mw_utg_btn_bb",
                                "board": BOARD}, "UTG open, BTN and BB call", ["BB", "UTG", "BTN"], 97.5)
    if built:
        sol.borrowed = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v)
                        for k, v in BUILT.items()}
    return sol


class StoredLibrary:
    """The 3-way library as Advisor._mw_library_solution asks it (MWLibrary.solution): this flop's stored solve."""
    def __init__(self, built=True):
        self.built, self.asked = built, 0

    def solution(self, ranges, board, pot, stack, rake=False, players=None):
        self.asked += 1
        return stored_solve(self.built)


def advisor(built=True):
    """worker_fast() reading StoredLibrary, whose street solves only record what was asked (and narrow nothing: the
    rules do), and whose node solve answers at once with the notes it was given (so the answer comes back whole)."""
    a = worker_fast()
    a.mw_library = StoredLibrary(built)
    a.calls = []

    def street_solve(board, ranges, st, stk, acts=(), budget=None):
        a.calls.append({"street": st.name, "quick": a._quick, "buckets": a.mw_street_config[st.name].get("buckets")})
        return None

    def node_solve(hero, hole, board, ranges, remaining, cur, stk, t0, notes, line=None, positions=None):
        act = "fold" if cur.cur_bet > cur.bets[hero] + 1e-9 else "check"
        return {"street": cur.name, "hero": hero, "players": len(remaining), "multiway": True, "solved": True,
                "actions": [{"action": act, "freq": 1.0, "ev_bb": 0.0, "amount_bb": None}], "recommended": act,
                "sampled": act, "solver": {"iterations": 10, "exploitability_pct": 0.1}, "notes": list(notes),
                "seconds": 0.0}

    a._mw_street_solve = street_solve
    a._multiway_solve = node_solve
    return a


def notes_of(r):
    return r.get("notes", [])


class LibraryLines(unittest.TestCase):
    """A flop line the library stores only in part ([check, bet, call]: the bet's node isn't stored) is solved from the
    street's start, as with no library, where upstream left it to the rules."""

    def test_fast_solves_the_street_past_the_library_line(self):
        a = advisor()
        a.advise(dict(FAST, hero="BB", hole="Kh7h", flop=[CHECK("BB"), BET("UTG", 4), CALL("BTN")]))
        self.assertEqual(a.mw_library.asked, 1)       # (the walk's first pass; hidden on its retry)
        self.assertEqual([c["street"] for c in a.calls], ["flop"])
        self.assertEqual(a.calls[0]["buckets"], A.MW_FAST_STREETS["flop"]["buckets"])
        self.assertFalse(a._mw_lib_hide)

    def test_quick_solves_it_in_the_quick_game(self):
        a = advisor()
        a.advise(dict(QUICK, hero="BB", hole="Kh7h", flop=[CHECK("BB"), BET("UTG", 4), CALL("BTN")]))
        self.assertEqual(len(a.calls), 1, a.calls)
        self.assertEqual(a.calls[0]["buckets"], A.MW_QUICK_FLOP["buckets"])
        self.assertFalse(a.calls[0]["quick"])

    def test_a_flop_answer_read_from_the_library_doesnt_stop_it(self):
        """Practice asks BB's first decision first (answered from the library and kept in _mw_lines), then BB's
        decision behind UTG's bet and BTN's call: the kept library answer is set aside for the retry, then kept."""
        a = advisor()
        first = a.advise(dict(FAST, hero="BB", hole="Kh7h", flop=[]))
        self.assertIn("precomputed", first, notes_of(first))
        kept = dict(a._mw_lines)
        self.assertEqual(len(kept), 1)
        a.advise(dict(FAST, hero="BB", hole="Kh7h", flop=[CHECK("BB"), BET("UTG", 4), CALL("BTN")]))
        self.assertEqual([c["street"] for c in a.calls], ["flop"])
        for k, v in kept.items():
            self.assertIs(a._mw_lines.get(k), v)

    def test_a_line_the_library_holds_is_read_from_it(self):
        a = advisor()
        r = a.advise(dict(FAST, hero="BTN", hole="Kh7h", flop=[CHECK("BB"), BET("UTG", 4)]))
        self.assertEqual(a.calls, [])
        self.assertTrue(any(n.startswith("flop: 3-way, ranges narrowed through the precomputed 3-way solve")
                            for n in notes_of(r)), notes_of(r))


class BuiltPrior(unittest.TestCase):
    """An answer whose ranges came through a spot served as built is marked approximate and says which spot."""

    def check_marked(self, r, street="flop"):
        self.assertEqual([x["street"] for x in r.get("ranges_built", [])], [street], r.get("ranges_built"))
        x = r["ranges_built"][0]
        self.assertEqual((x["spot"], x["date"], x["dist"]), ("mw_utg_btn_bb", mw_built.DATE, BUILT["dist"]))
        self.assertIs(r["solver"].get("approximate"), True)
        self.assertTrue(r["solver"]["approximate_reason"].startswith(
            f"the ranges through the {street} come from the precomputed 3-way solve of this spot as built on the "
            f"charts of {mw_built.DATE}, which have changed since: BB's range differs from this pot's by 7.1%"),
            r["solver"]["approximate_reason"])
        self.assertTrue(any(n.startswith("Approximate: the ranges through the ") for n in notes_of(r)), notes_of(r))

    def test_a_flop_decision_behind_a_bet(self):
        r = advisor().advise(dict(QUICK, hero="BTN", hole="Kh7h", flop=[CHECK("BB"), BET("UTG", 4)]))
        self.assertTrue(any(n.startswith("flop: 3-way, ranges narrowed through the precomputed 3-way solve of this "
                                         f"spot as built on the charts of {mw_built.DATE} (300 iterations")
                            for n in notes_of(r)), notes_of(r))
        self.check_marked(r)

    def test_a_turn_after_the_flop_checked_through(self):
        a = advisor()
        r = a.advise(dict(QUICK, hero="BTN", hole="Kh7h", board=BOARD + "2h",
                          flop=[CHECK("BB"), CHECK("UTG"), CHECK("BTN")], turn=[CHECK("BB"), BET("UTG", 5.5)]))
        self.check_marked(r)
        self.assertEqual([c["street"] for c in a.calls], ["turn"])

    def test_a_turn_after_your_flop_advice_from_the_library(self):
        """BB's flop decision answered from the library first: the turn's walk finds that answer in _mw_lines ("the
        solve your advice came from") and still says it was the spot as built."""
        a = advisor()
        a.advise(dict(FAST, hero="BB", hole="Kh7h", flop=[]))
        r = a.advise(dict(FAST, hero="BB", hole="Kh7h", board=BOARD + "2h",
                          flop=[CHECK("BB"), CHECK("UTG"), CHECK("BTN")], turn=[]))
        self.assertTrue(any(n.startswith("flop: 3-way, ranges narrowed through the solve your advice came from, the "
                                         "precomputed 3-way solve of this spot as built on the charts of ")
                            for n in notes_of(r)), notes_of(r))
        self.check_marked(r)

    def test_a_spot_of_its_own_is_not_marked(self):
        r = advisor(built=False).advise(dict(QUICK, hero="BTN", hole="Kh7h", board=BOARD + "2h",
                                             flop=[CHECK("BB"), CHECK("UTG"), CHECK("BTN")],
                                             turn=[CHECK("BB"), BET("UTG", 5.5)]))
        self.assertNotIn("ranges_built", r)
        self.assertNotIn("approximate", r["solver"])


if __name__ == "__main__":
    unittest.main()
