#!/usr/bin/env bash
# The detached library-breadth build (scripts/library/build_breadth.py): new 6-max and 8-max heads-up spots.
#
#   scripts/library/breadth.sh start    start (or resume) it, detached; safe to run again
#   scripts/library/breadth.sh stop     stop it (entries written so far are kept; start resumes)
#   scripts/library/breadth.sh status   running or not, entries per spot, the log's last lines
#
# Output, log and pid file: <main checkout>/library-build/sources/breadth/ (gitignored, outside any worktree, where
# assemble.py reads it). The runner is copied into its .runner/ at start and the solver is the main checkout's, so the
# build doesn't depend on the worktree that started it. The whole build is one `heavy -x` job (efficiency cores, nice
# 10, one of the Mac's two heavy slots; it waits for a free one), BREADTH_JOBS worker processes (default 2), each
# stopped past BREADTH_MAX_MB (default 1000; build_breadth.py then solves that flop on the old tree).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MAIN="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$ROOT/.git")")"
OUT="${BREADTH_OUT:-$MAIN/library-build/sources/breadth}"
PY="$MAIN/.venv/bin/python"
LOG="$OUT/build.log"
PID="$OUT/build.pid"
JOBS="${BREADTH_JOBS:-2}"
MAXMB="${BREADTH_MAX_MB:-1000}"

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-status}" in
start)
  if running; then echo "already running (pid $(cat "$PID"))"; exit 0; fi
  mkdir -p "$OUT/.runner"
  cp "$HERE/build_breadth.py" "$HERE/breadth.sh" "$OUT/.runner/"
  # a new session (no controlling terminal, out of the starting shell's process group): survives the app quitting
  BREADTH_MAIN="$MAIN" nohup "$PY" -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    bash "$OUT/.runner/breadth.sh" _loop >>"$LOG" 2>&1 </dev/null &
  echo $! >"$PID"
  echo "started (pid $!); log: $LOG"
  ;;
_loop)
  echo "=== $(date '+%F %T') queued for a heavy slot ($JOBS processes, at most $MAXMB MB each)"
  status=0
  BREADTH_MAIN="$MAIN" heavy "$PY" "$OUT/.runner/build_breadth.py" run --solver "$MAIN/solver" --out "$OUT" \
    --jobs "$JOBS" --max-mb "$MAXMB" || status=$?
  echo "=== $(date '+%F %T') exit $status$([ $status != 0 ] && echo ' (run start again to retry)')"
  rm -f "$PID"
  ;;
stop)
  if ! running; then echo "not running"; rm -f "$PID"; exit 0; fi
  p=$(cat "$PID")
  # the supervisor's session (setsid: its pid is the group): bash, heavy, build_breadth.py run and its workers
  kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p"
  for _ in $(seq 1 30); do running || break; sleep 1; done
  pkill -TERM -f "$OUT/.runner/build_breadth.py" 2>/dev/null || true
  rm -f "$PID"
  echo "=== $(date '+%F %T') stopped" >>"$LOG"
  echo "stopped"
  ;;
status)
  if running; then echo "running (pid $(cat "$PID"))"; else echo "not running"; fi
  if [ -f "$OUT/index.json" ]; then
    "$PY" - "$OUT" <<'EOF'
import json, sys, os
out = sys.argv[1]
i = json.load(open(os.path.join(out, "index.json")))
plan = json.load(open(os.path.join(out, "plan.json"))) if os.path.exists(os.path.join(out, "plan.json")) else {}
for s in i["spots"]:
    t = s.get("turns")
    nt = len(s["flops"]) if t is True else len(t or [])
    print(f"  {s['id']:<20} {len(s['flops']):>5} / {plan.get('spots', {}).get(s['id'], '?')} flops"
          f"  ({len(s.get('old', []))} on the old tree, {nt} turn files)")
over = os.path.join(out, "over-memory.json")
if os.path.exists(over):
    print(f"  {len(json.load(open(over)))} flops went over the memory cap with the river dealt (solved on the old tree)")
EOF
  fi
  if [ -f "$LOG" ]; then tail -n 5 "$LOG"; fi
  ;;
*) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
