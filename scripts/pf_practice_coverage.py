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
        [--players 2..6] [--stack 20..200]   (a game of engine/pf_solve.py's grid; 6 players at 100bb by default)
        [--chart-sizes]   (the grid's game at the charts' raise sizes, engine/pf_solve.py chart_sized: what Practice's
                           grade asks, at 2 to 6 players since 2026-11-17; at 6-max the 4x blind 3bet alone from 11-13)
        [--upstream]      (pf_study's stored grid, what ACCURACY sections 18 to 18.3 measured)
        [--upstream-flat] (a short-stack jam's flat alternative as upstream's, raises and all: before ACCURACY 18.11's fix)
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
import engine.pf_charts                  # noqa: E402,F401  (the charts as the worker serves them: repaired, 13-19bb moved)
from engine import pf_solve as LZ        # noqa: E402  (the solver every chip-game preflop request goes to since 11-11)

SEATS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
RANKS = "23456789TJQKA"
DECK = [r + s for r in RANKS for s in "shdc"]
STACK = 100.0
SIZE_EPS = 0.051                         # pf_study.Solve.walk's, and pfGrade.ts SIZE_EPS
CHIP_EPS = 0.011                         # pfGrade.ts CHIP_EPS
TOL, MIX, INACCURACY_PCT, MISTAKE_PCT = 0.011, 0.1, 2.0, 8.0     # web/src/grading/grade.ts
CLEAR_PCT = 20.0                         # grade.ts CLEAR_PCT: past the noise, a Blunder even where a grade is capped
UNTRAINED_SHARE, UNTRAINED_LOSS = 0.005, 0.5   # pfGrade.ts: a move the solve never plays, whose EV is untrained


def untrained(r):
    """pfGrade.ts untrainedMoves: the node's moves the solve plays under UNTRAINED_SHARE of the range where even the
    class with the best EV over folding loses UNTRAINED_LOSS or more by them against folding. Their EVs are untrained (a
    6-max 40bb HJ's 3-bet over a UTG open is -7.5bb for every class, AA's too), so Practice grades the node by the chart."""
    names = r["grid"]["actions"]
    fold = names.index("fold") if "fold" in names else -1

    def rel(ev, i):
        return ev[i] - (ev[fold] if fold >= 0 else 0.0)
    best, top = -math.inf, None
    for c in r["grid"]["cells"].values():
        ev = c.get("ev")
        if not ev or len(ev) != len(names) or any(not isinstance(x, (int, float)) for x in ev):
            continue
        m = max(rel(ev, i) for i in range(len(ev)))
        if m > best:
            best, top = m, ev
    if top is None:
        return []
    return [a["action"] for i, a in enumerate(r["actions"])
            if a["action"] != "fold" and i < len(names) and names[i] == a["action"]
            and isinstance(a.get("freq"), (int, float)) and a["freq"] < UNTRAINED_SHARE and rel(top, i) <= -UNTRAINED_LOSS]


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
    u = untrained(r)
    if u:
        return "untrained", "the solve never plays " + ", ".join(u), r
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


def noise(pot):
    """web/src/grading/grade.ts noiseOf for the preflop solve: its EV noise, bb, at a decision with this pot."""
    return pot * (4 + 2.75 * math.log(max(pot, 1.0))) / 100 if pot > 0 else 0.0


def verdict(evs, freqs, a, pot, capped=True, chart=None):
    """web/src/grading/grade.ts gradeAnswer with source "preflop-solve": within the noise Correct, past it only the
    excess (its thresholds on the pot's percent to 0.1, the frequencies to 0.1%, as grade.ts pct1 and freq1 round them).
    Short of a clear blunder no worse than Inaccuracy heads-up (grade.ts HEADS_UP_PF) or, with `chart` the charts'
    frequency of the move, where they play it 10% or more (grade.ts CHART_PARTS); `capped` off, neither (the verdict the
    caps stand in front of, which the run also counts)."""
    raw = max(0.0, max(evs) - evs[a])
    if raw <= TOL:
        return "Best", 0.0
    if round(freqs[a], 3) >= MIX or raw <= noise(pot):
        return "Correct", raw
    pct = round((raw - noise(pot)) / pot * 100, 1)
    v = "Inaccuracy" if pct < INACCURACY_PCT else "Mistake" if pct < MISTAKE_PCT else "Blunder"
    cap = len(SEATS) == 2 or (chart is not None and round(chart, 3) >= MIX)
    if capped and cap and v != "Inaccuracy" and pct < CLEAR_PCT:
        v = "Inaccuracy"
    return v, raw


def held_solve(rake, upstream, sizes=()):
    """The stored solve Practice's grade reads: Lizard's (engine/pf_solve.py, the worker's since 2026-11-11) or, with
    --upstream, pf_study's (what sections 18 to 18.3 measured). `sizes`: a Spec's sizes, for a stored game at other
    raise sizes, or "chart" for the game at the charts' raise sizes (pf_solve.chart_sized)."""
    r = (0.05, 3.0) if rake else None
    if upstream:
        return pf_study.held(pf_study.Spec(len(SEATS), STACK, 0.0, False, r))
    if sizes == "chart":
        return LZ.held(LZ.chart_sized(LZ.Spec(len(SEATS), (STACK,), rake=r)))
    return LZ.held(LZ.Spec(len(SEATS), (STACK,), rake=r, sizes=tuple(sizes)))


def run(policy, hands, seed, rake, own_sizes, upstream=False, sizes=()):
    rnd = random.Random(seed)
    adv = Advisor()
    extra = {"rake": 0.05, "rake_cap": 3} if rake else {}
    solve = held_solve(rake, upstream, sizes)
    if solve is None or not solve.stored:
        raise SystemExit("no stored solve")
    seen, why, by = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
    verdicts, uncapped, handsseen, loss, seats = collections.Counter(), collections.Counter(), collections.Counter(), [0.0, 0], collections.defaultdict(collections.Counter)
    nochart, follow, worst = collections.Counter(), collections.Counter(), collections.Counter()
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
                evs, sf, i = [cell["ev"][k] for k in order], [cell["f"][k] for k in order], opts.index(pick)
                # (the charts' frequency of your move: the options are the chart advice's, so its own; pfGrade.ts asOptions)
                v, raw = verdict(evs, sf, i, r["pot_bb"], chart=freqs[i])
                verdicts[v] += 1
                nochart[verdict(evs, sf, i, r["pot_bb"])[0]] += 1
                uncapped[verdict(evs, sf, i, r["pot_bb"], False)[0]] += 1
                # (the chart's most played move graded Mistake or worse: qa/checks.ts pf.follow, hard)
                if max(freqs) > 0 and freqs[i] == max(freqs):
                    follow[v] += 1
                    if v in ("Mistake", "Blunder"):
                        line = " ".join(f"{m['pos']} {m['action']}{' ' + format(m['to'], 'g') if m.get('to') else ''}"
                                        for m in t.line if m["action"] != "fold")
                        worst[(v, hero, line or "folded to", class_of(holes[hero]), names[i], round(freqs[i], 2),
                               round(raw, 2))] += 1
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
    return dict(policy=policy, hands=hands, seen=seen, why=why, by=by, verdicts=verdicts, nochart=nochart, uncapped=uncapped, follow=follow, worst=worst, loss=loss, handsseen=handsseen, seats=seats)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=30000)
    ap.add_argument("--policy", default="chart,uniform,solve")
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--rake", action="store_true", help="the 5% capped at 3bb game")
    ap.add_argument("--own-sizes", action="store_true")
    ap.add_argument("--players", type=int, default=6, help="2 to 6: a stored game of engine/pf_stored.py")
    ap.add_argument("--stack", type=float, default=100.0)
    ap.add_argument("--upstream", action="store_true", help="pf_study's stored solve (before 2026-11-11), not Lizard's")
    ap.add_argument("--chart-sizes", action="store_true", help="the stored game at the charts' raise sizes "
                    "(engine/pf_solve.py chart_sized), as Practice's grade asks it since 2026-11-17")
    ap.add_argument("--upstream-flat", action="store_true", help="a short-stack jam's flat alternative as upstream's "
                    "(engine/pf_charts.py _upstream_flat): the charts before ACCURACY 18.11's fix")
    a = ap.parse_args()
    if a.upstream_flat:
        import gto.advisor
        # (set for the whole run: an _upstream_flat() context left unreferenced is collected at once, restoring the fix)
        gto.advisor._flat_ev = engine.pf_charts._flat_ev
    global SEATS, STACK
    SEATS, STACK = list(TABLES[a.players]), a.stack
    for pol in a.policy.split(","):
        t0 = time.time()
        sizes = "chart" if a.chart_sizes else ()
        o = run(pol, a.hands, a.seed, a.rake, a.own_sizes, a.upstream, sizes)
        n = sum(o["seen"].values())
        print(f"== {a.players} players {a.stack:g}bb {pol}{' raked' if a.rake else ''}{' own-sizes' if a.own_sizes else ''}{' upstream' if a.upstream else ''}{' chart-sizes' if a.chart_sizes else ''}{' upstream-flat' if a.upstream_flat else ''}: {a.hands} hands, {n} decisions, {time.time() - t0:.0f}s", flush=True)
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
            if o["nochart"] != o["verdicts"]:
                print("  without the chart cap:", {k: f"{v / vn:.1%}" for k, v in o["nochart"].most_common()})
            if o["uncapped"] != o["verdicts"]:
                print("  without either cap:", {k: f"{v / vn:.1%}" for k, v in o["uncapped"].most_common()})
            fn = sum(o["follow"].values())
            if fn:
                bad = o["follow"]["Mistake"] + o["follow"]["Blunder"]
                print(f"  the chart's most played move: {fn} graded, {bad} Mistake or worse ({bad / fn:.2%}): " + ", ".join(f"{k} {v}" for k, v in o["follow"].most_common()))
                for (v, hero, line, cls, move, f, raw), c in o["worst"].most_common(8):
                    print(f"      {c:4d}x {v}: {hero} {cls} {move} (the chart's {f:.0%}) after {line}, {raw:.2f}bb lost")
        for (k, d), v in o["why"].most_common(14):
            print(f"    {v:6d} {k}: {d}")
        print(flush=True)


if __name__ == "__main__":
    main()
