"""A player profile held across the whole tree and re-solved: the exploit of an assumed opponent type.

A profile is a read on one player, in the engine's own tendency keys (gto/exploit.py LOCK_KEYS without the next_* ones,
which set one decision): fold, fold_flop, fold_turn, fold_river, bluff, bet, raise. Its presets are LOCK_PRESETS
(station, nit, maniac, overfolder); a custom profile is any numbers within LOCK_KEYS' bounds.

The profile as locks. At every decision of the profiled player in a solve's tree (every street the tree holds, every
runout row, every hand or bucket), the mix held is the equilibrium's mix there with the profile's rule laid on it:
gto/exploit.py TendencyLock, the rule the engine's best response to a read has always used, applied to the solve's own
average strategy and the profiled player's reach at that node. The rule, per decision:
  * facing a first bet (fold, call, raises): `fold` (plus fold_<street>) points of the reaching range move from calls to
    folds, the weakest calls first by hand strength on that board (percentile of the range; a bucket's place where hands
    share buckets), or from folds to calls, the strongest folds first, when negative. `raise` scales every hand's raises
    alike: -50 moves half of each hand's raises to calls, +50 half of each hand's calls to raises.
  * where they can bet (check, bets): `bet` scales every hand's betting alike, -50 halves it, +50 bets half the checks;
    `bluff` does the same for the weak hands only, between the 50th and 65th percentile tapering to none above it.
  * facing a raise of their own bet: only `raise` acts (the fold keys are for a first bet).
The profiled player's reach at each node is the profile's own: the walk from the root multiplies their range by the
profiled mixes above it (Solver._best_response's walk with the lock, as the engine's best response reads a read), so the
shares are of the range that would really get there.

Then everything else re-solves. Every one of the profiled player's decisions is held, so the restricted game leaves the
other player alone with choices: its equilibrium is that player's best response to the profile, and the node lock's DCFR
(engine/nodelock.py, checked against an LP in docs/ACCURACY.md section 16) finds it as an average strategy over the whole
tree, mixed where hands are indifferent, where the classic answer was one node's argmax. The convergence reached is the
other player's remaining best-response gain against the held profile (`gain`, % of the street's pot): 0 is the exact
exploit. The held player's own gain is 0 by construction.

How a pin lands: the node lock's regret pin (nodelock.py's docstring), one mix per cell rather than one per lock, written
through each original node's views so merged subtrees keep each line's own mix. Recorded after a warm start from the
equilibrium solve of the same tree (same shape checked), so the mixes are that solve's.

Advisor answers in the profile. `Profiled` wraps Advisor._solve_cached for one request: each heads-up solve the request
asks for (the street on screen's and the earlier streets' that narrow its ranges) is answered by its profile re-solve,
built on the equilibrium solve of the same arguments, so the earlier streets narrow the ranges as the profile and its
exploit played them. Study's answer (`study_answer`) and Exploit practice's advice (`advise_answer`) and opponent moves
(engine/exploit_play.py) read those re-solves; a module cache keeps the last few, so one street's answers share one
re-solve. Heads-up, after the flop, cash only (a tournament's payoffs aren't zero-sum and the node lock wasn't checked on
them); multiway and preflop are refused in words.
"""
from __future__ import annotations

import time
from collections import OrderedDict
from typing import Dict, List, Optional

import numpy as np

from gto import core
from gto.advisor import HU_CHECKS, HU_RESERVE, OVER_TARGET, strategy_grid
from gto.cards import ALL_COMBOS, cards_str
from gto.exploit import LOCK_KEYS, LOCK_PRESETS, TendencyLock, describe_lock
from gto.solver import BucketEntry, Chance, Decision, Solution, TooSlow, warm_start

from .nodelock import PIN, LockError, LockRefused, LockedSolution, LockedSolver, measure_plain, solve_locked, tree_shape

PROFILE_KEYS = ("fold", "fold_flop", "fold_turn", "fold_river", "bluff", "bet", "raise")
PRESETS = {k: dict(v) for k, v in LOCK_PRESETS.items()}
LABEL = ("Exploit re-solve: the opponent held to an assumed profile at every decision of theirs, the rest re-solved; "
         "not an equilibrium")
