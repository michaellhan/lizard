#!/usr/bin/env python3
"""Builds the flop library's spots at other stack depths (the solver's FORMAT_SPOTS games, e.g. srp_btn_bb_40bb) into
library-build/sources/depths, where scripts/library/assemble.py takes them into Lizard's library (FORMAT_SOURCES).

    depths_build.py start [--batch NAME ...] [--max-mb MB]   # detached; returns at once
    depths_build.py status                                     # what runs, entries on disk, s/entry, peak RAM, ETA
    depths_build.py stop

A batch is one run of solver/scripts/build_flop_library.py: its spots on their representative flops (or those of them
whose tree is at most `max_mcells` million cells, the solve's memory), 2 worker processes, a fresh process per entry,
turn files with EVs as the newer spots have. The batches run one after another inside one `heavy -x` job, which holds
one machine-wide slot (efficiency cores, nice 10) until the last ends, so they queue for a slot once.

Memory: a worker's peak grows with its tree's cells (the solver's README: heads-up 100bb trees of 63-73M cells peaked at
2.1-3.0 GB). While gtosolver's builds run a process stays under about 1 GB (CLAUDE.md), so `start` runs only the batches
whose `mb` is within --max-mb (MAX_MB by default), and a watchdog stops the job if any of its processes passes
--max-mb x KILL_OVER: that batch is then marked over its memory and the rest go on.

Detached and resumable: the supervisor runs in its own session (it survives the app and the shell closing), with its
pid, log and state in library-build/runs/depths. build_flop_library keeps every entry already on disk for the current
charts and tree, so `start` again after a stop, a crash or a reboot picks up where it was; a job killed otherwise (the
machine's memory guard) runs again after a pause, up to RETRIES times.

The solver runs from a frozen copy of this checkout's solver/ (runs/depths/solver-<hash>): its workers re-import it for
every entry, so a worktree removed or a solver/ re-imported mid-build can neither break the build nor mix two charts'
entries in one spot. `start --refresh` takes a new copy (entries the new charts don't match are then solved again).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple, Optional

ROOT = Path(__file__).resolve().parents[2]
MAIN = Path("/Users/mhan/Desktop/projects/lizard")  # the main checkout, whose library-build/ is the build's home
OUT = MAIN / "library-build" / "sources" / "depths"
RUN = MAIN / "library-build" / "runs" / "depths"
PY = MAIN / ".venv" / "bin" / "python"
JOBS = 2  # worker processes (the machine is shared: at most 2)
RETRIES = 5
MAX_MB = 1000  # a process's memory while gtosolver's builds run (CLAUDE.md: about 1 GB)
KILL_OVER = 1.15


class Batch(NamedTuple):
    name: str
    spots: list
    flops: int  # representative_flops(n)
    max_mcells: Optional[float]  # only the flops whose tree is at most this many million cells (None: all)
    mb: int  # a worker's estimated peak, MB (~41 bytes a cell over the batch's largest tree, from the README's figures)


# Most useful first (docs/library-depths.md): the four most-played heads-up pots (BTN, CO and SB opens the big blind
# calls; the big blind's 3bet against the button) at 40bb, whose charts a solve moved (pf_formats DEPTHS), then 200bb
# (100bb's charts with the big blind's calls priced for implied odds); the 184 representative flops first. Tree sizes
# (solver.tree_cells, rainbow to two-tone flops): 40bb's 3bet pot 3.7-6.9M cells, its single-raised pots 20-38M (73 of
# the 184 flops, the rainbow ones, at most 24M), 200bb's 3bet pot 24-44M and single-raised pots 38-70M.
SRP40 = ["srp_btn_bb_40bb", "srp_co_bb_40bb", "srp_sb_bb_40bb"]
BATCHES = [
    Batch("40bb-3bp", ["3bp_bb_btn_40bb"], 184, None, 300),
    Batch("40bb-srp-small", SRP40, 184, 24.0, 1000),
    Batch("40bb-srp", SRP40, 184, None, 1600),
    Batch("200bb", ["3bp_bb_btn_200bb", "srp_btn_bb_200bb", "srp_co_bb_200bb", "srp_sb_bb_200bb"], 184, None, 2900),
]
BY_NAME = {b.name: b for b in BATCHES}

STATE = RUN / "state.json"
PIDFILE = RUN / "supervisor.pid"
LOG = RUN / "build.log"
PROGRESS = re.compile(r"^\[(\d+)/(\d+) .*?\] (\S+) (\S+) iters=(\d+) expl=([\d.]+)% secs=(\d+) bytes=(\d+)")


def stamp() -> str:
    return time.strftime("%F %T")


def say(msg: str) -> None:
    print(f"{stamp()} depths_build: {msg}", file=sys.stderr, flush=True)


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def update_state(**kw) -> dict:
    st = {**load_state(), **kw}
    tmp = STATE.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(st, indent=1))
    os.replace(tmp, STATE)
    return st


def alive(pid) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def tree_hash(d: Path) -> str:
    h = hashlib.sha1()
    for p in sorted(d.rglob("*.py")):
        h.update(p.relative_to(d).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def snapshot(refresh: bool) -> Path:
    """The frozen solver copy the build runs from: the recorded one, else a new copy of this checkout's solver/."""
    old = load_state().get("solver")
    if old and Path(old).exists() and not refresh:
        return Path(old)
    snap = RUN / f"solver-{tree_hash(ROOT / 'solver')}"
    if not snap.exists():
        tmp = RUN / f".{snap.name}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(ROOT / "solver", tmp, ignore=shutil.ignore_patterns("flop_library", "build", "__pycache__", ".venv"))
        os.replace(tmp, snap)
    update_state(solver=str(snap))
    return snap


