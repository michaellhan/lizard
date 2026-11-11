#!/usr/bin/env bash
# The detached build of the five 6-max single-raised spots on every flop (scripts/library/build_srp_every_flop.py).
#
#   scripts/library/srp_every_flop.sh start    start (or resume) it, detached; safe to run again
#   scripts/library/srp_every_flop.sh stop     stop it (entries written so far are kept; start resumes)
#   scripts/library/srp_every_flop.sh status   running or not, entries per spot, the log's last lines
#
# Output, log and pid file: <main checkout>/library-build/sources/srp-every-flop/ (gitignored, outside any worktree,
# where assemble.py reads it). The runner and this script are copied into its .runner/ at start, and the solver is the
# main checkout's, so the build doesn't depend on the worktree that started it. Each spot is its own `heavy` job (2
# worker processes, efficiency cores, nice 10), so the machine-wide slot is given back between spots.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MAIN="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$ROOT/.git")")"
OUT="${SRP_OUT:-$MAIN/library-build/sources/srp-every-flop}"
PY="$MAIN/.venv/bin/python"
LOG="$OUT/build.log"
PID="$OUT/build.pid"
# lightest spots first (the base's median seconds an entry: 12, 14, 17, 27, 54), so whole spots land sooner
SPOTS="srp_utg_hj srp_utg_btn srp_hj_co srp_co_sb srp_btn_sb"

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-status}" in
start)
  if running; then echo "already running (pid $(cat "$PID"))"; exit 0; fi
  mkdir -p "$OUT/.runner"
  cp "$HERE/build_srp_every_flop.py" "$HERE/srp_every_flop.sh" "$OUT/.runner/"
  # a new session (no controlling terminal, out of the starting shell's process group): survives the app quitting
  nohup "$PY" -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    bash "$OUT/.runner/srp_every_flop.sh" _loop >>"$LOG" 2>&1 </dev/null &
  echo $! >"$PID"
  echo "started (pid $!); log: $LOG"
  ;;
_loop)
  echo "=== $(date '+%F %T') start: $SPOTS"
  failed=0
  for sid in $SPOTS; do
    left=$("$PY" "$OUT/.runner/build_srp_every_flop.py" --solver "$MAIN/solver" --out "$OUT" --spots "$sid" --dry-run \
           | sed -n 's/^\([0-9]*\) entries to solve.*/\1/p')
    if [ "$left" = "0" ]; then echo "$sid: done"; continue; fi
    echo "=== $(date '+%F %T') $sid: $left to solve; waiting for a heavy slot"
    if ! heavy "$PY" "$OUT/.runner/build_srp_every_flop.py" --solver "$MAIN/solver" --out "$OUT" --spots "$sid" --jobs 2; then
      echo "=== $(date '+%F %T') $sid: the build exited with an error"; failed=1
    fi
  done
  echo "=== $(date '+%F %T') finished$([ $failed = 1 ] && echo ' with errors (run start again to retry)')"
  rm -f "$PID"
  ;;
stop)
  if ! running; then echo "not running"; rm -f "$PID"; exit 0; fi
  p=$(cat "$PID")
  # the supervisor's session (setsid: its pid is the group): bash, heavy (which forwards to the job's own group)
  kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p"
  for _ in $(seq 1 30); do running || break; sleep 1; done
  pkill -TERM -f "$OUT/.runner/build_srp_every_flop.py" 2>/dev/null || true
  rm -f "$PID"
  echo "=== $(date '+%F %T') stopped" >>"$LOG"
  echo "stopped"
  ;;
status)
  if running; then echo "running (pid $(cat "$PID"))"; else echo "not running"; fi
  for sid in $SPOTS; do
    n=$(ls "$OUT/$sid" 2>/dev/null | grep -c '^[^.]*\.bin$' || true)
    echo "  $sid: $n of 1755 entries on disk"
  done
  if [ -f "$OUT/index.json" ]; then "$PY" -c 'import json,sys; i=json.load(open(sys.argv[1])); print("  index:", ", ".join(f"{s[\"id\"]} {len(s[\"flops\"])}" for s in i["spots"]))' "$OUT/index.json"; fi
  if [ -f "$LOG" ]; then tail -n 5 "$LOG"; fi
  ;;
*) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