KIND = "profile re-solve"
ITERATIONS = 1000
CACHE_SIZE = 3


def check_profile(adj) -> Dict[str, float]:
    """A profile's numbers checked: {key: value} within LOCK_KEYS' bounds, zeros dropped; LockError in words."""
    if not isinstance(adj, dict) or not adj:
        raise LockError("A profile needs its numbers: {key: value}, keys " + ", ".join(PROFILE_KEYS) + ".")
    out = {}
    for k, v in adj.items():
        if k not in PROFILE_KEYS:
            raise LockError(f"A profile has no key {k!r}: its keys are {', '.join(PROFILE_KEYS)}.")
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
            raise LockError(f"The profile's {k} must be a number.")
        lo, hi = LOCK_KEYS[k]
        if not lo <= float(v) <= hi:
            raise LockError(f"The profile's {k} must be between {lo} and {hi}, got {v}.")
        if float(v) != 0.0:
            out[k] = float(v)
    if not out:
        raise LockError("Every number of this profile is 0: it's the equilibrium, there's nothing to exploit.")
    return out


class ProfilePin:
    """A decision's cells held at one mix each: nodelock._Pin's interface (node, mask, mix, regret, seal), the regret
    worked out when written rather than kept, so a whole tree's pins cost one float32 per cell."""
    __slots__ = ("node", "mask", "mix")

    def __init__(self, node: Decision, mask: np.ndarray, mix: np.ndarray):
        self.node, self.mask, self.mix = node, mask, mix

    @property
    def regret(self) -> np.ndarray:
        return np.where(self.mix > 0, np.ldexp(self.mix, 100), np.float32(-PIN)).astype(np.float32)

    def seal(self):
        pass


def _mixes32(s: np.ndarray) -> np.ndarray:
    """(B, A, W) mixes normalised per cell, as float32; a cell with no mass plays every action alike."""
    s = np.clip(np.asarray(s, dtype=np.float64), 0.0, None)
    tot = s.sum(axis=1, keepdims=True)
    out = np.where(tot > 1e-12, s / np.maximum(tot, 1e-300), 1.0 / s.shape[1])
    return out.astype(np.float32)


class _Recorder:
    """The lock Solver._best_response lays on the profiled player's nodes, keeping what it gave at each."""

    def __init__(self, lock):
        self.lock, self.got = lock, {}

    def __call__(self, node, strat, reach, sel=None):
        s = self.lock(node, strat, reach) if sel is None else self.lock(node, strat, reach, sel)
        self.got[id(node)] = (node, np.asarray(s), np.asarray(strat))
        return s


def pin_profile(solver: LockedSolver, player: int, adj: Dict[str, float]) -> dict:
    """Pins every decision of `player` in the solver's tree to its average strategy as it stands (a warm start from the
    equilibrium) with TendencyLock(adj) on it (the module's docstring). Before the first iteration. What it pinned."""
    if not isinstance(solver, LockedSolver):
        raise TypeError("pin_profile needs a LockedSolver")
    lock = TendencyLock(solver.ctx, player, adj)
    rec = _Recorder(lock)
    r0, r1 = solver.ctx.root_reach
    a, b = np.asarray(r0, np.float32)[None, :], np.asarray(r1, np.float32)[None, :]
    support = solver._support(r0, r1)[player]
    held = solver._held
    solver._held, solver.sampling = False, False
    try:
        with np.errstate(all="ignore"):
            solver._best_response(solver.root, 1 - player, a, b, rec)
    finally:
        solver._held, solver.sampling = held, True
    nodes = cells = 0
    moved = 0.0
    for node, s, eq in rec.got.values():
        if id(node) in solver._pins:
            raise LockError("a decision of the profiled player is already locked")
        W = node.regret.shape[2]
        mask = np.zeros((node.B, W), dtype=bool)
        if node.bucketed:
            mask[:] = True
        else:
            mask[:, np.flatnonzero(support)] = True
        mix = _mixes32(s)
        solver._pins[id(node)] = ProfilePin(node, mask, mix)
        nodes += 1
        cells += int(mask.sum())
        moved = max(moved, float(np.abs(mix - _mixes32(eq))[np.broadcast_to(mask[:, None, :], mix.shape)].max(initial=0.0)))
    if not nodes:
        raise LockRefused("The profiled player has no decision in this tree.")
    return {"nodes": nodes, "cells": cells, "largest_move": moved}


