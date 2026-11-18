#!/usr/bin/env python3
"""How far a stored preflop game's grade can stand in for a game at other stacks: the tolerance Analyze's grade uses.

The stored grid (engine/pf_solve.py stored_games) is of equal stacks at 20, 25, 30, 40, 50, 60, 80, 100, 125, 150 and
200bb. A site's hand is rarely that: the stacks differ, and few are exactly one of those. web/src/features/analyze/
grading.ts `pfDepthAt` grades such a decision by the stored game nearest the effective stacks, where every live seat's
effective stack is within a tolerance of that game's depth, and by the charts anywhere else. This measures what that
costs: for each test table it solves the game natively at the table's own stacks (the same class-level model and the
charts' raise sizes, 1,500 iterations, as the grid), plays hands on it as Practice's table does (scripts/
pf_practice_coverage.py: opponents from Advisor.play, your move from the charts' mix or from any option evenly), and at
each of your decisions grades the move both ways, the native solve and the nearest stored game, read as grading.ts reads
a site's hand (pfGrade.ts pfPlayed: the same seat to act, the same chips in, your move among the node's actions at its
size, your class in the range). It reports, by each decision's deviation, how often the two verdicts agree and how far
the EV lost differs.

The deviation at a decision: each seat still in has an effective stack, its own or the deepest other live stack, whichever
is smaller; the stored game is the one nearest yours (by ratio); the deviation is the largest |effective / depth - 1| over
the seats still in.

    .venv/bin/python scripts/pf_depth_tolerance.py [--hands 3000] [--iters 1500] [--tables all|A,B,...]
"""
import argparse
import collections
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "solver"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from gto.advisor import Advisor          # noqa: E402
from gto import pf_study as PS           # noqa: E402
import engine.pf_stored                  # noqa: E402,F401  (Lizard's stored games, as the worker has them)
from engine import pf_solve as LZ        # noqa: E402

SEATS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
RANKS = "23456789TJQKA"
DECK = [r + s for r in RANKS for s in "shdc"]
DEPTHS = tuple(LZ.STORED_DEPTHS)
SIZE_EPS, CHIP_EPS = 0.051, 0.011
TOL, MIX, INACCURACY_PCT, MISTAKE_PCT = 0.011, 0.1, 2.0, 8.0     # web/src/grading/grade.ts
ORDER = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"]

# the test tables, UTG to BB: off the grid's depths at the worst points between them, and unequal in several ways
TABLES = {
    "A": (89,) * 6,
    "B": (110,) * 6,
    "C": (69,) * 6,
    "D": (35,) * 6,
    "E": (170,) * 6,
    "F": (100, 90, 110, 100, 85, 120),
    "G": (40, 100, 100, 100, 100, 100),
    "H": (200, 100, 100, 100, 100, 100),
    "I": (100, 100, 100, 100, 100, 60),
    "J": (70, 130, 100, 80, 120, 100),
}
CANT = "stored can't"
BUCKETS = (0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 9.9)


def class_of(hole: str) -> str:
    a, b = hole[:2], hole[2:]
    if RANKS.index(a[0]) < RANKS.index(b[0]):
        a, b = b, a
    return a[0] + b[0] if a[0] == b[0] else a[0] + b[0] + ("s" if a[1] == b[1] else "o")


def nearest_depth(x: float) -> float:
    return min(DEPTHS, key=lambda d: abs(math.log(x / d)))


def depth_at(stacks: dict, live: list, hero: str):
    """(the stored depth, the deviation): grading.ts pfDepthAt."""
    def eff(q):
        others = [stacks[r] for r in live if r != q]
        return min(stacks[q], max(others)) if others else stacks[q]
    d = nearest_depth(eff(hero))
    return d, max(abs(eff(q) / d - 1) for q in live)


