"""A true node lock: hold a player's strategy fixed at chosen decisions and re-solve everything else with DCFR.

`solve_locked` takes what gto.solver.solve takes, plus a list of `Lock`s. The answer is an equilibrium of the
*restricted game*, the game in which the locked hands' frequencies at the locked nodes are not choices: everyone else,
the locked player's other decisions included, re-solves against them. It is not the unlocked equilibrium, and not the
best response to a read that gto/exploit.py's TendencyLock gives; `LockedSolution.report()` labels it so.

What a lock is, in the sequence form: x(I, a) = m(a) x(parent of I) for every locked information set I (a hand at a
node, on a row of its boards). Those are linear equalities, so each player's strategies are still a polytope, the game
is still bilinear, and with zero-sum payoffs it has a value and a minimax solution. CFR on it is CFR with the locked
infosets' regrets left out of the sum, so the average strategies converge to it (a locked infoset plays m in every
iterate and so in the average).

Exploitability. Each player's best response keeps that player's own locks: it can change only what is that player's to
change. With v[p] the value of the average strategies and held[p] p's best response with p's locks held,
    gain[p] = held[p] - v[p]      exploitability_pct = (gain[0] + gain[1]) / 2 / root pot x 100
which is the engine's own scale, 0 at an equilibrium of the restricted game, and it's what Solver.exploitability
returns here. A player with no lock has held = free. Separately, free[p] is p's best response with its locks dropped:
free[p] - held[p] is what the lock costs p against this opponent. That can be any size, it's the point of a lock, and
it says nothing about how far the solve has converged.

How a lock is held: a regret pin, not a change to the walk. Regret matching turns regrets into a strategy, so a cell of
the flat regret buffer (Solver._regret) that holds m(a) x 2^100, or -2^100 where m(a) is 0, plays m: anything an
iteration adds is under float32's rounding of it. Every path that reads regrets then plays the lock with nothing else
changed: numpy's _cfr and _down on merged nodes, and the compiled core natively and in the browser, whose walk can't be
reached from outside solver/. Overriding Decision.strategy would reach numpy only: Solver.run hands the iterations to
core/gtocore.c, and _merge builds plain Decisions for the merged subtrees.
  * Merged subtrees (the likeliest silent bug): after Solver.__init__ an original node's regret and ssum are views of
    its rows in the flat buffers, whichever merged node traverses them, so a pin written through the original node
    lands on that line's rows alone. Nothing here keys off the merged node, and a merged sibling line stays free.
  * Discounting rounds a pinned cell (at most an ulp an iteration) and halves a negative one, so the pins are written
    again every PIN_EVERY iterations (Solver.run in slices). In between a pinned strategy is within about 4e-6 of m,
    and the zeros stay exact zeros (with beta None, CFR+'s floor, they rise to at most about 1e-23 until the next pin).
  * What's read at the end is exact: run() leaves the strategy sums of pinned cells at m, as float32s that sum to 1
    exactly (_float32_mix), so avg_strategy gives those floats back. The compiled core's evaluations read the same sums.
  * _support and _windows: a lock can only remove reach, so the windows stand. A named hand outside the player's range
    is not pinned: it's counted as ignored (and _windows would clear its cell). Whole-range locks pin every combo in
    the player's support, river-class images included.

Addressing. A line is a sequence of tokens from the root: action names as the tree spells them ("check", "bet 75%",
"raise to 30", "call", "all-in"), and at each chance node either a card ("Ah": that runout) or "*" (every runout). A
line must name a card or "*" at every chance node it crosses; there is no default. A Decision's rows are its boards,
so a locked line is a set of rows of one node, and each runout is its own information set: a lock on "*" is the same
mix on each runout separately, not a mix on average over them.

By abstraction (which cells exist is the solver's; a lock can only fix cells):
  * Every card dealt, per combo (exact mode): a lock means what it says.
  * Flop's turn_classes: the tree's card is the class's played card, and only that card can be named. The lock covers
    every card of the class, as the class's subtree does; the applied lock's notes say which.
  * Turn's river_classes: likewise on the river, and a class subtree's combo stands for its images under the card swaps,
    so a hand-scoped lock there can't name one hand: refused. Whole-range locks are honoured. A hand-scoped lock above
    them is honoured at its node, but it breaks the suit symmetry that makes a class exact: noted.
  * Bucketed nodes (Decision.bucketed: turn_buckets, river_buckets, river_strength, river_dealt): the cells are buckets,
    a combo has no strategy of its own, so a class or combo lock can't be honoured: refused (LockRefused). A whole-range
    lock is exact there, every bucket plays m, so every hand does.
  * Blind river nodes (river_play, per combo): the node has no river card; the lock is on the combo over all rivers.
  * Sampled cards (river_sample): the numpy path runs them; a row's pin holds whether or not it's sampled.

Heads-up postflop only: gto/multiway_solver.py is another solver and has none of this. Payoffs don't matter to a pin,
so rake and prize equity run, but only a zero-sum game has one value to validate (scripts/benchmarks/nodelock_bench.py).
"""
from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np