def solve_profile(eq: Solution, asked: dict, player: int, adj: Dict[str, float], *, time_budget: float = 3.0,
                  max_iters: int = ITERATIONS, should_stop=None, reserve=None, horizon: Optional[int] = None,
                  warm: bool = True) -> LockedSolution:
    """The profile re-solve of the equilibrium solve `eq` (asked: the arguments it was solved with, solve()'s names):
    its tree built again (its shape checked), warm from `eq`, the profile pinned on every decision of `player`
    (pin_profile), and the rest re-solved. `warm` False: the pins are recorded from the warm start, then every regret
    and sum the pins don't hold starts over from 0. The answer's `profile` says what was pinned."""
    stats: dict = {}

    def seed(root, s):
        warm_start(root, s.ctx, eq.root, eq.ctx)
        stats.update(pin_profile(s, player, adj))
        if not warm:
            s._regret[:] = 0
            s._ssum[:] = 0

    sol = solve_locked(asked["board"], asked["r0"], asked["r1"], asked["pot"], asked["stack"], [],
                       bets=asked.get("bets", (0.0, 0.0)), to_act=asked.get("to_act", 0),
                       n_raises=asked.get("n_raises", 0), cfg=eq.ctx.cfg, time_budget=time_budget, max_iters=max_iters,
                       should_stop=should_stop, reserve=reserve, horizon=horizon, seed=seed,
                       same_tree=tree_shape(eq.root))
    sol.profile = {"player": player, "adj": dict(adj), **stats}
    return sol


def br_check(eq: Solution, held: LockedSolution, player: int, adj: Dict[str, float]) -> dict:
    """The re-solve against an independent best response: the other player's best-response value to the equilibrium
    solve's strategy with TendencyLock(adj) laid on during the walk (what the engine's classic exploit answer computes),
    beside the re-solve's value for that player and its own best response to the held profile. bb per dealt pair."""
    hero = 1 - player
    s = eq.solver
    r0, r1 = eq.r0, eq.r1
    a, b = np.asarray(r0, np.float32)[None, :], np.asarray(r1, np.float32)[None, :]
    pairs = max(float((s.compat_sum(np.asarray(r1)[None, :])[0] * r0).sum()), 1e-12)
    s.sampling = False
    try:
        with np.errstate(all="ignore"):
            u = s._best_response(s.root, hero, a, b, TendencyLock(eq.ctx, player, adj))
    finally:
        s.sampling = True
    br = float((u[0] * (r0 if hero == 0 else r1)).sum()) / pairs
    m = held.measure()
    pot = float(m["root_pot"])
    return {"player": hero, "best_response": br, "value": m["value"][hero], "held_best_response": m["best_response_free"][hero],
            "gap_pct": (br - m["value"][hero]) / pot * 100, "pins_pct": abs(br - m["best_response_free"][hero]) / pot * 100}


# ------------------------------------------------------------------------------------------------ the Advisor's requests

_CACHE: "OrderedDict[tuple, LockedSolution]" = OrderedDict()


def _cache_key(asked: dict, eq: Solution, player: int, adj: Dict[str, float]) -> tuple:
    from .study_lock import root_key
    return (root_key(asked, eq.root), player, tuple(sorted(adj.items())))


def clear_cache():
    _CACHE.clear()


def _no_library(*_a, **_k):
    return None


class _Plain:
    """The equilibrium pass of a profile request: the library left out as in the profile's, so both answers are read off
    live solves of the same trees."""

    def __init__(self, adv):
        self.adv = adv

    def __enter__(self):
        self.adv._from_library = _no_library
        return self

    def __exit__(self, *_exc):
        self.adv.__dict__.pop("_from_library", None)
        return False