def entries_on_disk(sid: str) -> int:
    d = OUT / sid
    return sum(1 for p in d.glob("*.bin") if not p.name.endswith(".turn.bin")) if d.is_dir() else 0


def group_rss(pgid: int) -> tuple[int, int]:
    """(largest process, total) resident KB of a process group."""
    out = subprocess.run(["/bin/ps", "-axo", "pgid=,rss="], capture_output=True, text=True).stdout
    rss = [int(f[1]) for f in (ln.split() for ln in out.splitlines()) if len(f) == 2 and f[0] == str(pgid)]
    return (max(rss), sum(rss)) if rss else (0, 0)


BOARDS_PY = """
import sys
sys.path.insert(0, ".")
import gto.native
from gto import flop_library as fl
from gto.solver import tree_cells
from gto.cards import cards_str
spots, n, cap = sys.argv[1].split(","), int(sys.argv[2]), float(sys.argv[3]) * 1e6
by = {s[0]: s for s in fl.all_spots([s.rsplit("_", 1)[1] for s in spots])}
setups = []
for sid in spots:
    _, _, line, fmt = by[sid]
    s = fl.spot_setup(line, fmt.players, fmt.stack, fmt.ante, fmt.straddle)
    setups.append((s, fl.library_config(s["pot"], s["stack"])))
keep = [f for f in fl.representative_flops(n)
        if all(tree_cells(f, s["full0"], s["full1"], s["pot"], s["stack"], cfg=c) <= cap for s, c in setups)]
print(",".join(cards_str(f) for f in keep))
"""


def boards_of(b: Batch, snap: Path) -> Optional[list]:
    """The flops a batch with a tree cap builds (None: all its representative flops)."""
    if b.max_mcells is None:
        return None
    out = subprocess.run([str(PY), "-c", BOARDS_PY, ",".join(b.spots), str(b.flops), str(b.max_mcells)], cwd=snap,
                         capture_output=True, text=True, check=True).stdout.strip()
    return [x for x in out.split(",") if x]


def build_cmd(snap: Path, b: Batch, boards: Optional[list]) -> list:
    pick = ["--boards", ",".join(boards)] if boards is not None else ["--flops", str(b.flops)]
    return [str(PY), str(snap / "scripts" / "build_flop_library.py"), "--spots", ",".join(b.spots), *pick,
            "--jobs", str(JOBS), "--fresh", "--turn-evs", "--out", str(OUT)]