from gto import core
from gto.cards import ALL_COMBOS, COMBO_INDEX, card, card_str, combo_str
from gto.ranges import _class_combos
from gto.solver import (BucketEntry, Cancelled, Chance, Decision, Solution, Solver, Terminal, TooSlow, TreeBuilder,
                        Config, _spot, warm_start)

PIN = 2.0 ** 100            # a pinned regret's scale: a power of two, so that scaling a float32 mix rounds nothing
PIN_FLOOR = 2.0 ** 40       # at or over this a regret can only be a pin (a warm start's from another locked solve)
PIN_EVERY = 64              # iterations between the pins' rewrites: under it a negative pin halved each iteration
                            # (beta 0) is still 2^36, over any regret a slice adds
MIX_SUM_TOL = 1e-9          # how far a mix may be from summing to 1
ALL_RUNOUTS = "*"
LABEL = "Node-locked: an equilibrium of the restricted game with these frequencies fixed, not the unlocked equilibrium"


class LockError(ValueError):
    """A lock that doesn't make sense: a bad mix, a line the tree doesn't have, the wrong player."""


class LockRefused(LockError):
    """A well-formed lock this tree's abstraction can't honour."""


@dataclass(frozen=True)
class Lock:
    """`line`: tokens from the root (the module's docstring), () being the root. `player`: 0 OOP, 1 IP; it must be who
    acts there. `mix`: {action name: frequency}, the actions left out at 0, or one frequency per action in tree order.
    `hands`: "all", or {"classes": ["AKs", "QQ", "AK"], "combos": ["AhKh"]} (either key or both)."""
    line: Tuple[str, ...]
    player: int
    mix: Union[Mapping[str, float], Sequence[float]]
    hands: Union[str, Mapping[str, Sequence[str]]] = "all"


@dataclass
class Applied:
    """What a lock did. `cells`: (row, hand) cells pinned. `ignored`: hands it named outside the player's range (a board
    card or a dead card among them); `ignored_hands` the first few. `blocked`: pinned cells whose hand holds that row's
    runout (no reach there). `rows`: the node's rows locked, of `rows_total`."""
    lock: Lock
    names: List[str]
    mix: List[float]
    rows: int
    rows_total: int
    cells: int
    ignored: int = 0
    ignored_hands: List[str] = field(default_factory=list)
    blocked: int = 0
    notes: List[str] = field(default_factory=list)


class _Pin:
    """A node's pinned cells: mask (B, W) and each cell's mix (B, A, W), and the regrets that play it."""
    __slots__ = ("node", "mask", "mix", "regret")

    def __init__(self, node: Decision):
        self.node = node
        self.mask = np.zeros((node.B, node.regret.shape[2]), dtype=bool)
        self.mix = np.zeros(node.regret.shape, dtype=np.float32)
        self.regret = None

    def seal(self):
        self.regret = np.where(self.mix > 0, np.ldexp(self.mix, 100), np.float32(-PIN))