def eq_against_profile(eq: Solution, held: LockedSolution) -> float:
    """What the unheld player's equilibrium strategy (eq's, the solve the profile was laid on: the same tree) wins
    against the held profile, bb per dealt pair as LockedSolver.measure's values: its decisions pinned to eq's mixes for
    one walk of _best_response (which plays a player's own pins), then unpinned."""
    s = held.solver
    hero = 1 - held.profile["player"]
    r0, r1 = s.ctx.root_reach
    support = s._support(r0, r1)[hero]
    added = []
    stack = [(held.root, eq.root)]
    try:
        while stack:
            d, e = stack.pop()
            if isinstance(d, Decision):
                if d.player == hero and id(d) not in s._pins:
                    mask = np.zeros((d.B, d.regret.shape[2]), dtype=bool)
                    if d.bucketed:
                        mask[:] = True
                    else:
                        mask[:, np.flatnonzero(support)] = True
                    s._pins[id(d)] = ProfilePin(d, mask, _mixes32(e.avg_strategy()))
                    added.append(id(d))
                stack.extend(zip(d.children, e.children))
            elif isinstance(d, (Chance, BucketEntry)):
                stack.append((d.child, e.child))
        a, b = np.asarray(r0, np.float32)[None, :], np.asarray(r1, np.float32)[None, :]
        pairs = max(float((s.compat_sum(np.asarray(r1)[None, :])[0] * r0).sum()), 1e-12)
        held_flag = s._held
        s._held, s.sampling = True, False
        try:
            with np.errstate(all="ignore"):
                u = s._best_response(s.root, hero, a, b)
        finally:
            s._held, s.sampling = held_flag, True
        return float((u[0] * (r0 if hero == 0 else r1)).sum()) / pairs
    finally:
        for k in added:
            s._pins.pop(k, None)


class Profiled:
    """Advisor._solve_cached answered by profile re-solves for one request (the module's docstring). `player`: the
    profiled player's index in the heads-up solves (0 OOP, 1 IP), the same on every street of a hand heads-up after the
    flop. `solves`: (street, equilibrium solve, re-solve, what it was asked) in the order asked. `post` hears progress."""

    def __init__(self, adv, player: int, adj: Dict[str, float], post=None, budget: Optional[float] = None,
                 only: Optional[int] = None):
        """`only`: re-solve only the solves of a board of this many cards (Study's street on screen), the others left
        at equilibrium."""
        self.adv, self.player, self.adj, self.post = adv, player, dict(adj), post
        self.budget, self.only = budget, only
        self.solves: List[tuple] = []

    def __enter__(self):
        adv = self.adv
        orig = adv._solve_cached

        def solve_profiled(board, r0, r1, pot, stack, budget, bets=(0.0, 0.0), to_act=0, n_raises=0, **more):
            eq = orig(board, r0, r1, pot, stack, budget, bets=bets, to_act=to_act, n_raises=n_raises, **more)
            if self.only is not None and len(board) != self.only:
                return eq
            asked = dict(board=tuple(board), r0=r0, r1=r1, pot=pot, stack=stack, bets=tuple(bets), to_act=to_act,
                         n_raises=n_raises)
            held = self._held(eq, asked, budget)
            self.solves.append((("flop", "turn", "river")[len(board) - 3], eq, held, asked))
            return held

        adv._solve_cached = solve_profiled
        adv._from_library = _no_library     # (a stored flop isn't a tree that can be re-solved)
        return self

    def __exit__(self, *_exc):
        self.adv.__dict__.pop("_solve_cached", None)
        self.adv.__dict__.pop("_from_library", None)
        return False

    def _held(self, eq: Solution, asked: dict, budget: float) -> LockedSolution:
        if getattr(eq.ctx.cfg, "icm", None) is not None:
            raise LockRefused("A tournament's payoffs aren't zero-sum, and a lock hasn't been checked on them: profiles "
                              "re-solve cash games.")
        key = _cache_key(asked, eq, self.player, self.adj)
        got = _CACHE.get(key)
        if got is not None:       # (a re-solve that ran its course, to its target, its budget or its iterations)
            _CACHE.move_to_end(key)
            return got
        adv = self.adv
        left = max(0.5, min(120.0, float(self.budget or budget or adv.time_budget)))
        street = ("flop", "turn", "river")[len(asked["board"]) - 3]
        first = max(adv.hu_settled_from.get(street, HU_CHECKS[0]), HU_CHECKS[0])
        t0 = time.time()
        try:
            held = solve_profile(eq, asked, self.player, self.adj, time_budget=left,
                                 max_iters=min(c for c in HU_CHECKS if c >= first), should_stop=adv.should_stop,
                                 reserve=HU_RESERVE, horizon=ITERATIONS)
        except TooSlow:
            raise LockError("The solver can't run this tree on this device in the time this mode has.") from None
        post = None
        if self.post is not None:
            def post(p):
                self.post({**p, "study": "profile_progress", "street": street})
        from .study_lock import _run
        _run(adv, held, left, first, adv.hu_settled, post, t0, t0)
        _CACHE[key] = held
        _CACHE.move_to_end(key)
        while len(_CACHE) > CACHE_SIZE:
            _CACHE.popitem(last=False)
        return held


