"""The preflop charts as served, with Lizard's repairs (engine/pf_charts.py, engine/pf_dominance.py):

- 13 to 19bb play the 20bb game's moves, not the 100bb charts unmoved (the 6-max button opened 45.1% at 15bb, as at
  100bb, and 36.6% at 20bb), and the note says so ("the 20bb chart, played at 15bb"); 12bb is still push/fold. The flop
  library has no spot at those depths.
- Hand order: over the lines the charts play in a few games (up to three players in and three raises; two raises at
  9-max, four at 200bb), no hand continues 0.25 or more less often than the hand below it in its family when both
  arrive at 5% or more (the wheel aces A2-A5 left out), and AA and KK never flat over 60% of the time facing an open
  while the next hand down raises more. The nodes that feed a published flop library spot are left unrepaired, and
  their inversions are held to a count.
- A repair stays at its node: no premium folds 0.3 or more more often than upstream has it (outside a jam's call,
  which is equity against the jam range), and a hand that only reaches a node through an earlier repair plays the
  chart's answer there, not upstream's re-draw for a hand it never weighed.
- The advice's open- and 3bet-jams are the jam range the later streets and the calls of it read.
- Every published heads-up spot's ranges are the same with the repairs as without, also with a folded seat at another
  stack and a deeper player in the pot, so no fingerprint changes. The list is the spots the repo builds
  (flop_library's SPOTS and FORMAT_SPOTS, scripts/library/build_breadth.py's SPOTS: 57, the library's 53 and four
  FORMAT_SPOTS not built yet); with the library's index at hand (LIZARD_LIBRARY, else library-build/lizard-library),
  every spot in it is on the list and matches its fingerprints.

About a minute. Run: .venv/bin/python -m unittest scripts/engine/test_pf_charts.py
"""
import ast
import contextlib
import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_dominance as D  # noqa: E402
from gto import advisor as A  # noqa: E402
from gto import flop_library as FL  # noqa: E402
from gto import preflop as P  # noqa: E402
from gto.pf_classes import CLASS_INDEX, CLASSES  # noqa: E402

LIBRARY = Path(os.environ.get("LIZARD_LIBRARY", ROOT / "library-build" / "lizard-library"))
ADV = A.Advisor()
COMBOS = {c: 6 if len(c) == 2 else 4 if c.endswith("s") else 12 for c in CLASSES}
FOLDS = lambda *ps: [{"pos": p, "action": "fold"} for p in ps]  # noqa: E731
# the chart nodes feeding a published spot, over the walk below: their continue inversions (repairing them would move
# 26 of the 57 spots' ranges, 22 of the library's 53 fingerprints). A repair or chart change that lowers it should lower
# this too.
FED_INVERSIONS = 22


PC = None


def setUpModule():
    """The repairs in place for this module's tests alone: unittest discover runs every test file in one process, and
    the others test the charts as upstream serves them."""
    global PC
    from engine import pf_charts
    PC = pf_charts
    PC.install()


def tearDownModule():
    PC.uninstall()


@contextlib.contextmanager
def unrepaired():
    """The charts as upstream serves them."""
    PC.uninstall()
    try:
        yield
    finally:
        PC.install()


def share(res, actions) -> float:
    g = res["grid"]
    names = g["actions"]
    tot = sum(c["w"] * COMBOS[k] for k, c in g["cells"].items())
    return sum(c["w"] * COMBOS[k] * sum(f for a, f in zip(names, c["f"]) if a in actions)
               for k, c in g["cells"].items()) / tot


def advise(n, stack, hero, pre, **kw):
    return ADV.advise(dict(players=n, hero=hero, hole="2c7d", board="", stack=stack, preflop=pre, **kw))


