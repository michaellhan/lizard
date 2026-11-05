"""What the benchmark reports for a spot: is the tree the same, and how do the two answers differ. Reads the engine's
exported tree and strategies from files; imports no engine code, so every number below that says "measured by the
reference" comes from the reference's own evaluator, tree walker and best response.

The order of the comparison matters. Equilibria of a poker game are not unique, so two correct solvers can differ in
strategy, and what they must agree on is the value, and each must be unexploitable. So the value and each side's gains
come first; strategies come last, with every sizeable difference checked against the action values: an action the
engine plays more than the LP does, at a hand and node that matter, is "within an indifference" if it earns as much
as the best action against the LP's opponent strategy (with a best-responding continuation).
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from refsolver.cards import card_id, card_text, combo_text
from refsolver.hu import HUGame, NAct, NDeal, NEnd
from refsolver.mw import MAct, MEnd, MWGame

TV_FLAG = 0.05          # an infoset's strategies count as different past this total variation ...
REACH_FLOOR = 1e-3      # ... on infosets reached this often, per dealt pair, under either profile
INDIFFERENT_PCT = 0.10  # an action within this % of the root pot of the best one, per hand there, counts as indifferent
TOL_VALUE_PCT = 0.05    # pass: game values within this % of the pot ...
TOL_EXPL_PCT = 0.05     # ... and the engine's exploitability, by the reference's best response, under this


def name_of(text: str) -> str:
    return combo_text(card_id(text[:2]), card_id(text[2:]))


def board_text(b) -> str:
    return "".join(card_text(c) for c in b)


def hu_tree_diff(game: HUGame, tree: dict, rows: dict) -> Optional[str]:
    """None if the engine's tree is this game's, node by node (players, actions in order, chips, rake, boards)."""
    seen = set()

    def only_runout(n):
        return isinstance(n, NEnd) or (isinstance(n, NDeal) and only_runout(n.kid))

    def stop(n):
        return n.kid if not isinstance(n.kid, NDeal) else stop(n.kid)

    def go(n, path):
        if isinstance(n, NDeal):
            if only_runout(n):
                e = stop(n)
                t = tree.get(path)
                seen.add(path)
                if t is None or t["kind"] != "leaf":
                    return f"{path!r}: reference runs the cards out, engine has {t and t['kind']}"
                return check_money(e, t, path)
            return go(n.kid, path + "|")
        t = tree.get(path)
        seen.add(path)
        if t is None:
            return f"{path!r}: not in the engine's tree"
        if isinstance(n, NAct):
            if t["kind"] != "act" or t["player"] != n.player or t["names"] != n.names:
                return f"{path!r}: reference {n.player} {n.names}, engine {t}"
            if sorted(board_text(b) for b in n.boards) != sorted(rows[path]):
                return f"{path!r}: different boards"
            for name, kid in zip(n.names, n.kids):
                d = go(kid, f"{path}/{name}")
                if d:
                    return d
            return None
        want = "fold" if n.kind == "fold" else "showdown"
        if t["kind"] != want:
            return f"{path!r}: reference {want}, engine {t['kind']}"
        if n.kind == "fold" and t["folder"] != n.folder:
            return f"{path!r}: folder"
        return check_money(n, t, path)

    def check_money(e, t, path):
        if max(abs(t["inv"][0] - e.inv[0]), abs(t["inv"][1] - e.inv[1])) > 1e-6:
            return f"{path!r}: chips in, reference {e.inv}, engine {t['inv']}"
        if abs(t["rake"] - e.rake) > 1e-6:
            return f"{path!r}: rake, reference {e.rake}, engine {t['rake']}"
        return None

    d = go(game.root, "")
    if d:
        return d
    extra = set(tree) - seen
    return f"engine nodes the reference lacks: {sorted(extra)[:3]}" if extra else None


def engine_profile(game: HUGame, meta: dict, npz) -> Dict[str, np.ndarray]:
    """The engine's strategies in the reference's rows and hand order."""
    pos = {name_of(c): i for i, c in enumerate(meta["combos"])}
    out = {}
    for n in game.acts:
        raw = np.asarray(npz["s:" + n.path], dtype=np.float64)
        row = {b: i for i, b in enumerate(meta["rows"][n.path])}
        take_r = [row[board_text(b)] for b in n.boards]
        take_h = [pos[h] for h in game.deal.names[n.player]]
        s = raw[np.ix_(take_r, range(raw.shape[1]), take_h)]
        out[n.path] = s / s.sum(axis=1, keepdims=True)
    return out


def _infosets(game: HUGame, a: dict, b: dict) -> tuple:
    """Per infoset of the game: total variation between profiles a and b, and how often each profile reaches it."""
    ra, rb = game.reaches(a), game.reaches(b)
    out = []
    for n in game.acts:
        p, o = n.player, 1 - n.player
        mass = game.deal.mass(n.boards).astype(np.float64)
        if p == 1:
            mass = mass.transpose(0, 2, 1)
        reach = []
        for r in (ra, rb):
            opp = (mass @ r[n.path][o][:, :, None])[:, :, 0]
            reach.append(r[n.path][p] * opp * n.chance / game.pairs)
        tv = 0.5 * np.abs(a[n.path] - b[n.path]).sum(axis=1)
        out.append((n, tv * n.alive, reach[0] * n.alive, reach[1] * n.alive))
    return out


def strategy_report(game: HUGame, engine: dict, reference: dict, pot: float) -> dict:
    sets = _infosets(game, engine, reference)
    tv = np.concatenate([t.ravel() for _, t, _, _ in sets])
    we = np.concatenate([x.ravel() for _, _, x, _ in sets])
    wr = np.concatenate([x.ravel() for _, _, _, x in sets])
    w = (we + wr) / 2
    big = np.maximum(we, wr) >= REACH_FLOOR
    flagged = checked = 0
    worst_gap = 0.0
    worst = None
    unexplained = 0.0
    ceiling = INDIFFERENT_PCT / 100 * pot
    for p in (0, 1):
        q: Dict[str, np.ndarray] = {}
        game.walk(reference, p, True, q)                  # action values against the reference's opponent
        qe: Dict[str, np.ndarray] = {}
        game.walk(engine, p, True, qe)
        ra, re = game.reaches(reference), game.reaches(engine)
        for n, t, xe, xr in sets:
            if n.player != p:
                continue
            mask = (t > TV_FLAG) & (np.maximum(xe, xr) >= REACH_FLOOR)
            if not mask.any():
                continue
            mass = game.deal.mass(n.boards).astype(np.float64)
            if p == 1:
                mass = mass.transpose(0, 2, 1)
            mr = (mass @ ra[n.path][1 - p][:, :, None])[:, :, 0]
            me = (mass @ re[n.path][1 - p][:, :, None])[:, :, 0]
            for b, i in zip(*np.nonzero(mask)):
                flagged += 1
                use_q, m = (q, mr[b, i]) if mr[b, i] > 1e-12 else (qe, me[b, i])
                vals = use_q[n.path][b, :, i] / max(m, 1e-12)
                gap = vals.max() - vals
                more = engine[n.path][b, :, i] - reference[n.path][b, :, i] > 0.02
                g = float(gap[more].max()) if more.any() else 0.0
                if g <= ceiling:
                    checked += 1
                else:
                    unexplained += float(xe[b, i])
                if g > worst_gap:
                    worst_gap = g
                    worst = {"node": n.path, "hand": game.deal.names[p][i], "board": board_text(n.boards[b]),
                             "engine": [round(float(x), 4) for x in engine[n.path][b, :, i]],
                             "reference": [round(float(x), 4) for x in reference[n.path][b, :, i]],
                             "actions": n.names, "gap_bb": g}
    return {"infosets": int(tv.size), "infosets_reached": int(big.sum()),
            "largest_tv_reached": float(tv[big].max()) if big.any() else 0.0,
            "mean_tv_weighted": float((tv * w).sum() / max(w.sum(), 1e-300)),
            "differing": flagged, "differing_within_indifference": checked,
            "largest_gap_bb": worst_gap, "largest_gap_pct_pot": worst_gap / pot * 100, "worst": worst,
            "tv_flag": TV_FLAG, "reach_floor": REACH_FLOOR, "indifferent_pct_pot": INDIFFERENT_PCT}


def root_evs_check(game: HUGame, engine: dict, meta: dict) -> float:
    """The engine's displayed EVs: per combo and action at the root, relative to folding now, against the reference's
    walk of the engine's own strategies. The largest difference in bb, over combos in the root player's range."""
    root = game.root
    if not isinstance(root, NAct):
        return float("nan")
    p = root.player
    q: Dict[str, np.ndarray] = {}
    game.walk(engine, p, False, q)
    mass = game.deal.mass([game.deal.board]).astype(np.float64)[0]
    if p == 1:
        mass = mass.T
    opp = mass @ game.r0[1 - p]
    pos = {name_of(c): i for i, c in enumerate(meta["combos"])}
    take = [pos[h] for h in game.deal.names[p]]
    theirs = np.array(meta["root_evs"])[:, take]
    inv = _root_inv(game, p)
    mine = q[""][0] / np.maximum(opp, 1e-12) + inv
    live = (game.r0[p] > 0) & (opp > 0)
    return float(np.abs(mine - theirs)[:, live].max())


def cev_identity(game: HUGame, engine: dict, meta: dict) -> float:
    """The engine's displayed EVs are chips over the whole hand: its root EVs, mixed by its strategy and weighted by
    the deal, less the chips the player already has in, must be the player's value. Largest miss in bb (root player)."""
    root = game.root
    p = root.player
    mass = game.deal.mass([game.deal.board]).astype(np.float64)[0]
    if p == 1:
        mass = mass.T
    opp = mass @ game.r0[1 - p]
    pos = {name_of(c): i for i, c in enumerate(meta["combos"])}
    evs = np.array(meta["root_evs"])[:, [pos[h] for h in game.deal.names[p]]]
    mixed = (evs * engine[""][0]).sum(axis=0) - _root_inv(game, p)
    return float(abs((mixed * game.r0[p] * opp).sum() / game.pairs - game.value(engine, p)))


