"""Solves the preflop game of other formats and writes their chart moves (gto/pf_formats.py) to gto/pf_format_data.py.

    python scripts/build_pf_formats.py --solve 20bb,40bb,a0.125 --dir DIR     # solve (or keep) each game, DIR/<tag>.npz
    python scripts/build_pf_formats.py --write --dir DIR                       # the moves from the solves in DIR

A tag is a flop_library.Format's ('' the 6-max 100bb game, '40bb', 'a0.125', '40bb_a0.125', '8max', 'straddle',
'2max', '2max_40bb'; 'mp2' appended: at most two players to a flop, the 7-9 handed games' tree; 'limp': the small
blind may limp, the heads-up games' limp moves). Each game is
pf_game's tree for that table (its default sizes, raked as the charts are: RAKE) with the flop library's realization
(pf_game.LibraryModel, advisor._river_fix at RIVER_FIX), another depth's scaled by DEPTH_SCALE (the excess over equity measured there by
live solves against 100bb's on the same flops: scripts/pf_depth_values.py). One process, one thread.
--write writes the moves of SETS (pf_formats' grids), each class's taken along its family (family_smooth): 150bb,
200bb and heads-up 200bb solve (--solve 150bb,200bb,2max_200bb,2max_200bb_limp) but aren't written
(pf_formats.DEPTHS: deeper plays 100bb's moves and the rules' implied odds).
"""
from __future__ import annotations
import argparse
import gc
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import gto.native  # noqa: F401,E402
import numpy as np  # noqa: E402
from gto import pf_game as G  # noqa: E402
from gto import pf_formats as PF  # noqa: E402
from gto.flop_library import Format  # noqa: E402

RIVER_FIX = (1.0, 0.5)          # advisor._river_fix's scale in single-raised and 3bet pots (as the 100bb solve)
RAKE = (0.05, 4.0)              # every game is raked as the solves the charts were fit to (5% capped at 4bb), so a
                                # move is measured in the charts' own game (unraked, the margins move much more: the
                                # big blind's defence against the button +34 points with a 0.125bb ante, raked +24)
# {depth: {pot type: k}}: each share's excess over equity at that depth is k times 100bb's (pf_depth_values.py --fit:
# live solves of BTN vs BB, SB vs BB and BB vs BTN's 3bet pot on 12 of the 184 representative flops at 150
# iterations against the library's at 100bb; linear in depth between, 1 at 100). Single-raised pots barely move
# (BTN vs BB 0.90 / 0.98 / 0.96, SB vs BB 0.88 / 0.98 / 0.95 at 20 / 40 / 200bb), 3bet pots realize less as the
# stack shrinks to the pot (0.48 at 20bb, 0.76 at 40, 1.03 at 200); 4bet pots (type 3, no measure) as 3bet pots
DEPTH_SCALE = {20.0: {1: 0.890, 2: 0.475, 3: 0.475},
               40.0: {1: 0.977, 2: 0.762, 3: 0.762},
               100.0: {1: 1.0, 2: 1.0, 3: 1.0},
               200.0: {1: 0.956, 2: 1.034, 3: 1.034}}
ITERS = 1500

# the moves: (dimension, sub-key, game, base game)
SETS = ([("depth", d, f"{d:g}bb", "") for d in PF.DEPTHS if d != 100.0] +
        [("hu_depth", d, f"2max_{d:g}bb", "2max") for d in PF.HU_DEPTHS if d != 100.0] +
        [("ante", d, (f"{d:g}bb_" if d != 100.0 else "") + f"a{PF.ANTE:g}", f"{d:g}bb" if d != 100.0 else "")
         for d in PF.ANTE_DEPTHS] +
        [("players", 7.0, "7max_mp2", "mp2"), ("players", 8.0, "8max_mp2", "mp2"), ("straddle", 100.0, "straddle", "")] +
        [("limp", d, f"2max_{d:g}bb_limp" if d != 100.0 else "2max_limp", f"2max_{d:g}bb" if d != 100.0 else "2max")
         for d in PF.HU_DEPTHS])


