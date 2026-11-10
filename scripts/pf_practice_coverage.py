#!/usr/bin/env python3
"""How much of Practice's preflop the stored preflop solve can grade, native.

Plays hands as Practice's table does: six seats dealt from one deck, your seat moving one place a hand from the button;
each opponent's move from Advisor.play (the charts), sized as web/src/poker/table.ts `recordOf` takes it (half a big
blind, a raise under the minimum lifted to it); your options the chart advice's. At each of your decisions it asks what
web/src/features/practice/pfGrade.ts `pfRead` asks of the solve's node, in the same order, and counts the answer. Your
move is then drawn by one of three policies:

  chart    from the chart's mix for your hand (someone playing the charts)
  uniform  any option the table offers, evenly (someone playing badly, which is who goes off the lines the solve plays)
  solve    from the solve's mix for your class where it answers, else the chart's (someone playing what it's graded on)

--own-sizes is the session option "Offer the solve's raise sizes" (pfGrade.ts `pfRead` with `ownSizes`): at a spot the solve
can grade whose options are its in kind, your raise is at the solve's own size, to the cent as the tree has it (17.25bb, not
the table's half big blind). Anywhere else your raise stays the chart's, and that decision the chart's.

    .venv/bin/python scripts/pf_practice_coverage.py --hands 30000 --policy chart,uniform,solve [--rake] [--own-sizes]
        [--players 2..6] [--stack 20..200]   (a game of engine/pf_stored.py's grid; 6 players at 100bb by default)
"""
import argparse
import collections
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "solver"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from gto.advisor import Advisor          # noqa: E402
from gto import pf_study                 # noqa: E402
from gto.preflop import SEATS as TABLES  # noqa: E402
import engine.pf_stored                  # noqa: E402,F401  (Lizard's stored games, as the worker has them)

SEATS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
RANKS = "23456789TJQKA"
DECK = [r + s for r in RANKS for s in "shdc"]
STACK = 100.0
SIZE_EPS = 0.051                         # pf_study.Solve.walk's, and pfGrade.ts SIZE_EPS
CHIP_EPS = 0.011                         # pfGrade.ts CHIP_EPS
TOL, MIX, INACCURACY_PCT, MISTAKE_PCT = 0.011, 0.1, 2.0, 8.0     # web/src/grading/grade.ts


def class_of(hole: str) -> str:
    a, b = hole[:2], hole[2:]
    if RANKS.index(a[0]) < RANKS.index(b[0]):
        a, b = b, a
    return a[0] + b[0] if a[0] == b[0] else a[0] + b[0] + ("s" if a[1] == b[1] else "o")


class Table:
    """The preflop of poker/table.ts, equal stacks and no ante."""

    def __init__(self):
        self.bets = {p: 0.0 for p in SEATS}
        self.bets["SB"], self.bets["BB"] = 0.5, 1.0
        self.cur, self.last = 1.0, 1.0
        self.active, self.allin, self.acted = list(SEATS), set(), set()
        self.at, self.line = 0, []

    def to_act(self):
        if len(self.active) <= 1:
            return None
        need = [p for p in self.active if p not in self.allin and (p not in self.acted or self.bets[p] < self.cur - 1e-9)]
        if not need or len([p for p in self.active if p not in self.allin]) == 0:
            return None
        for k in range(6):
            p = SEATS[(self.at + k) % len(SEATS)]
            if p in need:
                return p
        return None

    def record(self, p, action, to=None):
        facing = self.cur - self.bets[p] > 1e-9
        behind = STACK - self.bets[p]
        can_raise = any(q != p and q not in self.allin for q in self.active)
        passive = {"pos": p, "action": "call" if facing else "check"}
        if action == "fold":
            return {"pos": p, "action": "fold"}
        if action in ("check", "call"):
            return passive
        if action == "all-in":
            return {"pos": p, "action": "all-in"} if behind <= self.cur - self.bets[p] + 1e-9 or can_raise else passive
        size = math.floor((to or 0) * 2 + 0.5) / 2
        if not can_raise:
            return passive
        size = max(size, self.cur + self.last) if size < STACK - 1e-9 else size
        return {"pos": p, "action": "all-in"} if size >= STACK - 1e-9 else {"pos": p, "action": "raise", "to": size}

    def apply(self, m):
        p, a = m["pos"], m["action"]
        self.line.append(m)
        self.acted.add(p)
        self.at = (SEATS.index(p) + 1) % len(SEATS)
        if a == "fold":
            self.active.remove(p)
        elif a == "call":
            self.bets[p] = self.cur
        elif a in ("raise", "all-in"):
            to = STACK if a == "all-in" else m["to"]
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

    def raises(self):
        return sum(1 for m in self.line if m["action"] in ("raise", "all-in"))


