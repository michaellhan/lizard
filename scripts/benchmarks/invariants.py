"""Checks that need the engine and the reference side by side, or a computation done by hand.

    python scripts/benchmarks/invariants.py [results/invariants.json]

  evaluator   the engine's and the reference's hand order on random boards
  polar_river the polarized river's closed-form equilibrium, with and without rake, against both sides
  lock_toy    a locked river node: the engine's best response against numbers worked out on paper
  lock_spot   a lock on a real spot: the engine's best response against the reference's, per combo and action
  subgame     a node solved on its own against the same node inside the whole solve, on both sides
  icm         Malmuth-Harville against a brute-force count, winner-take-all as chips, terminal prize equity, a river
              solved in prize equity and measured by the reference
  icm_ties    the size of the engine's split approximation in prize equity, on a board that chops often
  determinism the same solve twice
  sensitivity the engine's answer spoiled on purpose: the comparison must fail each one
A check that fails is written down as failed; nothing here raises on a bad number.
"""
from __future__ import annotations

import json
import os
import sys
import time

import engine_worker as ew  # noqa: E402  (sets the thread limits, imports gto)
import numpy as np  # noqa: E402

import build  # noqa: E402
import compare  # noqa: E402
import spots  # noqa: E402
from gto import evaluator as engine_eval  # noqa: E402
from gto import icm as engine_icm  # noqa: E402
from gto.cards import ALL_COMBOS, card, card_str  # noqa: E402
from gto.exploit import TendencyLock  # noqa: E402
from gto.solver import Config, solve  # noqa: E402
from refsolver import lp  # noqa: E402
from refsolver.cards import card_id, combo_cards, hands_with_board, score  # noqa: E402
from refsolver.hu import DCFR, Chips, HUGame, Holdem  # noqa: E402
from refsolver.icm import ICMPayoffs, equities as ref_equities  # noqa: E402
from refsolver.rules import HUSpec, Menu, hu_tree  # noqa: E402

STREETS = ("flop", "turn", "river")
ENGINE_ITERS = 20000


def ok(diff, tol) -> bool:
    return bool(abs(diff) <= tol)


def evaluator_agreement(boards: int = 3000, seed: int = 11) -> dict:
    """The two evaluators order all 1,081 hands on random rivers the same way, ties included."""
    rng = np.random.default_rng(seed)
    bad = 0
    for _ in range(boards):
        cards_ = rng.choice(52, 5, replace=False)
        b_engine = tuple(int(c) for c in cards_)
        b_ref = [card_id(card_str(c)) for c in b_engine]
        active = [i for i, (x, y) in enumerate(ALL_COMBOS) if x not in b_engine and y not in b_engine]
        e = np.asarray(engine_eval.eval_board(tuple(sorted(b_engine)), active))
        hole = [(card_id(card_str(ALL_COMBOS[i][0])), card_id(card_str(ALL_COMBOS[i][1]))) for i in active]
        r = score(hands_with_board(hole, b_ref))
        if not np.array_equal(np.unique(e, return_inverse=True)[1], np.unique(r, return_inverse=True)[1]):
            bad += 1
    return {"boards": boards, "hands_each": 1081, "boards_disagreeing": bad, "pass": bad == 0}


def _toy_spot(name, oop, ip, pot, stack, bets, raises=(0.75,), rake=0.0, cap=None, max_raises=2, allin_spr=0.0, **kw):
    return dict(name=name, kind="hu", board=spots.RIVER_BOARD, oop=oop, ip=ip, pot=pot, stack=stack,
                menu={"bets": list(bets), "raises": list(raises)}, max_raises=max_raises, allin_spr=allin_spr,
                rake=rake, cap=cap, **kw)


