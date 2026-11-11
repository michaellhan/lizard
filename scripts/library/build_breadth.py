#!/usr/bin/env python3
"""Library breadth: new heads-up spots the published library doesn't have, solved with the snapshot's own library
code (solver/scripts/build_flop_library.py: solve_entry's model, sizes and accuracy, write_entry, write_index) into a
source directory that scripts/library/assemble.py merges (library-build/sources/breadth).

Which spots, and why (docs/PROGRESS.md, 2026-11-11 "Library breadth"): the heads-up preflop lines the published
library lacks, ranked by how often the charts reach them (solver/scripts/flop_library_coverage.py's preflop_spots):

  * 6-max 100bb: the three flatted opens and five 3bet pots left (+5.5 points of heads-up flops: 90.4% -> 95.9%), then
    the nine commonest 4bet pots (+1.2);
  * 8-max 100bb: the seven opens the big blind defends and UTG vs UTG1's flat (65% of 8-max heads-up flops). The 8- and
    9-handed charts give the same ranges seat for seat (BTN, SB, CO, HJ, LJ, and 9-max's UTG and UTG2 are 8-max's UTG
    and UTG1), and the advisor finds a spot by its ranges, pot and stack (FlopLibrary.spot), so each also answers the
    9-handed pot (64% of 9-max heads-up flops). Read today as 6-max spots, approximately (flop_approx.near_exact).

Trees and memory. The snapshot builds every new entry with the river dealt (library_config(pot, stack)), with a turn
file. Measured on 2026-11-11 (one process, the entry solved as solve_entry does): a 4bet pot 14-15 s and 0.5-0.85 GB, a
3bet pot 17-27 s and 0.8-1.35 GB, a flatted open 64 s and 1.5 GB. This machine's rule is about 1 GB a process, so:

  * tree "dealt": the river dealt with a turn file; a process passing --max-mb is stopped and that flop is solved on
    the old tree instead (old_tree(): the river bet blind on the turn's boards, how the library's nine older
    single-raised spots were built), so every flop gets an entry and none breaks the memory rule;
  * tree "old": the old tree directly, no turn file (the single-raised pots, whose dealt trees are all over 1 GB).

An entry on the old tree is listed by write_index as the spot's "old" and read by the advisor on that tree
(FlopLibrary.entry_tree); `run --redo-old` solves them again dealt once a bigger --max-mb is allowed.

Resumable: an entry on disk for the spot's ranges, on either tree, is kept, so `run` again picks up where it was. The
index (and each spot's report.json, ranges.json) is rewritten every --index-every entries and at the end; plan.json
says how far each spot is being built (the Library page's progress bars, through assemble.py).

    build_breadth.py plan                       # spots, phases, what is left
    build_breadth.py run --jobs 2               # the build (scripts/library/breadth.sh runs it through `heavy`)
    build_breadth.py one SPOT FLOP [--tree old] # one entry, timed, with its peak memory (a measurement)
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main_checkout() -> Path:
    """The main checkout (this file may run from a worktree or a copy): the parent of git's common directory."""
    try:
        d = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           capture_output=True, text=True, check=True).stdout.strip()
        return Path(d).parent
    except (OSError, subprocess.CalledProcessError):
        return ROOT


MAIN = Path(os.environ.get("BREADTH_MAIN") or main_checkout())
OUT = MAIN / "library-build" / "sources" / "breadth"
MAX_MB = 1000  # CLAUDE.md: keep processes under about 1 GB


@dataclass(frozen=True)
class Spot:
    id: str
    label: str
    line: str
    fmt: str = ""        # flop_library.Format tag ('' the default game: 6-max 100bb)
    tree: str = "dealt"  # "dealt" (old-tree fallback over --max-mb) or "old"


