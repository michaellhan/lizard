"""Study's node lock: the node on screen, held at a mix, re-solved at that speed's own settings.

The worker's `answer` comes here for a request with state["nodelock"]; everything else about the request is the Study
state of the node on screen, so which node is meant is never a second thing to keep in step:

    state["nodelock"] = {"mix": {action name: frequency}, "hands": "all" | {"classes": [...], "combos": [...]},
                         "expect": {"actor": seat, "actions": [names]}}

How the tree is the tree on screen. Nothing here rebuilds the spot. Advisor.study runs as it would for the page, with
its narrowing, its ranges and its config, and two of its own steps are watched: _solve_cached says what each solve was
asked (board, full ranges, pot, stack, bets, who acts, raises) and _study_node says which solve and node answered. The
locked solve is then built from those same arguments and that solve's own config (sol.ctx.cfg, so a tree the Advisor
trimmed to fit stays trimmed), and tree_shape checks the two trees match before an iteration runs.

How a Study line becomes tokens. A Study node on a street lies in a solve rooted at that street's start, on the real
board (or, when the line was rare or the pot only just became heads-up, at the node itself). So the path from the root
to the node crosses no chance node: its tokens are this street's action names, found by walking the solve's tree to
the very node _study_node was given. No card is ever named. Card classes and buckets exist only below the root's
street, so at the node on screen every hand has its own strategy in both speeds, and the on-screen turn or river is
the root's board whatever the flop's own tree played for it (the flop's solve only narrowed the ranges).

Where it can't: the flop library. A stored flop is a few of a solve's nodes, not a tree that can be re-solved, so on the
flop the Study path is run with the library left out and the flop solved live at this speed; the "unlocked" numbers
are that live solve's, and a flop whose stored sizes aren't the live tree's is refused with the live actions.

What the restricted game covers: the root's street and below. The ranges entering the street stay as the unlocked hand
left them, since the earlier streets aren't in this solve.
"""
from __future__ import annotations

import time
from typing import List, Optional, Sequence

import numpy as np

from gto import core
from gto.advisor import HU_CHECKS, HU_RESERVE, OVER_TARGET
from gto.cards import cards_str
from gto.solver import BucketEntry, Cancelled, Chance, Decision, TooSlow

from .nodelock import (LABEL, Lock, LockError, LockRefused, LockedSolution, measure_plain, solve_locked, tree_shape)

ITERATIONS = 1000       # as a heads-up solve's (advisor.HU_CHECKS' end)
REACH_MIN = 1e-6        # a share of the range this small isn't reached: its frequencies mean nothing
MULTIWAY = "Node locking is heads-up: this pot has more than two players in it."
SCOPE_STREET = ("The lock is on this street's solve. The ranges entering the street stay as the unlocked hand left "
                "them: the earlier streets don't react to it.")
SCOPE_NODE = ("The solve starts at this node, so what came before it doesn't react to the lock: the ranges here stay "
              "as the unlocked hand left them.")


class _Multiway(Cancelled):
    """A multiway Study path, stopped before it solves. (A Cancelled: Advisor.study answers any other exception with
    the betting rules.)"""


