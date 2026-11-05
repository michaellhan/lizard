"""An independent solve of small heads-up PLO4 rivers, to check web/src/engine/plo/river/ against. It shares no code with
that solver, only the file its numbers are written to, and it does each hard part the other way round:

  - a hand's strength is plo_reference.best_plo: all 60 ways, spelled out;
  - blockers are a matrix, every pair of hands asked whether they share a card (the TypeScript counts by inclusion and
    exclusion and never looks at a pair);
  - payoffs are dense matrices, one per terminal node;
  - the betting tree is worked out here in whole cents from the rules (TDA 56-C), not read from the table engine;
  - the algorithm is CFR+, regrets floored at zero and a linear average (the TypeScript's is discounted CFR).

    .venv/bin/python scripts/engine/plo_river_reference.py    # about a minute: writes web/src/engine/plo/vectors/river.json

Each spot's fixture has the game value bracketed by exact best responses: the value of the game to the first seat lies
between -(the second seat's best response) and (the first seat's best response), whatever solved it. It also has this
solve's whole strategy, rounded, with those best responses taken on the rounded numbers, so the TypeScript's best
response can be held to them on someone else's strategy.

Values are chips in the zero-sum form: each seat is credited half the pot at the start, so a seat's EV is value + pot / 2.
Exploitability is the average of the two seats' best-response gains. No rake.

Run its own checks with: .venv/bin/python -m unittest scripts/engine/test_plo_river_reference.py
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_reference import DECK, OUT, Mulberry32, best_plo, draw, parse, show  # noqa: E402

# numpy 2.0 on macOS's Accelerate reports divide and overflow from matmul on clean input; the numbers are right, and a
# real one would show: a NaN fails the fixture's check in Game.__init__
np.seterr(divide="ignore", over="ignore", invalid="ignore")

BB = 100  # cents; the smallest bet


def read_range(text):
    """'AsKsQhJh,6s5s4h3d@25' -> ([cards, ...], [weight, ...]): exact hands only, the spots here spell theirs out."""
    hands, weights = [], []
    for item in text.split(","):
        hand, _, pct = item.strip().partition("@")
        hands.append(parse(hand))
        weights.append(int(pct) / 100 if pct else 1.0)
    return hands, np.array(weights, dtype=float)


# ---- the tree, in cents


def floor_pct(cents, pct):
    return cents * pct // 100


def build_tree(pot, stack, bets, raises, raise_cap, all_in):
    """Pot and stack in cents, sizes in whole percents. Node 0 is the root, the first seat to act; returns a list of
    {"kind", "path", "bets", ...}: "action" with player, tokens, labels and children, "fold" with folded, "showdown"."""
    nodes = []

    def visit(put, turn, cur, last_raise, raises_made, path):
        i = len(nodes)
        node = {"path": path, "bets": list(put)}
        nodes.append(node)
        mine = put[turn]
        to_call = cur - mine
        pot_now = pot + put[0] + put[1]
        tokens = ["f", "c"] if to_call else ["x"]
        may_raise = cur < stack and (cur == 0 or raises_made < raise_cap)
        if may_raise:
            biggest = min(cur + pot_now + to_call, stack)  # call, then raise by the pot after the call
            smallest = min(cur + last_raise, stack)
            listed = raises if to_call else bets
            base = pot_now + to_call if to_call else pot_now
            tos = {min(max(cur + floor_pct(base, pct), smallest), biggest) for pct in listed}
            if all_in and stack <= biggest:
                tos.add(stack)
            tokens += [("r" if to_call else "b") + str(to) for to in sorted(tos)]
        node.update(kind="action", player=turn, tokens=tokens, children=[])
        for token in tokens:
            path2 = path + "." + token if path else token
            if token == "f":
                node["children"].append(visit_end(put, "fold", turn, path2))
            elif token == "c":
                called = list(put)
                called[turn] = cur
                node["children"].append(visit_end(called, "showdown", None, path2))
            elif token == "x":
                if turn == 0:
                    node["children"].append(visit(put, 1, 0, BB, 0, path2))
                else:
                    node["children"].append(visit_end(put, "showdown", None, path2))
            else:
                to = int(token[1:])
                bet = list(put)
                bet[turn] = to
                full = to - cur >= last_raise
                node["children"].append(visit(bet, 1 - turn, to, to - cur if full else last_raise, raises_made + (1 if cur else 0), path2))
        return i

    def visit_end(put, kind, folded, path):
        i = len(nodes)
        put = list(put)
        if kind == "fold":
            put[1 - folded] = put[folded]  # the bet nobody matched goes back
            nodes.append({"kind": "fold", "path": path, "bets": put, "folded": folded})
        else:
            nodes.append({"kind": "showdown", "path": path, "bets": put})
        return i

    visit([0, 0], 0, 0, BB, 0, "")
    return nodes


# ---- the game


class Game:
    def __init__(self, spot):
        self.spot = spot
        board = parse(spot["board"])
        self.hands = []
        self.weights = []
        for seat in ("oop", "ip"):
            hands, weights = read_range(spot[seat])
            self.hands.append(hands)
            self.weights.append(weights)
        a, b = self.hands
        self.compat = np.array([[not set(x) & set(y) for y in b] for x in a], dtype=float)
        ranks_a = [best_plo(h, board) for h in a]
        ranks_b = [best_plo(h, board) for h in b]
        self.wins = np.array([[(x > y) - (x < y) for y in ranks_b] for x in ranks_a], dtype=float)
        pot = round(spot["pot"] * 100)
        self.pot = pot / 100
        self.nodes = build_tree(pot, round(spot["stack"] * 100), spot["bets"], spot["raises"], spot["raiseCap"], spot["allIn"])
        self.payoff = {}
        half = self.pot / 2
        for i, n in enumerate(self.nodes):
            if n["kind"] == "fold":
                val = half + n["bets"][n["folded"]] / 100
                self.payoff[i] = (val if n["folded"] == 1 else -val) * self.compat
            elif n["kind"] == "showdown":
                self.payoff[i] = (half + n["bets"][0] / 100) * self.wins * self.compat
        self.matchups = float(self.weights[0] @ self.compat @ self.weights[1])
        if not self.matchups > 0:
            raise ValueError(f"{spot['name']}: no matchup can be dealt")

    def n(self, seat):
        return len(self.hands[seat])

    def terminal(self, i, hero, reach):
        return self.payoff[i] @ reach if hero == 0 else -(reach @ self.payoff[i])

    def root_value(self, hero, values):
        return float(self.weights[hero] @ values) / self.matchups


def regret_match(regret):
    positive = np.maximum(regret, 0)
    total = positive.sum(axis=0)
    a = regret.shape[0]
    return np.where(total > 0, positive / np.where(total > 0, total, 1), 1 / a)


def solve_cfr_plus(game, target_pct=1e-3, max_iterations=40_000):
    regret = {}
    average = {}
    for i, n in enumerate(game.nodes):
        if n["kind"] == "action":
            shape = (len(n["tokens"]), game.n(n["player"]))
            regret[i] = np.zeros(shape)
            average[i] = np.zeros(shape)

    def walk(i, hero, reach, t):
        n = game.nodes[i]
        if n["kind"] != "action":
            return game.terminal(i, hero, reach)
        sigma = regret_match(regret[i])
        if n["player"] == hero:
            values = np.stack([walk(c, hero, reach, t) for c in n["children"]])
            here = (sigma * values).sum(axis=0)
            regret[i] = np.maximum(regret[i] + values - here, 0)
            return here
        average[i] += t * sigma * reach
        return sum(walk(c, hero, reach * sigma[k], t) for k, c in enumerate(n["children"]))

    t = 0
    pct = float("inf")
    while t < max_iterations and pct > target_pct:
        for _ in range(50):
            t += 1
            walk(0, 0, game.weights[1], t)
            walk(0, 1, game.weights[0], t)
        pct = measure(game, normalise(average))["pct"]
    return normalise(average), t


def normalise(average):
    out = {}
    for i, s in average.items():
        total = s.sum(axis=0)
        out[i] = np.where(total > 0, s / np.where(total > 0, total, 1), 1 / s.shape[0])
    return out


def respond(game, strategy, i, hero, reach, best):
    n = game.nodes[i]
    if n["kind"] != "action":
        return game.terminal(i, hero, reach)
    if n["player"] == hero:
        values = np.stack([respond(game, strategy, c, hero, reach, best) for c in n["children"]])
        return values.max(axis=0) if best else (strategy[i] * values).sum(axis=0)
    return sum(respond(game, strategy, c, hero, reach * strategy[i][k], best) for k, c in enumerate(n["children"]))


def measure(game, strategy):
    best = [game.root_value(s, respond(game, strategy, 0, s, game.weights[1 - s], True)) for s in (0, 1)]
    value = game.root_value(0, respond(game, strategy, 0, 0, game.weights[1], False))
    chips = (best[0] + best[1]) / 2
    return {"best": best, "value": value, "chips": chips, "pct": 100 * chips / game.pot, "lower": -best[1], "upper": best[0]}


def round_strategy(strategy, digits=7):
    out = {}
    for i, s in strategy.items():
        r = np.round(s, digits)
        out[i] = r / r.sum(axis=0)
    return out


def fixture(spot, target_pct=1e-3):
    game = Game(spot)
    strategy, iterations = solve_cfr_plus(game, target_pct)
    stored = round_strategy(strategy)
    m = measure(game, stored)
    return {
        **spot,
        "hands": [[show(h) for h in game.hands[0]], [show(h) for h in game.hands[1]]],
        "tree": [{"path": n["path"], "kind": n["kind"], "bets": [b / 100 for b in n["bets"]], **({"player": n["player"], "tokens": n["tokens"]} if n["kind"] == "action" else {}), **({"folded": n["folded"]} if n["kind"] == "fold" else {})} for n in game.nodes],
        "matchups": game.matchups,
        "iterations": iterations,
        "value": m["value"],
        "lower": m["lower"],
        "upper": m["upper"],
        "best": m["best"],
        "exploitabilityPct": m["pct"],
        # by node path: a list by action of a list by hand, in the order of `hands`
        "strategy": {game.nodes[i]["path"]: [[float(f"{p:.8g}") for p in row] for row in s.tolist()] for i, s in stored.items()},
    }


# ---- the spots


def random_range(rnd, deck, board, size, weighted):
    """`size` different hands dealt off `deck`, each off the board."""
    left = [c for c in deck if c not in board]
    seen = {}
    while len(seen) < size:
        hand = sorted(draw(left, 4, rnd), key=lambda c: DECK.index(c))
        key = show(hand)
        if key not in seen:
            seen[key] = 1 + int(rnd() * 100) if weighted else 100
    return ",".join(k if w >= 100 else f"{k}@{min(w, 100)}" for k, w in seen.items())


def spots():
    out = [
        # the toys test_plo_river_reference.py works by hand
        {"name": "polarised, pot-size bet", "board": "2c7d9hJsKd", "oop": "QhTh4c3c,6s5s4h3d", "ip": "AsAc8s8c", "pot": 10, "stack": 100, "bets": [100], "raises": [], "raiseCap": 0, "allIn": False},
        {"name": "a catcher that blocks the value", "board": "2c7d9hJsKd", "oop": "QhTh4c3c,6s5s4h3d", "ip": "AsAc8s4c,AdAh8d8h", "pot": 10, "stack": 100, "bets": [50], "raises": [], "raiseCap": 0, "allIn": False},
    ]
    rnd = Mulberry32(20261105)
    full = DECK
    high = [c for c in DECK if c[0] >= 9]  # 24 cards: hands block one another far more than on the whole deck
    for name, board, deck, size, extra in (
        ("two pair of sizes, one raise", "Ks9h4d2c7s", full, 24, {"pot": 20, "stack": 100, "bets": [50, 100], "raises": [100], "raiseCap": 1, "allIn": True}),
        ("flush board, a short stack", "Ah8h3h6c2d", full, 30, {"pot": 20, "stack": 13, "bets": [50, 100], "raises": [100], "raiseCap": 2, "allIn": True}),
        ("paired board, weights, two raises", "9s9d5c5hQd", full, 36, {"pot": 12.35, "stack": 40, "bets": [33, 75], "raises": [60, 100], "raiseCap": 2, "allIn": True}),
        ("hands from 24 cards, heavy blocking", "Th9c2d3s4h", high, 40, {"pot": 8, "stack": 30, "bets": [100], "raises": [100], "raiseCap": 3, "allIn": False}),
    ):
        b = parse(board)
        out.append({"name": name, "board": board, "oop": random_range(rnd, deck, b, size, True), "ip": random_range(rnd, deck, b, size, True), **extra})
    return out


def main():
    out = []
    for spot in spots():
        f = fixture(spot)
        print(f"{f['name']}: {len(f['hands'][0])}x{len(f['hands'][1])}, {len(f['tree'])} nodes, {f['iterations']} iterations, value in [{f['lower']:.6f}, {f['upper']:.6f}], {f['exploitabilityPct']:.5f}% of the pot")
        out.append(f)
    OUT.mkdir(exist_ok=True)
    path = OUT / "river.json"
    path.write_text(json.dumps({"spots": out}, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size / 1000:.0f} KB)")


if __name__ == "__main__":
    main()