def depth_scale(depth: float) -> dict:
    ds = sorted(DEPTH_SCALE)
    x = min(max(depth, ds[0]), ds[-1])
    lo, hi = max(d for d in ds if d <= x), min(d for d in ds if d >= x)
    t = 0.0 if hi == lo else (x - lo) / (hi - lo)
    return {k: (1 - t) * DEPTH_SCALE[lo].get(k, 1.0) + t * DEPTH_SCALE[hi].get(k, 1.0) for k in (1, 2, 3)}


def parse(tag: str):
    """(Format, max players to a flop, whether the small blind may limp) of a tag."""
    mp, limp = 3, False
    parts = [p for p in tag.split("_") if p]
    if "mp2" in parts:
        mp = 2
        parts.remove("mp2")
    if "limp" in parts:
        limp = True
        parts.remove("limp")
    return Format.parse("_".join(parts)), mp, limp


def game(tag: str):
    from gto.advisor import _river_fix
    from gto.preflop import SEATS
    fmt, mp, limp = parse(tag)
    pos = SEATS[fmt.players]
    model = G.LibraryModel(river_fix=_river_fix(), river_scale={1: RIVER_FIX[0], 2: RIVER_FIX[1]},
                           scale=depth_scale(fmt.stack))
    root = G.build(pos, stack=fmt.stack, ante=fmt.ante, straddle=fmt.straddle, max_players=mp, sb_limp=limp)
    return G.Game(root, pos, model, stack=fmt.stack, rake=RAKE)


def path(d: str, tag: str) -> str:
    return os.path.join(d, (tag or "6max_100bb") + ".npz")


def solved(d: str, tag: str):
    g = game(tag)
    g.load(path(d, tag))
    return g


REACH = 0.05                    # a class's move counts in full where both solves play the line with at least this
                                # share of its combos, less below (none where either never reaches the decision:
                                # an unreached class's strategy is arbitrary, the 3bettor's 72o facing a 4bet)


def decisions(g) -> dict:
    """{line_key: ({action: per-class strategy}, per-class reach)} of a solved game's chart decisions ('all-in' as
    'raise'; the reach: the share of each class's combos the player to act brings to the decision, the product of
    its own actions' probabilities along the line, walked per decision so no (nodes, seats, classes) array is held:
    the 8-handed game's would be ~1 GB)."""
    out = {}
    avg = g.average()
    for k in g.dec:
        nd = g.nodes_all[k]
        key = PF.node_key(g.positions[nd.player], nd.line)
        if key is None:
            continue
        s = avg[g.dec_of[k]]
        acts = {}
        for a, nm in enumerate(nd.names):
            nm = "raise" if nm == "all-in" else nm
            acts[nm] = acts.get(nm, 0.0) + s[a]
        r = np.ones(len(s[0]))
        c = k
        while g.parent[c] >= 0:
            par = g.parent[c]
            if g.nodes_all[par].player == nd.player:
                r = r * avg[g.dec_of[par], g.act[c]]
            c = par
        out[key] = (acts, r)
    return out


SMOOTH = 1.0                    # a class's move is its family's (families()) around it: Gaussian weights of this many
                                # kicker steps (1, 0.61, 0.14 for the class, its neighbours, theirs), by reach
                                # (Lizard, 2026-11-17; docs/ACCURACY.md section 32)


VALUE = ("JJ", "QQ", "KK", "AA", "AKs", "AKo")   # left out of the families: value hands, whose move is no pick among
                                                # near-indifferent neighbours (smoothed, the 9-handed UTG's AKs facing
                                                # a squeeze took AQs's flats: 100% raise -> 31%)


def families() -> list:
    """The class families a move runs smoothly along, each weakest first (indices into pf_classes.CLASSES): the
    pairs, and per high card its suited and its offsuit hands by kicker, without the VALUE hands (each the top of
    its family), which keep their own moves and lend none."""
    from gto.pf_classes import CLASS_INDEX
    rk = "23456789TJQKA"
    out = [[CLASS_INDEX[r + r] for r in rk if r + r not in VALUE]]
    for h in rk[1:]:
        for t in "so":
            out.append([CLASS_INDEX[h + lo + t] for lo in rk[:rk.index(h)] if h + lo + t not in VALUE])
    return out