def _root_inv(game: HUGame, p: int) -> float:
    n = game.root
    while not isinstance(n, NEnd):
        n = n.kid if isinstance(n, NDeal) else n.kids[0]
    return n.inv[p]


def root_frequencies(game: HUGame, strat: dict) -> Dict[str, float]:
    n = game.root
    w = game.r0[n.player] / game.r0[n.player].sum()
    return {a: float((strat[""][0, i] * w).sum()) for i, a in enumerate(n.names)}


def compare_hu(spot: dict, game: HUGame, meta: dict, npz, ref: dict, ref_npz) -> dict:
    pot = meta["root_pot"]
    out: dict = {"iterations": meta["iterations"]}
    d = hu_tree_diff(game, meta["tree"], meta["rows"])
    out["tree_identical"] = d is None
    if d is not None:
        out["not_compared"] = d
        return out
    engine = engine_profile(game, meta, npz)
    reference = {n.path: np.asarray(ref_npz["s:" + n.path]) for n in game.acts}
    ge = game.gains(engine)
    gr = ref["gains"]
    zero_sum = game.zero_sum()
    out["zero_sum"] = zero_sum
    out["value_oop_ref"] = gr["value"][0]
    out["value_ip_ref"] = gr["value"][1]
    out["value_oop_engine_own"] = meta["engine_values"][0]
    out["value_ip_engine_own"] = meta["engine_values"][1]
    out["value_oop_engine_by_ref"] = ge["value"][0]
    out["value_ip_engine_by_ref"] = ge["value"][1]
    dv = max(abs(ge["value"][0] - gr["value"][0]), abs(ge["value"][1] - gr["value"][1]))
    out["value_diff_bb"] = dv
    out["value_diff_pct_pot"] = dv / pot * 100
    out["own_vs_ref_walk_bb"] = max(abs(meta["engine_values"][p] - ge["value"][p]) for p in (0, 1))
    out["expl_engine_by_ref_pct"] = (ge["gain"][0] + ge["gain"][1]) / 2 / pot * 100
    out["gains_engine_by_ref_bb"] = ge["gain"]
    out["expl_ref_pct"] = (gr["gain"][0] + gr["gain"][1]) / 2 / pot * 100
    out["gains_ref_bb"] = gr["gain"]
    out["expl_engine_own_pct"] = meta["engine_exploitability_pct"]
    if zero_sum:
        # with an exact value, each best response brackets it: a value outside the bracket is a bug on one side
        v = gr["value"][0]
        out["value_in_engine_bracket"] = bool(-ge["br"][1] - 1e-9 <= v <= ge["br"][0] + 1e-9)
    out["rake_check_bb"] = abs(ge["value"][0] + ge["value"][1] + game.expected_rake(engine))
    out["rake_paid_bb"] = game.expected_rake(engine)
    out["root_ev_max_diff_bb"] = root_evs_check(game, engine, meta)
    out["cev_identity_bb"] = cev_identity(game, engine, meta)
    out["root_freq_engine"] = root_frequencies(game, engine)
    out["root_freq_ref"] = root_frequencies(game, reference)
    bounds = ref.get("frequency_bounds")
    if bounds:
        slip = {a: max(bounds[a][0] - out["root_freq_engine"][a], out["root_freq_engine"][a] - bounds[a][1], 0.0)
                for a in bounds}
        out["root_freq_bounds"] = bounds
        out["root_freq_outside_bounds"] = max(slip.values())
    out["strategy"] = strategy_report(game, engine, reference, pot)
    out["wall_s"] = meta["wall_s"]
    out["iterate_s"] = meta.get("iterate_s")
    out["peak_rss_mb"] = meta["peak_rss_mb"]
    out["use_core"] = meta["use_core"]
    out["cells"] = meta["cells"]
    out["pass"] = out["value_diff_pct_pot"] <= TOL_VALUE_PCT and out["expl_engine_by_ref_pct"] <= TOL_EXPL_PCT and \
        out.get("value_in_engine_bracket", True)
    return out