class _Capture:
    """Advisor.study with its solves and its answer's node watched, and on the flop without the library. Everything is
    an instance attribute over the class's method, gone again on the way out. `adv` runs one request at a time."""

    def __init__(self, adv, flop: bool):
        self.adv, self.flop = adv, flop
        self.asked, self.found = {}, None

    def __enter__(self):
        adv = self.adv
        solved, node = adv._solve_cached, adv._study_node

        def solve_watched(board, r0, r1, pot, stack, budget, bets=(0.0, 0.0), to_act=0, n_raises=0, **more):
            sol = solved(board, r0, r1, pot, stack, budget, bets=bets, to_act=to_act, n_raises=n_raises, **more)
            self.asked[id(sol)] = dict(board=board, r0=r0, r1=r1, pot=pot, stack=stack, bets=bets, to_act=to_act,
                                       n_raises=n_raises)
            return sol

        def node_watched(sol, node, n_r0, n_r1, evs, strat, cur, hero, villain, hero_p, board, to_call, behind, expl,
                         lib_sol, positions, notes, t0):
            self.found = dict(sol=sol, node=node, cur=cur, hero=hero, villain=villain, hero_p=hero_p, board=board,
                              library=lib_sol is not None, notes=list(notes))
            # (the node's whole-range tables aren't needed here, and its equities take seconds in the browser)
            return {"study": "node", "street": cur.name, "actor": hero, "actions": [{"action": n} for n in node.names]}

        def multiway(*_a, **_k):
            raise _Multiway()

        adv._solve_cached, adv._study_node = solve_watched, node_watched
        for name in ("_multiway_solve", "_study_mw_node", "_study_mw_near", "_study_mw_prev"):
            setattr(adv, name, multiway)
        if self.flop:
            adv._from_library = lambda *_a, **_k: None
        return self

    def __exit__(self, *_exc):
        for name in ("_solve_cached", "_study_node", "_multiway_solve", "_study_mw_node", "_study_mw_near",
                     "_study_mw_prev", "_from_library"):
            self.adv.__dict__.pop(name, None)
        return False


def line_to(root, target) -> List[str]:
    """The action names from `root` to `target`, a decision on root's street (the module's docstring)."""
    stack = [(root, [])]
    while stack:
        node, line = stack.pop()
        if node is target:
            return line
        if isinstance(node, Decision):
            stack.extend((c, line + [n]) for n, c in zip(node.names, node.children) if isinstance(c, Decision))
    raise LockError("the node on screen isn't on its solve's street")


def _board_cards(state: dict) -> int:
    return len(str(state.get("board") or "").replace(" ", "").replace(",", "")) // 2


def _study(adv, state: dict, flop: bool) -> dict:
    """The Study answer's solve and node (_Capture.found) with what its solve was asked, or LockRefused for a node with
    none."""
    st = {k: v for k, v in state.items() if k not in ("nodelock", "one_size", "breakdown", "runouts", "preflop_solve")}
    st["study"] = True
    with _Capture(adv, flop) as cap:
        try:
            res = adv.study(st)
        except _Multiway:
            raise LockRefused(MULTIWAY) from None
    found = cap.found
    if found is None:
        if res.get("cancelled"):
            raise Cancelled()
        if res.get("multiway"):
            raise LockRefused(MULTIWAY)
        if res.get("study") in ("deal", "over"):
            raise LockRefused("Nobody acts here: there's no decision to lock.")
        if "error" in res:
            raise LockError(str(res["error"]))
        raise LockRefused("No heads-up solve answers this node (the betting rules do), so there's no tree to lock.")
    found["asked"] = cap.asked.get(id(found["sol"]))
    if found["asked"] is None:
        raise LockRefused("This node's answer has no solve of its own to lock.")
    return found


def _lock_of(state: dict, found: dict, line: Sequence[str]) -> Lock:
    """The request's lock on the node found, checked against what the page showed."""
    req, node = state["nodelock"], found["node"]
    expect = req.get("expect") or {}
    if expect.get("actor") and expect["actor"] != found["hero"]:
        raise LockError(f"{found['hero']} acts at this node, not {expect['actor']}")
    mix = req.get("mix")
    if not isinstance(mix, dict) or not mix:
        raise LockError("A lock needs a mix: a frequency for the node's actions.")
    names = list(node.names)
    if (expect.get("actions") and list(expect["actions"]) != names) or set(mix) - set(names):
        e = LockRefused("This node's actions in the live solve aren't the ones shown: "
                        f"{', '.join(names)}. The lock has to be given on those.")
        e.actions = names
        raise e
    return Lock(tuple(line), int(found["hero_p"]), {k: float(v) for k, v in mix.items()}, req.get("hands") or "all")


