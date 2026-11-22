"""The stored preflop solves' moves that were never trained, against the rule Practice's and Analyze's grade reads them by
(web/src/features/practice/pfGrade.ts untrainedMoves: a move the range makes under UNTRAINED_SHARE of it that even its
strongest hand loses UNTRAINED_LOSS bb or more by, against folding, leaves the spot to the chart).

pf_study.pack stores every hand a player never brings to a node as folding there, and the seats behind a move no one makes
never trained against it, so such a move's EV is of folding to whatever comes next: the HJ's 3-bet over a 6-max 40bb UTG
open read -7.495bb for AA as -7.5 for 72o, and the grade called a chart's AA 3-bet a 12.8bb Blunder (lz3; -7.491 on lz4). Found here from the
solve's own arrays (the audit's definition: under 0.5% of the range, EVs flat across the live classes within 0.5bb, even the
strongest class losing over 0.5bb), each must be caught by the page's rule on the node as the worker answers it
(engine.pf_solve.Solve.node): the count graded by EV regardless is held at 0. A move a few hands make (the BTN calling a
4-bet all-in at 6-max 60bb with 0.48% of its range, AA's call +58.7bb) is learned and stays graded.

Quick by default (CI's python job): the games at the charts' raise rule (`_ch`, what Practice and Analyze grade by),
6-max at every depth and the other table sizes at 20, 40 and 100bb, and the tournament presets' stages, about 20 seconds.
Every stored game and preset: PF_OFFPATH_ALL=1 (about 2 minutes of CPU: through slot.sh).

Run: .venv/bin/python -m unittest scripts/engine/test_pf_offpath.py
"""
import json
import os
import re
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_solve as PSV  # noqa: E402
from gto import pf_game as G  # noqa: E402
from gto import pf_study as PS  # noqa: E402
from gto.pf_classes import CLASSES, N_IN  # noqa: E402

ALL = os.environ.get("PF_OFFPATH_ALL") == "1"
TS = (ROOT / "web" / "src" / "features" / "practice" / "pfGrade.ts").read_text()


def ts_const(name: str) -> float:
    m = re.search(rf"export const {name} = ([0-9.]+);", TS)
    if not m:
        raise AssertionError(f"pfGrade.ts has no {name}")
    return float(m.group(1))


SHARE, LOSS = ts_const("UNTRAINED_SHARE"), ts_const("UNTRAINED_LOSS")
# the audit's degenerate move (scratchpad audit-preflop/degen.py): its EVs flat across the live classes within this
SPREAD = 0.5


def untrained(node: dict) -> list:
    """pfGrade.ts untrainedMoves on a node answer: [(action, amount_bb)]."""
    names = node["grid"]["actions"]
    fold = names.index("fold") if "fold" in names else -1

    def rel(ev, i):
        return ev[i] - (ev[fold] if fold >= 0 else 0.0)

    top, best = None, -float("inf")
    for c in node["grid"]["cells"].values():
        ev = c.get("ev")
        if not ev or len(ev) != len(names) or any(not isinstance(x, (int, float)) for x in ev):
            continue
        m = max(rel(ev, i) for i in range(len(ev)))
        if m > best:
            top, best = ev, m
    if top is None:
        return []
    return [(a["action"], a.get("amount_bb")) for i, a in enumerate(node["actions"])
            if a["action"] != "fold" and names[i] == a["action"] and isinstance(a.get("freq"), (int, float))
            and a["freq"] < SHARE and rel(top, i) <= -LOSS]


def degenerate(sv) -> list:
    """The never-trained moves at the nodes the page grades (not rough), from the solve's arrays: [(line, action)]."""
    g = sv.game
    s, reach, M, V = sv._values()
    out = []
    for d, k in enumerate(g.dec):
        node = g.nodes_all[k]
        p, names = node.player, node.names
        if any(reach[k, q].sum() < 1e-9 for q in range(g.n)):
            continue                      # (a seat the solve never brings here: rough)
        norm = np.ones(len(CLASSES))
        for q in range(g.n):
            if q != p:
                norm = norm * M[k, q]
        with np.errstate(all="ignore"):
            evs = np.array([V[node.children[a].index, p] / np.maximum(norm, 1e-300) for a in range(len(names))])
        if "fold" not in names:
            continue                      # (a check: no fold to measure against; the page's rule reads it all the same)
        evs = evs - evs[names.index("fold")]
        w = reach[k, p] / G.PRIOR
        live = w > PS.LIVE_W
        if not live.any():
            continue
        comb = w * N_IN
        mix = s[d, :len(names)]
        share = (mix * comb)[:, live].sum(1) / max(float(comb[live].sum()), 1e-12)
        top = max(np.nonzero(live)[0], key=lambda j: np.nanmax(evs[:, j]))
        for a, nm in enumerate(names):
            e = evs[a, live]
            if nm != "fold" and share[a] < SHARE and np.all(np.isfinite(e)) and e.max() - e.min() < SPREAD \
                    and evs[a, top] < -LOSS:
                out.append((list(node.line), nm))
    return out