class Shallow(unittest.TestCase):
    def test_13_to_19bb_play_the_20bb_charts(self):
        btn = FOLDS("UTG", "HJ", "CO")
        at = {d: advise(6, d, "BTN", btn) for d in (12, 13, 15, 17, 19, 20)}
        with unrepaired():
            hundred = share(advise(6, 100, "BTN", btn), ("raise",))
            unmoved = share(advise(6, 15, "BTN", btn), ("raise",))
        self.assertAlmostEqual(unmoved, hundred, places=3)          # (what it was: the 100bb chart, 45.1%)
        self.assertGreater(hundred - share(at[20], ("raise",)), 0.05)
        for d in (13, 15, 17, 19):
            self.assertAlmostEqual(share(at[d], ("raise",)), share(at[20], ("raise",)), places=3, msg=f"{d}bb")
            self.assertIn(f"preflop: the 20bb chart, played at {d}bb (the 100bb chart moved by solves of the 20bb game)",
                          at[d]["notes"])
        self.assertIn("preflop: the 20bb chart (the 100bb chart moved by solves of this game)", at[20]["notes"])
        self.assertEqual([a["action"] for a in at[12]["actions"]], ["all-in", "fold"])    # (push/fold as before)

    def test_the_big_blinds_defence_moves_with_depth(self):
        pre = FOLDS("UTG", "HJ", "CO") + [{"pos": "BTN", "action": "raise", "to": 2.5}] + FOLDS("SB")
        cont = {d: share(advise(6, d, "BB", pre), ("call", "all-in")) for d in (13, 15, 19, 20)}
        with unrepaired():
            old = share(advise(6, 15, "BB", pre), ("call", "all-in"))
        self.assertGreater(cont[15] - old, 0.03)       # (it defended the 100bb chart's way: 48.4% at 15bb)
        for d in (13, 15, 19):
            self.assertLess(abs(cont[d] - cont[20]), 0.01, f"{d}bb")

    def test_no_library_spot_is_at_these_depths(self):
        depths = {s for _, _, s, _ in PC.PUBLISHED}
        self.assertFalse([d for d in depths if PC.SHALLOW[0] < d < PC.SHALLOW[1]])
        if (LIBRARY / "index.json").exists():
            idx = json.loads((LIBRARY / "index.json").read_text())
            stacks = {float((s.get("game") or {}).get("stack", 100.0)) for s in idx["spots"]}
            self.assertFalse([d for d in stacks if PC.SHALLOW[0] < d < PC.SHALLOW[1]])


def walk(n, stack, max_in, kw=None, max_raises=3, branch=0.01):
    """Every node the charts play from the start: each move with at least `branch` of the range (a fold always), up to
    max_raises raises and max_in players in. [(line, hero, answer, feeds a library spot)]"""
    kw = kw or {}
    out = []

    def go(pre):
        positions = P.Table(P.SEATS[n], kw.get("ante", 0.0), False, None)
        st = A.replay_hand(positions, stack, {"preflop": pre}, 1)[0]
        if st.closed or st.to_act is None:
            return
        hero = st.to_act
        res = advise(n, stack, hero, pre, **kw)
        out.append((pre, hero, res, PC.feeds_library(hero, pre, P.at_depth(positions, stack), stack)))
        raises = sum(a["action"] in ("raise", "all-in") for a in pre)
        vol = {a["pos"] for a in pre if a["action"] != "fold"} | {hero}
        for a in res["actions"]:
            if a["action"] == "fold":
                go(pre + [{"pos": hero, "action": "fold"}])
            elif share(res, (a["action"],)) >= branch:
                if a["action"] in ("raise", "all-in") and raises < max_raises and len(vol) <= max_in:
                    go(pre + [{"pos": hero, "action": a["action"], "to": a["amount_bb"]}])
                elif a["action"] == "call" and len(vol) < max_in:
                    go(pre + [{"pos": hero, "action": "call"}])
    go([])
    return out


def node_arrays(res):
    g = res["grid"]
    names = g["actions"]
    cells = [g["cells"].get(c, {"w": 0.0, "f": [0.0] * len(names)}) for c in CLASSES]
    w = np.array([c["w"] for c in cells])
    F = np.array([c["f"] for c in cells])
    fold = F[:, names.index("fold")] if "fold" in names else None
    rai = F[:, [i for i, a in enumerate(names) if a in ("raise", "all-in")]].sum(1)
    call = F[:, names.index("call")] if "call" in names else np.zeros(len(CLASSES))
    return w, fold, rai, call


def line(pre) -> str:
    return " ".join(f"{a['pos']}:{a['action'][0]}{a.get('to', '')}" for a in pre if a["action"] != "fold") or "first in"


PAIRS = [(wk, st) for wk, st in D.pairs() if wk not in D.WHEEL and st not in D.WHEEL]
NEXT_DOWN = {CLASS_INDEX["AA"]: CLASS_INDEX["KK"], CLASS_INDEX["KK"]: CLASS_INDEX["QQ"]}


def inversions(res, gap=0.25, wmin=0.05) -> list:
    """[(weaker, stronger)]: a hand continuing `gap` or more less often than the one below it in its family."""
    w, fold, _, _ = node_arrays(res)
    if fold is None:
        return []
    cont = 1.0 - fold
    return [(CLASSES[wk], CLASSES[st]) for wk, st in PAIRS
            if w[wk] >= wmin and w[st] >= wmin and cont[wk] - cont[st] >= gap]