def _float32_mix(v: np.ndarray) -> np.ndarray:
    """A mix as the float32s the solver will hold, summing to exactly 1 added first to last, as regret matching and
    avg_strategy add them: their reciprocal is then exactly 1 too, and those very floats come back. One entry takes the
    rounding, a few ulps of it, the largest that can: partial sums round, so it's a search, not a subtraction."""
    m = v.astype(np.float32)

    def total(x) -> np.float32:
        s = np.float32(0.0)
        for e in x:
            s = s + e
        return s

    for i in np.argsort(-m):
        if m[i] <= 0:
            break
        c = m.copy()
        c[i] = m[i] + (np.float32(1.0) - total(m))
        centre = c[i]
        for steps in range(33):
            for direction in (np.inf, -np.inf):
                c[i] = centre
                for _ in range(steps):
                    c[i] = np.nextafter(c[i], np.float32(direction))
                if c[i] > 0 and total(c) == 1:
                    return c
    raise LockError(f"the mix {v.tolist()} can't be held in float32")


def _checked_mix(mix, names: List[str], where: str) -> np.ndarray:
    if isinstance(mix, Mapping):
        unknown = [k for k in mix if k not in names]
        if unknown:
            raise LockError(f"{where}: no action {unknown[0]!r} in the mix; the actions are {names}")
        v = [mix.get(n, 0.0) for n in names]
    else:
        v = list(mix)
        if len(v) != len(names):
            raise LockError(f"{where}: {len(v)} frequencies for {len(names)} actions {names}")
    try:
        a = np.array(v, dtype=np.float64)
    except (TypeError, ValueError):
        raise LockError(f"{where}: the mix must be numbers, got {v}") from None
    if not np.all(np.isfinite(a)) or np.any(a < 0):
        raise LockError(f"{where}: frequencies must be finite and at least 0, got {v}")
    if abs(a.sum() - 1.0) > MIX_SUM_TOL:
        raise LockError(f"{where}: frequencies must sum to 1, these sum to {a.sum():.12g}")
    return a


def _named_hands(hands) -> Optional[List[int]]:
    """Full combo indices a scope names; None: the whole range."""
    if isinstance(hands, str):
        if hands != "all":
            raise LockError(f"hands: 'all', or {{'classes': [...], 'combos': [...]}}, got {hands!r}")
        return None
    if not isinstance(hands, Mapping) or not hands or set(hands) - {"classes", "combos"}:
        raise LockError(f"hands: 'all', or {{'classes': [...], 'combos': [...]}}, got {hands!r}")
    out: Dict[int, None] = {}
    for cls in hands.get("classes", ()):
        try:
            out.update((COMBO_INDEX[cb], None) for cb in _class_combos(cls))
        except ValueError:
            raise LockError(f"hands: bad class {cls!r}") from None
    for text in hands.get("combos", ()):
        try:
            a, b = card(text[:2]), card(text[2:])
        except (ValueError, TypeError):
            raise LockError(f"hands: bad combo {text!r}") from None
        if a == b:
            raise LockError(f"hands: bad combo {text!r}")
        out[COMBO_INDEX[(min(a, b), max(a, b))]] = None
    if not out:
        raise LockError("hands: names no hands")
    return list(out)


def _skip(node):
    while isinstance(node, BucketEntry):
        node = node.child
    return node


def _played(solver, r0, r1) -> tuple:
    """(each player's value, each player's best response, the function that scores a utility row): a solve's average
    strategies as they stand, bb per dealt pair of hands, locks ignored by the best responses."""
    a, b = r0[None, :].astype(np.float32), r1[None, :].astype(np.float32)
    raw = (r0, r1)
    pairs = max(float((solver.compat_sum(r1[None, :])[0] * r0).sum()), 1e-12)

    def score(u, p) -> float:
        return float((u[0] * raw[p]).sum()) / pairs

    got = core.evaluate(solver, [(solver.root, p, a, b, core.AVG) for p in (0, 1)] +
                        [(solver.root, p, a, b, core.BR) for p in (0, 1)])
    solver.sampling = False
    held = getattr(solver, "_held", None)
    try:
        if got is None:
            if held is not None:
                solver._held = False
            got = [solver._cfr(solver.root, p, a, b, update=False, use_avg=True) for p in (0, 1)] + \
                  [solver._best_response(solver.root, p, a, b) for p in (0, 1)]
    finally:
        solver.sampling = True
        if held is not None:
            solver._held = held
    return [score(got[p], p) for p in (0, 1)], [score(got[2 + p], p) for p in (0, 1)], score