def polar_river() -> dict:
    """A polarized river with one all-in size: OOP has one nut hand and one air hand, IP one bluff-catcher. From the
    indifferences, with rake R0 on the unbet pot P and R1 on the called pot P + 2B:
      air's share of the bets  b = B / (P + 2B - R1)      call frequency  c = (P - R0) / (P - R0 + B)
      air bets x = b / (1 - b) of the time (one combo each); nuts always bet."""
    out = {}
    P, B = 20.0, 20.0
    for label, rate, cap in (("no rake", 0.0, None), ("5% uncapped", 0.05, None), ("5% capped at 2", 0.05, 2.0)):
        spot = _toy_spot("polar", "7h7c,6h5h", "KdQd", P, B, [1.0], rake=rate, cap=cap)
        rake = lambda pot: min(rate * pot, cap) if cap is not None else rate * pot  # noqa: E731
        R0, R1 = rake(P), rake(P + 2 * B)
        b = B / (P + 2 * B - R1)
        c = (P - R0) / (P - R0 + B)
        x = b / (1 - b)
        nuts = c * (P / 2 + B - R1) + (1 - c) * (P / 2 - R0)
        air = -P / 2
        v_oop = (nuts + air) / 2
        meta, strat, sol = ew.run_hu(spot, ENGINE_ITERS)
        game = build.hu_game(spot)
        names = game.deal.names[0]
        air_i, call_i = names.index("6h5h"), game.acts[-1]
        DCFR(game).run(20000)
        refavg = game.average()
        profile = compare.engine_profile(game, meta, _Mem(strat))
        by_path = {n.path: n for n in game.acts}
        bet = by_path[""].names.index("all-in")
        vs_bet = by_path["/all-in"].names.index("call")
        row = {
            "air_bets_hand": x, "air_bets_engine": float(profile[""][0, bet, air_i]),
            "air_bets_reference": float(refavg[""][0, bet, air_i]),
            "ip_calls_hand": c, "ip_calls_engine": float(profile["/all-in"][0, vs_bet, 0]),
            "ip_calls_reference": float(refavg["/all-in"][0, vs_bet, 0]),
            "oop_value_hand": v_oop, "oop_value_engine": meta["engine_values"][0],
            "oop_value_reference": game.value(refavg, 0),
            "gains_engine_by_ref_bb": game.gains(profile)["gain"],
        }
        if rate == 0:
            row["oop_value_lp"] = lp.solve(game)["value_each_side"][0]
        row["pass"] = ok(row["air_bets_engine"] - x, 0.005) and ok(row["ip_calls_engine"] - c, 0.005) and \
            ok(row["oop_value_engine"] - v_oop, 0.01) and ok(row["air_bets_reference"] - x, 0.005) and \
            ok(row["ip_calls_reference"] - c, 0.005) and ok(row["oop_value_reference"] - v_oop, 0.01)
        out[label] = row
    out["pass"] = all(v["pass"] for v in out.values() if isinstance(v, dict))
    return out


class _Mem(dict):
    """A dict standing in for a loaded npz."""

    def __getitem__(self, k):
        return dict.__getitem__(self, k[2:] if k.startswith("s:") else k)