def premium_flats(res, pre) -> list:
    """AA or KK flatting over 60% facing one raise while the next hand down raises more."""
    if sum(a["action"] in ("raise", "all-in") for a in pre) != 1:
        return []
    w, _, rai, call = node_arrays(res)
    return [CLASSES[i] for i, j in NEXT_DOWN.items()
            if w[i] >= 0.05 and w[j] >= 0.05 and call[i] > 0.6 and rai[j] > rai[i] + 1e-9]


def raises(pre) -> int:
    return sum(a["action"] in ("raise", "all-in") for a in pre)


def table(n, stack, kw=None, stacks=None):
    return P.at_depth(P.Table(P.SEATS[n], (kw or {}).get("ante", 0.0), False, None, stack, stacks), stack)


# (players, stack, most players in, extra rules, most raises)
GAMES = [(6, 100, 3, None, 3), (6, 40, 3, None, 3), (6, 15, 3, None, 3), (6, 40, 3, {"ante": 0.125}, 3),
         (2, 100, 3, None, 3), (9, 100, 3, None, 2), (7, 100, 3, None, 3), (6, 200, 3, None, 4)]
PREMIUMS = ("AA", "KK", "QQ", "JJ", "AKs", "AKo")


class HandOrder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.games = [walk(n, d, mi, kw, max_raises=mr) for n, d, mi, kw, mr in GAMES]
        cls.nodes = [(f"{n}max {d}bb{' ante' if kw else ''}", node) for (n, d, mi, kw, mr), ns in zip(GAMES, cls.games)
                     for node in ns]

    def test_no_hand_continues_less_than_the_one_below_it(self):
        bad = [(g, line(pre), hero, inv) for g, (pre, hero, res, fed) in self.nodes if not fed for inv in inversions(res)]
        self.assertGreater(len(self.nodes), 2000)
        self.assertEqual(bad[:5], [])

    def test_the_library_spots_nodes_are_held_to_their_count(self):
        fed = [inv for _, (pre, hero, res, f) in self.nodes if f for inv in inversions(res)]
        self.assertLessEqual(len(fed), FED_INVERSIONS)

    def test_aa_and_kk_never_flat_while_the_next_hand_down_raises(self):
        bad = [(g, hero, premium_flats(res, pre)) for g, (pre, hero, res, fed) in self.nodes
               if not fed and premium_flats(res, pre)]
        self.assertEqual(bad, [])

    def test_no_premium_folds_more_than_upstream_has_it(self):
        """A node's answer is upstream's, priced against upstream's ranges, then repaired: another node's repair can't
        tip its re-draw (a small blind squeezing more AA had UTG's AKs fold 98.8% where it jammed 83.4%). A call of a
        jam is left out: it is equity against the jam range, and the jams served are the repaired ones."""
        bad = []
        for (n, d, _, kw, _), walked in zip(GAMES, self.games):
            if n not in (7, 9):
                continue
            nodes = [x for x in walked if not any(a["action"] == "all-in" for a in x[0])]
            with unrepaired():
                ups = [advise(n, d, hero, pre, **(kw or {})) for pre, hero, _, _ in nodes]
            for (pre, hero, res, _), up in zip(nodes, ups):
                w, fold, _, _ = node_arrays(res)
                wu, foldu, _, _ = node_arrays(up)
                if fold is None:
                    continue
                bad += [(n, hero, line(pre), c) for c in PREMIUMS if w[CLASS_INDEX[c]] >= 0.2 and wu[CLASS_INDEX[c]] >= 0.2
                        and fold[CLASS_INDEX[c]] - foldu[CLASS_INDEX[c]] >= 0.3]
        self.assertEqual(bad, [])
        squeeze = [{"pos": "UTG", "action": "raise", "to": 2.5}, {"pos": "UTG1", "action": "call"},
                   {"pos": "UTG2", "action": "call"}] + FOLDS("LJ", "HJ", "CO", "BTN") + \
            [{"pos": "SB", "action": "raise", "to": 15.0}] + FOLDS("BB")
        ask = dict(players=9, hero="UTG", hole="AhKh", board="", stack=100, preflop=squeeze)
        now = {a["action"]: a["freq"] for a in ADV.advise(ask)["actions"]}
        with unrepaired():
            old = {a["action"]: a["freq"] for a in ADV.advise(ask)["actions"]}
        self.assertGreater(old["all-in"], 0.8)
        self.assertAlmostEqual(now["all-in"], old["all-in"], delta=0.01)

    def test_a_hand_only_a_repair_brings_plays_the_charts_answer(self):
        """6-max 200bb: J9s 3-bets over UTG's open only as the repair pools it with JTs. Facing the 5bet, upstream's
        re-draw had never weighed it (a call), and pooled with JTs that went all-in for 200bb. Now it plays the chart's
        fold there. Over the 200bb lines to four raises, such a hand never continues more than the chart has it."""
        pre = [{"pos": "UTG", "action": "raise", "to": 2.5}, {"pos": "HJ", "action": "raise", "to": 7.5},
               {"pos": "CO", "action": "raise", "to": 20.0}] + FOLDS("BTN", "SB", "BB") + \
            [{"pos": "UTG", "action": "raise", "to": 53.5}]
        g = advise(6, 200, "HJ", pre)["grid"]
        for c in ("J9s", "JTs"):
            self.assertGreater(g["cells"][c]["w"], 0.05)
            self.assertGreaterEqual(g["cells"][c]["f"][g["actions"].index("fold")], 0.99, c)
        positions = table(6, 200)
        nodes = [x for x in self.games[GAMES.index((6, 200, 3, None, 4))] if raises(x[0]) >= 3]
        with unrepaired():
            ups = [advise(6, 200, hero, pre) for pre, hero, _, _ in nodes]
        seen, bad = 0, []
        for (pre, hero, res, _), up in zip(nodes, ups):
            w, fold, _, _ = node_arrays(res)
            chart = PC._strategy_for(hero, pre, positions).get("fold")
            if fold is None or chart is None:
                continue
            chart = PC._classes(chart)
            for i in np.flatnonzero((w >= 0.01) & (node_arrays(up)[0] < PC.NEW_W)):
                seen += 1
                if fold[i] < chart[i] - 0.01:
                    bad.append((hero, line(pre), CLASSES[i], round(1 - fold[i], 3), round(1 - chart[i], 3)))
        self.assertGreater(seen, 100)
        self.assertEqual(bad, [])

    def test_each_actions_share_of_the_range_is_kept(self):
        pre = [{"pos": "UTG", "action": "raise", "to": 2.5}]
        res = advise(6, 40, "HJ", pre, ante=0.125)
        with unrepaired():
            old = advise(6, 40, "HJ", pre, ante=0.125)
            self.assertTrue(premium_flats(old, pre))       # (AA flatted 97%, KK raising 22%)
        self.assertEqual(premium_flats(res, pre), [])
        for a in ("raise", "call", "fold"):
            self.assertAlmostEqual(share(res, (a,)), share(old, (a,)), places=4, msg=a)   # (the grid rounds each mix)