def measure_plain(solution: Solution) -> dict:
    """An unlocked solve on LockedSolver.measure's definitions and scale, to set beside a locked one."""
    value, free, _ = _played(solution.solver, solution.r0, solution.r1)
    gain = [free[p] - value[p] for p in (0, 1)]
    pot = float(solution.solver.root.pot_now)
    return {"iterations": int(solution.solver.iters), "root_pot": pot, "value": value, "best_response": free,
            "gain": gain, "exploitability_pct": (gain[0] + gain[1]) / 2 / pot * 100}


def tree_shape(root) -> str:
    """A digest of a tree: its decisions' players, actions and boards and its chance nodes' boards. Two trees with the
    same shape have the same nodes, so a line means the same decision in both."""
    h = hashlib.sha1()
    stack = [root]
    while stack:
        n = stack.pop()
        if isinstance(n, BucketEntry):
            stack.append(n.child)
        elif isinstance(n, Chance):
            h.update(repr(("C", n.K, n.boards)).encode())
            stack.append(n.child)
        elif isinstance(n, Decision):
            h.update(repr(("D", n.player, n.names, n.bucketed, n.boards)).encode())
            stack.extend(n.children)
    return h.hexdigest()


class LockedSolver(Solver):
    """Solver with Locks held (the module's docstring). `locks` are resolved here, after the merge, so that an original
    node's arrays are views; r0, r1: the root's reaches. `applied`: what each lock did."""

    def __init__(self, ctx, root, dead, locks: Sequence[Lock], r0: np.ndarray, r1: np.ndarray):
        super().__init__(ctx, root, dead)
        self._pins: Dict[int, _Pin] = {}
        self._held = True                 # _best_response keeps the node player's own locks
        self._has_classes = self._any_classes(root)
        reach = (np.ravel(r0) > 0, np.ravel(r1) > 0)
        support = self._support(r0, r1)
        self.applied = [self._apply(k, reach, support) for k in locks]
        for pin in self._pins.values():
            pin.seal()
        self.pin()

    @staticmethod
    def _any_classes(node) -> bool:
        stack = [node]
        while stack:
            n = stack.pop()
            if isinstance(n, Decision):
                stack.extend(n.children)
            elif isinstance(n, Chance):
                if n.perm is not None:
                    return True
                stack.append(n.child)
            elif isinstance(n, BucketEntry):
                stack.append(n.child)
        return False

    def resolve(self, line: Sequence[str]) -> tuple:
        """(the Decision a line ends at, its rows, whether a river-class chance node is above it, notes). LockError for
        a line this tree doesn't have, saying what it has at the point the line leaves it."""
        node, rows, under_classes, notes = _skip(self.root), [0], False, []
        walked: List[str] = []
        for token in line:
            at = f"line {tuple(walked)}"
            if isinstance(node, Decision):
                if token not in node.names:
                    raise LockError(f"{at}: no action {token!r}; the actions are {node.names}")
                node = _skip(node.children[node.names.index(token)])
            elif isinstance(node, Chance):
                rows, note = self._deal(node, rows, token, at)
                under_classes = under_classes or node.perm is not None
                notes += note
                node = _skip(node.child)
            else:
                raise LockError(f"{at}: the hand is over there, {token!r} can't follow")
            walked.append(token)
        at = f"line {tuple(walked)}"
        if isinstance(node, Chance):
            raise LockError(f"{at} ends at a chance node: name a card or {ALL_RUNOUTS!r}, then a decision")
        if isinstance(node, Terminal):
            raise LockError(f"{at} ends the hand: there's no decision to lock")
        return node, rows, under_classes, notes

    def _deal(self, node: Chance, rows: List[int], token: str, at: str) -> tuple:
        """The child rows of `rows` under token, and notes."""
        K, child = node.K, node.child
        if token == ALL_RUNOUTS:
            return [r * K + k for r in rows for k in range(K)], []
        try:
            c = card(token)
        except (ValueError, TypeError):
            raise LockError(f"{at}: a chance node: name a card or {ALL_RUNOUTS!r}, not {token!r}") from None
        hit = [r * K + k for r in rows for k in range(K) if child.boards[r * K + k][-1] == c]
        classed = node.perm is not None or node.umasks is not None
        classes = [self.ctx.turn_classes(b, self.dead) for b in {node.boards[r] for r in rows}] if classed else []
        if not hit:
            for cls in classes:
                for played, cs in cls:
                    if c in cs:
                        raise LockError(f"{at}: {token} is played as {card_str(played)} here (card classes): name that")
            have = sorted({child.boards[r * K + k][-1] for r in rows for k in range(K)})
            raise LockError(f"{at}: {token} isn't a card of this tree; it has {[card_str(x) for x in have]}")
        notes = []
        for cls in classes[:1]:
            cs = next(cs for played, cs in cls if played == c)
            if len(cs) > 1:
                notes.append(f"{token} stands for its class here: the lock covers {' '.join(card_str(x) for x in cs)}")
        if node.sample is not None:
            notes.append("this card is sampled during the solve (Config.river_sample)")
        return hit, notes

    def _apply(self, lock: Lock, reach: tuple, support: np.ndarray) -> Applied:
        node, rows, under_classes, notes = self.resolve(tuple(lock.line))
        where = f"line {tuple(lock.line)}"
        if node.player != lock.player:
            raise LockError(f"{where}: player {node.player} acts there, not player {lock.player}")
        mix = _checked_mix(lock.mix, node.names, where)
        named = _named_hands(lock.hands)
        p, W = node.player, node.regret.shape[2]
        ignored, ignored_hands, blocked = 0, [], 0
        if named is None:
            cols = np.arange(W) if node.bucketed else np.flatnonzero(support[p])
        else:
            if node.bucketed:
                raise LockRefused(f"{where}: this node is played by hand buckets, a combo has no strategy of its own "
                                  "there: lock the whole range, or solve the spot without buckets")
            if under_classes:
                raise LockRefused(f"{where}: a river class's combo stands for its images on the class's other cards, so "
                                  "it can't name one hand: lock the whole range, or solve with river_classes off")
            pos = {int(f): i for i, f in enumerate(self.ctx.active)}
            keep = []
            for f in named:
                i = pos.get(f)
                if i is not None and reach[p][i]:
                    keep.append(i)
                else:
                    ignored += 1
                    if len(ignored_hands) < 8:
                        ignored_hands.append(combo_str(ALL_COMBOS[f]))
            cols = np.array(sorted(keep), dtype=np.intp)
            if len(cols) == 0:
                notes.append("no hand it names is in this player's range: it changes nothing")
            elif self._has_classes:
                notes.append("the river classes below assume ranges symmetric in the swapped suits, which a hand-scoped "
                             "lock can break: the class subtrees then average the images' reaches")
        if node.bucketed:
            notes.append("played by hand buckets: every bucket holds the mix, so every hand does")
        if node.blind:
            notes.append("a river played without its card: the lock holds over every river")
        pin = self._pins.get(id(node))
        if pin is None:
            pin = self._pins[id(node)] = _Pin(node)
        m = _float32_mix(mix)
        if len(cols):
            ix = np.ix_(rows, cols)
            taken = pin.mask[ix]
            if taken.any():
                same = (pin.mix[rows][:, :, cols] == m[None, :, None]).all(axis=1)
                if not same[taken].all():
                    raise LockError(f"{where}: two locks give the same hand different mixes")
            pin.mask[ix] = True
            for a in range(len(m)):
                pin.mix[np.ix_(rows, [a], cols)] = m[a]
            if W == self.ctx.n and not node.bucketed and len(node.boards[0]) > self.ctx.root_len:
                cards = np.array([node.boards[r][self.ctx.root_len:] for r in rows])
                blocked = int((self.ctx.member[cards].sum(axis=1)[:, cols] > 0).sum())
        return Applied(lock, list(node.names), mix.tolist(), len(rows), node.B, len(rows) * len(cols), ignored,
                       ignored_hands, blocked, notes)

    def pin(self):
        """The pins into the flat buffers, through each original node's views: rows of a merged node's other lines are
        not touched."""
        for pin in self._pins.values():
            where = pin.mask[:, None, :]
            np.copyto(pin.node.regret, pin.regret, where=where)
            np.copyto(pin.node.ssum, pin.mix, where=where)

    def scrub(self):
        """After a warm start from another locked solve: its pins, now on cells this one has free, would freeze them."""
        big = np.abs(self._regret) >= np.float32(PIN_FLOOR)
        self._regret[big] = 0
        self._ssum[big] = 0
        self.pin()

    def run(self, r0, r1, time_budget=3.0, max_iters=1000, min_iters=10, should_stop=None, reserve=None, max_per=None):
        """Solver.run in slices of PIN_EVERY iterations with the pins written again between them; the budget and its
        rules are the whole run's. The last slice leaves the strategy sums exact, however the run ends."""
        t0 = time.time()
        start = self.iters
        if self.horizon is None and max_iters > self.iters:
            self.horizon = max_iters
        try:
            while True:
                before = self.iters
                done = before - start
                super().run(r0, r1, time_budget=max(time_budget - (time.time() - t0), 0.0),
                            max_iters=min(max_iters, before + PIN_EVERY), min_iters=max(min_iters - done, 1),
                            should_stop=should_stop, reserve=reserve, max_per=max_per if before == start else None)
                self.pin()
                done = self.iters - start
                if self.iters >= max_iters or self.iters == before or \
                        (done >= min_iters and time.time() - t0 > time_budget):
                    break
        finally:
            self.pin()
        return self.iters, time.time() - t0

    def _best_response(self, node, p, r0, r1, lock=None):
        """Solver._best_response, with p's pinned cells playing their mix when `_held` (p can't leave its own lock)."""
        pin = self._pins.get(id(node)) if self._held else None
        if pin is None or node.player != p:
            return super()._best_response(node, p, r0, r1, lock)
        us = np.stack([self._best_response(c, p, r0, r1, lock) for c in node.children], axis=1)      # (B, A, W)
        return np.where(pin.mask, (pin.mix * us).sum(axis=1), us.max(axis=1))

    def _locked_players(self) -> set:
        return {pin.node.player for pin in self._pins.values() if pin.mask.any()}

    def measure(self, r0, r1) -> dict:
        """Values and each player's best responses, bb per dealt pair of hands (the module's docstring)."""
        value, free, score = _played(self, r0, r1)
        self._held = True
        self.sampling = False
        try:
            a, b = r0[None, :].astype(np.float32), r1[None, :].astype(np.float32)
            locked = self._locked_players()
            held = [score(self._best_response(self.root, p, a, b), p) if p in locked else free[p] for p in (0, 1)]
        finally:
            self.sampling = True
        gain = [held[p] - value[p] for p in (0, 1)]
        pot = float(self.root.pot_now)
        raked = self.ctx.cfg.rake_rate > 0 or self.ctx.cfg.icm is not None
        self.br_values = (self.iters, held[0], held[1], raked)
        return {"iterations": int(self.iters), "root_pot": pot, "value": value, "best_response_held": held,
                "gain_held": gain, "exploitability_pct": (gain[0] + gain[1]) / 2 / pot * 100,
                "best_response_free": free, "lock_cost": [free[p] - held[p] for p in (0, 1)]}

    def exploitability(self, r0, r1) -> float:
        """In the restricted game (the module's docstring): percent of the pot at the root."""
        return self.measure(r0, r1)["exploitability_pct"]