def _walked(root, line: Sequence[str], r0, r1) -> list:
    """Along a line from root: (node, action taken there or None, reaches (r0, r1) arriving) for each decision."""
    out, node, reach = [], root, [np.array(r0, dtype=float), np.array(r1, dtype=float)]
    for token in list(line) + [None]:
        out.append((node, token, (reach[0].copy(), reach[1].copy())))
        if token is None:
            break
        a = node.names.index(token)
        reach[node.player] = reach[node.player] * node.avg_strategy0()[a]
        node = node.children[a]
    return out


def _freqs(node, reach) -> Optional[List[float]]:
    """The node's mix over what reaches it, or None where nothing does."""
    w = reach[node.player]
    total = float(w.sum())
    if total <= 0:
        return None
    return [float((s * w).sum()) / total for s in node.avg_strategy0()]


def _row(free_node, held_node, free_reach, held_reach, r_all, seats, at: str, line: Sequence[str]) -> dict:
    """A decision in both solves. `reach`: the share of the two ranges that gets there together, each player's share
    multiplied, in each solve; where it's nothing the decision isn't played and its frequencies are None."""
    p = free_node.player

    def share(reach) -> float:
        return float(np.prod([float(reach[q].sum()) / max(float(np.sum(r_all[q])), 1e-12) for q in (0, 1)]))

    free, held = share(free_reach), share(held_reach)
    return {"at": at, "line": list(line), "seat": seats[p], "player": p, "actions": list(free_node.names),
            "unlocked": None if free < REACH_MIN else _freqs(free_node, free_reach),
            "locked": None if held < REACH_MIN else _freqs(held_node, held_reach),
            "reach": {"unlocked": free, "locked": held}}


def _changes(sol, held, line: Sequence[str], seats) -> list:
    """The decisions on the line down to the locked node, then those straight after each of its actions: what a lock
    of the whole range can't show at its own node, it shows there."""
    a = _walked(sol.root, line, sol.r0, sol.r1)
    b = _walked(held.root, line, held.r0, held.r1)
    r_all = (sol.r0, sol.r1)
    rows = []
    for i, ((fn, tok, fr), (hn, _, hr)) in enumerate(zip(a, b)):
        at = "before" if tok is not None else "locked"
        rows.append(_row(fn, hn, fr, hr, r_all, seats, at, list(line[:i])))
    fn, _, fr = a[-1]
    hn, _, hr = b[-1]
    fs, hs = fn.avg_strategy0(), hn.avg_strategy0()
    for i, name in enumerate(fn.names):
        fc, hc = fn.children[i], hn.children[i]
        if isinstance(fc, Decision):
            f2, h2 = [fr[0].copy(), fr[1].copy()], [hr[0].copy(), hr[1].copy()]
            f2[fn.player] = f2[fn.player] * fs[i]
            h2[fn.player] = h2[fn.player] * hs[i]
            rows.append(_row(fc, hc, f2, h2, r_all, seats, "after", list(line) + [name]))
    return rows


def _below(root) -> dict:
    """What abstraction the tree has below its root's street."""
    has = {"turn_classes": False, "river_classes": False, "buckets": False, "cards": set()}
    stack = [root]
    while stack:
        n = stack.pop()
        if isinstance(n, BucketEntry):
            stack.append(n.child)
        elif isinstance(n, Chance):
            has["river_classes"] = has["river_classes"] or n.perm is not None
            has["turn_classes"] = has["turn_classes"] or n.umasks is not None
            has["cards"].add(n.K)
            stack.append(n.child)
        elif isinstance(n, Decision):
            has["buckets"] = has["buckets"] or n.bucketed
            stack.extend(n.children)
    return has