class Table:
    """The preflop of poker/table.ts, each seat's own stack, no ante."""

    def __init__(self, stacks):
        self.stack = dict(stacks)
        self.bets = {p: 0.0 for p in SEATS}
        self.bets["SB"], self.bets["BB"] = 0.5, 1.0
        self.cur, self.last = 1.0, 1.0
        self.active, self.allin, self.acted = list(SEATS), set(), set()
        self.at, self.line = 0, []

    def to_act(self):
        if len(self.active) <= 1:
            return None
        need = [p for p in self.active if p not in self.allin and (p not in self.acted or self.bets[p] < self.cur - 1e-9)]
        if not need:
            return None
        live = [p for p in self.active if p not in self.allin]
        if len(live) == 1 and self.bets[live[0]] >= self.cur - 1e-9:
            return None
        for k in range(6):
            p = SEATS[(self.at + k) % len(SEATS)]
            if p in need:
                return p
        return None

    def record(self, p, action, to=None):
        facing = self.cur - self.bets[p] > 1e-9
        top = self.stack[p]
        can_raise = any(q != p and q not in self.allin for q in self.active)
        passive = {"pos": p, "action": "call" if facing else "check"}
        if action == "fold":
            return {"pos": p, "action": "fold"}
        if action in ("check", "call"):
            return passive if top > self.cur - 1e-9 or not facing else {"pos": p, "action": "all-in"}
        if action == "all-in":
            return {"pos": p, "action": "all-in"} if top <= self.cur + 1e-9 or can_raise else passive
        size = math.floor((to or 0) * 2 + 0.5) / 2
        if not can_raise:
            return passive
        size = max(size, self.cur + self.last) if size < top - 1e-9 else size
        return {"pos": p, "action": "all-in"} if size >= top - 1e-9 else {"pos": p, "action": "raise", "to": size}

    def apply(self, m):
        p, a = m["pos"], m["action"]
        self.line.append(m)
        self.acted.add(p)
        self.at = (SEATS.index(p) + 1) % len(SEATS)
        if a == "fold":
            self.active.remove(p)
        elif a == "call":
            self.bets[p] = min(self.cur, self.stack[p])
        elif a in ("raise", "all-in"):
            to = self.stack[p] if a == "all-in" else m["to"]
            if to > self.cur:
                if to - self.cur >= self.last - 1e-9:
                    self.last = to - self.cur
                    self.acted = {p}
                self.cur = to
            self.bets[p] = to
            if a == "all-in":
                self.allin.add(p)

    @property
    def pot(self):
        return sum(self.bets.values())


def request(t, hero):
    st = {p: t.stack[p] for p in SEATS}
    return dict(players=6, stack=st[hero], stacks=st, board="", preflop=[dict(m) for m in t.line], flop=[], turn=[],
                river=[], hero=hero)


def read(solve, t, hero, hole, move):
    """pfGrade.ts pfPlayed: (the verdict's inputs: EVs, freqs, the move's index, the pot) or why not."""
    r = solve.node([dict(m) for m in t.line])
    if r.get("error") or r.get("study") != "node" or r.get("actor") != hero:
        return "off-tree"
    if any("played as the solve's size" in n for n in r["notes"]):
        return "line-size"
    to_call = min(t.cur - t.bets[hero], t.stack[hero] - t.bets[hero])
    pot = t.pot - (r.get("uncalled_bb") or 0)
    if abs(r["pot_bb"] - pot) > CHIP_EPS or abs(r["to_call_bb"] - to_call) > CHIP_EPS:
        return "chips"
    if r["rough"]:
        return "rough"
    cell = r["grid"]["cells"].get(class_of(hole))
    if cell is None:
        return "class-gone"
    acts = r["actions"]
    hits = [i for i, a in enumerate(acts) if a["action"] == move["action"]
            and (move["action"] != "raise" or abs(a["amount_bb"] - move["to"]) <= SIZE_EPS)]
    if not hits:
        return "no-move"
    names = r["grid"]["actions"]
    order = [names.index(a["action"]) for a in acts]
    return [cell["ev"][k] for k in order], [cell["f"][k] for k in order], hits[0], r["pot_bb"]


def verdict(evs, freqs, a, pot):
    raw = max(0.0, max(evs) - evs[a])
    pct = raw / pot * 100
    if raw <= TOL:
        return "Best", 0.0
    if freqs[a] >= MIX:
        return "Correct", raw
    return ("Inaccuracy" if pct < INACCURACY_PCT else "Mistake" if pct < MISTAKE_PCT else "Blunder"), raw


def native(stacks, iters):
    spec = LZ.chart_sized(LZ.Spec(6, tuple(float(x) for x in stacks)))
    if spec.equal and float(stacks[0]) in DEPTHS:
        return LZ.held(spec), 0.0, 0.0
    g = spec.game()
    t0 = time.time()
    for k in range(1, iters + 1):
        g.iterate(k)
    s = LZ.Solve(spec, PS.pack(g))
    s.measure()
    return s, s.mbb, time.time() - t0