def family_smooth(x: np.ndarray, w: np.ndarray, sigma: float = SMOOTH) -> np.ndarray:
    """x (per class) with each class's value its family's around it: the average over the family weighted by a
    Gaussian in kicker steps (sigma) times each class's weight w (a class with none adds nothing; where no class
    within reach has any, a class keeps its own value).

    Both solves are class-level, so where several classes of a family are near indifferent (the bluffs of a 3bet
    range, the last calls of a defence) each solve plays a few of them purely and which ones is arbitrary; the two
    solves pick different ones and their difference flips between neighbours: SB facing a HJ open, 40bb against
    100bb moved K9s +0.78 raise and KTs 0, so the 40bb chart 3bet K9s 78% and folded KTs 99%, Q9s +0.39 and QTs
    -0.41. What the game changes runs along the family (more 3bets with suited kings at 40bb), so the move is
    taken from the family around each class rather than from the class alone."""
    if sigma <= 0:
        return np.asarray(x, float)
    x, w = np.asarray(x, float), np.asarray(w, float)
    out = x.copy()
    for fam in families():
        if len(fam) < 2:
            continue
        r = np.arange(len(fam), dtype=float)
        K = np.exp(-0.5 * ((r[:, None] - r[None, :]) / sigma) ** 2) * w[fam][None, :]
        tot = K.sum(axis=1)
        ok = tot > 1e-12
        out[np.asarray(fam)[ok]] = (K @ x[fam])[ok] / tot[ok]
    return out


def moves(dg: dict, db: dict, positions, dim: str) -> dict:
    """The moves of a game (its decisions(), dg, at `positions`) against its base game's (db): per chart decision,
    the class strategy minus the base's at the decision whose charts it plays (the same seats for depth, ante and
    limps; preflop.chart_key's for players and straddle), for raise and call (fold is what's left), taken along
    each class's family (family_smooth) and weighted by how surely both solves reach it (REACH)."""
    from gto.preflop import Table
    out = {}
    table = Table(list(positions), 0.0, dim == "straddle", None)
    for key, (acts, rg) in dg.items():
        hero, seq = key.split("|")
        actions = [{"pos": x.split(":")[0], "action": "raise"} for x in seq.split(",") if x]
        bkey = key if dim in ("depth", "ante", "hu_depth", "limp") else PF.analog(hero, actions, table)
        if bkey is None or bkey not in db:
            continue
        b, rb = db[bkey]
        w = np.clip(np.minimum(rg, rb) / REACH, 0.0, 1.0)
        mv = {}
        for a in ("raise", "call"):
            if a in acts or a in b:
                d = np.asarray(acts.get(a, 0.0)) - np.asarray(b.get(a, 0.0))
                mv[a] = w * family_smooth(np.broadcast_to(d, w.shape), w)
        out[key] = mv
    return out


def game_moves(d: str, tag: str, base: str, dim: str) -> dict:
    """moves() of two solved games, one loaded at a time."""
    g = solved(d, tag)
    dg, positions = decisions(g), g.positions
    del g
    gc.collect()
    b = solved(d, base)
    db = decisions(b)
    del b
    gc.collect()
    return moves(dg, db, positions, dim)


