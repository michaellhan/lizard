"""Solves Lizard's stored preflop games and writes each to engine/pf/<key>.bin, as upstream's
solver/scripts/build_pf_study.py does its two: STORED_ITERS iterations of the same DCFR, the average strategy packed
by pf_study.pack with the stored (quantized) strategy's exploitability in its header.

    .venv/bin/python scripts/pf/build_stored.py [--keys K1,K2] [--iters N] [--missing] [--log engine/pf/built.jsonl]
    .venv/bin/python scripts/pf/build_stored.py --engine        # Lizard's preflop solver's grid (engine/pf_solve.py)
    .venv/bin/python scripts/pf/build_stored.py --forced --out DIR [--missing] [--keys ...]   # antes and straddles
    .venv/bin/python scripts/pf/build_stored.py --forced --install DIR                         # ... into engine/pf

Without --engine: upstream's class-level model's grid (engine/pf_stored.py, keys like 6max_100bb). With it: the grid of
engine/pf_solve.py (its calibrated model, engine/pf_calib.py; keys like lz4_6max_100bb, logged to lz4_built.jsonl), the
one the worker answers Study's, Practice's and Analyze's preflop solve from.

--forced: engine/pf_solve.py's games with a straddle or a big-blind ante (forced_games, keys like lz4_6max_100bb_s and
lz4_9max_40bb_a0.11), the most played first. Each is solved FORCED_STEP iterations at a time until its stored strategy is
within its target (`target`: TARGET_MBB per 1.5bb of chips in before anyone acts) or FORCED_MAX iterations, logged to DIR/lz4_forced_built.jsonl. --out writes them outside
the repository (library-build/runs/<name>/), so a long build survives the worktree; --install DIR then copies every
file there that is its game's tree and within the bound into engine/pf/, adds their log lines to
engine/pf/lz4_forced_built.jsonl, and writes the lists of built games (engine/pf_forced_built.py and
web/src/solver/pfForcedBuilt.ts) from what engine/pf/ holds. It can run while the build goes on: it takes what's done.

One process, one thread (gto.native holds BLAS to one). A 6-max game takes about 3 minutes natively, fewer players far
less. Route the whole grid through the shared CPU slot (gtosolver/.work/bin/slot.sh). Each game appends a line to the
log: key, iterations, seconds, the stored strategy's mbb/hand a seat, and bytes.
"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "solver"))
sys.path.insert(0, ROOT)
import gto.native  # noqa: F401,E402
from gto import pf_study as PS  # noqa: E402
from engine import pf_stored, pf_solve  # noqa: E402

FORCED_STEP = 1500
FORCED_MAX = 4500
# a forced game is installed within its target at FORCED_STEP iterations, or within this much more after more (as the
# grid's STORED_ITERS_OF games, 1.8 against 1.5, which level off just above the target where a live solve's stall rule
# stops them too)
FORCED_SLACK = 1.8 / 1.5


def pot0(spec) -> float:
    """The chips in before anyone acts, bb: the blinds, a straddle's 2bb, every seat's ante."""
    return 1.5 + (2.0 if spec.straddle else 0.0) + spec.players * spec.ante


def target(spec) -> float:
    """A forced game's target, mbb/hand a seat: pf_study.TARGET_MBB per 1.5bb of chips in before anyone acts. A
    straddle's or an ante's chips make every pot bigger, and a strategy's error costs in proportion: a straddled game is
    held to 3.5 mbb (1.5 mbb a hand in units of its 2bb "big blind" and 1bb small one), a 6-max game with 0.17 antes to
    2.52. Measured: straddled games level off at 2.3 to 3.0 mbb by 4,500 iterations (docs/ACCURACY.md section 18.13)."""
    return PS.TARGET_MBB * pot0(spec) / 1.5


def bound(spec, iterations: int) -> float:
    """What a forced game is installed within: its target at FORCED_STEP iterations, FORCED_SLACK times it after more."""
    return target(spec) * (1.0 if iterations <= FORCED_STEP else FORCED_SLACK)
FORCED_LOG = pf_solve.MODEL_TAG + "_forced_built.jsonl"
BUILT_PY = os.path.join(ROOT, "engine", "pf_forced_built.py")
BUILT_TS = os.path.join(ROOT, "web", "src", "solver", "pfForcedBuilt.ts")


def built(path: str, spec) -> bool:
    """--missing: a game counts as built when its file is there and is this game's tree. The key names the model (its tag)
    and every tree option, so a game on another model has another file; but a tree rule changed under the same key (as the
    charts' raise rule did, 2026-11-17) leaves a file of another tree, which pack's header (its decision count) shows."""
    if not os.path.exists(path):
        return False
    from gto import pf_game as G
    with open(path, "rb") as f:
        head = f.read(8)
    n = sum(1 for nd in G.walk(spec.build()[0]) if nd.kind == "dec")
    if head[:4] == b"PFS1" and int.from_bytes(head[4:8], "little") == n:
        return True
    print(f"{os.path.basename(path)}: not this game's tree ({n} decisions); rebuilt", flush=True)
    return False


def measured(Solve, spec, g) -> float:
    """The stored (quantized) strategy's mbb/hand a seat, on a second game read from the packed file (the grid's way)."""
    s = Solve(spec, PS.pack(g))
    s.measure()
    return s.mbb


def stored_mbb(g, spec) -> float:
    """The same figure on the solving game itself, its strategy sums swapped for the packed strategy while it's measured
    (pf_game's exploitability reads only the average strategy), so a build holds one game: a 6-max 200bb game is about a
    gigabyte (pf_solve.Spec.estimate_mb), and two would pass the gigabyte a process here keeps under."""
    saved = g.ssum
    try:
        g.ssum = PS.unpack(g, PS.pack(g))
        return 1000.0 * sum(g.exploitability(per_seat=True)) / spec.players
    finally:
        g.ssum = saved


def last_lines(path: str) -> dict:
    out = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                if line.strip():
                    r = json.loads(line)
                    out[r["key"]] = r
    return out


def install(src: str) -> None:
    """--forced --install SRC: SRC's finished forced games into engine/pf/, then the lists of built games."""
    specs = {s.key: s for s in pf_solve.forced_games()}
    logs = last_lines(os.path.join(src, FORCED_LOG))
    mine = os.path.join(pf_solve.STORE_DIR, FORCED_LOG)
    have = last_lines(mine)
    added = []
    for key, spec in specs.items():
        path, r = os.path.join(src, key + ".bin"), logs.get(key)
        if r is None or not os.path.exists(path) or have.get(key) == r:
            continue
        if not built(path, spec):
            continue
        with open(path, "rb") as f:
            mbb = PS.stored_mbb(f.read())
        limit = bound(spec, r["iterations"])
        if mbb is None or mbb >= limit:
            print(f"{key}: {mbb} mbb/hand a seat at {r['iterations']} iterations, past {limit:.2f}: left out", flush=True)
            continue
        shutil.copyfile(path, os.path.join(pf_solve.STORE_DIR, key + ".bin"))
        added.append(r)
    with open(mine, "a") as f:
        for r in added:
            f.write(json.dumps(r) + "\n")
    have.update({r["key"]: r for r in added})
    # (the lists say what engine/pf/ holds of the set now: a file here with its log line, its game's tree)
    keys = [k for k, s in specs.items() if k in have and built(os.path.join(pf_solve.STORE_DIR, k + ".bin"), s)]
    with open(BUILT_PY, "w") as f:
        f.write('"""The stored preflop games with an ante or a straddle (engine/pf_solve.py forced_games) whose files are '
                'in engine/pf/,\nwith the iterations each was solved for. Written by `scripts/pf/build_stored.py --forced '
                '--install DIR`, with\nweb/src/solver/pfForcedBuilt.ts; don\'t edit by hand."""\nBUILT = {\n')
        for k in keys:
            f.write(f'    "{k}": {have[k]["iterations"]},\n')
        f.write("}\n")
    with open(BUILT_TS, "w") as f:
        f.write("// The stored preflop games with an ante or a straddle whose files are in engine/pf/ (engine/pf_forced_built.py"
                ",\n// engine/pf_solve.py forced_games). Written by `scripts/pf/build_stored.py --forced --install DIR`; don't edit"
                " by hand.\nexport const PF_FORCED_BUILT: readonly string[] = [\n")
        for k in keys:
            f.write(f'  "{k}",\n')
        f.write("];\n")
    print(json.dumps({"installed": len(added), "built": len(keys), "of": len(specs),
                      "bytes": sum(have[k]["bytes"] for k in keys)}), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default="")
    ap.add_argument("--iters", type=int, default=0, help="iterations (default: pf_study.STORED_ITERS, with --engine each "
                                                         "game's own from pf_solve.STORED_ITERS_OF)")
    ap.add_argument("--missing", action="store_true", help="only games with no file yet")
    ap.add_argument("--log", default="")
    ap.add_argument("--engine", action="store_true", help="engine/pf_solve.py's grid (the calibrated model)")
    ap.add_argument("--forced", action="store_true", help="engine/pf_solve.py's games with antes and straddles")
    ap.add_argument("--out", default="", help="where the files go (default engine/pf/)")
    ap.add_argument("--install", default="", help="with --forced: a build's folder to take finished games from")
    a = ap.parse_args()
    if a.install:
        if not a.forced:
            sys.exit("--install takes --forced")
        return install(a.install)
    out_dir = a.out or pf_stored.DIR
    if a.forced:
        specs = {s.key: s for s in pf_solve.forced_games()}
        Solve = pf_solve.Solve
        a.log = a.log or os.path.join(out_dir, FORCED_LOG)
    elif a.engine:
        specs = {s.key: s for s in pf_solve.stored_games()}
        Solve = pf_solve.Solve
        a.log = a.log or os.path.join(pf_solve.STORE_DIR, pf_solve.MODEL_TAG + "_built.jsonl")
    else:
        specs = {s.key: s for s in pf_stored.games()}
        Solve = PS.Solve
        a.log = a.log or os.path.join(pf_stored.DIR, "built.jsonl")
    keys = a.keys.split(",") if a.keys else list(specs)
    os.makedirs(out_dir, exist_ok=True)
    if a.forced:
        # the set's own order (the most played first), so a build stopped part way has the games that matter most
        order = {k: i for i, k in enumerate(specs)}
        keys.sort(key=lambda k: order[k])
    else:
        # fewest players first: the quick games land before the 6-max ones
        keys.sort(key=lambda k: (specs[k].players, specs[k].stack, specs[k].rake is not None))
    for key in keys:
        spec = specs[key]
        out = os.path.join(out_dir, key + ".bin")
        if a.missing and built(out, spec):
            continue
        iters = a.iters or (pf_solve.STORED_ITERS_OF.get(key, PS.STORED_ITERS) if a.engine else
                            FORCED_STEP if a.forced else PS.STORED_ITERS)
        g = spec.game()
        t0 = time.time()
        done = 0
        while True:
            for t in range(done + 1, iters + 1):
                g.iterate(t)
            done = iters
            mbb = stored_mbb(g, spec) if a.forced else measured(Solve, spec, g)
            # (--forced without --iters: on until the stored strategy is within its target, FORCED_STEP at a time)
            if not a.forced or a.iters or mbb <= target(spec) or iters >= FORCED_MAX:
                break
            iters += FORCED_STEP
        blob = PS.pack(g, mbb)
        with open(out, "wb") as f:
            f.write(blob)
        line = {"key": key, "iterations": iters, "seconds": round(time.time() - t0, 1), "mbb": round(mbb, 3),
                "bytes": len(blob)}
        with open(a.log, "a") as f:
            f.write(json.dumps(line) + "\n")
        print(json.dumps(line), flush=True)


if __name__ == "__main__":
    main()