@dataclass
class LockedSolution(Solution):
    """A Solution of the restricted game. `strategy`, `evs` (the root's) and exploitability() as on a Solution."""
    applied: List[Applied] = field(default_factory=list)

    def measure(self) -> dict:
        return self.solver.measure(self.r0, self.r1)

    def strategy_at(self, line: Sequence[str]) -> tuple:
        """(action names, the rows' boards, (rows, A, W) average strategy) at a line."""
        node, rows, _, _ = self.solver.resolve(tuple(line))
        return list(node.names), [node.boards[r] for r in rows], node.avg_strategy(np.array(rows))

    def report(self) -> dict:
        """The answer's numbers with what they are: plain data, ready to send to the page."""
        return {"kind": "node-locked equilibrium", "label": LABEL, "game": "restricted", "measure": self.measure(),
                "locks": [{"line": list(a.lock.line), "player": a.lock.player, "actions": a.names, "mix": a.mix,
                           "hands": a.lock.hands, "rows": a.rows, "rows_total": a.rows_total, "cells": a.cells,
                           "ignored": a.ignored, "ignored_hands": a.ignored_hands, "blocked": a.blocked,
                           "notes": a.notes} for a in self.applied]}


def lines(root) -> Iterator[Tuple[Tuple[str, ...], int, List[str]]]:
    """Every decision of a tree: (its line, with ALL_RUNOUTS at each chance node, its player, its actions)."""
    stack = [(root, ())]
    while stack:
        node, line = stack.pop()
        if isinstance(node, BucketEntry):
            stack.append((node.child, line))
        elif isinstance(node, Chance):
            stack.append((node.child, line + (ALL_RUNOUTS,)))
        elif isinstance(node, Decision):
            yield line, node.player, list(node.names)
            stack.extend((c, line + (n,)) for n, c in zip(node.names, node.children))