def write(d: str, out: str, keep=(), smooth_kept=(), hold=()):
    """The moves of every game in SETS solved in d (and of those named in `keep`, (dimension, sub-key), unsolved there:
    their entries in the module now at `out`, as they are, or taken along each family (family_smooth, unit weights:
    the reach weighting is in them already) once where also named in `smooth_kept`: a set written before SMOOTH whose
    games aren't solved on disk, the 8-handed moves of 2026-11-17, whose game on today's tree needs ~3 GB) to `out`.
    `hold`: (dimension, sub-key, line key) decisions whose moves stay as the module at `out` has them (a decision
    whose ranges a precomputed flop library was solved on: moved, its ranges would no longer be the library's)."""
    lines = ['"""Generated by scripts/build_pf_formats.py: the preflop charts\' moves in other games (gto/pf_formats.py).',
             'DELTAS[dimension][sub-key] = (index, data): per decision and action, each class\'s (pf_classes.CLASSES)',
             'move from the base game\'s solve to this game\'s, in 1% steps (pf_formats.encode)."""', "DELTAS = {"]
    by = {}
    current = {}
    from gto.pf_classes import CLASSES
    if (keep or hold) and os.path.exists(out):
        import importlib.util
        spec = importlib.util.spec_from_file_location("_current_moves", out)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        current = mod.DELTAS
    for dim, sub, tag, base in SETS:
        if not (os.path.exists(path(d, tag)) and os.path.exists(path(d, base))):
            if sub in current.get(dim, {}) and (dim, sub) in keep:
                by.setdefault(dim, {})[sub] = current[dim][sub]
                how = "KEPT"
                if (dim, sub) in smooth_kept:
                    one = np.ones(len(CLASSES))
                    by[dim][sub] = PF.encode({k: {a: family_smooth(v, one) for a, v in m.items()}
                                              for k, m in PF.decode(*current[dim][sub]).items()})
                    how = "KEPT (smoothed)"
                print(f"{dim} {sub:g}: {tag or '6max_100bb'} or {base or '6max_100bb'} not solved, {how} from {out}")
            else:
                print(f"{dim} {sub:g}: {tag or '6max_100bb'} or {base or '6max_100bb'} not solved, skipped")
            continue
        mv = game_moves(d, tag, base, dim)
        by.setdefault(dim, {})[sub] = PF.encode(mv)
        print(f"{dim} {sub:g}: {len(mv)} decisions, mean |move| "
              f"{np.mean([np.abs(v).mean() for m in mv.values() for v in m.values()]):.3f}", flush=True)
    for dim, sub in {(h[0], h[1]) for h in hold}:
        if sub not in by.get(dim, {}) or sub not in current.get(dim, {}):
            continue
        new, old = PF.decode(*by[dim][sub]), PF.decode(*current[dim][sub])
        held = [k for dm, sb, k in hold if (dm, sb) == (dim, sub) and k in old]
        new.update({k: old[k] for k in held})
        by[dim][sub] = PF.encode(new)
        print(f"{dim} {sub:g}: {len(held)} decisions HELD from {out}: {' '.join(sorted(held))}")
    for dim, subs in by.items():
        lines.append(f"    {dim!r}: {{")
        for sub, (index, data) in subs.items():
            lines.append(f"        {sub!r}: ({index!r},")
            lines += [f"            {data[i:i + 100]!r}" for i in range(0, len(data), 100)] or ["            ''"]
            lines[-1] += "),"
        lines.append("    },")
    lines.append("}")
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {out} ({os.path.getsize(out) / 1e3:.0f} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solve", default="", help="comma separated tags ('6max' for the 6-max 100bb game)")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--iters", type=int, default=ITERS)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "gto", "pf_format_data.py"))
    ap.add_argument("--keep", default="", help="dimension:sub-key,... to keep from --out's module where unsolved")
    ap.add_argument("--hold", default="", help="dimension/sub-key/line key;... decisions whose moves stay as --out's "
                    "module has them")
    ap.add_argument("--smooth-kept", default="", help="dimension:sub-key,... of --keep's to take along each family "
                    "once (moves written before SMOOTH; never twice)")
    a = ap.parse_args()
    os.makedirs(a.dir, exist_ok=True)
    for tag in [t for t in a.solve.split(",") if t]:
        tag = "" if tag == "6max" else tag
        p = path(a.dir, tag)
        if os.path.exists(p):
            print(f"{tag or '6max_100bb'}: solved already", flush=True)
            continue
        g = game(tag)
        t0 = time.time()
        g.solve(a.iters)
        g.save(p)
        print(f"{tag or '6max_100bb'}: {len(g.dec)} decisions, {a.iters} iterations in {time.time() - t0:.0f}s, "
              f"exploitability {g.exploitability():.4f} bb/hand", flush=True)
    if a.write:
        keep = [(k.split(":")[0], float(k.split(":")[1])) for k in a.keep.split(",") if k]
        sk = [(k.split(":")[0], float(k.split(":")[1])) for k in a.smooth_kept.split(",") if k]
        hold = [(h.split("/")[0], float(h.split("/")[1]), h.split("/", 2)[2]) for h in a.hold.split(";") if h]
        write(a.dir, a.out, keep, sk, hold)


if __name__ == "__main__":
    main()