class Repair(unittest.TestCase):
    def test_the_premiums_overlapping_steps_are_solved_at_once(self):
        """AQs 0.70, AKs 0.05, AKo and AQo 1.0, all continuing (9-max, the small blind's squeeze): AKs, AKo and AQo pool
        to 0.864 and AQs keeps its 0.70 (one chain after another left it at 0.375)."""
        names = ["raise", "call", "fold"]
        M = np.zeros((3, len(CLASSES)))
        M[2] = 1.0
        for c, r in {"AQs": 0.70, "AKs": 0.05, "AKo": 1.0, "AQo": 1.0}.items():
            M[:, CLASS_INDEX[c]] = [r, 1.0 - r, 0.0]
        wt = np.array([float(COMBOS[c]) for c in CLASSES])
        R = D.repair_classes(M, names, wt)
        self.assertAlmostEqual(R[0, CLASS_INDEX["AQs"]], 0.70)
        for c in ("AKs", "AKo", "AQo"):
            self.assertAlmostEqual(R[0, CLASS_INDEX[c]], (4 * 0.05 + 12 + 12) / 28, msg=c)    # 0.8643
            self.assertAlmostEqual(R[0, CLASS_INDEX[c]] + R[1, CLASS_INDEX[c]], 1.0)
        np.testing.assert_allclose((R * wt).sum(1), (M * wt).sum(1), atol=1e-9)

    def test_isotonic_is_pool_adjacent_violators_on_a_chain(self):
        rng = np.random.default_rng(7)
        for _ in range(50):
            v, wt = rng.random(5), rng.random(5) + 0.1
            iso = D.isotonic(v, wt, [(i, i + 1) for i in range(4)])
            pav = v.copy()
            for s0, e0 in D._blocks(v, wt):
                pav[s0:e0] = (v[s0:e0] * wt[s0:e0]).sum() / wt[s0:e0].sum()
            np.testing.assert_allclose(iso, pav, atol=1e-12)

    def test_pooling_keeps_the_mix_and_the_order(self):
        names = ["raise", "call", "fold"]
        M = np.zeros((3, len(CLASSES)))
        M[2] = 1.0
        k4, k5 = CLASS_INDEX["K4o"], CLASS_INDEX["K5o"]
        M[:, k4] = [0.5, 0.3, 0.2]                     # K4o continues 80%, K5o not at all
        aa, kk = CLASS_INDEX["AA"], CLASS_INDEX["KK"]
        M[:, aa] = [0.1, 0.9, 0.0]                     # AA flats 90% while KK raises 80%
        M[:, kk] = [0.8, 0.2, 0.0]
        wt = np.array([float(COMBOS[c]) for c in CLASSES])
        R = D.repair_classes(M, names, wt)
        np.testing.assert_allclose((R * wt).sum(1), (M * wt).sum(1), atol=1e-9)
        self.assertAlmostEqual(R[2, k4], R[2, k5])
        self.assertAlmostEqual(R[0, aa], 0.45)
        self.assertAlmostEqual(R[0, kk], 0.45)
        self.assertAlmostEqual(R[0, aa] + R[1, aa], 1.0)
        for wk, st in D.pairs():
            self.assertGreaterEqual(1 - R[2, st], 1 - R[2, wk] - 1e-9, (CLASSES[wk], CLASSES[st]))

    def test_a_hand_that_never_arrives_moves_nobody_else(self):
        names = ["raise", "fold"]
        M = np.zeros((2, len(CLASSES)))
        M[1] = 1.0
        k4, k5 = CLASS_INDEX["K4o"], CLASS_INDEX["K5o"]
        M[:, k4] = [1.0, 0.0]
        wt = np.array([float(COMBOS[c]) for c in CLASSES])
        wt[k4] = 12 * D.EPS
        R = D.repair_classes(M, names, wt)
        self.assertLess(R[0, k5], 1e-5)
        self.assertLess(R[0, k4], 1e-5)


