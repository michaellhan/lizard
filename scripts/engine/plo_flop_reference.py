"""An independent solve of small heads-up PLO4 flops, every turn and river card after them included, to check
web/src/engine/plo/flop/ (and the rake and card samples of the river, turn and flop solvers) against. It shares no
code with that solver, and it does each hard part the other way round:

  - a hand's strength on each river is plo_reference.best_plo: all 60 ways, spelled out;
  - blockers are tensors: every pair of hands asked whether they share a card, and for each turn and river card
    whether either holds it (the TypeScript maps each card's combos back to the street before and counts blockers by
    inclusion and exclusion);
  - the turn cards are one axis of dense tensors and each turn's river cards a second, solved side by side (the
    TypeScript solves each card's game on its own);
  - the chance weights are folded into the payoff tensors, a matchup at a time (the TypeScript scales each side's
    vectors on the way in and out);
  - rake is in the payoffs: two payoff tensors per terminal node, one for each seat, as the game isn't zero-sum;
  - all three betting trees are worked out here in whole cents from the rules (plo_river_reference.build_tree);
  - the algorithm is CFR+, regrets floored at zero and a linear average (the TypeScript's is discounted CFR).

    .venv/bin/python scripts/engine/plo_flop_reference.py    # a few minutes: writes web/src/engine/plo/vectors/flop.json

Chance. In the full game a matchup that can be dealt sees 41 turn cards and then 40 river cards, each as likely. With
a sample of K cards (picked as web/src/engine/plo/sample.ts says: the candidates by suit, each suit high to low, every
(N/K)th), a matchup of hands holding a and b of the sampled cards sees K - a - b of them; the solver's weight on each
is M / ((K - a - B)(K - b - A)), A and B the ranges' average a and b, M = K - A - B (exact where a = A or b = B). This
file solves that same game, and can also solve the exactly normalised one, 1 / (K - a - b), to measure the difference.

Values are chips: each seat is credited half the flop's pot at the start (a later street's values, credited half its
own pot, are the same numbers). Rake: pct of the pot as the hand ends, up to cap, paid by the winner, split in a tie.
Exploitability is the average of the two seats' best-response gains, each seat's value at the strategies measured on
its own.

Run its own checks with: .venv/bin/python -m unittest scripts/engine/test_plo_flop_reference.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_reference import DECK, OUT, best_plo, parse, show  # noqa: E402
from plo_river_reference import build_tree, read_range  # noqa: E402

np.seterr(divide="ignore", over="ignore", invalid="ignore")

SUITS = "shdc"
TURNS_PER_MATCHUP = 52 - 3 - 8
RIVERS_PER_MATCHUP = 52 - 4 - 8


def pick(candidates, k):
    """k of the candidates, spread by rank and suit; all of them when k is None or covers them. Down the candidates from
    the highest rank (suits c, d, h, s within a rank), every (n / k)th position names a rank; of that rank's cards left
    (or the nearest rank's), the one of the suit furthest behind its share of the candidates, a tie to the higher card."""
    n = len(candidates)
    if k is None or k >= n:
        return list(candidates)
    order = SUITS  # the solver's suit numbers, 0 to 3: a higher number is a higher card within a rank
    by_rank = sorted(candidates, key=lambda c: (-c[0], -order.index(c[1])))
    share = {s: sum(1 for c in candidates if c[1] == s) for s in order}
    taken = dict.fromkeys(order, 0)
    out = []
    for i in range(k):
        rank = by_rank[math.floor((i + 0.5) * n / k)][0]
        left = [c for c in candidates if c not in out]
        off = min(abs(c[0] - rank) for c in left)
        options = [c for c in left if abs(c[0] - rank) == off]
        card = min(options, key=lambda c: (taken[c[1]] / share[c[1]], -c[0], -order.index(c[1])))
        out.append(card)
        taken[card[1]] += 1
    return sorted(out, key=lambda c: candidates.index(c))


def rake_on(rake, pot):
    if not rake or rake["pct"] <= 0:
        return 0.0
    return min(rake["pct"] / 100 * pot, rake.get("cap", float("inf")))


def chance(hands, weights, live, cards, full, exact):
    """The weight of each matchup (n, m) on each of `cards`, for the hands still live (bool per seat) at this street.
    `full`: the cards a matchup sees on the whole deck (the weight is 1 / full when nothing is sampled)."""
    if cards is None:
        return None
    K = len(cards)
    s = set(cards)
    held = [np.array([len(s & set(h)) for h in hands[seat]], dtype=float) for seat in (0, 1)]
    if exact:
        return 1 / (K - held[0][:, None] - held[1][None, :])
    avg = [float((held[seat] * weights[seat] * live[seat]).sum() / (weights[seat] * live[seat]).sum()) for seat in (0, 1)]
    M = K - avg[0] - avg[1]
    return M / np.outer(K - held[0] - avg[1], K - held[1] - avg[0])


class FlopGame:
    def __init__(self, spot, exact=False):
        self.spot = spot
        board = parse(spot["board"])
        assert len(board) == 3
        hands, weights = [], []
        for seat in ("oop", "ip"):
            h, w = read_range(spot[seat])
            hands.append(h)
            weights.append(w)
        compat = np.array([[not set(x) & set(y) for y in hands[1]] for x in hands[0]], dtype=float)
        keep = [compat.sum(axis=1) > 0, compat.sum(axis=0) > 0]
        self.hands = [[h for h, k in zip(hands[s], keep[s]) if k] for s in (0, 1)]
        self.weights = [weights[s][keep[s]] for s in (0, 1)]
        self.compat = compat[keep[0]][:, keep[1]]
        a, b = self.hands
        n, m = len(a), len(b)
        rake = spot.get("rake")
        self.rake = rake

        # the turn cards (sampled or all), and each one's river cards
        off = [c for c in DECK if c not in board]
        self.turn_sampled = spot.get("turnSample") is not None and spot["turnSample"] < len(off)
        self.turns = pick(off, spot.get("turnSample"))
        self.rivers = [pick([c for c in off if c != t], spot.get("riverSample")) for t in self.turns]
        self.river_sampled = spot.get("riverSample") is not None and spot["riverSample"] < len(off) - 1
        T, R = len(self.turns), len(self.rivers[0])
        hold_t = [np.array([[t in h for t in self.turns] for h in self.hands[s]], dtype=float) for s in (0, 1)]  # (n, T)
        hold_r = [np.array([[[r in h for r in self.rivers[k]] for k in range(T)] for h in self.hands[s]], dtype=float) for s in (0, 1)]  # (n, T, R)
        self.compat_t = self.compat[None] * (1 - hold_t[0].T)[:, :, None] * (1 - hold_t[1].T)[:, None, :]  # (T, n, m)
        self.compat_tr = self.compat_t[:, None] * (1 - hold_r[0].transpose(1, 2, 0))[:, :, :, None] * (1 - hold_r[1].transpose(1, 2, 0))[:, :, None, :]  # (T, R, n, m)
        wins = np.zeros((T, R, n, m))
        for k, t in enumerate(self.turns):
            for q, r in enumerate(self.rivers[k]):
                five = board + [t, r]
                ra = [best_plo(h, five) if t not in h and r not in h else None for h in a]
                rb = [best_plo(h, five) if t not in h and r not in h else None for h in b]
                for i, x in enumerate(ra):
                    for j, y in enumerate(rb):
                        if x is not None and y is not None:
                            wins[k, q, i, j] = (x > y) - (x < y)
        self.wins = wins * self.compat_tr

        # chance weights by matchup: the turn's (T, n, m), each turn's rivers' (T, n, m)
        live = [np.ones(n, bool), np.ones(m, bool)]
        wt = chance(self.hands, self.weights, live, self.turns, TURNS_PER_MATCHUP, exact) if self.turn_sampled else None
        self.w_turn = self.compat_t * (wt[None] if wt is not None else 1 / TURNS_PER_MATCHUP)
        w_river = np.zeros((T, n, m))
        for k, t in enumerate(self.turns):
            # the turn's live hands: off the turn card, and meeting an opposing hand there
            ok = self.compat_t[k]
            lv = [(ok.sum(axis=1) > 0), (ok.sum(axis=0) > 0)]
            if self.river_sampled:
                w_river[k] = chance(self.hands, self.weights, lv, self.rivers[k], RIVERS_PER_MATCHUP, exact)
            else:
                w_river[k] = 1 / RIVERS_PER_MATCHUP
        self.w_tr = self.w_turn[:, None] * w_river[:, None] * self.compat_tr  # (T, R, n, m)
        if not self.turn_sampled:
            assert np.allclose(self.compat_t.sum(axis=0), TURNS_PER_MATCHUP * self.compat)
        if not self.turn_sampled and not self.river_sampled:
            assert np.allclose(self.w_tr.sum(axis=(0, 1)), self.compat)

        pot = round(spot["pot"] * 100)
        self.pot = pot / 100
        stack = round(spot["stack"] * 100)
        fs, ts, rs = spot["flopSizes"], spot["turnSizes"], spot["riverSizes"]
        tree = lambda p, st, s: build_tree(p, st, s["bets"], s["raises"], s["raiseCap"], s["allIn"])  # noqa: E731
        self.flop = tree(pot, stack, fs)
        # by flop closing: the turn's (pot, stack, tree); by (flop closing, turn closing): the river's
        self.turn = {}
        self.river = {}
        for i, nd in enumerate(self.flop):
            if nd["kind"] != "showdown" or stack - nd["bets"][0] <= 0:
                continue
            tp, tst = pot + 2 * nd["bets"][0], stack - nd["bets"][0]
            self.turn[i] = (tp, tst, tree(tp, tst, ts))
            for j, nt in enumerate(self.turn[i][2]):
                if nt["kind"] == "showdown" and tst - nt["bets"][0] > 0:
                    rp, rst = tp + 2 * nt["bets"][0], tst - nt["bets"][0]
                    self.river[(i, j)] = (rp, rst, tree(rp, rst, rs))
        self.matchups = float(self.weights[0] @ self.compat @ self.weights[1])
        if not self.matchups > 0:
            raise ValueError(f"{spot['name']}: no matchup can be dealt")

    def n(self, seat):
        return len(self.hands[seat])

    def root_value(self, hero, values):
        return float(self.weights[hero] @ values) / self.matchups

    # ---- payoffs: (seat 0's, seat 1's), each a tensor over the street's card axes and (n, m)

    def fold_payoffs(self, pot_cents, node, w):
        val = pot_cents / 200 + node["bets"][node["folded"]] / 100
        r = rake_on(self.rake, (pot_cents + node["bets"][0] + node["bets"][1]) / 100)
        f = node["folded"]
        return ((val - r if f == 1 else -val) * w, (val - r if f == 0 else -val) * w)

    def showdown_payoffs(self, pot_cents, bet, wins, w):
        val = pot_cents / 200 + bet / 100
        r = rake_on(self.rake, (pot_cents + 2 * bet) / 100)
        win, lose = wins > 0, wins < 0
        p0 = np.where(win, val - r, np.where(lose, -val, -r / 2)) * w
        p1 = np.where(lose, val - r, np.where(win, -val, -r / 2)) * w
        return p0, p1


def value_of(payoffs, hero, reach):
    """Hero's values: payoffs (P0, P1) over (..., n, m); reach over (..., other)."""
    if hero == 0:
        return np.einsum("...nm,...m->...n", payoffs[0], reach)
    return np.einsum("...nm,...n->...m", payoffs[1], reach)


def regret_match(regret, axis):
    positive = np.maximum(regret, 0)
    total = positive.sum(axis=axis, keepdims=True)
    return np.where(total > 0, positive / np.where(total > 0, total, 1), 1 / regret.shape[axis])


def normalise(s, axis):
    total = s.sum(axis=axis, keepdims=True)
    return np.where(total > 0, s / np.where(total > 0, total, 1), 1 / s.shape[axis])


class Strategy:
    """Tables by node: the flop's (A, n); by flop closing, the turn's (T, A, n); by (flop, turn) closing, the river's
    (T, R, A, n)."""

    def __init__(self, game, fill=0.0):
        T, R = len(game.turns), len(game.rivers[0])
        act = lambda tree: [(i, nd) for i, nd in enumerate(tree) if nd["kind"] == "action"]  # noqa: E731
        self.flop = {i: np.full((len(nd["tokens"]), game.n(nd["player"])), fill) for i, nd in act(game.flop)}
        self.turn = {c: {i: np.full((T, len(nd["tokens"]), game.n(nd["player"])), fill) for i, nd in act(t[2])} for c, t in game.turn.items()}
        self.river = {c: {i: np.full((T, R, len(nd["tokens"]), game.n(nd["player"])), fill) for i, nd in act(t[2])} for c, t in game.river.items()}

    def map(self, f):
        out = Strategy.__new__(Strategy)
        out.flop = {i: f(s, 0) for i, s in self.flop.items()}
        out.turn = {c: {i: f(s, 1) for i, s in t.items()} for c, t in self.turn.items()}
        out.river = {c: {i: f(s, 2) for i, s in t.items()} for c, t in self.river.items()}
        return out


class Walker:
    """One pass of one seat: "solve" (CFR+ on regret and average), "best" (a best response to strategy) or "average"."""

    def __init__(self, game, hero, how, strategy=None, regret=None, average=None, t=0):
        self.g, self.hero, self.how, self.s, self.reg, self.avg, self.t = game, hero, how, strategy, regret, average, t

    def node(self, nd, table_s, table_r, table_a, key, axis, reach, children):
        """A decision anywhere: `axis` is where the actions sit in the tables (0 flop, 1 turn, 2 river)."""
        how, hero = self.how, self.hero
        sigma = regret_match(table_r[key], axis) if how == "solve" else table_s[key]
        if nd["player"] == hero:
            values = np.stack([child(reach) for child in children], axis=axis)
            if how == "best":
                return values.max(axis=axis)
            here = (sigma * values).sum(axis=axis)
            if how == "solve":
                table_r[key] = np.maximum(table_r[key] + values - np.expand_dims(here, axis), 0)
            return here
        if how == "solve":
            table_a[key] += self.t * sigma * np.expand_dims(reach, axis)
        return sum(child(reach * np.take(sigma, k, axis=axis)) for k, child in enumerate(children))

    def flop(self, i, reach):
        g = self.g
        nd = g.flop[i]
        pot = round(g.spot["pot"] * 100)
        if nd["kind"] == "fold":
            return value_of(g.fold_payoffs(pot, nd, g.compat), self.hero, reach)
        if nd["kind"] == "showdown":
            T, R = g.w_tr.shape[:2]
            if i not in g.turn:  # all-in: every turn and river is a showdown
                p = g.showdown_payoffs(pot, nd["bets"][0], g.wins, g.w_tr)
                return value_of((p[0].sum(axis=(0, 1)), p[1].sum(axis=(0, 1))), self.hero, reach)
            out = self.turn_(i, 0, np.broadcast_to(reach, (T,) + reach.shape))
            return out.sum(axis=0)
        s = self.s.flop if self.s else None
        return self.node(nd, s, self.reg.flop if self.reg else None, self.avg.flop if self.avg else None, i, 0, reach, [lambda r, c=c: self.flop(c, r) for c in nd["children"]])

    def turn_(self, fc, i, reach):
        g = self.g
        tp, _tst, tree = g.turn[fc]
        nd = tree[i]
        if nd["kind"] == "fold":
            return value_of(g.fold_payoffs(tp, nd, g.w_turn), self.hero, reach)
        if nd["kind"] == "showdown":
            R = g.w_tr.shape[1]
            if (fc, i) not in g.river:
                p = g.showdown_payoffs(tp, nd["bets"][0], g.wins, g.w_tr)
                return value_of((p[0].sum(axis=1), p[1].sum(axis=1)), self.hero, reach)
            out = self.river_(fc, i, 0, np.broadcast_to(reach[:, None, :], (reach.shape[0], R, reach.shape[1])))
            return out.sum(axis=1)
        pick_ = lambda tbl: tbl[fc] if tbl else None  # noqa: E731
        return self.node(nd, pick_(self.s.turn if self.s else None), pick_(self.reg.turn if self.reg else None), pick_(self.avg.turn if self.avg else None), i, 1, reach, [lambda r, c=c: self.turn_(fc, c, r) for c in nd["children"]])

    def river_(self, fc, tc, i, reach):
        g = self.g
        rp, _rst, tree = g.river[(fc, tc)]
        nd = tree[i]
        if nd["kind"] == "fold":
            return value_of(g.fold_payoffs(rp, nd, g.w_tr), self.hero, reach)
        if nd["kind"] == "showdown":
            return value_of(g.showdown_payoffs(rp, nd["bets"][0], g.wins, g.w_tr), self.hero, reach)
        key = (fc, tc)
        pick_ = lambda tbl: tbl[key] if tbl else None  # noqa: E731
        return self.node(nd, pick_(self.s.river if self.s else None), pick_(self.reg.river if self.reg else None), pick_(self.avg.river if self.avg else None), i, 2, reach, [lambda r, c=c: self.river_(fc, tc, c, r) for c in nd["children"]])


def averaged(average):
    return average.map(lambda s, axis: normalise(s, axis if axis == 0 else axis))


def measure(game, strategy):
    root = lambda hero, how: game.root_value(hero, Walker(game, hero, how, strategy).flop(0, game.weights[1 - hero]))  # noqa: E731
    best = [root(0, "best"), root(1, "best")]
    values = [root(0, "average"), root(1, "average")]
    gain = [best[0] - values[0], best[1] - values[1]]
    chips = (gain[0] + gain[1]) / 2
    return {"best": best, "value": values[0], "values": values, "chips": chips, "pct": 100 * chips / game.pot, "lower": -best[1], "upper": best[0]}


def solve_cfr_plus(game, target_pct=1e-3, max_iterations=20_000, every=25):
    regret = Strategy(game)
    average = Strategy(game)
    t = 0
    pct = float("inf")
    while t < max_iterations and pct > target_pct:
        for _ in range(every):
            t += 1
            Walker(game, 0, "solve", None, regret, average, t).flop(0, game.weights[1])
            Walker(game, 1, "solve", None, regret, average, t).flop(0, game.weights[0])
        pct = measure(game, averaged(average))["pct"]
    return averaged(average), t


def rounded(strategy, digits=7):
    def r(s, axis):
        x = np.round(s, digits)
        return x / x.sum(axis=axis, keepdims=True)

    return strategy.map(r)


def tree_json(nodes):
    return [
        {
            "path": nd["path"],
            "kind": nd["kind"],
            "bets": [b / 100 for b in nd["bets"]],
            **({"player": nd["player"], "tokens": nd["tokens"]} if nd["kind"] == "action" else {}),
            **({"folded": nd["folded"]} if nd["kind"] == "fold" else {}),
        }
        for nd in nodes
    ]


def weight_error(game):
    """How far each matchup's turn weights add from 1, over the matchups as they're dealt: (max, mean)."""
    total = game.w_turn.sum(axis=0)
    dev = np.abs(total - 1) * game.compat
    w = np.outer(game.weights[0], game.weights[1]) * game.compat
    return float(dev.max()), float((dev * w).sum() / w.sum())


def fixture(spot, target_pct=1e-3):
    game = FlopGame(spot)
    strategy, iterations = solve_cfr_plus(game, target_pct)
    stored = rounded(strategy)
    m = measure(game, stored)
    num = lambda rows: [[float(f"{p:.8g}") for p in row] for row in rows]  # noqa: E731
    card = lambda c: show([c])  # noqa: E731
    out = {
        **spot,
        "hands": [[show(h) for h in game.hands[0]], [show(h) for h in game.hands[1]]],
        # the cards some matchup can be dealt with (the solver leaves out a card on which none can)
        "turnCards": [card(t) for k, t in enumerate(game.turns) if game.compat_t[k].any()],
        "riverCards": {card(t): [card(r) for q, r in enumerate(game.rivers[k]) if game.compat_tr[k, q].any()] for k, t in enumerate(game.turns) if game.compat_t[k].any()},
        "tree": tree_json(game.flop),
        "turnTrees": {game.flop[c]["path"]: tree_json(t[2]) for c, t in game.turn.items()},
        "riverTrees": {f"{game.flop[c]['path']}|{game.turn[c][2][j]['path']}": tree_json(t[2]) for (c, j), t in game.river.items()},
        "matchups": game.matchups,
        "iterations": iterations,
        "value": m["value"],
        "values": m["values"],
        "lower": m["lower"],
        "upper": m["upper"],
        "best": m["best"],
        "exploitabilityPct": m["pct"],
        # (a node with one action, a check down, is left out: its strategy is that action)
        "strategy": {game.flop[i]["path"]: num(s.tolist()) for i, s in stored.flop.items() if s.shape[0] > 1},
        # by flop closing path, turn card, turn node path
        "turnStrategy": {game.flop[c]["path"]: {card(t): {game.turn[c][2][i]["path"]: num(s[k].tolist()) for i, s in tbl.items() if s.shape[1] > 1} for k, t in enumerate(game.turns)} for c, tbl in stored.turn.items()},
        # by "flop closing|turn closing", turn card, river card, river node path
        "riverStrategy": {
            f"{game.flop[c]['path']}|{game.turn[c][2][j]['path']}": {
                card(t): {card(r): {game.river[(c, j)][2][i]["path"]: num(s[k, q].tolist()) for i, s in tbl.items() if s.shape[2] > 1} for q, r in enumerate(game.rivers[k])} for k, t in enumerate(game.turns)
            }
            for (c, j), tbl in stored.river.items()
            if any(s.shape[2] > 1 for s in tbl.values())
        },
    }
    if game.turn_sampled:
        out["turnWeightError"] = dict(zip(("max", "mean"), weight_error(game)))
    return out


# ---- the spots

NONE = {"bets": [], "raises": [], "raiseCap": 0, "allIn": False}
POT = {"bets": [100], "raises": [], "raiseCap": 0, "allIn": False}


def spots():
    return [
        # every turn and river: a pot-sized bet on the flop and on the turn, the river checked down
        {"name": "one bet a street, every card", "board": "Js9s4d", "oop": "AhAdKhKd,6s5s3h2h", "ip": "Tc9c8h7h,QsQhJcTd", "pot": 10, "stack": 40, "flopSizes": POT, "turnSizes": POT, "riverSizes": NONE},
        # raked, with an all-in raise on the flop: rake comes off folds, flop all-ins over every turn and river, and
        # showdowns
        {
            "name": "rake and a flop all-in",
            "board": "Kh8d3c",
            "oop": "AsKsQdJd,8s8c5h4h",
            "ip": "KdKc7h6h,AhQhJhTs",
            "pot": 10,
            "stack": 25,
            "flopSizes": {"bets": [75], "raises": [100], "raiseCap": 1, "allIn": True},
            "turnSizes": POT,
            "riverSizes": NONE,
            "rake": {"pct": 5, "cap": 1},
        },
        # a sample of 9 turn cards and 9 rivers after each, a bet on every street, raked
        {
            "name": "sampled turns and rivers, raked",
            "board": "Ts7h2h",
            "oop": "AhKhQdJd,7s7c6d5d,TcTd9s8s",
            "ip": "JhTh9c8c,AsAdQcQs",
            "pot": 12,
            "stack": 50,
            "flopSizes": POT,
            "turnSizes": {"bets": [75], "raises": [], "raiseCap": 0, "allIn": False},
            "riverSizes": POT,
            "rake": {"pct": 5, "cap": 2},
            "turnSample": 9,
            "riverSample": 9,
        },
    ]


def main():
    out = []
    for spot in spots():
        f = fixture(spot)
        print(f"{f['name']}: {len(f['hands'][0])}x{len(f['hands'][1])}, {len(f['turnCards'])} turns, {f['iterations']} iterations, values {f['values'][0]:.6f} {f['values'][1]:.6f}, {f['exploitabilityPct']:.5f}% of the pot")
        out.append(f)
    OUT.mkdir(exist_ok=True)
    path = OUT / "flop.json"
    path.write_text(json.dumps({"spots": out}, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size / 1000:.0f} KB)")


if __name__ == "__main__":
    main()
