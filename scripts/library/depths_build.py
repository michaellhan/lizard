#!/usr/bin/env python3
"""Builds the flop library's spots at other stack depths (the solver's FORMAT_SPOTS games, e.g. srp_btn_bb_40bb) into
library-build/sources/depths, where scripts/library/assemble.py takes them into Lizard's library (--formats).

    depths_build.py start [--measure] [--batch 40bb ...]   # detached; returns at once
    depths_build.py status                                   # what runs, entries on disk, peak RAM, ETA
    depths_build.py stop

Each batch is one run of solver/scripts/build_flop_library.py (its spots on their representative flops, 2 worker
processes, a fresh process per entry, turn files with EVs as the newer spots have) through `heavy -x`: one machine-wide
slot, the efficiency cores, nice 10. Batches run one at a time, in BATCHES order.

Detached and resumable: the supervisor runs in its own session (it survives the app and the shell closing), with its
pid, log and state in library-build/runs/depths. build_flop_library keeps every entry already on disk for the current
charts and tree, so `start` again after a stop, a crash or a reboot picks up where it was; a build killed under it (the
machine's memory guard) is run again after a pause, up to RETRIES times.

The solver runs from a frozen copy of this checkout's solver/ (runs/depths/solver-<hash>): its workers re-import it for
every entry, so a worktree removed or a solver/ re-imported mid-build can neither break the build nor mix two charts'
entries in one spot. `start --refresh` takes a new copy (entries the new charts don't match are then solved again).

--measure solves MEASURE_N entries of each spot only (kept, so the full run doesn't redo them): seconds and peak RAM per
entry, for the projection `status` prints.
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

ROOT = Path(__file__).resolve().parents[2]
MAIN = Path("/Users/mhan/Desktop/projects/lizard")  # the main checkout, whose library-build/ is the build's home
OUT = MAIN / "library-build" / "sources" / "depths"
RUN = MAIN / "library-build" / "runs" / "depths"
PY = MAIN / ".venv" / "bin" / "python"
JOBS = 2  # worker processes (the machine is shared: at most 2)
RETRIES = 5
MEASURE_N = 2

# The batches, most useful first (docs/library-depths.md): the four most-played heads-up pots (BTN, CO and SB opens the
# big blind calls; the big blind's 3bet against the button) at 40bb, the depth whose charts a solve moved (pf_formats
# DEPTHS), then 200bb (100bb's charts with the big blind's calls priced for implied odds); 184 flops each first.
BATCHES = [
    ("40bb", ["srp_btn_bb_40bb", "srp_co_bb_40bb", "srp_sb_bb_40bb", "3bp_bb_btn_40bb"], 184),
    ("200bb", ["srp_btn_bb_200bb", "srp_co_bb_200bb", "srp_sb_bb_200bb", "3bp_bb_btn_200bb"], 184),
]

STATE = RUN / "state.json"
PIDFILE = RUN / "supervisor.pid"
LOG = RUN / "build.log"
PROGRESS = re.compile(r"^\[(\d+)/(\d+) .*?\] (\S+) (\S+) iters=(\d+) expl=([\d.]+)% secs=(\d+) bytes=(\d+)")


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(st: dict) -> None:
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1))
    os.replace(tmp, STATE)


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
    st = load_state()
    old = Path(st["solver"]) if st.get("solver") else None
    if old and old.exists() and not refresh:
        return old
    snap = RUN / f"solver-{tree_hash(ROOT / 'solver')}"
    if not snap.exists():
        tmp = RUN / f".{snap.name}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(ROOT / "solver", tmp, ignore=shutil.ignore_patterns("flop_library", "build", "__pycache__", ".venv"))
        os.replace(tmp, snap)
    st["solver"] = str(snap)
    save_state(st)
    return snap


def entries_on_disk(sid: str) -> int:
    d = OUT / sid
    return sum(1 for p in d.glob("*.bin") if not p.name.endswith(".turn.bin")) if d.is_dir() else 0


def group_rss(pgid: int) -> tuple[int, int]:
    """(largest process, total) resident KB of a process group."""
    out = subprocess.run(["/bin/ps", "-axo", "pgid=,rss="], capture_output=True, text=True).stdout
    rss = [int(f[1]) for f in (ln.split() for ln in out.splitlines()) if len(f) == 2 and f[0] == str(pgid)]
    return (max(rss), sum(rss)) if rss else (0, 0)


def build_cmd(snap: Path, spots: list[str], flops: int, limit: int = 0) -> list[str]:
    return ["heavy", "-x", str(PY), str(snap / "scripts" / "build_flop_library.py"), "--spots", ",".join(spots),
            "--flops", str(flops), "--jobs", str(JOBS), "--fresh", "--turn-evs", "--out", str(OUT),
            *(["--limit", str(limit)] if limit else [])]


def run_one(st: dict, name: str, cmd: list[str], cwd: Path) -> int:
    """Runs one build to its end, sampling its RAM; returns its exit status."""
    log = open(LOG, "ab")
    p = subprocess.Popen(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    st.update(current=name, child=p.pid, childStarted=time.time())
    save_state(st)
    peak = st.setdefault("peakRss", {})
    while p.poll() is None:
        big, total = group_rss(p.pid)
        rec = peak.setdefault(name.split(":")[0], {"processKB": 0, "totalKB": 0})
        if big > rec["processKB"] or total > rec["totalKB"]:
            rec["processKB"], rec["totalKB"] = max(big, rec["processKB"]), max(total, rec["totalKB"])
            save_state(st)
        time.sleep(15)
    st.pop("child", None)
    save_state(st)
    return p.returncode


def supervise(batches: list[str], measure: bool) -> None:
    st = load_state()
    snap = Path(st["solver"])
    st.update(status="running", measure=measure, started=time.time(), batches=batches)
    save_state(st)
    for name, spots, flops in BATCHES:
        if name not in batches:
            continue
        runs = [(f"{name}:{s}", [s], MEASURE_N) for s in spots] if measure else [(name, spots, 0)]
        for label, sp, limit in runs:
            for attempt in range(RETRIES + 1):
                print(f"{time.strftime('%F %T')} depths_build: {label} (attempt {attempt + 1})", file=sys.stderr, flush=True)
                rc = run_one(st, label, build_cmd(snap, sp, flops, limit), snap)
                if rc == 0:
                    break
                print(f"{time.strftime('%F %T')} depths_build: {label} exited {rc}; again in 60 s", file=sys.stderr, flush=True)
                time.sleep(60)
            else:
                st.update(status=f"failed: {label} exited {rc} {RETRIES + 1} times")
                save_state(st)
                return
            if not measure:
                st.setdefault("done", []).append(name)
                save_state(st)
    st.update(status="measured" if measure else "finished", current=None, ended=time.time())
    save_state(st)


def cmd_start(a) -> int:
    RUN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    if PIDFILE.exists() and alive(PIDFILE.read_text().strip()):
        print(f"already running (pid {PIDFILE.read_text().strip()}); `status` to see it")
        return 1
    snap = snapshot(a.refresh)
    batches = a.batch or [b[0] for b in BATCHES]
    with open(LOG, "ab") as log:
        p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_supervise", *(["--measure"] if a.measure else []),
                              "--batch", *batches], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True, cwd=RUN)
    PIDFILE.write_text(str(p.pid))
    print(f"started (pid {p.pid}) {'measuring ' if a.measure else ''}{', '.join(batches)} from {snap}\nlog: {LOG}")
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
    st.update(status="stopped", child=None)
    save_state(st)
    print("stopped; `start` resumes (entries on disk are kept)")
    return 0


def projection(lines: list[str]) -> dict[str, list[int]]:
    """Seconds per entry solved, per spot, from the build log."""
    secs: dict[str, list[int]] = {}
    for ln in lines:
        m = PROGRESS.match(ln)
        if m:
            secs.setdefault(m.group(3), []).append(int(m.group(7)))
    return secs


def cmd_status(_a) -> int:
    st = load_state()
    pid = PIDFILE.read_text().strip() if PIDFILE.exists() else None
    running = bool(pid and alive(pid))
    print(f"supervisor: {'running pid ' + pid if running else 'not running'}; status {st.get('status')}; "
          f"current {st.get('current')}; solver copy {st.get('solver')}")
    lines = LOG.read_text(errors="replace").splitlines() if LOG.exists() else []
    secs = projection(lines)
    left_s = 0.0
    for name, spots, flops in BATCHES:
        for s in spots:
            n = entries_on_disk(s)
            # (a spot not measured yet: its batch's spots of the same pot type)
            per = secs.get(s) or [x for k, v in secs.items() if k.endswith(f"_{name}") and k[:3] == s[:3] for x in v]
            avg = sum(per) / len(per) if per else None
            left_s += (flops - n) * (avg or 0)
            print(f"  {s:<20} {n:>5}/{flops} on disk" + (f"   {avg:.0f} s/entry over {len(per)}" if avg else ""))
    for k, v in (st.get("peakRss") or {}).items():
        print(f"  peak RAM {k}: largest process {v['processKB'] / 1024:.0f} MB, all its processes {v['totalKB'] / 1024:.0f} MB")
    if left_s:
        print(f"  projected: {left_s / 3600:.1f} core-hours left, ~{left_s / JOBS / 3600:.1f} h with {JOBS} workers once "
              "it holds a heavy slot (spots not measured yet count 0)")
    prog = [ln for ln in lines if re.match(r"^\[\d+/\d+ ", ln)]
    if prog:
        print(f"  last: {prog[-1][:160]}")
    tail = [ln for ln in lines[-5:] if not re.match(r"^\[\d+/\d+ ", ln)]
    for ln in tail:
        print(f"  log: {ln[:160]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start")
    s.add_argument("--measure", action="store_true")
    s.add_argument("--refresh", action="store_true", help="take a new copy of solver/")
    s.add_argument("--batch", nargs="+", choices=[b[0] for b in BATCHES])
    sub.add_parser("status")
    sub.add_parser("stop")
    v = sub.add_parser("_supervise")
    v.add_argument("--measure", action="store_true")
    v.add_argument("--batch", nargs="+")
    a = ap.parse_args()
    if a.cmd == "_supervise":
        supervise(a.batch, a.measure)
        return 0
    return {"start": cmd_start, "stop": cmd_stop, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