class Jams(unittest.TestCase):
    def test_the_advices_jams_are_the_jam_range(self):
        """An open- or 3bet-jam's range (what the later streets and the calls of it read) is the hands the advice jams
        there. Upstream's split: its push/fold flatting alternative read the chart's calls, not the re-priced ones."""
        seen = 0
        for n, d, kw, mi in [(6, 10, None, 3), (6, 15, None, 3), (6, 25, None, 3), (9, 15, {"ante": 0.125}, 2),
                             (2, 15, None, 3)]:
            positions = table(n, d, kw)
            for pre, hero, res, _ in walk(n, d, mi, kw, max_raises=2):
                names = res["grid"]["actions"]
                if raises(pre) > 1 or "all-in" not in names or share(res, ("all-in",)) < 0.005:
                    continue
                seen += 1
                gap = self.gap(res, pre, hero, positions, d)
                self.assertLess(gap[0], 0.001, (n, d, line(pre), hero, gap[1:]))
        self.assertGreater(seen, 100)
        pre = [{"pos": "HJ", "action": "raise", "to": 2.5}, {"pos": "CO", "action": "call"}] + FOLDS("BTN", "SB")
        pre = FOLDS("UTG") + pre
        with unrepaired():
            res = advise(6, 15, "BB", pre)
            self.assertGreater(self.gap(res, pre, "BB", table(6, 15), 15)[0], 0.5)     # (33: jammed 100%, in the range 0%)

    def test_with_rake_the_jams_are_the_raked_charts(self):
        """Without rake the advice plays the chart moved to no rake (gto/pf_norake.py) and the jam range above is its
        jams; with rake neither moves, and they still agree."""
        seen = 0
        for n, d, mi in [(6, 15, 3), (2, 15, 3)]:
            positions = P.at_depth(P.Table(P.SEATS[n], 0.0, False, (0.05, 4.0), d), d)
            for pre, hero, res, _ in walk(n, d, mi, {"rake": 0.05, "rake_cap": 4}, max_raises=2):
                names = res["grid"]["actions"]
                if raises(pre) > 1 or "all-in" not in names or share(res, ("all-in",)) < 0.005:
                    continue
                seen += 1
                gap = self.gap(res, pre, hero, positions, d)
                self.assertLess(gap[0], 0.001, (n, d, line(pre), hero, gap[1:]))
        self.assertGreater(seen, 20)

    @staticmethod
    def gap(res, pre, hero, positions, d):
        names = res["grid"]["actions"]
        amt = next(a["amount_bb"] for a in res["actions"] if a["action"] == "all-in")
        before = PC._classes(A.preflop_ranges(pre, positions, d)[hero])
        after = PC._classes(A.preflop_ranges(pre + [{"pos": hero, "action": "all-in", "to": amt}], positions, d)[hero])
        j = names.index("all-in")
        return max((abs(after[i] / before[i] - res["grid"]["cells"][c]["f"][j]), c, after[i] / before[i])
                   for i, c in enumerate(CLASSES) if before[i] >= 0.01 and c in res["grid"]["cells"])