def lock_toy() -> dict:
    """OOP holds one bluff (6h5h, losing to everything at showdown); IP AhAd or KdQd, equally likely. Pot 10, all-in 10
    after a check or as a bet. With IP's response to the all-in locked, EV(all-in) relative to folding now (i.e. with
    the 5 already in as sunk) is  f x 10 + (1 - f) x (-10)  where f is the share of IP's range folding, and EV(check) is
    0 when IP checks behind: OOP then gives up its 5 at showdown, the same as folding.
      lock A: AA calls, KQ folds 60%: f = 0.3, all-in = -4.
      lock B: both fold 90%:          f = 0.9, all-in = +8.
    TendencyLock's "fold +30" against a range that calls with everything moves its weakest half first: KQ folds 60%,
    the same as lock A."""
    pot, stack = 10.0, 10.0
    spot = _toy_spot("lock", "6h5h", "AhAd,KdQd", pot, stack, [1.0])
    board = ew.board_cards(spot)
    r0, r1 = ew.hu_ranges(spot)
    sol = solve(board, r0, r1, pot, stack, cfg=ew.hu_config(spot), time_budget=1e9, max_iters=2000)
    s, root = sol.solver, sol.root
    jam = root.children[root.names.index("all-in")]
    combos = [ALL_COMBOS[i] for i in sol.ctx.active]
    label = [card_str(a) + card_str(b) for a, b in combos]
    aa = next(i for i, c in enumerate(label) if set((c[:2], c[2:])) == {"Ah", "Ad"})
    kq = next(i for i, c in enumerate(label) if set((c[:2], c[2:])) == {"Kd", "Qd"})
    behind = root.children[root.names.index("check")]

    def fixed(fold_aa, fold_kq):
        def lock(node, strat, reach):
            st = strat.copy()
            if node is jam:
                st[:, :, :] = 0
                fold, call = node.names.index("fold"), node.names.index("call")
                st[:, fold, aa], st[:, call, aa] = fold_aa, 1 - fold_aa
                st[:, fold, kq], st[:, call, kq] = fold_kq, 1 - fold_kq
            if node is behind:
                st[:, :, :] = 0
                st[:, node.names.index("check"), :] = 1.0
            return st
        return lock

    def evs(lock):
        e = s.node_action_br_evs(root, sol.r0, sol.r1, lock=lock)
        hero = next(i for i, c in enumerate(label) if sol.r0[i] > 0)
        return {n: float(e[a, hero]) for a, n in enumerate(root.names)}

    out = {}
    for label_, f_aa, f_kq, want in (("A: AA calls, KQ folds 60%", 0.0, 0.6, -4.0), ("B: both fold 90%", 0.9, 0.9, 8.0)):
        got = evs(fixed(f_aa, f_kq))
        out[label_] = {"allin_hand": want, "allin_engine": got["all-in"], "check_hand": 0.0, "check_engine": got["check"],
                       "pass": ok(got["all-in"] - want, 1e-4) and ok(got["check"], 1e-4)}
    # the app's lock: "fold +30" over the solved strategy, with IP still checking behind
    tl = TendencyLock(sol.ctx, 1, {"fold": 30.0})
    base = fixed(0.0, 0.0)

    def tendency(node, strat, reach):
        st = strat.copy()
        if node is jam:
            st = base(node, strat, reach)        # the range calling with everything, as the docstring's sum assumes
        if node is behind:
            return base(node, strat, reach)
        return tl(node, st, reach)

    got = evs(tendency)
    out["TendencyLock fold +30"] = {"allin_hand": -4.0, "allin_engine": got["all-in"],
                                    "pass": ok(got["all-in"] + 4.0, 1e-3)}
    out["pass"] = all(v["pass"] for v in out.values() if isinstance(v, dict))
    return out


def lock_spot() -> dict:
    """On river-one-size: IP's reply to the bet locked, the engine's best response per combo and action against the
    reference's, for a lock of the engine's (TendencyLock) and an arbitrary per-combo lock."""
    spot = spots.get("river-one-size")
    meta, strat, sol = ew.run_hu(spot, ENGINE_ITERS)
    game = build.hu_game(spot)
    prof = compare.engine_profile(game, meta, _Mem(strat))
    root, s = sol.root, sol.solver
    bet = next(i for i, n in enumerate(root.names) if n.startswith("bet"))
    node = root.children[bet]
    path = "/" + root.names[bet]
    pos = {compare.name_of(c): i for i, c in enumerate(meta["combos"])}
    take = [pos[h] for h in game.deal.names[1]]
    hero = [pos[h] for h in game.deal.names[0]]
    r0, r1 = sol.r0[None, :], sol.r1[None, :]

    seen = {}

    def recorded(lock):
        def inner(n, st, reach):
            out = lock(n, st, reach)
            if n is node:
                seen["strategy"] = np.asarray(out)[0][:, take].astype(np.float64)
            return out
        return inner

    def arbitrary(n, st, reach):
        if n is not node:
            return st
        st = st.copy()
        st[:, :, :] = 0
        st[:, 0, ::2] = 1.0          # every other combo folds, the rest call
        st[:, 1, 1::2] = 1.0
        return st

    tl = TendencyLock(sol.ctx, 1, {"fold": 25.0})

    def tendency(n, st, reach):
        return tl(n, st, reach) if n is node else st

    out = {}
    for label, lock in (("TendencyLock fold +25", tendency), ("arbitrary per-combo lock", arbitrary)):
        e = s.node_action_br_evs(root, sol.r0, sol.r1, lock=recorded(lock))
        locked = seen["strategy"]
        q = {}
        game.walk(prof, 0, True, q, lock={path: locked[None, :, :]})
        mass = game.deal.compat.astype(np.float64) @ game.r0[1]
        mine = q[""][0] / np.maximum(mass, 1e-12) + spot["pot"] / 2
        theirs = np.asarray(e)[:, hero]
        out[label] = {"largest_diff_bb": float(np.abs(mine - theirs).max()), "combos": len(hero),
                      "pass": ok(np.abs(mine - theirs).max(), 1e-3)}
    out["pass"] = all(v["pass"] for v in out.values() if isinstance(v, dict))
    return out