def street_strategy(solution: Solution, player: int) -> Dict[Tuple[str, ...], Tuple[List[str], np.ndarray]]:
    """Every decision of `player` on the root street of a solve, combo for combo: {line: (action names, (A, N_FULL)
    average strategy)}, the columns in gto.cards' full combo order, 0 outside the solve's combos. The root street is
    never bucketed (buckets start under its chance nodes), so this is the same object in any of the engine's flop
    models: what `hold_strategy` lays on another solve of the spot, abstracted differently."""
    active = np.asarray(solution.ctx.active)
    out: Dict[Tuple[str, ...], Tuple[List[str], np.ndarray]] = {}
    stack = [(solution.root, ())]
    while stack:
        node, line = stack.pop()
        if not isinstance(node, Decision):
            continue                     # a chance node, a bucket entry or a terminal: the street is over there
        if node.B != 1 or node.bucketed:
            raise LockError(f"line {line}: not a root-street decision of one board")
        if node.player == player:
            full = np.zeros((len(node.names), len(ALL_COMBOS)), dtype=np.float32)
            full[:, active] = node.avg_strategy()[0]
            out[line] = (list(node.names), full)
        stack.extend((c, line + (n,)) for n, c in zip(node.names, node.children))
    return out


def hold_strategy(solver: "LockedSolver", held: Mapping[Tuple[str, ...], Tuple[Sequence[str], np.ndarray]],
                  player: int) -> int:
    """Pin `player`'s root-street decisions to `held` (street_strategy's form), each combo its own mix: the restricted
    game in which that player's whole strategy on the street is given and everything after it, theirs included, is
    re-solved. Every root-street decision of the player must be in `held` with the same actions, and nothing may
    already be pinned there. Returns the cells pinned. Call before the first iteration (solve_locked's `seed`)."""
    support = solver._support(*solver.ctx.root_reach)[player]
    active = np.asarray(solver.ctx.active)
    cells, seen = 0, set()
    stack = [(solver.root, ())]
    while stack:
        node, line = stack.pop()
        if not isinstance(node, Decision):
            continue
        stack.extend((c, line + (n,)) for n, c in zip(node.names, node.children))
        if node.player != player:
            continue
        if line not in held:
            raise LockError(f"line {line}: no strategy given for this decision of player {player}")
        names, full = held[line]
        if list(names) != list(node.names):
            raise LockError(f"line {line}: the strategy's actions {list(names)} aren't the tree's {node.names}")
        if node.B != 1 or node.bucketed:
            raise LockRefused(f"line {line}: not a root-street decision of one board")
        if id(node) in solver._pins:
            raise LockError(f"line {line}: already locked")
        mix = np.asarray(full, dtype=np.float64)[:, active]                     # (A, W)
        tot = mix.sum(axis=0)
        cols = np.flatnonzero(support & (tot > 0))
        pin = solver._pins[id(node)] = _Pin(node)
        pin.mask[0, cols] = True
        for j in cols:
            pin.mix[0, :, j] = _float32_mix(mix[:, j] / tot[j])
        pin.seal()
        cells += len(cols)
        seen.add(line)
    extra = set(held) - seen
    if extra:
        raise LockError(f"line {sorted(extra)[0]}: not a decision of player {player} in this tree")
    return cells