def convergence(held: LockedSolution) -> dict:
    """How far a re-solve got: the unheld player's best-response gain against the held profile (% of the pot; 0 is the
    exact exploit), the restricted game's exploitability on the node lock's scale, iterations. Read once per iteration
    count."""
    got = getattr(held, "_conv", None)
    if got is not None and got[0] == held.iters:
        return got[1]
    m = held.measure()
    p = held.profile["player"]
    hero = 1 - p
    pot = float(m["root_pot"])
    out = {"iterations": int(held.iters), "root_pot": pot, "gain_pct": m["gain_held"][hero] / pot * 100,
           "exploitability_pct": m["exploitability_pct"], "value": m["value"],
           "best_response": m["best_response_free"][hero], "seconds": round(float(held.seconds), 2)}
    held._conv = (held.iters, out)
    return out


def player_of(state: dict, seat: str, other: str) -> int:
    """The index (0 out of position after the flop, 1 in position) of `seat` in its heads-up pot with `other`, from the
    table's postflop order (gto.preflop.postflop_order: heads-up the big blind is first)."""
    from gto import preflop as pf
    n = int(state.get("players") or 0)
    if n not in pf.SEATS:
        raise LockError(f"no table of {n} players")
    order = pf.postflop_order(list(pf.SEATS[n]))
    seat, other = seat.upper(), other.upper()
    if seat not in order or other not in order or seat == other:
        raise LockError(f"{seat} against {other} isn't a heads-up pot at this table")
    return 0 if order.index(seat) < order.index(other) else 1


def _seat_player(seat: str, found: dict) -> int:
    if seat == found["hero"]:
        return int(found["hero_p"])
    if seat == found["villain"]:
        return 1 - int(found["hero_p"])
    raise LockRefused(f"{seat} isn't in this heads-up pot ({found['hero']} and {found['villain']} are).")


def _range_side(sol, node, reach_me, evs, strat) -> dict:
    """The actor's range at a node of a solve: its mix, each action's EV (bb relative to folding now, the range's
    average over the hands that take it in part or whole: over the whole range where none does), and the range's EV."""
    w = np.asarray(reach_me, dtype=np.float64)
    tot = max(float(w.sum()), 1e-12)
    strat = np.asarray(strat, dtype=np.float64)
    evs = np.asarray(evs, dtype=np.float64)
    mix = [float((s * w).sum()) / tot for s in strat]
    ev = []
    for a in range(len(strat)):
        took = w * strat[a]
        t = float(took.sum())
        ev.append(float((evs[a] * took).sum()) / t if t > 1e-9 * tot else float((evs[a] * w).sum()) / tot)
    return {"mix": mix, "ev": ev, "range_ev": float(((strat * evs).sum(axis=0) * w).sum()) / tot,
            "combos": round(float(w.sum()), 2)}