def abstraction_words(street: str, root, hand_scoped: bool) -> str:
    """What the tree the lock is solved on abstracts, in words."""
    below = _below(root)
    if street == "river":
        return "Every hand has its own strategy here and nothing is dealt below: the tree abstracts only the bet sizes."
    parts = ["At this node every hand has its own strategy."]
    if below["turn_classes"]:
        parts.append("Below it the turn is played as one card per class")
        if below["buckets"]:
            parts[-1] += ", and from the turn down hands share buckets, so the strategies there aren't per hand."
        else:
            parts[-1] += "."
    elif below["river_classes"]:
        parts.append("Below it the river is played as one card per class, which is exact only for ranges symmetric in "
                     "the swapped suits.")
    elif below["buckets"]:
        parts.append("Below it hands share buckets, so the strategies there aren't per hand.")
    if hand_scoped and below["river_classes"]:
        parts.append("Locking some hands and not others breaks that symmetry, so the class subtrees average them: "
                     "treat a hand-scoped lock here as approximate.")
    parts.append("Exploitability is measured in this tree, not in the full game.")
    return " ".join(parts)


def _words(seat: str, names: Sequence[str], mix: Sequence[float], hands) -> str:
    held = ", ".join(f"{n} {m * 100:.1f}%" for n, m in zip(names, mix) if m > 0)
    if hands == "all":
        who = "whole range"
    else:
        who = ", ".join(list(hands.get("classes") or []) + list(hands.get("combos") or []))
    return f"{seat} holds {held} ({who})"


def _run(adv, sol: LockedSolution, left: float, first: int, target: Optional[float], post, t0: float,
         started: float) -> None:
    """A heads-up solve's checks (Advisor._hu_run's), saying how it goes at each: `left` seconds from `t0`, the request
    having started at `started`. `target` None: to the end."""
    checks = [c for c in HU_CHECKS if c >= first] + [ITERATIONS]
    while sol.iters < ITERATIONS:
        expl = None
        if sol.iters in checks:
            if target is not None or post is not None:
                expl = sol.solver.exploitability(sol.r0, sol.r1)
            if post is not None:
                post({"study": "nodelock_progress", "iterations": int(sol.iters), "of": ITERATIONS,
                      "exploitability_pct": round(expl, 4) if expl is not None else None,
                      "seconds": round(time.time() - started, 2)})
            if target is not None and expl < target:
                break
        rem = left - (time.time() - t0)
        if rem <= 0:
            break
        goal = min(c for c in checks if c > sol.iters)
        _, secs = sol.solver.run(sol.r0, sol.r1, time_budget=rem, max_iters=goal, min_iters=1,
                                 should_stop=adv.should_stop, reserve=HU_RESERVE)
        sol.iters = sol.solver.iters
        sol.seconds += secs
        if sol.iters < goal:
            break
    if not sol.fresh():
        sol._refresh()