def subgame() -> dict:
    """Two nodes, each with the ranges reaching it in the engine's whole solve, solved alone: by the engine (as the app
    does when you open a node) and by the reference's LP. Three numbers should agree: the node's value inside the whole
    solve, and the two lone solves' values. River facing a bet; a river after the turn is checked through."""
    out = {}
    cases = [("river-one-size", "/bet 75%", None), ("turn-one-size", "/check/check|", "9d")]
    for name, path, river in cases:
        spot = dict(spots.get(name))
        meta, strat, sol = ew.run_hu(spot, 20000 if river is None else 3000)
        game = build.hu_game(spot)
        prof = compare.engine_profile(game, meta, _Mem(strat))
        node = next(n for n in game.acts if n.path == path)
        row = 0
        board_text = spot["board"]
        if river is not None:
            board_text = spot["board"] + river
            row = next(i for i, b in enumerate(node.boards) if compare.board_text(b) == board_text)
        whole = game.reaches(prof)[path]
        floor = 1e-7
        ranges = []
        for p in (0, 1):
            w = whole[p][row] * node.alive[row] if node.player == p else whole[p][row] * game.deal.alive(node.boards, p)[row]
            big = float(w.max())
            ranges.append({h: float(x) / big for h, x in zip(game.deal.names[p], w) if x / big > floor})
        inv = _inv_at(game, path)
        sub = dict(spot, board=board_text, ranges_exact=ranges)
        if river is None:
            # facing the bet: the river's pot and the bet as they stand
            sub.update(bets0=(inv[0] - spot["pot"] / 2, inv[1] - spot["pot"] / 2), to_act=node.player, n_raises=1)
        else:
            sub.update(pot=inv[0] + inv[1], stack=spot["stack"] - (inv[0] - spot["pot"] / 2))
        v_whole = _node_values(game, prof, node, row)
        m2, st2, _ = ew.run_hu(sub, 20000)
        g2 = build.hu_game(sub)
        prof2 = compare.engine_profile(g2, m2, _Mem(st2))
        diff_tree = compare.hu_tree_diff(g2, m2["tree"], m2["rows"])
        res = lp.solve(g2)
        v_lp = res["value_each_side"][0]
        v_eng = m2["engine_values"][0]
        base = spot["pot"] / 2 if river is None else inv[0]
        expl = (sum(g2.gains(prof2)["gain"])) / 2 / m2["root_pot"] * 100
        row_out = {"node": path + (river or ""), "tree_identical": diff_tree is None,
                   "hands_at_node": [len(ranges[0]), len(ranges[1])],
                   "whole_oop_value_bb": v_whole[0], "alone_engine_oop_value_bb": v_eng, "alone_lp_oop_value_bb": v_lp,
                   "alone_engine_expl_by_ref_pct": expl, "diff_whole_vs_lp_bb": v_whole[0] - v_lp,
                   "diff_engine_vs_lp_bb": v_eng - v_lp, "pot_at_node": m2["root_pot"]}
        row_out["pass"] = diff_tree is None and ok(row_out["diff_whole_vs_lp_bb"] / m2["root_pot"] * 100, 0.1) and \
            ok(row_out["diff_engine_vs_lp_bb"] / m2["root_pot"] * 100, 0.05)
        out[path + (river or "")] = row_out
    out["pass"] = all(v["pass"] for v in out.values() if isinstance(v, dict))
    return out


def _inv_at(game: HUGame, path: str):
    """Chips in at a node: the inv of the first terminal below it that isn't a fold's (or a fold's own)."""
    from refsolver.hu import NDeal, NEnd
    n = next(x for x in game.acts if x.path == path)
    # the node's own stakes are the fold terminal's when one is there, else the check-through showdown's
    while not isinstance(n, NEnd):
        n = n.kid if isinstance(n, NDeal) else n.kids[0]
    return n.inv