def _class_rows(eq_ctx, ex_ctx, me_eq, me_ex, eq_strat, ex_strat, eq_evs, ex_evs, names) -> dict:
    """Per hand class of the actor's range, each answer on its own reach: weight in each (w, w_ex: share of the class's
    combos), both mixes and both EVs (the mix's, bb relative to folding now). A class in either range."""
    w_eq, w_ex = _expand(eq_ctx, me_eq), _expand(ex_ctx, me_ex)
    g_eq = strategy_grid([_expand(eq_ctx, s) for s in eq_strat], list(names), w_eq)["cells"]
    g_ex = strategy_grid([_expand(ex_ctx, s) for s in ex_strat], list(names), w_ex)["cells"]
    ev_eq = strategy_grid([_expand(eq_ctx, (np.asarray(eq_strat) * np.asarray(eq_evs)).sum(axis=0))], ["ev"], w_eq)["cells"]
    ev_ex = strategy_grid([_expand(ex_ctx, (np.asarray(ex_strat) * np.asarray(ex_evs)).sum(axis=0))], ["ev"], w_ex)["cells"]
    out = {}
    for cls, c in g_eq.items():
        x = g_ex[cls]
        if c["w"] <= 0 and x["w"] <= 0:
            continue
        out[cls] = {"w": c["w"], "w_ex": x["w"], "eq": c["f"] if c["w"] > 0 else None,
                    "ex": x["f"] if x["w"] > 0 else None,
                    "ev_eq": round(ev_eq[cls]["f"][0], 3) if c["w"] > 0 else None,
                    "ev_ex": round(ev_ex[cls]["f"][0], 3) if x["w"] > 0 else None}
    return out


def _expand(ctx, x) -> np.ndarray:
    out = np.zeros(len(ALL_COMBOS))
    out[np.asarray(ctx.active)] = np.asarray(x, dtype=np.float64)
    return out


def _profile_of(req: dict) -> tuple:
    prof = req.get("profile")
    if not isinstance(prof, dict):
        raise LockError("A profile request needs {seat, adj}.")
    seat = str(prof.get("seat") or "").upper()
    if not seat:
        raise LockError("A profile needs the seat it's on.")
    adj = prof.get("adj")
    if isinstance(adj, str):
        if adj not in PRESETS:
            raise LockError(f"No preset {adj!r}: the presets are {', '.join(PRESETS)}.")
        adj = PRESETS[adj]
    return seat, check_profile(adj)


SCOPE_STREET = ("The profile is held at every decision of {seat}'s in this street's solve, which covers the streets after "
                "it as its tree plays them. The ranges entering the street stay as the equilibrium left them.")
SCOPE_HAND = ("The profile is held at every decision of {seat}'s in the solves of this hand's streets after the flop, each "
              "street's solve covering the streets after it as its tree plays them, so the ranges entering this street "
              "are the ones the profile and its exploit leave.")
RULE = ("Each of their decisions is the equilibrium's mix with the profile laid on it: folds move by hand strength (their "
        "weakest calls fold first, their strongest folds call first), bluffs move among their weak hands, bets and raises "
        "scale every hand alike.")


def values_of(eq: Solution, held: LockedSolution) -> dict:
    """The street's values for the exploiting player, bb per dealt pair at the solve's root, all in one tree on one pair
    of ranges: at equilibrium, their equilibrium strategy against the profile, and the re-solved exploit against it; the
    profile's player's two in the same order (equilibrium, against the exploit)."""
    p = held.profile["player"]
    hero = 1 - p
    plain = measure_plain(eq)
    conv = convergence(held)
    vs = eq_against_profile(eq, held)
    return {"player": hero, "eq": plain["value"][hero], "eq_vs_profile": vs, "exploit": conv["value"][hero],
            "best_response": conv["best_response"], "profiled": {"eq": plain["value"][p], "exploited": conv["value"][p]},
            "root_pot": conv["root_pot"], "unlocked_exploitability_pct": plain["exploitability_pct"]}