def chain(names: list) -> int:
    """Inside the heavy slot: each batch's build in turn. Returns the first failing build's status, else 0."""
    snap = Path(load_state()["solver"])
    for name in names:
        b = BY_NAME[name]
        boards = boards_of(b, snap)
        planned = load_state().get("planned", {})
        update_state(current=name, planned={**planned, name: len(boards) if boards is not None else b.flops})
        say(f"{name}: {', '.join(b.spots)} on {len(boards) if boards is not None else b.flops} flops")
        rc = subprocess.run(build_cmd(snap, b, boards), cwd=snap, stdin=subprocess.DEVNULL).returncode
        if rc != 0:
            return rc
        st = load_state()
        update_state(done=sorted(set(st.get("done", [])) | {name}))
    return 0


def supervise(names: list, max_mb: int) -> None:
    update_state(status="running", started=time.time(), batches=names, maxMb=max_mb, current=None)
    kill_kb = max_mb * KILL_OVER * 1024
    attempt = 0
    while True:
        st = load_state()
        todo = [n for n in names if n not in st.get("done", []) and n not in st.get("overMemory", {})]
        if not todo:
            update_state(status="finished", current=None, ended=time.time())
            return
        say(f"queueing for a heavy slot: {', '.join(todo)} (attempt {attempt + 1})")
        with open(LOG, "ab") as log:
            p = subprocess.Popen(["heavy", "-x", str(PY), str(Path(__file__).resolve()), "_chain", *todo],
                                 stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        update_state(child=p.pid)
        over = None
        while p.poll() is None:
            big, total = group_rss(p.pid)
            st = load_state()
            cur = st.get("current") or "queued"
            peak = st.get("peakRss", {})
            rec = peak.get(cur, {"processKB": 0, "totalKB": 0})
            if big > rec["processKB"] or total > rec["totalKB"]:
                peak[cur] = {"processKB": max(big, rec["processKB"]), "totalKB": max(total, rec["totalKB"])}
                update_state(peakRss=peak)
            if big > kill_kb and over is None:
                over = cur
                say(f"{cur}: a process at {big / 1024:.0f} MB, over {max_mb} MB x {KILL_OVER}: stopping it")
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except OSError:
                    pass
            time.sleep(10)
        update_state(child=None)
        if over is not None:
            update_state(overMemory={**load_state().get("overMemory", {}), over: f"over {max_mb} MB x {KILL_OVER}"})
            continue
        if p.returncode == 0:
            continue
        attempt += 1
        if attempt > RETRIES:
            update_state(status=f"failed: the job exited {p.returncode} {attempt} times", current=None)
            return
        say(f"the job exited {p.returncode}; again in 60 s")
        time.sleep(60)


def cmd_start(a) -> int:
    RUN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    if PIDFILE.exists() and alive(PIDFILE.read_text().strip()):
        print(f"already running (pid {PIDFILE.read_text().strip()}); `status` to see it")
        return 1
    names = a.batch or [b.name for b in BATCHES if b.mb <= a.max_mb]
    heavy = [n for n in names if BY_NAME[n].mb > a.max_mb]
    if heavy:
        print(f"refusing: {', '.join(heavy)} need about {max(BY_NAME[n].mb for n in heavy)} MB a process, over "
              f"--max-mb {a.max_mb}")
        return 1
    snap = snapshot(a.refresh)
    update_state(overMemory={}, peakRss={})  # (a new start tries again what an earlier one stopped)
    # the supervisor and the job run from a copy beside the log, so the worktree this came from can go
    me = RUN / "depths_build.py"
    if Path(__file__).resolve() != me:
        shutil.copyfile(Path(__file__).resolve(), me)
    with open(LOG, "ab") as log:
        p = subprocess.Popen([sys.executable, str(me), "_supervise", "--max-mb", str(a.max_mb),
                              *names], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True, cwd=RUN)
    PIDFILE.write_text(str(p.pid))
    later = [b.name for b in BATCHES if b.name not in names]
    print(f"started (pid {p.pid}): {', '.join(names)} from {snap}\nlog: {LOG}"
          + (f"\nnot started (over --max-mb {a.max_mb} a process): {', '.join(later)}" if later else ""))
    return 0


def cmd_stop(_a) -> int:
    st = load_state()
    pid = PIDFILE.read_text().strip() if PIDFILE.exists() else None
    if pid and alive(pid):
        os.kill(int(pid), signal.SIGTERM)
    if st.get("child") and alive(st["child"]):
        try:
            os.killpg(int(st["child"]), signal.SIGTERM)
        except OSError:
            pass
    update_state(status="stopped", child=None, current=None)
    print("stopped; `start` resumes (entries on disk are kept)")
    return 0


def cmd_status(_a) -> int:
    st = load_state()
    pid = PIDFILE.read_text().strip() if PIDFILE.exists() else None
    running = bool(pid and alive(pid))
    print(f"supervisor: {'running, pid ' + pid if running else 'not running'}; status {st.get('status')}; "
          f"batch {st.get('current') or '-'}; done {', '.join(st.get('done', [])) or '-'}")
    for k, v in (st.get("overMemory") or {}).items():
        print(f"  stopped over memory: {k} ({v})")
    lines = LOG.read_text(errors="replace").splitlines() if LOG.exists() else []
    secs: dict = {}
    for ln in lines:
        m = PROGRESS.match(ln)
        if m:
            secs.setdefault(m.group(3), []).append(int(m.group(7)))
    planned = st.get("planned", {})
    left_s = 0.0
    seen = set()
    for b in BATCHES:
        if b.name not in (st.get("batches") or []):
            continue
        n_plan = planned.get(b.name, b.flops)
        for s in b.spots:
            if (s, b.name) in seen:
                continue
            seen.add((s, b.name))
            n = entries_on_disk(s)
            per = secs.get(s) or [x for k, v in secs.items() if k in b.spots for x in v]
            avg = sum(per) / len(per) if per else None
            left_s += max(0, n_plan - n) * (avg or 0)
            print(f"  {b.name:<15} {s:<18} {n:>4} on disk of {n_plan}" + (f"   {avg:.0f} s/entry over {len(per)}" if avg else ""))
    for k, v in (st.get("peakRss") or {}).items():
        print(f"  peak RAM ({k}): largest process {v['processKB'] / 1024:.0f} MB, the job {v['totalKB'] / 1024:.0f} MB")
    if left_s:
        print(f"  ETA: ~{left_s / JOBS / 3600:.1f} h of solving left at {JOBS} workers ({left_s / 3600:.1f} core-hours; a "
              "batch not measured yet counts 0), once it holds a heavy slot")
    prog = [ln for ln in lines if PROGRESS.match(ln)]
    if prog:
        print(f"  last: {prog[-1][:170]}")
    for ln in [ln for ln in lines if not PROGRESS.match(ln)][-3:]:
        print(f"  log: {ln[:170]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start")
    s.add_argument("--batch", nargs="+", choices=list(BY_NAME))
    s.add_argument("--max-mb", type=int, default=MAX_MB, help="a process's memory allowed (MB)")
    s.add_argument("--refresh", action="store_true", help="take a new copy of solver/")
    sub.add_parser("status")
    sub.add_parser("stop")
    v = sub.add_parser("_supervise")
    v.add_argument("--max-mb", type=int, default=MAX_MB)
    v.add_argument("names", nargs="+")
    c = sub.add_parser("_chain")
    c.add_argument("names", nargs="+")
    a = ap.parse_args()
    if a.cmd == "_supervise":
        supervise(a.names, a.max_mb)
        return 0
    if a.cmd == "_chain":
        return chain(a.names)
    return {"start": cmd_start, "stop": cmd_stop, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
