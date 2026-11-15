#!/usr/bin/env python3
"""How much of a stored tournament preset's preflop in Practice the stored prize-equity solve can grade, native.

scripts/pf_practice_coverage.py for engine/pf_icm_stored.py's stages: the preset's table (each seat's own chips, its ante
dead in the pot), your seat moving one place a hand, each opponent's move from Advisor.play asked with the preset's request
as Practice asks it (pf_icm_stored.request: prizes, the other tables, the stacks), sized as poker/table.ts `recordOf`
takes it. As Practice plays a session graded by a stored preset, the request carries `pf_play`, so an opponent's move is
drawn from the stored node where it is this spot (engine/pf_icm_study.play), and where the solve reads your spot your
options are its own (pfGrade.ts `solveOptions`). At each of your decisions it asks what web/src/features/practice/
pfGrade.ts `pfRead` asks of the stored node, in the same order, and counts the answer. Your move: from the solve's mix
where it answers, else the chart's (--policy uniform: any option evenly, someone playing badly).

--charts plays it as before the stored presets: the opponents' moves the charts', your options the chart's (--own-sizes:
"Offer the solve's raise sizes"), to see why the opponents and your buttons follow the solve.

    .venv/bin/python scripts/pf_icm/coverage.py --hands 2000 [--stage "Sit & go bubble"] [--policy chart,uniform]
        [--charts [--own-sizes]]
"""
import argparse
import collections
import math
import os
import random
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "solver"))
sys.path.insert(0, ROOT)
from gto.advisor import Advisor          # noqa: E402
from gto.preflop import SEATS as TABLES  # noqa: E402
from engine import pf_icm_stored as ST   # noqa: E402
from engine import pf_icm_study as IS    # noqa: E402

RANKS = "23456789TJQKA"
DECK = [r + s for r in RANKS for s in "shdc"]
SIZE_EPS, CHIP_EPS = 0.051, 0.011        # pfGrade.ts
STAGES = ("first in", "facing an open", "facing a 3-bet", "facing a 4-bet", "facing a 5-bet+")


def class_of(hole: str) -> str:
    a, b = hole[:2], hole[2:]
    if RANKS.index(a[0]) < RANKS.index(b[0]):
        a, b = b, a
    return a[0] + b[0] if a[0] == b[0] else a[0] + b[0] + ("s" if a[1] == b[1] else "o")


class Table:
    """The preflop of poker/table.ts with each seat's own chips and an ante a seat."""

    def __init__(self, seats, stacks, ante):
        self.seats = list(seats)
        self.ante = ante
        self.cap = {p: s - ante for p, s in zip(seats, stacks)}         # what each can bet
        self.bets = {p: 0.0 for p in seats}
        sb, bb = (seats[-2], seats[-1]) if len(seats) > 2 else (seats[0], seats[1])
        self.bets[sb], self.bets[bb] = min(0.5, self.cap[sb]), min(1.0, self.cap[bb])
        self.cur, self.last = 1.0, 1.0
        self.active, self.allin, self.acted = list(seats), set(), set()
        self.at, self.line = 0, []

    def to_act(self):
        live = [p for p in self.active if p not in self.allin]
        if len(self.active) <= 1 or not live:
            return None
        need = [p for p in live if p not in self.acted or self.bets[p] < self.cur - 1e-9]
        if not need or (len(live) == 1 and self.bets[live[0]] >= self.cur - 1e-9):
            return None
        n = len(self.seats)
        for k in range(n):
            p = self.seats[(self.at + k) % n]
            if p in need:
                return p
        return None

    def record(self, p, action, to=None):
        facing = self.cur - self.bets[p] > 1e-9
        cap = self.cap[p]
        can_raise = any(q != p and q not in self.allin for q in self.active) and cap > self.cur + 1e-9
        passive = {"pos": p, "action": "call" if facing else "check"}
        if action == "fold":
            return {"pos": p, "action": "fold"}
        if action in ("check", "call"):
            return passive                       # (a call for less stays a call, as table.ts records it)
        if action == "all-in":
            return {"pos": p, "action": "all-in"} if cap <= self.cur + 1e-9 or can_raise else passive
        if not can_raise:
            return passive
        size = math.floor((to or 0) * 2 + 0.5) / 2
        size = max(size, self.cur + self.last) if size < cap - 1e-9 else size
        return {"pos": p, "action": "all-in"} if size >= cap - 1e-9 else {"pos": p, "action": "raise", "to": size}

    def apply(self, m):
        p, a = m["pos"], m["action"]
        self.line.append(m)
        self.acted.add(p)
        self.at = (self.seats.index(p) + 1) % len(self.seats)
        if a == "fold":
            self.active.remove(p)
        elif a == "call":
            self.bets[p] = min(self.cur, self.cap[p])
            if self.bets[p] >= self.cap[p] - 1e-9:
                self.allin.add(p)
        elif a in ("raise", "all-in"):
            to = self.cap[p] if a == "all-in" else m["to"]
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
        return sum(self.bets.values()) + self.ante * len(self.seats)

    def raises(self):
        return sum(1 for m in self.line if m["action"] in ("raise", "all-in"))