def mw_tree_diff(game: MWGame, tree: dict) -> Optional[str]:
    seen = set()

    def go(n, path):
        t = tree.get(path)
        seen.add(path)
        if t is None:
            return f"{path!r}: not in the engine's tree"
        if isinstance(n, MAct):
            if t["kind"] != "act" or t["player"] != n.player or t["names"] != n.names:
                return f"{path!r}: reference {n.player} {n.names}, engine {t}"
            for name, kid in zip(n.names, n.kids):
                d = go(kid, f"{path}/{name}")
                if d:
                    return d
            return None
        if tuple(t["live"]) != tuple(n.live) or abs(t["pot"] - n.pot) > 1e-6 or abs(t["rake"] - n.rake) > 1e-6 or \
                max(abs(x - y) for x, y in zip(t["c"], n.c)) > 1e-6:
            return f"{path!r}: reference {n.live} {n.pot} {n.c} {n.rake}, engine {t}"
        return None

    d = go(game.root, "")
    if d:
        return d
    extra = set(tree) - seen
    return f"engine nodes the reference lacks: {sorted(extra)[:3]}" if extra else None


def compare_mw(spot: dict, game: MWGame, meta: dict, npz, ref: dict, ref_npz) -> dict:
    pot = meta["root_pot"]
    out: dict = {"iterations": meta["iterations"]}
    d = mw_tree_diff(game, meta["tree"])
    out["tree_identical"] = d is None
    if d is not None:
        out["not_compared"] = d
        return out
    pos = {name_of(c): i for i, c in enumerate(meta["combos"])}
    engine = {}
    for n in game.acts:
        raw = np.asarray(npz["s:" + n.path], dtype=np.float64)[0]
        s = raw[:, [pos[h] for h in game.names[n.player]]]
        engine[n.path] = s / s.sum(axis=0, keepdims=True)
    reference = {n.path: np.asarray(ref_npz["s:" + n.path]) for n in game.acts}
    ge = game.gains(engine)
    gr = ref["gains"]
    out["values_ref"] = gr["value"]
    out["values_engine_own"] = meta["engine_values"]
    out["values_engine_by_ref"] = ge["value"]
    out["own_vs_ref_walk_bb"] = max(abs(x - y) for x, y in zip(meta["engine_values"], ge["value"]))
    out["value_diff_bb"] = max(abs(x - y) for x, y in zip(ge["value"], gr["value"]))
    out["value_diff_pct_pot"] = out["value_diff_bb"] / pot * 100
    out["nashconv_engine_by_ref_pct"] = sum(ge["gain"]) / pot * 100
    out["nashconv_engine_own_pct"] = meta["engine_nash_conv_pct"]
    out["nashconv_ref_pct"] = sum(gr["gain"]) / pot * 100
    out["gains_engine_by_ref_bb"] = ge["gain"]
    out["gains_engine_own_bb"] = meta["engine_gains"]
    out["gains_ref_bb"] = gr["gain"]
    rake = game.expected_rake(engine)
    out["rake_paid_bb"] = rake
    out["conservation_bb"] = abs(sum(ge["value"]) - (spot["pot"] - rake))   # (values net each player's own chips)
    ra, re = game.reaches(reference), game.reaches(engine)
    tvs, ws, biggest = [], [], 0.0
    for n in game.acts:
        p = n.player
        q, s = [i for i in range(3) if i != p]
        m = np.moveaxis(game.mask.astype(np.float64), p, 0)
        w = []
        for r in (ra, re):
            opp = (m @ r[n.path][s]) @ r[n.path][q]
            w.append(r[n.path][p] * opp / game.deals)
        tv = 0.5 * np.abs(engine[n.path] - reference[n.path]).sum(axis=0)
        tvs.append(tv); ws.append((w[0] + w[1]) / 2)
        reached = np.maximum(w[0], w[1]) >= REACH_FLOOR
        if reached.any():
            biggest = max(biggest, float(tv[reached].max()))
    tv, w = np.concatenate(tvs), np.concatenate(ws)
    out["largest_tv_reached"] = biggest
    out["mean_tv_weighted"] = float((tv * w).sum() / max(w.sum(), 1e-300))
    out["wall_s"] = meta["wall_s"]
    out["peak_rss_mb"] = meta["peak_rss_mb"]
    out["use_core"] = meta["use_core"]
    out["pass"] = out["nashconv_engine_by_ref_pct"] <= 2 * TOL_EXPL_PCT and \
        out["own_vs_ref_walk_bb"] <= TOL_VALUE_PCT / 100 * pot
    return out