def bucket(dev):
    for lo, hi in zip(BUCKETS, BUCKETS[1:]):
        if dev <= hi + 1e-9:
            return f"{lo:.0%}-{hi:.0%}" if hi < 9 else f">{lo:.0%}"
    return "?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=3000)
    ap.add_argument("--iters", type=int, default=1500)
    ap.add_argument("--tables", default="all")
    ap.add_argument("--policy", default="chart,uniform")
    ap.add_argument("--seed", type=int, default=20261117)
    a = ap.parse_args()
    names = list(TABLES) if a.tables == "all" else a.tables.split(",")
    for n in names:
        if n not in TABLES:          # (a table of its own: "95/95/95/95/95/95", UTG to BB)
            TABLES[n] = tuple(float(x) for x in n.split("/"))
    adv = Advisor()
    stored = {}

    def stored_at(d):
        if d not in stored:
            stored[d] = LZ.held(LZ.chart_sized(LZ.Spec(6, (float(d),))))
            if stored[d] is None:
                raise SystemExit(f"no stored 6-max game at the charts' sizes at {d:g}bb")
        return stored[d]
    total = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    losses = collections.defaultdict(lambda: collections.defaultdict(list))
    for name in names:
        stacks = dict(zip(SEATS, (float(x) for x in TABLES[name])))
        sol, mbb, secs = native(TABLES[name], a.iters)
        print(f"== table {name} {TABLES[name]}: native solve {secs:.0f}s, {mbb:.3f} mbb", flush=True)
        for pol in a.policy.split(","):
            rnd = random.Random(a.seed)
            seen = collections.Counter()
            for h in range(a.hands):
                deck = DECK[:]
                rnd.shuffle(deck)
                holes = {p: deck[2 * i] + deck[2 * i + 1] for i, p in enumerate(SEATS)}
                hero = SEATS[(3 - h) % 6]
                t = Table(stacks)
                while True:
                    p = t.to_act()
                    if p is None:
                        break
                    if p != hero:
                        mv = adv.play(request(t, hero) | {"hole": holes[hero]}, p, holes[p], rnd.randrange(1 << 30))
                        t.apply(t.record(p, mv["action"], mv.get("to")))
                        continue
                    opts = adv.advise(request(t, hero) | {"hole": holes[hero]})["actions"]
                    freqs = [max(0.0, o["freq"]) for o in opts]
                    pick = rnd.choice(opts) if pol == "uniform" else rnd.choices(opts, freqs if sum(freqs) else None)[0]
                    m = t.record(p, pick["action"].split()[0], pick.get("amount_bb"))
                    live = list(t.active)
                    d, dev = depth_at(stacks, live, hero)
                    b = bucket(dev)
                    nat = read(sol, t, hero, holes[hero], m)
                    sto = read(stored_at(d), t, hero, holes[hero], m)
                    if isinstance(nat, str):
                        seen["native: " + nat] += 1
                    elif isinstance(sto, str):
                        seen["stored: " + sto] += 1
                        total[pol][b][CANT] += 1
                    else:
                        vn, ln = verdict(*nat)
                        vs, ls = verdict(*sto)
                        gap = abs(ORDER.index(vn) - ORDER.index(vs))
                        seen["both"] += 1
                        c = total[pol][b]
                        c["both"] += 1
                        c["same"] += vn == vs
                        c["one apart"] += gap == 1
                        c["two+ apart"] += gap >= 2
                        c["best agrees"] += (vn == "Best") == (vs == "Best")
                        losses[pol][b].append(abs(ln - ls))
                    t.apply(m)
                    if m["action"] == "fold":
                        break
            print(f"  {pol}: " + ", ".join(f"{k} {v}" for k, v in seen.most_common()), flush=True)
    for pol in a.policy.split(","):
        print(f"== by deviation, {pol} (decisions both read)")
        for b in sorted(total[pol], key=lambda s: float(s.strip(">").split("-")[0].rstrip("%"))):
            c, ls = total[pol][b], losses[pol][b]
            n = c["both"]
            if not n:
                continue
            ls = sorted(ls)
            print(f"  {b:8s} n {n:6d}  same verdict {c['same'] / n:6.1%}  one class apart {c['one apart'] / n:5.1%}  "
                  f"two+ {c['two+ apart'] / n:5.1%}  Best agrees {c['best agrees'] / n:6.1%}  "
                  f"|EV lost diff| mean {sum(ls) / n:.4f}bb p95 {ls[int(0.95 * (n - 1))]:.3f}bb  "
                  f"(stored can't read {c[CANT]})", flush=True)


if __name__ == "__main__":
    main()
