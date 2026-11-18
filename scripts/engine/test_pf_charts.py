"""The preflop charts as served, with Lizard's repairs (engine/pf_charts.py, engine/pf_dominance.py):

- 13 to 19bb play the 20bb game's moves, not the 100bb charts unmoved (the 6-max button opened 45.1% at 15bb, as at
  100bb, and 36.6% at 20bb); 12bb is still push/fold. The flop library has no spot at those depths.
- Hand order: over the lines the charts play in a few games (heads-up and one-caller lines, up to three raises), no
  hand continues 0.25 or more less often than the hand below it in its family when both arrive at 5% or more (the wheel
  aces A2-A5 left out), and AA and KK never flat over 60% of the time facing an open while the next hand down raises
  more. The nodes that feed a published flop library spot are left unrepaired, and their inversions are held to a count.
- Every published heads-up spot's ranges are the same with the repairs as without, so no fingerprint changes; with the
  library's index at hand (LIZARD_LIBRARY, else library-build/lizard-library), they match its fingerprints too.

About 20 seconds. Run: .venv/bin/python -m unittest scripts/engine/test_pf_charts.py
"""
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
# 22 of the 53 spots' fingerprints). A repair or chart change that lowers it should lower this too.
FED_INVERSIONS = 19


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
            self.assertTrue(any("the 20bb chart" in x for x in at[d]["notes"]), at[d]["notes"])
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


GAMES = [(6, 100, 3, None), (6, 40, 3, None), (6, 15, 3, None), (6, 40, 3, {"ante": 0.125}), (2, 100, 3, None),
         (9, 100, 2, None)]


class HandOrder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = [(f"{n}max {d}bb{' ante' if kw else ''}", node) for n, d, mi, kw in GAMES for node in walk(n, d, mi, kw)]

    def test_no_hand_continues_less_than_the_one_below_it(self):
        bad = [(g, " ".join(f"{a['pos']}:{a['action'][0]}" for a in pre if a["action"] != "fold") or "first in", hero,
                inv) for g, (pre, hero, res, fed) in self.nodes if not fed for inv in inversions(res)]
        self.assertGreater(len(self.nodes), 600)
        self.assertEqual(bad[:5], [])

    def test_the_library_spots_nodes_are_held_to_their_count(self):
        fed = [inv for _, (pre, hero, res, f) in self.nodes if f for inv in inversions(res)]
        self.assertLessEqual(len(fed), FED_INVERSIONS)

    def test_aa_and_kk_never_flat_while_the_next_hand_down_raises(self):
        bad = [(g, hero, premium_flats(res, pre)) for g, (pre, hero, res, fed) in self.nodes
               if not fed and premium_flats(res, pre)]
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

    def test_the_list_is_the_librarys(self):
        if not (LIBRARY / "index.json").exists():
            self.skipTest(f"no library index at {LIBRARY}")
        idx = json.loads((LIBRARY / "index.json").read_text())
        have = {(s["id"], int((s.get("game") or {}).get("players", 6)), float((s.get("game") or {}).get("stack", 100.0)),
                 s["line"]) for s in idx["spots"]}
        self.assertEqual(have, set(PC.PUBLISHED))
        now = self.ranges()
        fp = {s["id"]: list(s["fp"]) for s in idx["spots"]}
        bad = [sid for sid, (r0, r1, _, _) in now.items() if [FL.range_fp(r0), FL.range_fp(r1)] != fp[sid]]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