def _node_values(game: HUGame, strat: dict, node, row: int) -> tuple:
    """Both players' values in one row of `node`, per pair of hands reaching it, under `strat`: the walk of hu.py run
    from the reaches at the node instead of from the root."""
    from refsolver.hu import NDeal, NEnd
    reach = game.reaches(strat)[node.path]
    out = []

    def go(n, p, ro, rows):
        o = 1 - p
        if isinstance(n, NEnd):
            return (n.pay[p][rows] @ ro[:, :, None])[:, :, 0]
        if isinstance(n, NDeal):
            B, K = ro.shape[0], n.K
            kid_rows = (rows[:, None] * K + np.arange(K)).ravel()
            ro2 = (ro[:, None, :] * n.keep[o][rows]).reshape(B * K, -1)
            u = go(n.kid, p, ro2, kid_rows).reshape(B, K, -1)
            return (u * n.keep[p][rows]).sum(axis=1) / n.div
        s = strat[n.path][rows]
        if n.player == o:
            u = 0.0
            for a, kid in enumerate(n.kids):
                u = u + go(kid, p, ro * s[:, a, :], rows)
            return u
        us = np.stack([go(kid, p, ro, rows) for kid in n.kids], axis=1)
        return (us * s).sum(axis=1)

    rows = np.array([row])
    mass = game.deal.mass(node.boards).astype(np.float64)[row]
    pairs = float(reach[0][row] @ mass @ reach[1][row])
    for p in (0, 1):
        u = go(node, p, reach[1 - p][row][None, :], rows)[0]
        out.append(float(reach[p][row] @ u) / pairs)
    return tuple(out)


def icm() -> dict:
    out = {}
    # Malmuth-Harville: the engine's dynamic programme against walking every finishing order
    cases = [([40, 30, 20, 10], [50, 30, 20]), ([5, 5, 5, 5, 5], [40, 30, 20, 10]), ([70, 20, 8, 2], [100]),
             ([33, 21, 13, 8, 5, 3], [60, 25, 15])]
    worst = max(float(np.abs(np.array(ref_equities(s, p)) - engine_icm.equities(s, p)).max()) for s, p in cases)
    out["malmuth_harville"] = {"cases": len(cases), "largest_diff": worst, "pass": worst < 1e-9}

    stacks = {"A": 45.0, "B": 30.0, "C": 25.0}
    pay = [50.0, 30.0, 20.0]
    spot = _toy_spot("icm", "99,77,33,K9s,QJs,JTs,65s", "AKo,KQo,QQ,JJ,98s", 20.0, 20.0, [0.75])
    spot["reference"] = "cfr"
    contrib = {"A": 10.0, "B": 10.0}
    # the engine's terminals against the reference's rule
    model = engine_icm.Model(stacks, pay)
    payoffs = engine_icm.HUPayoffs(model, ("A", "B"), contrib, (10.0, 10.0))
    ref_pay = ICMPayoffs([45.0, 30.0, 25.0], pay, (0, 1), (0.0, 0.0))
    game = build.hu_game(spot, ref_pay)
    out["spot_has_ties"] = any(e.kind == "show" and _ties(game, e) for e in game.ends)
    meta, strat, sol = ew.run_hu(spot, ENGINE_ITERS, {"icm": payoffs})
    diff = 0.0
    for e in game.ends:
        t = meta["tree"][e.path] if e.path in meta["tree"] else None
        if t is None or "pay" not in t:
            continue
        if e.kind == "fold":
            diff = max(diff, abs(t["pay"][0] - e.values[0]), abs(t["pay"][1] - e.values[1]))
        else:
            w0, l0, t0, w1, l1, t1 = e.values
            a0, b0, a1, b1 = t["pay"]
            diff = max(diff, abs(a0 + b0 - w0), abs(a0 - b0 - l0), abs(a1 + b1 - w1), abs(a1 - b1 - l1))
    out["terminal_values"] = {"terminals": len(game.ends), "largest_diff_chip_eq": diff, "pass": diff < 1e-3}
    # a split: the rule against the engine's mean of a win and a loss
    allin = max((e for e in game.ends if e.kind == "show"), key=lambda e: e.inv[0])
    out["split_value"] = {"pot": allin.inv[0] + allin.inv[1], "rule_chip_eq": allin.values[2],
                          "engine_mean_chip_eq": (allin.values[0] + allin.values[1]) / 2,
                          "note": "the engine's documented approximation; this spot has no ties, so the river below doesn't feel it"}
    d = compare.hu_tree_diff(game, meta["tree"], meta["rows"])
    prof = compare.engine_profile(game, meta, _Mem(strat))
    g = game.gains(prof)
    DCFR(game).run(20000)
    avg = game.average()
    gr = game.gains(avg)
    out["river_in_prize_equity"] = {
        "tree_identical": d is None, "iterations": ENGINE_ITERS, "root_pot": meta["root_pot"],
        "value_engine_by_ref": g["value"], "value_engine_own": meta["engine_values"], "value_ref_cfr": gr["value"],
        "gains_engine_by_ref": g["gain"], "gains_ref_cfr": gr["gain"], "engine_own_pct": meta["engine_exploitability_pct"],
        "zero_sum": game.zero_sum(),
        "pass": d is None and sum(g["gain"]) / 2 / meta["root_pot"] * 100 <= 0.05}
    # winner-take-all: prize equity is chips, so the same river's value must equal the chip game's
    wta = engine_icm.HUPayoffs(engine_icm.Model(stacks, [100.0]), ("A", "B"), contrib, (10.0, 10.0))
    m_chip, _, _ = ew.run_hu(spot, ENGINE_ITERS)
    m_wta, _, _ = ew.run_hu(spot, ENGINE_ITERS, {"icm": wta})
    dv = max(abs(a - b) for a, b in zip(m_chip["engine_values"], m_wta["engine_values"]))
    out["winner_take_all_is_chips"] = {"largest_value_diff_bb": dv, "pass": dv < 1e-3}
    # a bubble: prize equity must make calling off cost more than chips say
    chip = m_chip["engine_values"]
    out["bubble_direction"] = {"chip_values": chip, "prize_values": meta["engine_values"],
                               "sum_prize_values_vs_others": sum(meta["engine_values"]),
                               "note": "two players in a pot lose prize equity to the third on average: the sum "
                                       "should be negative, the chip game's zero",
                               "pass": sum(meta["engine_values"]) < 0}
    out["pass"] = all(v.get("pass", True) for v in out.values() if isinstance(v, dict)) and not out["spot_has_ties"]
    return out