def study_answer(adv, state: dict, post=None) -> dict:
    """Study's profile re-solve at the node on screen: state["nodelock"] = {"profile": {"seat": seat, "adj": {key:
    value} | preset name, "streets": "street" (the default) | "hand"}}. The node's equilibrium answer and its exploit
    answer side by side, the street's values (values_of) and the re-solve's convergence. LockError / LockRefused in
    words."""
    from .study_lock import _board_cards, _study, line_to
    t0 = time.time()
    n = _board_cards(state)
    if n < 3:
        raise LockRefused("Profiles are re-solved after the flop: preflop is the charts or a separate solve.")
    seat, adj = _profile_of(state["nodelock"])
    scope = state["nodelock"]["profile"].get("streets") or "street"
    if scope not in ("street", "hand"):
        raise LockError(f"streets is \"street\" or \"hand\", got {scope!r}")
    if n == 3:
        scope = "street"      # (the flop's solve is the hand's first)
    eq_found = _study(adv, state, flop=True)
    if getattr(eq_found["sol"].ctx.cfg, "icm", None) is not None:
        raise LockRefused("A tournament's payoffs aren't zero-sum, and a lock hasn't been checked on them: profiles "
                          "re-solve cash games.")
    player = _seat_player(seat, eq_found)
    budget = max(0.5, min(120.0, float(state.get("budget") or adv.time_budget)))
    with Profiled(adv, player, adj, post, budget, only=n if scope == "street" else None) as pr:
        ex_found = _study(adv, state, flop=True)
    held = ex_found["sol"]
    if not isinstance(held, LockedSolution) or not hasattr(held, "profile") or not pr.solves:
        raise LockRefused("This node's answer has no solve of its own to hold the profile in.")
    eq_sol, eq_node, ex_node = eq_found["sol"], eq_found["node"], ex_found["node"]
    if list(eq_node.names) != list(ex_node.names) or eq_found["hero"] != ex_found["hero"]:
        raise LockRefused("In the profile's hand the node on screen is another decision (the ranges the profile "
                          "narrowed gave another tree): its actions are " + ", ".join(ex_node.names) + ".")
    hero_p = int(eq_found["hero_p"])
    seats = [eq_found["hero"], eq_found["villain"]] if hero_p == 0 else [eq_found["villain"], eq_found["hero"]]
    names = list(eq_node.names)
    me_eq = eq_found["n_r0"] if hero_p == 0 else eq_found["n_r1"]
    me_ex = ex_found["n_r0"] if hero_p == 0 else ex_found["n_r1"]
    eq_side = _range_side(eq_sol, eq_node, me_eq, eq_found["evs"], eq_found["strat"])
    ex_side = _range_side(held, ex_node, me_ex, ex_found["evs"], ex_found["strat"])
    conv = convergence(held)
    under = pr.solves[-1][1]          # the equilibrium solve this street's profile was laid on (same tree and ranges)
    vals = values_of(under, held)
    street = eq_found["cur"].name
    exploiter = seats[1 - player]
    notes = []
    aim = adv.expl_target
    short = aim is not None and conv["gain_pct"] > 2 * OVER_TARGET * aim
    if short:
        notes.append(f"The re-solve stopped with {exploiter}'s best response still gaining {conv['gain_pct']:.2f}% of "
                     f"the pot against the profile, more than {2 * OVER_TARGET} times this mode's aim of {aim}%: the "
                     "exploit isn't settled.")
    notes.append("Both answers are read off live solves, the flop library left out: stored flops aren't trees that can "
                 "be re-solved, so the equilibrium side can differ a little from a stored answer on screen.")
    if scope == "hand":
        notes.append("The node's two sides are on different ranges (the profile's hand narrowed them its way); the "
                     "street's three values are all on the profile's ranges.")
    if eq_sol.ctx.cfg.rake_rate > 0:
        notes.append("The pot is raked: the re-solve's checks against a best response were run unraked.")
    streets = [{"street": st, "nodes": h.profile["nodes"], "cells": h.profile["cells"], "iterations": int(h.iters),
                "gain_pct": round(convergence(h)["gain_pct"], 4)} for st, _e, h, _a in pr.solves]
    return {
        "study": "profile", "street": street, "actor": eq_found["hero"], "opponent": eq_found["villain"],
        "position": "OOP" if hero_p == 0 else "IP", "board": cards_str(eq_found["board"]),
        "kind": KIND, "game": "restricted", "label": LABEL,
        "profile_solve": {
            "seat": seat, "player": player, "exploiter": exploiter, "seats": seats, "adj": adj,
            "words": f"{seat} {describe_lock(adj)}", "streets_held": scope,
            "line": line_to(eq_sol.root, eq_node), "actions": names,
            "actor_profiled": eq_found["hero"] == seat,
            "eq": eq_side, "exploit": ex_side,
            "classes": _class_rows(eq_sol.ctx, held.ctx, me_eq, me_ex, eq_found["strat"], ex_found["strat"],
                                   eq_found["evs"], ex_found["evs"], names),
            "values": vals,
            "convergence": conv,
            "pinned": {"nodes": held.profile["nodes"], "cells": held.profile["cells"]},
            "streets": streets,
            "scope": (SCOPE_HAND if scope == "hand" else SCOPE_STREET).format(seat=seat),
            "rule": RULE,
        },
        "solver": {"iterations": int(held.iters), "solve_seconds": round(float(held.seconds), 2), "nodes": held.n_nodes,
                   "active_combos": held.ctx.n, "exploitability_pct": round(max(conv["gain_pct"], 0.0), 4),
                   "core": bool(core.lib() is not None and held.solver.use_core and held.solver._core_ok),
                   **({"target_pct": aim} if aim is not None else {}), **({"approximate": True} if short else {})},
        "notes": notes + [x for x in ex_found["notes"] if "to tree action" not in x],
        "seconds": round(time.time() - t0, 2),
    }