# Value order (share of the table's heads-up flops, 6-max / 8-max, flop_library_coverage.preflop_spots, 2026-11-11).
SPOTS = [
    Spot("srp_hj_sb", "HJ vs SB single-raised pot", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:c,BB:f", tree="old"),        # 0.87
    Spot("srp_co_btn", "CO vs BTN single-raised pot", "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:f", tree="old"),      # 0.87
    Spot("srp_utg_sb", "UTG vs SB single-raised pot", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:c,BB:f", tree="old"),      # 0.81
    Spot("3bp_btn_utg", "BTN 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:c"),                     # 0.64
    Spot("3bp_sb_utg", "SB 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:c"),                        # 0.64
    Spot("3bp_bb_hj", "BB 3bet vs HJ", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:r10,HJ:c"),                           # 0.61
    Spot("3bp_sb_hj", "SB 3bet vs HJ", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:r10,BB:f,HJ:c"),                           # 0.57
    Spot("3bp_bb_utg", "BB 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:r10,UTG:c"),                        # 0.53
    # 8-max (and 9-max: the same ranges)                                                                (8-max / 9-max)
    Spot("srp_btn_bb_8max", "BTN vs BB single-raised pot, 8-max", "UTG:f,UTG1:f,LJ:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
         "8max", "old"),                                                                                      # 14.6 / 12.3
    Spot("srp_sb_bb_8max", "SB vs BB single-raised pot, 8-max", "UTG:f,UTG1:f,LJ:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c",
         "8max", "old"),                                                                                      # 12.0 / 10.2
    Spot("srp_co_bb_8max", "CO vs BB single-raised pot, 8-max", "UTG:f,UTG1:f,LJ:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c",
         "8max", "old"),                                                                                      # 10.0 / 8.4
    Spot("srp_utg_bb_8max", "UTG vs BB single-raised pot, 8-max", "UTG:r2.5,UTG1:f,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:c",
         "8max", "old"),                                                                                      # 6.3 / 11.1
    Spot("srp_hj_bb_8max", "HJ vs BB single-raised pot, 8-max", "UTG:f,UTG1:f,LJ:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c",
         "8max", "old"),                                                                                      # 8.7 / 7.3
    # 4bet pots, 6-max (the opener's 2.3x 4bet over the 3bet, called: the advisor's default size)
    Spot("4bp_utg_hj", "UTG 4bet vs HJ", "UTG:r2.5,HJ:r7.5,CO:f,BTN:f,SB:f,BB:f,UTG:r17.25,HJ:c"),             # 0.25
    Spot("4bp_hj_co", "HJ 4bet vs CO", "UTG:f,HJ:r2.5,CO:r7.5,BTN:f,SB:f,BB:f,HJ:r17.25,CO:c"),                # 0.25
    Spot("4bp_co_btn", "CO 4bet vs BTN", "UTG:f,HJ:f,CO:r2.5,BTN:r7.5,SB:f,BB:f,CO:r17.25,BTN:c"),             # 0.16
    Spot("4bp_utg_btn", "UTG 4bet vs BTN", "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:r17.25,BTN:c"),          # 0.12
    Spot("4bp_utg_sb", "UTG 4bet vs SB", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:r23,SB:c"),                 # 0.12
    Spot("4bp_btn_sb", "BTN 4bet vs SB", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:r10,BB:f,BTN:r23,SB:c"),                 # 0.12
    Spot("4bp_btn_bb", "BTN 4bet vs BB", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:r23,BB:c"),                 # 0.10
    Spot("4bp_sb_bb", "SB 4bet vs BB", "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:r10,SB:r23,BB:c"),                      # 0.10
    Spot("4bp_co_sb", "CO 4bet vs SB", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:r10,BB:f,CO:r23,SB:c"),                    # 0.06
    # 8-max, the rest of the big blind's defences and the commonest flat
    Spot("srp_lj_bb_8max", "LJ vs BB single-raised pot, 8-max", "UTG:f,UTG1:f,LJ:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c",
         "8max", "old"),                                                                                      # 5.8 / 4.9
    Spot("srp_utg1_bb_8max", "UTG1 vs BB single-raised pot, 8-max",
         "UTG:f,UTG1:r2.5,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:c", "8max", "old"),                                    # 5.5 / 4.6
    Spot("srp_utg_utg1_8max", "UTG vs UTG1 single-raised pot, 8-max",
         "UTG:r2.5,UTG1:c,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:f", "8max", "old"),                                    # 2.5 / 5.5
]
BY_ID = {s.id: s for s in SPOTS}
# Phases, built in turn: every spot to 184 representative flops, then to 552 (an odd multiple of a set holds it).
PHASES = [184, 552]

bfl = fl = None  # build_flop_library and gto.flop_library, imported from --solver


def load(solver: Path) -> None:
    global bfl, fl
    sys.path.insert(0, str(solver / "scripts"))
    sys.path.insert(0, str(solver))
    import build_flop_library as b  # noqa: E402  (imports gto.native first: BLAS on one thread)
    bfl, fl = b, b.fl


def spot_tuple(s: Spot) -> tuple:
    """(id, label, line, Format), as build_flop_library's spots are."""
    return (s.id, s.label, s.line, fl.Format.parse(s.fmt))


def meta_of(s: Spot) -> dict:
    sid, _, line, fmt = spot_tuple(s)
    return bfl._meta(sid, bfl._setup(line, fmt))


def flops(n: int) -> list:
    from gto.cards import cards_str
    return [cards_str(f) for f in fl.representative_flops(n)]


def on_disk(out: Path, s: Spot, name: str, meta: dict) -> str | None:
    """'dealt' or 'old' for an entry on disk for the spot's ranges on that tree, else None."""
    p = str(out / s.id / f"{name}.bin")
    if bfl.current(p, meta):
        return "dealt"
    old = bfl.old_tree(meta)
    if old is not None and bfl.current(p, meta, old):
        return "old"
    return None


# ----------------------------------------------------------------------------- one entry (a worker process)
def solve_one(solver: Path, out: Path, sid: str, name: str, tree: str, opts: dict) -> str:
    """Solve and write one entry: the river dealt with its turn file (build_flop_library.solve_entry), or the old tree
    without one (the river blind: library_config() without pot and stack, as the older spots' entries)."""
    import resource
    from gto.cards import cards as parse_cards
    from gto.solver import solve
    s = BY_ID[sid]
    _, _, line, fmt = spot_tuple(s)
    t0 = time.time()
    if tree == "dealt":
        msg = bfl.solve_entry((sid, line, fmt.as_dict(), name, str(out), {**opts, "turns": True, "turn_evs": False}))
    else:
        st = bfl._setup(line, fmt)
        meta = dict(bfl._meta(sid, st), board=name, tree=fl.old_tree())
        sol = solve(parse_cards(name), st["full0"], st["full1"], st["pot"], st["stack"], cfg=fl.library_config(),
                    time_budget=1e9, max_iters=opts["min_iters"])
        expl = sol.exploitability()
        while expl > opts["target"] and sol.iters < opts["max_iters"]:
            sol.extend(1e9, max_iters=min(sol.iters + opts["check"], opts["max_iters"]))
            expl = sol.exploitability()
        data, _ = bfl.write_entry(str(out), sid, name, sol, meta, with_turns=False)
        msg = f"{sid} {name} iters={sol.iters} expl={expl:.3f}% secs={time.time() - t0:.0f} bytes={len(data)}"
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # bytes on macOS
    return f"{msg} tree={tree} peak_mb={rss:.0f}"


# ----------------------------------------------------------------------------- the build
def rss_mb(pid: int) -> float:
    try:
        out = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True).stdout
        return int(out.strip() or 0) / 1024
    except (OSError, ValueError):
        return 0.0


def todo_list(out: Path, phases: list, redo_old: bool, spots: list) -> list:
    """[(spot, flop, tree)] still to solve, phase by phase, spot by spot in value order."""
    jobs, seen = [], set()
    metas = {s.id: meta_of(s) for s in spots}
    for n in phases:
        names = flops(n)
        for s in spots:
            for nm in names:
                if (s.id, nm) in seen:
                    continue
                seen.add((s.id, nm))
                have = on_disk(out, s, nm, metas[s.id])
                if have == "dealt" or (have == "old" and (s.tree == "old" or not redo_old)):
                    continue
                jobs.append((s.id, nm, s.tree))
    return jobs


def write_plan(out: Path, phases: list) -> None:
    """plan.json: the flop count each spot is being built to (assemble.py's targets, the Library page's bars)."""
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "plan.json.tmp"
    tmp.write_text(json.dumps({"spots": {s.id: max(phases) for s in SPOTS}, "phases": phases}, indent=1))
    os.replace(tmp, out / "plan.json")


def run(a) -> int:
    out = a.out.resolve()
    write_plan(out, a.phases)
    skip_p = out / "over-memory.json"
    over = json.loads(skip_p.read_text()) if skip_p.exists() else {}
    jobs = todo_list(out, a.phases, a.redo_old, a.spots)
    # a dealt flop that went over --max-mb before is solved on the old tree straight away (unless --max-mb grew)
    jobs = [(sid, nm, "old" if tr == "dealt" and over.get(f"{sid}/{nm}", 1e9) > a.max_mb else tr)
            if f"{sid}/{nm}" in over else (sid, nm, tr) for sid, nm, tr in jobs]
    if a.limit:
        jobs = jobs[: a.limit]
    print(f"=== {time.strftime('%F %T')} {len(jobs)} entries to solve, {a.jobs} processes, max {a.max_mb} MB a "
          f"process, out {out}", flush=True)
    every = [spot_tuple(s) for s in SPOTS]
    stop = {"now": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__("now", True))
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("now", True))
    queue = list(jobs)
    running: dict = {}  # pid -> (Popen, job, started, peak)
    done = failed = since_index = 0
    t0 = time.time()
    opts = json.dumps({"min_iters": a.min_iters, "max_iters": a.max_iters, "check": a.check, "target": a.target})
    while (queue or running) and not stop["now"]:
        while queue and len(running) < a.jobs and not stop["now"]:
            job = queue.pop(0)
            p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_one", *job, "--solver", str(a.solver),
                                  "--out", str(out), "--opts", opts], stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
            running[p.pid] = (p, job, time.time(), 0.0)
        time.sleep(1)
        for pid, (p, job, started, peak) in list(running.items()):
            mb = rss_mb(pid)
            peak = max(peak, mb)
            running[pid] = (p, job, started, peak)
            sid, nm, tree = job
            if p.poll() is None:
                if mb > a.max_mb:
                    p.kill()
                    p.wait()
                    del running[pid]
                    over[f"{sid}/{nm}"] = round(mb)
                    tmp = skip_p.with_suffix(".tmp")
                    tmp.write_text(json.dumps(over, indent=0, sort_keys=True))
                    os.replace(tmp, skip_p)
                    for leftover in (out / sid).glob(f"{nm}*.tmp"):
                        leftover.unlink(missing_ok=True)
                    if tree == "dealt":
                        queue.insert(0, (sid, nm, "old"))
                        print(f"  {sid} {nm}: {mb:.0f} MB with the river dealt, over {a.max_mb}: stopped after "
                              f"{time.time() - started:.0f} s, solving it on the old tree", flush=True)
                    else:
                        failed += 1
                        print(f"  {sid} {nm}: {mb:.0f} MB on the old tree, over {a.max_mb}: left out", flush=True)
                continue
            del running[pid]
            text = (p.stdout.read() if p.stdout else "").strip().splitlines()
            line = next((x for x in reversed(text) if x.startswith(sid)), None)
            if p.returncode != 0 or line is None:
                failed += 1
                print(f"  {sid} {nm} ({tree}): failed, exit {p.returncode}: {' | '.join(text[-3:])}", flush=True)
                continue
            done += 1
            since_index += 1
            el = time.time() - t0
            left = len(queue) + len(running)
            print(f"[{done}/{len(jobs)} {el / 60:.0f} min, ~{el / done * left / 3600:.1f} h left] {line} "
                  f"watched_mb={peak:.0f}", flush=True)
            if since_index >= a.index_every:
                bfl.write_index(str(out), every)
                since_index = 0
    for pid, (p, job, *_rest) in running.items():
        p.terminate()
    for pid, (p, *_rest) in running.items():
        try:
            p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            p.kill()
    if out.is_dir():
        bfl.write_index(str(out), every)
    print(f"=== {time.strftime('%F %T')} {'stopped' if stop['now'] else 'finished'}: {done} solved, {failed} failed",
          flush=True)
    return 1 if failed and not stop["now"] else 0


def plan(a) -> int:
    out = a.out.resolve()
    metas = {s.id: meta_of(s) for s in a.spots}
    total = 0
    for n in a.phases:
        names = flops(n)
        print(f"phase {n} flops:")
        for s in a.spots:
            st = [on_disk(out, s, nm, metas[s.id]) for nm in names]
            left = st.count(None)
            total += left if n == max(a.phases) else 0
            print(f"  {s.id:<20} {s.fmt or '6max':<5} {s.tree:<5} {st.count('dealt'):>4} dealt {st.count('old'):>4} old "
                  f"{left:>4} left   pot {metas[s.id]['pot']:<6} stack {metas[s.id]['stack']}")
    print(f"{total} entries left to the last phase")
    return 0


def one(a) -> int:
    out = a.out.resolve()
    from gto.cards import cards as parse_cards
    name = fl.flop_name(parse_cards(a.flop))
    opts = {"min_iters": a.min_iters, "max_iters": a.max_iters, "check": a.check, "target": a.target}
    t0 = time.time()
    print(solve_one(a.solver, out, a.spot, name, a.tree, opts), f"wall={time.time() - t0:.0f}", flush=True)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["plan", "run", "one", "_one"])
    ap.add_argument("rest", nargs="*")
    ap.add_argument("--solver", type=Path, default=MAIN / "solver", help="the solver snapshot to run")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--phases", default=",".join(map(str, PHASES)))
    ap.add_argument("--spots", default="", help="comma separated spot ids (default: every spot, in value order)")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--max-mb", type=int, default=MAX_MB)
    ap.add_argument("--redo-old", action="store_true", help="solve again with the river dealt the entries of 'dealt' "
                    "spots that fell back to the old tree (after a bigger --max-mb is allowed)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--index-every", type=int, default=20)
    ap.add_argument("--min-iters", type=int, default=200)
    ap.add_argument("--max-iters", type=int, default=1000)
    ap.add_argument("--check", type=int, default=100)
    ap.add_argument("--target", type=float, default=0.15)
    ap.add_argument("--tree", choices=["dealt", "old"], default=None)
    ap.add_argument("--opts", default=None)
    a = ap.parse_args(argv)
    a.solver = a.solver.resolve()
    a.phases = sorted(int(x) for x in str(a.phases).split(",") if x)
    want = [x for x in a.spots.split(",") if x]
    if [x for x in want if x not in BY_ID]:
        ap.error(f"unknown spot in {want}; spots: {list(BY_ID)}")
    a.spots = [BY_ID[x] for x in want] if want else SPOTS
    out = a.out.resolve()
    if "gtosolver" in out.parts or (a.solver / "gto" / "static" / "flop_library").resolve() in [out, *out.parents]:
        sys.exit(f"refusing: --out {out}")
    load(a.solver)
    if a.cmd == "_one":
        sid, name, tree = a.rest
        print(solve_one(a.solver, out, sid, name, tree, json.loads(a.opts)), flush=True)
        return 0
    if a.cmd == "one":
        if len(a.rest) != 2 or a.rest[0] not in BY_ID:
            ap.error(f"one SPOT FLOP; spots: {list(BY_ID)}")
        a.spot, a.flop = a.rest
        a.tree = a.tree or BY_ID[a.spot].tree
        return one(a)
    return plan(a) if a.cmd == "plan" else run(a)


if __name__ == "__main__":
    sys.exit(main())