def solve_locked(board: Sequence[int], r_oop: np.ndarray, r_ip: np.ndarray, pot: float, stack: float,
                 locks: Sequence[Lock], bets=(0.0, 0.0), to_act: int = 0, n_raises: int = 0,
                 cfg: Optional[Config] = None, time_budget: float = 3.0, max_iters: int = 1000,
                 dead: Sequence[int] = (), should_stop=None, warm: Optional[Solution] = None,
                 reserve: Optional[float] = None, horizon: Optional[int] = None, max_cells: Optional[int] = None,
                 max_per: Optional[float] = None, seed=None, same_tree: Optional[str] = None) -> LockedSolution:
    """gto.solver.solve with `locks` held. Every argument is solve()'s. `warm`: an earlier solve of the spot, unlocked or
    locked: its pins don't come along (LockedSolver.scrub), and this solve's are written over what it copies. The
    iteration count starts over, as in solve(). `same_tree`: another solve's tree_shape, which this tree must have.
    LockError or LockRefused before any iteration runs."""
    t_start = time.time()
    cfg = cfg or Config()
    board = tuple(board)
    ctx, active, r0f, r1f, dead_set = _spot(board, r_oop, r_ip, cfg, dead)
    tb = TreeBuilder(ctx, dead=list(dead_set), max_cells=max_cells)
    root = tb.build(board, pot, stack, bets, to_act, n_raises)
    if same_tree is not None and tree_shape(root) != same_tree:
        raise LockError("the locked solve's tree isn't the tree of the answer on screen")
    r0, r1 = r0f[active], r1f[active]
    ctx.root_reach = (r0, r1)
    s = LockedSolver(ctx, root, dead_set, locks, r0, r1)
    s.horizon = horizon
    if warm is not None:
        warm_start(root, ctx, warm.root, warm.ctx)
        if isinstance(warm.solver, LockedSolver):
            s.scrub()
        s.pin()
    elif seed is not None:
        seed(root, s)
        s.pin()
    if reserve is not None:
        time_budget = max(time_budget - (time.time() - t_start), 0.0)
    t_run = time.time()

    def solution(iters, secs) -> LockedSolution:
        sol = LockedSolution(root, root.names, None, None, iters, secs, tb.n_nodes, ctx, r0, r1, s, s.applied)
        sol.cells = tb.cells
        return sol

    try:
        iters, secs = s.run(r0, r1, time_budget=time_budget, max_iters=max_iters, should_stop=should_stop,
                            reserve=reserve, max_per=max_per)
    except TooSlow as e:
        e.cells = tb.cells
        raise
    except Cancelled as e:
        e.sol = solution(s.iters, time.time() - t_run)
        raise
    sol = solution(iters, secs)
    sol._refresh()
    return sol
