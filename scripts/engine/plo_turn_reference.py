"""An independent solve of small heads-up PLO4 turns, every river card after them included, to check
web/src/engine/plo/turn/ against. It shares no code with that solver, and it does each hard part the other way round:

  - a hand's strength on each river is plo_reference.best_plo: all 60 ways, spelled out;
  - blockers are matrices: every pair of hands asked whether they share a card, and for each river card whether
    either holds it (the TypeScript maps each river's combos back to the turn's and counts blockers by inclusion and
    exclusion);
  - the 48 river cards are one axis of dense tensors, solved side by side (the TypeScript solves each card's river
    game on its own);
  - both betting trees are worked out here in whole cents from the rules (plo_river_reference.build_tree);
  - the algorithm is CFR+, regrets floored at zero and a linear average (the TypeScript's is discounted CFR).

    .venv/bin/python scripts/engine/plo_turn_reference.py    # about a minute: writes web/src/engine/plo/vectors/turn.json

A matchup that can be dealt sees 40 river cards, each as likely, so a river card's values count 1/40 at the turn. A
turn closing all-in is a showdown on every river card. Values are chips in the zero-sum form: each seat is credited
half the turn's pot at the start (a river's values, credited half the river's pot, are the same numbers). No rake.

Each spot's fixture has the game value bracketed by exact best responses, through every river, and this solve's whole
strategy, rounded, with those best responses taken on the rounded numbers, so the TypeScript's best response can be
held to them on someone else's strategy.

Run its own checks with: .venv/bin/python -m unittest scripts/engine/test_plo_turn_reference.py
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_reference import DECK, OUT, Mulberry32, best_plo, parse, show  # noqa: E402
from plo_river_reference import build_tree, random_range, read_range  # noqa: E402

np.seterr(divide="ignore", over="ignore", invalid="ignore")

RIVERS_PER_MATCHUP = 52 - 4 - 8


class TurnGame:
    def __init__(self, spot):
        self.spot = spot
        board = parse(spot["board"])
        assert len(board) == 4
        hands, weights = [], []
        for seat in ("oop", "ip"):
            h, w = read_range(spot[seat])
            hands.append(h)
            weights.append(w)
        # every pair asked whether it shares a card; a hand that meets no opposing hand is dropped, as it's never dealt
        compat = np.array([[not set(x) & set(y) for y in hands[1]] for x in hands[0]], dtype=float)
        keep = [compat.sum(axis=1) > 0, compat.sum(axis=0) > 0]
        self.hands = [[h for h, k in zip(hands[s], keep[s]) if k] for s in (0, 1)]
        self.weights = [weights[s][keep[s]] for s in (0, 1)]
        self.compat = compat[keep[0]][:, keep[1]]
        a, b = self.hands
        # the river cards, every one off the board; per card, which pairs can still be dealt and who wins
        self.cards = [c for c in DECK if c not in board]
        holds = [np.array([[c in h for c in self.cards] for h in self.hands[s]], dtype=float) for s in (0, 1)]  # (n, C)
        self.compat_c = self.compat[None, :, :] * (1 - holds[0].T)[:, :, None] * (1 - holds[1].T)[:, None, :]  # (C, n, m)
        wins = np.zeros_like(self.compat_c)
        for k, c in enumerate(self.cards):
            five = board + [c]
            ra = [best_plo(h, five) if c not in h else None for h in a]
            rb = [best_plo(h, five) if c not in h else None for h in b]
            for i, x in enumerate(ra):
                for j, y in enumerate(rb):
                    if x is not None and y is not None:
                        wins[k, i, j] = (x > y) - (x < y)
        self.wins_c = wins * self.compat_c
        # (each pair dealt sees exactly 40 river cards)
        assert np.allclose(self.compat_c.sum(axis=0), RIVERS_PER_MATCHUP * self.compat)

        pot = round(spot["pot"] * 100)
        self.pot = pot / 100
        stack = round(spot["stack"] * 100)
        ts, rs = spot["turnSizes"], spot["riverSizes"]
        self.turn = build_tree(pot, stack, ts["bets"], ts["raises"], ts["raiseCap"], ts["allIn"])
        self.half = self.pot / 2
        # where the turn closes with chips behind, its river tree (the river's pot and stack in cents)
        self.rivers = {}
        for i, n in enumerate(self.turn):
            if n["kind"] != "showdown":
                continue
            bet = n["bets"][0]
            if stack - bet > 0:
                self.rivers[i] = build_tree(pot + 2 * bet, stack - bet, rs["bets"], rs["raises"], rs["raiseCap"], rs["allIn"])
        self.matchups = float(self.weights[0] @ self.compat @ self.weights[1])
        if not self.matchups > 0:
            raise ValueError(f"{spot['name']}: no matchup can be dealt")

    def n(self, seat):
        return len(self.hands[seat])

    def root_value(self, hero, values):
        return float(self.weights[hero] @ values) / self.matchups

    # ---- terminal values: hero's, against the other seat's reach

    def turn_fold(self, node, hero, reach):
        val = self.half + node["bets"][node["folded"]] / 100
        p = (val if node["folded"] == 1 else -val) * self.compat
        return p @ reach if hero == 0 else -(reach @ p)

    def allin(self, node, hero, reach):
        p = (self.half + node["bets"][0] / 100) * self.wins_c.sum(axis=0) / RIVERS_PER_MATCHUP
        return p @ reach if hero == 0 else -(reach @ p)

    def river_terminal(self, turn_bet, node, hero, reach):
        """A river terminal on every card at once: reach (C, other), out (C, hero)."""
        half = self.half + turn_bet / 100
        if node["kind"] == "fold":
            val = half + node["bets"][node["folded"]] / 100
            p = (val if node["folded"] == 1 else -val) * self.compat_c
        else:
            p = (half + node["bets"][0] / 100) * self.wins_c
        return np.einsum("cnm,cm->cn", p, reach) if hero == 0 else -np.einsum("cnm,cn->cm", p, reach)


def regret_match(regret, axis):
    positive = np.maximum(regret, 0)
    total = positive.sum(axis=axis, keepdims=True)
    a = regret.shape[axis]
    return np.where(total > 0, positive / np.where(total > 0, total, 1), 1 / a)


def normalise(s, axis):
    total = s.sum(axis=axis, keepdims=True)
    return np.where(total > 0, s / np.where(total > 0, total, 1), 1 / s.shape[axis])


class Strategy:
    """Tables by node: the turn's (actions, hands), each river's (cards, actions, hands)."""

    def __init__(self, game, fill=0.0):
        self.turn = {i: np.full((len(n["tokens"]), game.n(n["player"])), fill) for i, n in enumerate(game.turn) if n["kind"] == "action"}
        self.river = {
            c: {i: np.full((len(game.cards), len(n["tokens"]), game.n(n["player"])), fill) for i, n in enumerate(tree) if n["kind"] == "action"}
            for c, tree in game.rivers.items()
        }

    def map(self, f_turn, f_river):
        out = Strategy.__new__(Strategy)
        out.turn = {i: f_turn(s) for i, s in self.turn.items()}
        out.river = {c: {i: f_river(s) for i, s in t.items()} for c, t in self.river.items()}
        return out


def walk(game, i, hero, reach, how, strategy=None, regret=None, average=None, t=0):
    """Hero's values at turn node i against the other seat's reach (by hand). how: "solve" (CFR+ on regret and
    average), "best" (a best response to strategy) or "average" (strategy against strategy)."""
    n = game.turn[i]
    if n["kind"] == "fold":
        return game.turn_fold(n, hero, reach)
    if n["kind"] == "showdown":
        if i not in game.rivers:
            return game.allin(n, hero, reach)
        C = len(game.cards)
        out = river_walk(game, i, 0, n["bets"][0], hero, np.broadcast_to(reach, (C, reach.shape[0])), how, strategy, regret, average, t)
        return out.sum(axis=0) / RIVERS_PER_MATCHUP
    sigma = regret_match(regret.turn[i], 0) if how == "solve" else strategy.turn[i]
    if n["player"] == hero:
        values = np.stack([walk(game, c, hero, reach, how, strategy, regret, average, t) for c in n["children"]])
        if how == "best":
            return values.max(axis=0)
        here = (sigma * values).sum(axis=0)
        if how == "solve":
            regret.turn[i] = np.maximum(regret.turn[i] + values - here, 0)
        return here
    if how == "solve":
        average.turn[i] += t * sigma * reach
    return sum(walk(game, c, hero, reach * sigma[k], how, strategy, regret, average, t) for k, c in enumerate(n["children"]))


def river_walk(game, closing, i, turn_bet, hero, reach, how, strategy, regret, average, t):
    tree = game.rivers[closing]
    n = tree[i]
    if n["kind"] != "action":
        return game.river_terminal(turn_bet, n, hero, reach)
    sigma = regret_match(regret.river[closing][i], 1) if how == "solve" else strategy.river[closing][i]
    if n["player"] == hero:
        values = np.stack([river_walk(game, closing, c, turn_bet, hero, reach, how, strategy, regret, average, t) for c in n["children"]], axis=1)
        if how == "best":
            return values.max(axis=1)
        here = (sigma * values).sum(axis=1)
        if how == "solve":
            regret.river[closing][i] = np.maximum(regret.river[closing][i] + values - here[:, None, :], 0)
        return here
    if how == "solve":
        average.river[closing][i] += t * sigma * reach[:, None, :]
    return sum(river_walk(game, closing, c, turn_bet, hero, reach * sigma[:, k, :], how, strategy, regret, average, t) for k, c in enumerate(n["children"]))


def averaged(average):
    return average.map(lambda s: normalise(s, 0), lambda s: normalise(s, 1))


def measure(game, strategy):
    best = [game.root_value(s, walk(game, 0, s, game.weights[1 - s], "best", strategy)) for s in (0, 1)]
    value = game.root_value(0, walk(game, 0, 0, game.weights[1], "average", strategy))
    chips = (best[0] + best[1]) / 2
    return {"best": best, "value": value, "chips": chips, "pct": 100 * chips / game.pot, "lower": -best[1], "upper": best[0]}


def solve_cfr_plus(game, target_pct=1e-3, max_iterations=40_000):
    regret = Strategy(game)
    average = Strategy(game)
    t = 0
    pct = float("inf")
    while t < max_iterations and pct > target_pct:
        for _ in range(50):
            t += 1
            walk(game, 0, 0, game.weights[1], "solve", None, regret, average, t)
            walk(game, 0, 1, game.weights[0], "solve", None, regret, average, t)
        pct = measure(game, averaged(average))["pct"]
    return averaged(average), t


def rounded(strategy, digits=7):
    def r(s, axis):
        x = np.round(s, digits)
        return x / x.sum(axis=axis, keepdims=True)

    return strategy.map(lambda s: r(s, 0), lambda s: r(s, 1))


def tree_json(nodes):
    return [
        {
            "path": n["path"],
            "kind": n["kind"],
            "bets": [b / 100 for b in n["bets"]],
            **({"player": n["player"], "tokens": n["tokens"]} if n["kind"] == "action" else {}),
            **({"folded": n["folded"]} if n["kind"] == "fold" else {}),
        }
        for n in nodes
    ]


def fixture(spot, target_pct=1e-3):
    game = TurnGame(spot)
    strategy, iterations = solve_cfr_plus(game, target_pct)
    stored = rounded(strategy)
    m = measure(game, stored)
    num = lambda rows: [[float(f"{p:.8g}") for p in row] for row in rows]  # noqa: E731
    return {
        **spot,
        "hands": [[show(h) for h in game.hands[0]], [show(h) for h in game.hands[1]]],
        "tree": tree_json(game.turn),
        # by the turn's closing path, the river's tree
        "riverTrees": {game.turn[c]["path"]: tree_json(tree) for c, tree in game.rivers.items()},
        "matchups": game.matchups,
        "iterations": iterations,
        "value": m["value"],
        "lower": m["lower"],
        "upper": m["upper"],
        "best": m["best"],
        "exploitabilityPct": m["pct"],
        # turn: by node path, a list by action of a list by hand, in the order of `hands`
        "strategy": {game.turn[i]["path"]: num(s.tolist()) for i, s in stored.turn.items()},
        # rivers: by closing path, by river card, by river node path, the same (a hand holding the card: anything)
        "riverStrategy": {
            game.turn[c]["path"]: {show([card]): {game.rivers[c][i]["path"]: num(s[k].tolist()) for i, s in t.items()} for k, card in enumerate(game.cards)}
            for c, t in stored.river.items()
        },
    }


# ---- the spots

NONE = {"bets": [], "raises": [], "raiseCap": 0, "allIn": False}


def spots():
    out = [
        # checked through or one pot-sized bet a street
        {"name": "one bet a street", "board": "2c7d9hJs", "oop": "QhTh4c3c,6s5s4h3d,AsAc8s8c", "ip": "AhAd5c5d,Tc9c8d7h", "pot": 10, "stack": 50, "turnSizes": {"bets": [100], "raises": [], "raiseCap": 0, "allIn": False}, "riverSizes": {"bets": [100], "raises": [], "raiseCap": 0, "allIn": False}},
        # a raise on the turn puts it all in: some closings are showdowns over the river, the rest have a river left
        {"name": "a raise all-in on the turn", "board": "Ks9h4d2c", "oop": "AsKcQsJs,9s9c5d5c,8h7h6d5h", "ip": "KhKdTc8c,AhQhJh3h", "pot": 10, "stack": 25, "turnSizes": {"bets": [75], "raises": [100], "raiseCap": 1, "allIn": True}, "riverSizes": {"bets": [100], "raises": [], "raiseCap": 0, "allIn": True}},
    ]
    rnd = Mulberry32(20261110)
    board = "Th8h3c2d"
    b = parse(board)
    out.append({"name": "weighted ranges, two sizes", "board": board, "oop": random_range(rnd, DECK, b, 6, True), "ip": random_range(rnd, DECK, b, 5, True), "pot": 12, "stack": 40, "turnSizes": {"bets": [50, 100], "raises": [100], "raiseCap": 1, "allIn": False}, "riverSizes": {"bets": [75], "raises": [100], "raiseCap": 1, "allIn": False}})
    return out


def main():
    out = []
    for spot in spots():
        f = fixture(spot)
        print(f"{f['name']}: {len(f['hands'][0])}x{len(f['hands'][1])}, {len(f['tree'])} turn nodes, {len(f['riverTrees'])} river trees, {f['iterations']} iterations, value in [{f['lower']:.6f}, {f['upper']:.6f}], {f['exploitabilityPct']:.5f}% of the pot")
        out.append(f)
    OUT.mkdir(exist_ok=True)
    path = OUT / "turn.json"
    path.write_text(json.dumps({"spots": out}, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size / 1000:.0f} KB)")


if __name__ == "__main__":
    main()