def locked_study(adv, state: dict, post=None) -> dict:
    """The answer for a Study node held at state["nodelock"]; LockError or LockRefused with words for the page; `post`
    (one argument, a dict) hears how the solve goes. Cancelled as any solve."""
    t0 = time.time()
    n = _board_cards(state)
    if n < 3:
        raise LockRefused("Node locking is postflop: preflop is the charts or a separate solve, not this tree.")
    found = _study(adv, state, flop=n == 3)
    sol, node, cur = found["sol"], found["node"], found["cur"]
    cfg = sol.ctx.cfg
    if getattr(cfg, "icm", None) is not None:
        raise LockRefused("A tournament's payoffs aren't zero-sum, and a lock hasn't been checked on them: this is for "
                          "cash games.")
    if not isinstance(sol.root, Decision) or node.player != found["hero_p"]:
        raise LockRefused("The tree expected the other player to act here, so the node on screen isn't one it has.")
    line = line_to(sol.root, node)
    lock = _lock_of(state, found, line)
    seats = [found["hero"], found["villain"]] if found["hero_p"] == 0 else [found["villain"], found["hero"]]
    unlocked = measure_plain(sol)
    budget = max(0.5, min(120.0, float(state.get("budget") or adv.time_budget)))
    target = adv.hu_settled
    street = cur.name
    first = max(adv.hu_settled_from.get(street, HU_CHECKS[0]), HU_CHECKS[0])
    a = found["asked"]
    t1 = time.time()
    try:
        held = solve_locked(a["board"], a["r0"], a["r1"], a["pot"], a["stack"], [lock], bets=a["bets"],
                            to_act=a["to_act"], n_raises=a["n_raises"], cfg=cfg, time_budget=budget,
                            max_iters=min(c for c in HU_CHECKS if c >= first), should_stop=adv.should_stop,
                            reserve=HU_RESERVE, horizon=ITERATIONS, same_tree=tree_shape(sol.root))
    except TooSlow:
        raise LockError("The solver can't run this tree on this device in the time this mode has.") from None
    _run(adv, held, budget, first, target, post, t1, t0)
    m = held.measure()
    applied = held.applied[0]
    hand_scoped = lock.hands != "all"
    notes = list(applied.notes)
    if hand_scoped and applied.ignored:
        notes.append(f"{applied.ignored} of the hands named aren't in {found['hero']}'s range here: "
                     f"{', '.join(applied.ignored_hands)}.")
    if cfg.rake_rate > 0:
        notes.append("The pot is raked, so the two values don't sum to zero: the benchmark behind this lock is unraked.")
    if n == 3:
        notes.append("The flop is solved live here, whichever source answers it on screen: stored flops aren't trees "
                     "that can be re-solved.")
    notes.extend(x for x in found["notes"] if "to tree action" not in x)
    aim = adv.expl_target
    rough = hand_scoped and _below(held.root)["river_classes"]
    short = aim is not None and m["exploitability_pct"] > OVER_TARGET * aim
    if short:
        notes.append(f"The solve stopped {m['exploitability_pct']:.2f}% of the pot from the restricted game's "
                     f"equilibrium, more than {OVER_TARGET} times this mode's aim of {aim}%.")
    pin = next(iter(held.solver._pins.values()))
    reached = _walked(held.root, line, held.r0, held.r1)[-1][2][lock.player]
    in_lock = float(reached[pin.mask[0]].sum())
    out = {
        "study": "nodelock", "street": street, "actor": found["hero"], "opponent": found["villain"],
        "position": "OOP" if found["hero_p"] == 0 else "IP", "board": cards_str(found["board"]),
        "kind": "node-locked equilibrium", "game": "restricted", "label": LABEL,
        "node_lock": {
            "line": list(line), "seat": found["hero"], "player": lock.player, "seats": seats,
            "actions": applied.names, "mix": applied.mix, "hands": lock.hands, "cells": applied.cells,
            "ignored": applied.ignored, "ignored_hands": applied.ignored_hands,
            "words": _words(found["hero"], applied.names, applied.mix, lock.hands),
            "share_held": in_lock / max(float(reached.sum()), 1e-12),
            "untrained": bool(min(applied.mix) <= 0.0),
            "root_pot": m["root_pot"],
            "locked": {**m, "seconds": round(held.seconds, 2)},
            "unlocked": unlocked,
            "changes": _changes(sol, held, line, seats),
            "abstraction": abstraction_words(street, held.root, hand_scoped),
            "scope": SCOPE_NODE if node is sol.root and cur.actions else SCOPE_STREET,
        },
        "solver": {"iterations": int(held.iters), "solve_seconds": round(held.seconds, 2), "nodes": held.n_nodes,
                   "active_combos": held.ctx.n, "exploitability_pct": round(max(m["exploitability_pct"], 0.0), 4),
                   "core": bool(core.lib() is not None and held.solver.use_core and held.solver._core_ok),
                   **({"target_pct": aim} if aim is not None else {}), **({"approximate": True} if rough or short else {})},
        "notes": notes, "seconds": round(time.time() - t0, 2),
    }
    return out


def answer(adv, state: dict, post=None) -> dict:
    """locked_study as the worker sends it: what's wrong with a lock comes back in words (lock_error "invalid" for one
    that makes no sense, "refused" for one this spot can't honour), and `live_actions` where the actions differ."""
    try:
        with np.errstate(all="ignore"):
            return locked_study(adv, state, post)
    except LockRefused as e:
        return {"error": str(e), "lock_error": "refused", **({"live_actions": e.actions} if hasattr(e, "actions") else {})}
    except LockError as e:
        return {"error": str(e), "lock_error": "invalid"}