def request(t, rake):
    return dict(players=len(SEATS), stack=STACK, board="", preflop=[dict(m) for m in t.line], flop=[], turn=[], river=[], **rake)


def read(solve, t, hero, hole, opts, own_sizes):
    """pfGrade.ts pfRead: (what the solve says: "answered" or why not, the detail, the node)."""
    r = solve.node([dict(m) for m in t.line])
    if r.get("error"):
        return "off-tree", r["error"], None
    if r.get("study") != "node":
        return "past-end", str(r.get("study")), None
    if r.get("actor") != hero:
        return "off-tree", "actor", None
    if any("played as the solve's size" in n for n in r["notes"]):
        return "line-size", r["notes"][0], r
    if abs(r["pot_bb"] - t.pot) > CHIP_EPS or abs(r["to_call_bb"] - (t.cur - t.bets[hero])) > CHIP_EPS:
        return "line-size", "chips differ (an all-in the tree plays as a raise)", r
    if r["rough"]:
        return "rough", "; ".join(n for n in r["notes"] if "never" in n)[:60], r
    cell = r["grid"]["cells"].get(class_of(hole))
    if cell is None:
        return "class-gone", "", r
    sol = [(a["action"], a["amount_bb"]) for a in r["actions"]]
    table = []
    for o in opts:
        m = t.record(hero, o["action"].split()[0], o.get("amount_bb"))
        table.append((m["action"], m.get("to")))

    def same(a, b):
        return a[0] == b[0] and (a[0] != "raise" or abs(a[1] - b[1]) <= SIZE_EPS)
    def kinds(xs):
        return sorted(x[0] for x in xs)
    if own_sizes and kinds(table) == kinds(sol):
        return "answered", "", r
    if len(table) != len(sol) or not all(any(same(a, b) for b in sol) for a in table):
        return ("own-size" if kinds(table) == kinds(sol) else "options"), f"{table} vs {sol}", r
    return "answered", "", r


def verdict(evs, freqs, a, pot):
    raw = max(0.0, max(evs) - evs[a])
    pct = raw / pot * 100
    if raw <= TOL:
        return "Best", 0.0
    if freqs[a] >= MIX:
        return "Correct", raw
    return ("Inaccuracy" if pct < INACCURACY_PCT else "Mistake" if pct < MISTAKE_PCT else "Blunder"), raw