class LibrarySpots(unittest.TestCase):
    def ranges(self):
        out = {}
        for sid, n, stack, line in PC.PUBLISHED:
            st = FL.spot_setup(line, players=n, stack=stack)
            out[sid] = (st["full0"], st["full1"], st["pot"], st["stack"])
        return out

    def test_no_published_spots_ranges_move(self):
        now = self.ranges()
        with unrepaired():
            before = self.ranges()
        moved = [sid for sid in now if not all(np.array_equal(a, b) for a, b in zip(now[sid][:2], before[sid][:2]))]
        self.assertEqual(moved, [])

    @staticmethod
    def stacked():
        """Each spot's flop ranges at a table where a seat that folds has another stack (40% of the table's) and the
        player who closes the action is deeper (150%): the decisions are the same ones, at the same effective depths."""
        out = {}
        for sid, n, stack, ln in PC.PUBLISHED:
            acts = []
            for part in ln.split(","):
                pos, code = part.split(":")
                act = {"f": "fold", "c": "call", "x": "check", "r": "raise"}[code[0]]
                acts.append({"pos": pos, "action": act, **({"to": float(code[1:])} if act == "raise" else {})})
            stacks = {acts[-1]["pos"]: stack * 1.5}
            stacks.update({a["pos"]: stack * 0.4 for a in acts[:1] if a["action"] == "fold"})
            r = A.preflop_ranges(acts, table(n, stack, stacks=stacks), stack)
            out[sid] = {p: r[p] for p in sorted(r)}
        return out

    def test_unequal_stacks_dont_move_them_either(self):
        now = self.stacked()
        with unrepaired():
            before = self.stacked()
        self.assertEqual({sid: list(r) for sid, r in now.items()}, {sid: list(r) for sid, r in before.items()})
        moved = [sid for sid in now if not all(np.array_equal(now[sid][p], before[sid][p]) for p in now[sid])]
        self.assertEqual(moved, [])

    def test_the_list_is_the_spots_the_repo_builds(self):
        want = {(sid, fmt.players, float(fmt.stack), ln) for sid, _, ln, fmt in FL.all_spots()}
        tree = ast.parse((ROOT / "scripts" / "library" / "build_breadth.py").read_text())
        spots = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                     and any(getattr(t, "id", None) == "SPOTS" for t in node.targets))
        for call in spots.elts:
            args = [ast.literal_eval(a) for a in call.args]
            kw = {k.arg: ast.literal_eval(k.value) for k in call.keywords}
            fmt = FL.Format.parse(args[3] if len(args) > 3 else kw.get("fmt", ""))
            want.add((args[0], fmt.players, float(fmt.stack), args[2]))
        self.assertEqual(len(want), 57)
        self.assertEqual(set(PC.PUBLISHED), want)

    def test_the_list_is_the_librarys(self):
        if not (LIBRARY / "index.json").exists():
            self.skipTest(f"no library index at {LIBRARY}")
        idx = json.loads((LIBRARY / "index.json").read_text())
        have = {(s["id"], int((s.get("game") or {}).get("players", 6)), float((s.get("game") or {}).get("stack", 100.0)),
                 s["line"]) for s in idx["spots"]}
        self.assertEqual(have - set(PC.PUBLISHED), set())      # (the list also holds FORMAT_SPOTS not built yet)
        now = self.ranges()
        fp = {s["id"]: list(s["fp"]) for s in idx["spots"]}
        bad = [sid for sid, (r0, r1, _, _) in now.items() if sid in fp and [FL.range_fp(r0), FL.range_fp(r1)] != fp[sid]]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