def line_of(line) -> list:
    return [{"pos": p, "action": a, **({"to": t} if a in ("raise", "all-in", "call") else {})} for p, a, t in line]


def check(case: unittest.TestCase, sv, key: str) -> tuple:
    """(never-trained moves found, those the page's rule would still grade by EV) at one stored solve."""
    found = degenerate(sv)
    missed = []
    for line, nm in found:
        node = sv.node(line_of(line))
        if node.get("study") != "node" or node.get("rough"):
            continue                      # (the page leaves a rough node to the chart already)
        if nm not in [a for a, _ in untrained(node)]:
            missed.append((key, line, nm))
    return len(found), missed


def cash_games() -> list:
    games = PSV.stored_games()
    if ALL:
        return games
    # (since 2026-11-17 the grade reads the games at the charts' raise rule, `_ch`, at 2 to 6 players)
    return [s for s in games if s.chart and (s.players == 6 or (s.stacks[0] in (20.0, 40.0, 100.0) and s.rake is None))]


class Rule(unittest.TestCase):
    def test_constants_are_the_pages(self):
        self.assertEqual((SHARE, LOSS), (0.005, 0.5))
        # (engine/pf_offpath.py fills a seat's later nodes only behind moves the solve trained, by the same share)
        from engine import pf_offpath
        self.assertEqual(pf_offpath.UNTRAINED_SHARE, SHARE)

    def test_the_hijacks_3bet_at_40bb_is_caught_and_a_rare_learned_call_is_not(self):
        spec = next(s for s in PSV.stored_games() if s.key == f"{PSV.MODEL_TAG}_6max_40bb_ch")
        sv = PSV.Solve(spec, PSV.read_stored(spec.key))
        hj = sv.node([{"pos": "UTG", "action": "raise", "to": 2.5}])
        self.assertFalse(hj["rough"])
        self.assertEqual(untrained(hj), [("raise", 7.5)])
        self.assertEqual(untrained(sv.node([])), [])
        spec = next(s for s in PSV.stored_games() if s.key == f"{PSV.MODEL_TAG}_6max_60bb_ch")
        sv = PSV.Solve(spec, PSV.read_stored(spec.key))
        rare = sv.node(line_of([("UTG", "raise", 2.5), ("HJ", "raise", 7.5), ("CO", "all-in", 60.0)]))
        call = next(a for a in rare["actions"] if a["action"] == "call")
        self.assertLess(call["freq"], SHARE)
        self.assertEqual(untrained(rare), [])


class CashGrid(unittest.TestCase):
    def test_no_untrained_move_is_graded_by_ev(self):
        found, missed = 0, []
        for spec in cash_games():
            sv = PSV.Solve(spec, PSV.read_stored(spec.key))
            n, m = check(self, sv, spec.key)
            found += n
            missed += m
        self.assertGreater(found, 0)          # (the grid has them: the rule has something to catch)
        self.assertEqual(missed[:5], [])
        self.assertEqual(len(missed), 0)


class TournamentPresets(unittest.TestCase):
    def test_no_untrained_move_is_graded_by_ev(self):
        from engine import pf_icm_stored as ST
        from engine import pf_icm_study as IS
        from gto.advisor import Advisor
        man = json.loads(Path(ST.MANIFEST).read_text())
        if not ALL:
            man = [e for e in man if e["set"] == "stage"]
        adv = Advisor()
        missed = []
        for e in man:
            spec, why = IS.spec_of(adv, {**e["request"], "bb": 1.0, "street": "preflop", "board": ""})
            self.assertIsNotNone(spec, why)
            blob = Path(ST.DIR, e["key"] + ".bin").read_bytes()
            sv = IS.Solve(spec, blob)
            missed += check(self, sv, e["key"])[1]
        self.assertEqual(missed[:5], [])


if __name__ == "__main__":
    unittest.main()