def run(policy, hands, seed, rake, own_sizes):
    rnd = random.Random(seed)
    adv = Advisor()
    extra = {"rake": 0.05, "rake_cap": 3} if rake else {}
    solve = pf_study.held(pf_study.Spec(len(SEATS), STACK, 0.0, False, (0.05, 3.0) if rake else None))
    if solve is None or not solve.stored:
        raise SystemExit("no stored solve")
    seen, why, by = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
    verdicts, handsseen, loss, seats = collections.Counter(), collections.Counter(), [0.0, 0], collections.defaultdict(collections.Counter)
    for h in range(hands):
        deck = DECK[:]
        rnd.shuffle(deck)
        holes = {p: deck[2 * i] + deck[2 * i + 1] for i, p in enumerate(SEATS)}
        hero = SEATS[(3 - h) % len(SEATS)]
        t = Table()
        kinds_here = set()
        while True:
            p = t.to_act()
            if p is None:
                break
            if p != hero:
                mv = adv.play(dict(request(t, extra), hero=hero, hole=holes[hero]), p, holes[p], rnd.randrange(1 << 30))
                t.apply(t.record(p, mv["action"], mv.get("to")))
                continue
            opts = adv.advise(dict(request(t, extra), hero=hero, hole=holes[hero]))["actions"]
            kind, detail, r = read(solve, t, hero, holes[hero], opts, own_sizes)
            pot = ["first in", "facing an open", "facing a 3-bet", "facing a 4-bet", "facing a 5-bet+"][min(t.raises(), 4)]
            seen[kind] += 1
            by[pot][kind] += 1
            seats[hero][kind] += 1
            kinds_here.add(kind)
            if kind != "answered":
                why[(kind, detail[:110])] += 1
            freqs = [max(0.0, o["freq"]) for o in opts]
            pick = None
            cell = r["grid"]["cells"].get(class_of(holes[hero])) if r and kind == "answered" else None
            if policy == "uniform":
                pick = rnd.choice(opts)
            elif policy == "solve" and cell:
                name = rnd.choices(r["grid"]["actions"], cell["f"])[0]
                pick = next((o for o in opts if o["action"].split()[0] == name), None)
            pick = pick or rnd.choices(opts, freqs if sum(freqs) else None)[0]
            if cell:
                names = [o["action"].split()[0] for o in opts]
                order = [r["grid"]["actions"].index(n) for n in names]
                v, raw = verdict([cell["ev"][k] for k in order], [cell["f"][k] for k in order], opts.index(pick), r["pot_bb"])
                verdicts[v] += 1
                loss[0] += raw
                loss[1] += 1
            name = pick["action"].split()[0]
            size = pick.get("amount_bb")
            own = own_sizes and kind == "answered" and name == "raise"
            if own:
                size = next(a["amount_bb"] for a in r["actions"] if a["action"] == "raise")
            m = t.record(p, name, size)
            if own and m["action"] == "raise":
                m["to"] = size                   # (practice.ts moveOfOption `exact`: the solve's, not the half big blind)
            t.apply(m)
            if name == "fold":
                break
        handsseen["hands"] += 1
        if kinds_here:
            handsseen["with a decision"] += 1
            if kinds_here != {"answered"}:
                handsseen["a decision the solve can't grade"] += 1
    return dict(policy=policy, hands=hands, seen=seen, why=why, by=by, verdicts=verdicts, loss=loss, handsseen=handsseen, seats=seats)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=30000)
    ap.add_argument("--policy", default="chart,uniform,solve")
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--rake", action="store_true", help="the 5% capped at 3bb game")
    ap.add_argument("--own-sizes", action="store_true")
    ap.add_argument("--players", type=int, default=6, help="2 to 6: a stored game of engine/pf_stored.py")
    ap.add_argument("--stack", type=float, default=100.0)
    a = ap.parse_args()
    global SEATS, STACK
    SEATS, STACK = list(TABLES[a.players]), a.stack
    for pol in a.policy.split(","):
        t0 = time.time()
        o = run(pol, a.hands, a.seed, a.rake, a.own_sizes)
        n = sum(o["seen"].values())
        print(f"== {a.players} players {a.stack:g}bb {pol}{' raked' if a.rake else ''}{' own-sizes' if a.own_sizes else ''}: {a.hands} hands, {n} decisions, {time.time() - t0:.0f}s", flush=True)
        for k, v in o["seen"].most_common():
            print(f"  {k:12s} {v:7d} {v / n:6.1%}")
        for pot in ("first in", "facing an open", "facing a 3-bet", "facing a 4-bet", "facing a 5-bet+"):
            c = o["by"].get(pot)
            if c:
                s = sum(c.values())
                print(f"  {pot:16s} {s:6d} ({s / n:5.1%}) answered {c['answered'] / s:6.1%}  " + " ".join(f"{k} {v / s:.1%}" for k, v in c.most_common() if k != "answered"))
        for seat in SEATS:
            c = o["seats"].get(seat)
            if c:
                print(f"  {seat:4s} {sum(c.values()):6d} answered {c['answered'] / sum(c.values()):6.1%}")
        print("  hands:", dict(o["handsseen"]))
        vn = sum(o["verdicts"].values())
        if vn:
            print("  verdicts by the solve:", {k: f"{v / vn:.1%}" for k, v in o["verdicts"].most_common()}, f"EV lost per decision {o['loss'][0] / max(o['loss'][1], 1):.4f}bb")
        for (k, d), v in o["why"].most_common(14):
            print(f"    {v:6d} {k}: {d}")
        print(flush=True)


if __name__ == "__main__":
    main()