def icm_ties() -> dict:
    """The one place the engine's prize model is knowingly not the rule: a split pays the mean of a win and a loss
    (solver/gto/icm.py). On a board that chops often, the engine's solve in its own payoffs, then measured by the
    reference in the true payoffs of a split, so the approximation gets a size rather than an adjective."""
    stacks = {"A": 45.0, "B": 30.0, "C": 25.0}
    pay = [50.0, 30.0, 20.0]
    spot = dict(_toy_spot("icm-ties", "AA,KK,QQ,JJ,Ts9d,AsKs,T7s", "T4s,T3s,QQ,AdKd,AsQd,KdQc", 20.0, 20.0, [0.75]),
                board="5c6d7h8s9c", reference="cfr")
    payoffs = engine_icm.HUPayoffs(engine_icm.Model(stacks, pay), ("A", "B"), {"A": 10.0, "B": 10.0}, (10.0, 10.0))
    game = build.hu_game(spot, ICMPayoffs([45.0, 30.0, 25.0], pay, (0, 1), (0.0, 0.0)))
    meta, strat, _ = ew.run_hu(spot, ENGINE_ITERS, {"icm": payoffs})
    d = compare.hu_tree_diff(game, meta["tree"], meta["rows"])
    g = game.gains(compare.engine_profile(game, meta, _Mem(strat)))
    DCFR(game).run(20000)
    gr = game.gains(game.average())
    pot = meta["root_pot"]
    return {"tree_identical": d is None, "has_ties": any(e.kind == "show" and _ties(game, e) for e in game.ends),
            "iterations": ENGINE_ITERS, "root_pot": pot, "engine_own_expl_pct_in_its_payoffs": meta["engine_exploitability_pct"],
            "engine_values_own": meta["engine_values"], "engine_values_true_split": g["value"], "ref_values_true_split": gr["value"],
            "gains_engine_true_split": g["gain"], "gains_ref_true_split": gr["gain"],
            "engine_gain_pct_pot_true_split": sum(g["gain"]) / 2 / pot * 100,
            "own_vs_true_value_pct_pot": max(abs(a - b) for a, b in zip(meta["engine_values"], g["value"])) / pot * 100,
            "note": "measures a documented approximation, so it is reported rather than judged",
            "pass": d is None}