def read(solve, t, hero, hole, opts, own_sizes, solve_options):
    """pfGrade.ts pfRead: (what the solve says: "answered" or why not, the detail, the node)."""
    r = solve.node([dict(m) for m in t.line])
    if r.get("error"):
        return "off-tree", r["error"][:80], None
    if r.get("study") != "node":
        return "past-end", str(r.get("study")), None
    if r.get("actor") != hero:
        return "off-tree", "actor", None
    moved = next((n for n in r["notes"] if "played as the solve's size" in n), None)
    if moved:
        return "line-size", moved[:90], r
    pot = t.pot - r.get("uncalled_bb", 0.0)            # (a jam no one can call: pfGrade.ts chipsOff)
    to_call = min(t.cur - t.bets[hero], t.cap[hero] - t.bets[hero])
    if abs(r["pot_bb"] - pot) > CHIP_EPS or abs(r["to_call_bb"] - to_call) > CHIP_EPS:
        return "chips", f"pot {pot:g} vs {r['pot_bb']:g}, to call {to_call:g} vs {r['to_call_bb']:g}", r
    if r.get("rough"):
        return "rough", "", r
    cell = r["grid"]["cells"].get(class_of(hole))
    if cell is None:
        return "class-gone", "", r
    if solve_options:
        return "answered", "", r
    sol = [(a["action"], a["amount_bb"]) for a in r["actions"]]
    table = []
    for o in opts:
        m = t.record(hero, o["action"].split()[0], o.get("amount_bb"))
        table.append((m["action"], m.get("to")))

    def same(a, b):
        return a[0] == b[0] and (a[0] != "raise" or abs(a[1] - b[1]) <= SIZE_EPS)
    kinds = lambda xs: sorted(x[0] for x in xs)   # noqa: E731
    if own_sizes and kinds(table) == kinds(sol):
        return "answered", "", r
    if len(table) != len(sol) or not all(any(same(a, b) for b in sol) for a in table):
        return ("own-size" if kinds(table) == kinds(sol) else "options"), f"{table} vs {sol}", r
    return "answered", "", r