def advise_answer(adv, state: dict, post=None) -> dict:
    """Exploit practice's advice against a profile: state["nodelock"] = {"profile": {"seat": the opponent, "adj": ...},
    "advise": true} with the hand from the player practising (hero, hole), no `locks`. Advisor.advise run twice: at
    equilibrium (gto_freq, gto_ev), then with every heads-up solve answered by its profile re-solve (Profiled), so the
    answer's frequencies and EVs are the re-solved exploit's at this node. Marked `profile_solve`."""
    seat, adj = _profile_of(state["nodelock"])
    st = {k: v for k, v in state.items() if k not in ("nodelock", "locks")}
    if len(str(st.get("board") or "").replace(" ", "")) < 6:
        raise LockRefused("Profiles are re-solved after the flop.")
    with _Plain(adv):
        eq = adv.advise(st)
    if "error" in eq or eq.get("street") == "preflop" or not eq.get("villain") or eq.get("multiway") or \
            eq.get("villain") != seat:
        why = eq.get("error") or ("this pot isn't heads up against " + seat)
        raise LockRefused(f"No profile re-solve here: {why}.")
    player = 0 if eq.get("position") == "IP" else 1      # the villain's index: hero OOP -> villain 1
    if player != player_of(st, seat, str(eq.get("hero") or st.get("hero") or "")):
        raise LockRefused("The table's order and the answer disagree on who is in position.")
    with Profiled(adv, player, adj, post) as pr:
        ex = adv.advise(st)
    if "error" in ex:
        return ex
    if not pr.solves:
        raise LockRefused("This answer has no heads-up solve of its own to hold the profile in.")
    _st, _eq_sol, held, _a = pr.solves[-1]
    gto = {a["action"]: a for a in eq.get("actions") or []}
    for a in ex.get("actions") or []:
        g = gto.get(a["action"])
        if g is not None:
            a["gto_freq"], a["gto_ev"] = g.get("freq"), g.get("ev_bb")
    conv = convergence(held)
    ex["profile_solve"] = {"seat": seat, "player": player, "adj": adj, "words": f"{seat} {describe_lock(adj)}",
                           "gain_pct": round(conv["gain_pct"], 4), "iterations": conv["iterations"],
                           "streets": [x[0] for x in pr.solves], "label": LABEL}
    ex["locked"] = {seat: adj}
    ex.setdefault("solver", {})["exploitability_pct"] = round(max(conv["gain_pct"], 0.0), 2)
    ex["notes"] = [f"profile re-solve: {seat} {describe_lock(adj)} held at every decision of theirs, your strategy "
                   "re-solved against it (not an equilibrium)"] + list(ex.get("notes") or [])
    return ex


def answer(adv, state: dict, post=None) -> dict:
    """The worker's entry, through engine/study_lock.answer for a request with state["nodelock"]["profile"]."""
    try:
        with np.errstate(all="ignore"):
            if state["nodelock"].get("advise"):
                return advise_answer(adv, state, post)
            return study_answer(adv, state, post)
    except LockRefused as e:
        return {"error": str(e), "lock_error": "refused"}
    except LockError as e:
        return {"error": str(e), "lock_error": "invalid"}