def _ties(game, e) -> bool:
    _, _, _, tie = game._outcomes[id(e.boards)]
    return bool(tie.any())


def determinism() -> dict:
    spot = spots.get("river-two-sizes")
    a = ew.run_hu(spot, 3000)[1]
    b = ew.run_hu(spot, 3000)[1]
    same = all(np.array_equal(a[k], b[k]) for k in a)
    g1, g2 = build.hu_game(spot), build.hu_game(spot)
    r1, r2 = lp.solve(g1), lp.solve(g2)
    same_lp = all(np.array_equal(r1["strategy"][k], r2["strategy"][k]) for k in r1["strategy"])
    return {"engine_identical": same, "lp_identical": same_lp, "pass": same and same_lp}


def sensitivity() -> dict:
    """Would the benchmark notice? The engine's answer on one river, spoiled on purpose in ways a real bug would, each
    run through the same comparison. Every spoiled answer must fail, and the unspoiled one must pass."""
    spot = spots.get("river-one-size")
    game = build.hu_game(spot)
    res = lp.solve(game)
    ref = {"gains": game.gains(res["strategy"])}
    ref_npz = {"s:" + k: v for k, v in res["strategy"].items()}
    meta, strat, _ = ew.run_hu(spot, 3000)
    meta["peak_rss_mb"] = 0.0

    def run(m, st):
        r = compare.compare_hu(spot, game, m, _Mem(st), ref, ref_npz)
        return {k: r.get(k) for k in ("tree_identical", "not_compared", "value_diff_pct_pot", "expl_engine_by_ref_pct",
                                      "pass")}

    out = {"clean": run(meta, strat)}
    mixed = dict(strat)                                       # a strategy 5% of the way to uniform at every node
    for k, v in strat.items():
        u = np.ones_like(v) / v.shape[1]
        mixed[k] = 0.95 * v + 0.05 * u
    out["strategies_5pct_toward_uniform"] = run(meta, mixed)
    swapped = dict(meta, combos=list(reversed(meta["combos"])))  # hands crossed: a card-order or range-mapping bug
    out["hands_crossed"] = run(swapped, strat)
    tree = {k: dict(v) for k, v in meta["tree"].items()}
    key = next(k for k, v in tree.items() if v["kind"] == "showdown")
    tree[key]["inv"] = [tree[key]["inv"][0] + 0.5, tree[key]["inv"][1] + 0.5]    # half a blind of chips off at one showdown
    out["tree_chips_off"] = run(dict(meta, tree=tree), strat)
    tree = {k: dict(v) for k, v in meta["tree"].items()}
    key = next(k for k, v in tree.items() if v["kind"] == "act")
    tree[key]["names"] = list(reversed(tree[key]["names"]))   # actions in another order
    out["tree_actions_reordered"] = run(dict(meta, tree=tree), strat)
    spoiled = [v for k, v in out.items() if k != "clean"]
    out["pass"] = bool(out["clean"]["pass"]) and not any(v["pass"] for v in spoiled)
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ew.HERE, "results", "invariants.json")
    out = {}
    for name, fn in (("evaluator", evaluator_agreement), ("polar_river", polar_river), ("lock_toy", lock_toy),
                     ("lock_spot", lock_spot), ("subgame", subgame), ("icm", icm), ("determinism", determinism),
                     ("icm_ties", icm_ties), ("sensitivity", sensitivity)):
        t0 = time.time()
        try:
            out[name] = fn()
        except Exception as e:  # a crash is a failed check, written down
            import traceback
            out[name] = {"pass": False, "error": repr(e), "trace": traceback.format_exc()[-1500:]}
        out[name]["seconds"] = time.time() - t0
        print(name, "pass" if out[name].get("pass") else "FAIL", f"{out[name]['seconds']:.1f} s", flush=True)
    out["peak_rss_mb"] = ew.peak_rss_mb()
    with open(path, "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