def run(stage, policy, hands, seed, own_sizes, charts):
    rnd = random.Random(seed)
    adv = Advisor()
    req = ST.request(stage)
    name, n, stacks, _pay, _field, _ante = stage
    seats = list(TABLES[n])
    ante = req.get("ante", 0.0)
    spec, why = IS.spec_of(adv, {**req, "bb": 1.0})
    solve = IS.held(spec)
    if solve is None or not solve.stored:
        raise SystemExit(f"{name}: no stored solve ({why})")
    seen, why, by, seats_seen = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    for h in range(hands):
        deck = DECK[:]
        rnd.shuffle(deck)
        holes = {p: deck[2 * i] + deck[2 * i + 1] for i, p in enumerate(seats)}
        hero = seats[h % n]
        t = Table(seats, stacks, ante)
        while True:
            p = t.to_act()
            if p is None:
                break
            ask = dict(req, board="", preflop=[dict(m) for m in t.line], flop=[], turn=[], river=[], hero=hero, hole=holes[hero],
                       **({} if charts else {"pf_play": True}))
            if p != hero:
                mv = adv.play(ask, p, holes[p], rnd.randrange(1 << 30))
                m = t.record(p, mv["action"], mv.get("to"))
                if mv.get("pf_icm") and m["action"] == "raise":
                    m["to"] = mv["to"]                   # (flow.ts moveOf: the solve's size to the cent)
                t.apply(m)
                continue
            opts = adv.advise(ask)["actions"]
            kind, detail, r = read(solve, t, hero, holes[hero], opts, own_sizes, not charts)
            seen[kind] += 1
            by[STAGES[min(t.raises(), 4)]][kind] += 1
            seats_seen[hero][kind] += 1
            if kind != "answered":
                why[(kind, detail[:110])] += 1
            if kind == "answered" and not charts:
                opts = [{"action": a["action"], "amount_bb": a["amount_bb"], "freq": f}
                        for a, f in zip(r["actions"], (r["grid"]["cells"][class_of(holes[hero])]["f"][r["grid"]["actions"].index(a["action"])] for a in r["actions"]))]
            freqs = [max(0.0, o["freq"]) for o in opts]
            pick = rnd.choice(opts) if policy == "uniform" else rnd.choices(opts, freqs if sum(freqs) else None)[0]
            pname, size = pick["action"].split()[0], pick.get("amount_bb")
            own = (own_sizes or not charts) and kind == "answered" and pname == "raise"
            if own:
                size = next((a["amount_bb"] for a in r["actions"] if a["action"] == "raise"), size)
            m = t.record(p, pname, size)
            if own and m["action"] == "raise":
                m["to"] = size
            t.apply(m)
            if pname == "fold":
                break
    return seen, why, by, seats_seen, seats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=2000)
    ap.add_argument("--stage", default="", help="a stage's name (default: every one)")
    ap.add_argument("--policy", default="chart")
    ap.add_argument("--seed", type=int, default=20261111)
    ap.add_argument("--own-sizes", action="store_true")
    ap.add_argument("--charts", action="store_true", help="the opponents and your options the charts', as before")
    a = ap.parse_args()
    total = collections.Counter()
    for stage in ST.STAGES:
        if a.stage and stage[0] != a.stage:
            continue
        for pol in a.policy.split(","):
            t0 = time.time()
            seen, why, by, seats_seen, seats = run(stage, pol, a.hands, a.seed, a.own_sizes, a.charts)
            n = sum(seen.values())
            total.update(seen)
            print(f"== {stage[0]} {pol}{' charts' if a.charts else ''}{' own-sizes' if a.own_sizes else ''}: {a.hands} hands, {n} decisions, "
                  f"answered {seen['answered'] / max(n, 1):.1%}, {time.time() - t0:.0f}s", flush=True)
            for pot in STAGES:
                c = by.get(pot)
                if c:
                    s = sum(c.values())
                    print(f"  {pot:16s} {s:6d} ({s / n:5.1%}) answered {c['answered'] / s:6.1%}  "
                          + " ".join(f"{k} {v / s:.1%}" for k, v in c.most_common() if k != "answered"))
            print("  by seat: " + ", ".join(f"{p} {seats_seen[p]['answered'] / max(sum(seats_seen[p].values()), 1):.0%}" for p in seats))
            for (k, d), v in why.most_common(6):
                print(f"    {v:6d} {k}: {d}")
    n = sum(total.values())
    if n:
        print(f"== all: {n} decisions, answered {total['answered'] / n:.1%}")


if __name__ == "__main__":
    main()
