"""The benchmark: every spot on the reference and on the engine, each in its own process, then the comparison.

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh \\
        scripts/benchmarks/.venv/bin/python scripts/benchmarks/run_benchmark.py         # all spots
    python scripts/benchmarks/run_benchmark.py --spots river-flush,turn-one-size        # some; merged into the results
    python scripts/benchmarks/run_benchmark.py --table                                  # the tables from the results

Needs numpy, treys and scipy (scripts/benchmarks/.venv: see docs/ACCURACY.md section 14). Raw numbers go to
results/benchmark.json. One process at a time, single-threaded.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import tempfile
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402

import build  # noqa: E402
import compare  # noqa: E402
import spots  # noqa: E402

ROOT = os.path.join(HERE, "..", "..")
RESULTS = os.path.join(HERE, "results", "benchmark.json")


def machine() -> dict:
    def sh(*cmd):
        try:
            return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            return ""

    with open(os.path.join(ROOT, "solver", "UPSTREAM.json")) as f:
        upstream = json.load(f)
    try:
        import scipy
        scipy_v = scipy.__version__
    except ImportError:
        scipy_v = None
    return {"platform": platform.platform(), "cpu": sh("sysctl", "-n", "machdep.cpu.brand_string"),
            "memory_gb": int(sh("sysctl", "-n", "hw.memsize") or 0) / (1 << 30), "python": platform.python_version(),
            "numpy": np.__version__, "scipy": scipy_v, "git_commit": sh("git", "-C", ROOT, "rev-parse", "HEAD"),
            "solver_upstream_commit": upstream["commit"], "threads": 1,
            "load_note": "run niced through slot.sh beside other builds: times are a loaded machine's, not a benchmark "
                         "of speed"}


def run(cmd, env=None) -> None:
    subprocess.check_call([sys.executable] + cmd, env=dict(os.environ, **(env or {})))


def load(prefix: str) -> tuple:
    with open(prefix + ".json") as f:
        meta = json.load(f)
    return meta, np.load(prefix + ".npz")


def one_spot(spot: dict, tmp: str) -> dict:
    name = spot["name"]
    t0 = time.time()
    ref_prefix = os.path.join(tmp, "ref-" + name)
    run([os.path.join(HERE, "ref_worker.py"), name, ref_prefix])
    ref, ref_npz = load(ref_prefix)
    print(f"{name}: reference done in {ref['wall_s']:.1f} s", flush=True)
    game = build.mw_game(spot) if spot["kind"] == "mw" else build.hu_game(spot)
    cmp_fn = compare.compare_mw if spot["kind"] == "mw" else compare.compare_hu
    engine_runs = []
    for iters in spot["engine_iters"]:
        prefix = os.path.join(tmp, f"eng-{name}-{iters}")
        run([os.path.join(HERE, "engine_worker.py"), name, str(iters), prefix])
        meta, npz = load(prefix)
        r = cmp_fn(spot, game, meta, npz, ref, ref_npz)
        engine_runs.append(r)
        print(f"  {iters} iterations: value diff {r.get('value_diff_pct_pot', float('nan')):.5f}% pot, "
              f"tree {'same' if r['tree_identical'] else 'DIFFERENT'}", flush=True)
    return {"spot": {k: v for k, v in spot.items() if k != "ranges_exact"}, "reference": ref, "engine": engine_runs,
            "total_s": time.time() - t0}


def numpy_parity(tmp: str) -> dict:
    """The engine's two paths, the compiled core and numpy, on one river against the reference: each path's own
    exploitability and the reference's measure of it, and how far apart the two paths' strategies are where it matters."""
    name = "river-two-sizes"
    spot = spots.get(name)
    game = build.hu_game(spot)
    ref_prefix = os.path.join(tmp, "parity-ref")
    run([os.path.join(HERE, "ref_worker.py"), name, ref_prefix])
    ref, ref_npz = load(ref_prefix)
    out, profiles = {"spot": name, "iterations": 3000}, {}
    for label, env in (("core", {}), ("numpy", {"GTO_CORE": "0"})):
        prefix = os.path.join(tmp, f"parity-{label}")
        run([os.path.join(HERE, "engine_worker.py"), name, "3000", prefix], env)
        meta, npz = load(prefix)
        r = compare.compare_hu(spot, game, meta, npz, ref, ref_npz)
        out[label] = {k: r[k] for k in ("use_core", "wall_s", "peak_rss_mb", "value_diff_pct_pot", "expl_engine_own_pct",
                                        "expl_engine_by_ref_pct", "pass")}
        profiles[label] = compare.engine_profile(game, meta, npz)
    tv = [(t, np.maximum(a, b)) for _, t, a, b in compare._infosets(game, profiles["core"], profiles["numpy"])]
    reached = np.concatenate([t[w >= compare.REACH_FLOOR] for t, w in tv])
    everywhere = np.concatenate([t.ravel() for t, _ in tv])
    out["largest_tv_reached"] = float(reached.max())
    out["largest_tv_any_infoset"] = float(everywhere.max())
    return out


def f(x, digits=4) -> str:
    return "-" if x is None else f"{x:.{digits}f}"


def table(data: dict) -> str:
    rows = ["| Spot | Reference | Hands | Iter | Value OOP ref (bb) | Value diff (bb) | Value diff (% pot) | Expl engine (% pot) | "
            "Expl ref (% pot) | Largest TV | Mean TV | Differ / within indiff. | Engine s | Engine MB | Ref s | Ref MB | Pass |",
            "|" + "---|" * 17]
    for name in [s["name"] for s in spots.SPOTS]:
        d = data["spots"].get(name)
        if not d or d["spot"]["kind"] != "hu":
            continue
        ref = d["reference"]
        for r in d["engine"]:
            if not r["tree_identical"]:
                rows.append(f"| {name} | not compared: {r['not_compared']} |" + " |" * 15)
                continue
            st = r["strategy"]
            rows.append(f"| {name} | {ref['method']} | {ref['hands'][0]}x{ref['hands'][1]} | {r['iterations']} | "
                        f"{f(r['value_oop_ref'], 4)} | {r['value_diff_bb']:.2e} | {r['value_diff_pct_pot']:.5f} | "
                        f"{r['expl_engine_by_ref_pct']:.5f} | {r['expl_ref_pct']:.1e} | {st['largest_tv_reached']:.3f} | "
                        f"{st['mean_tv_weighted']:.4f} | {st['differing']} / {st['differing_within_indifference']} | "
                        f"{r['wall_s']:.3f} | {r['peak_rss_mb']:.0f} | {ref['wall_s']:.1f} | {ref['peak_rss_mb']:.0f} | "
                        f"{'yes' if r['pass'] else 'NO'} |")
    rows += ["", "| Spot | Hands | Iter | Values ref (bb) | Value diff (% pot) | NashConv engine (% pot) | NashConv ref (% pot) | "
             "Largest TV | Mean TV | Engine s | Engine MB | Ref s | Ref MB | Pass |", "|" + "---|" * 14]
    for name in [s["name"] for s in spots.SPOTS]:
        d = data["spots"].get(name)
        if not d or d["spot"]["kind"] != "mw":
            continue
        ref = d["reference"]
        for r in d["engine"]:
            if not r["tree_identical"]:
                rows.append(f"| {name} | not compared: {r['not_compared']} |" + " |" * 12)
                continue
            rows.append(f"| {name} | {'x'.join(map(str, ref['hands']))} | {r['iterations']} | "
                        f"{' / '.join(f(x, 3) for x in r['values_ref'])} | {r['value_diff_pct_pot']:.4f} | "
                        f"{r['nashconv_engine_by_ref_pct']:.5f} | {r['nashconv_ref_pct']:.5f} | "
                        f"{r['largest_tv_reached']:.3f} | {r['mean_tv_weighted']:.4f} | {r['wall_s']:.2f} | "
                        f"{r['peak_rss_mb']:.0f} | {ref['wall_s']:.1f} | {ref['peak_rss_mb']:.0f} | "
                        f"{'yes' if r['pass'] else 'NO'} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", default="")
    ap.add_argument("--table", action="store_true")
    a = ap.parse_args()
    data = {"spots": {}}
    if os.path.exists(RESULTS):
        with open(RESULTS) as fh:
            data = json.load(fh)
    if a.table:
        print(table(data))
        return
    chosen = [spots.get(n) for n in a.spots.split(",")] if a.spots else spots.SPOTS
    data["machine"] = machine()
    data["tolerances"] = {"value_pct_pot": compare.TOL_VALUE_PCT, "exploitability_pct_pot": compare.TOL_EXPL_PCT,
                          "three_way_nashconv_pct_pot": 2 * compare.TOL_EXPL_PCT, "tv_flag": compare.TV_FLAG,
                          "reach_floor": compare.REACH_FLOOR, "indifferent_pct_pot": compare.INDIFFERENT_PCT}
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="lizard-bench-") as tmp:
        for spot in chosen:
            data["spots"][spot["name"]] = one_spot(spot, tmp)
            with open(RESULTS, "w") as fh:
                json.dump(data, fh, indent=1)
        if not a.spots:
            data["numpy_parity"] = numpy_parity(tmp)
    data["last_run_s"] = time.time() - t0
    with open(RESULTS, "w") as fh:
        json.dump(data, fh, indent=1)
    print(f"done in {data['last_run_s']:.0f} s")


if __name__ == "__main__":
    main()
