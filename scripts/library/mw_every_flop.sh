#!/bin/bash
# mw_every_flop.sh start|stop|status: the 3-way spots' build to every flop (scripts/library/build_mw_every_flop.py),
# detached from any terminal or app (its own session, nohup), through `heavy -x` (queued for one of the Mac's two
# heavy slots, then the efficiency cores at nice 10; the pid stays the job's), into the main checkout's ignored
# library-build/sources/mw-every-flop, where assemble.py reads it.
#
#   start   copy the driver beside the output (so it outlives a worktree) and start it, unless it is running
#   stop    SIGTERM the job's process group: the workers stop, every finished entry stays, `start` resumes
#   status  running or not, progress.json, the log's last lines
# MW_REBUILD=1 before any of them: the rebuild of the spots on today's ranges (--rebuild, sources/mw-rebuild) instead
set -euo pipefail
MAIN=${LIZARD_MAIN:-/Users/mhan/projects/lizard}
# MW_REBUILD=1: the spots rebuilt on today's ranges (build_mw_every_flop.py --rebuild) into sources/mw-rebuild
REBUILD=()
if [ "${MW_REBUILD:-0}" = 1 ]; then REBUILD=(--rebuild); fi
OUT=${MW_OUT:-$MAIN/library-build/sources/$([ "${MW_REBUILD:-0}" = 1 ] && echo mw-rebuild || echo mw-every-flop)}
PY=$MAIN/.venv/bin/python
HERE=$(cd "$(dirname "$0")" && pwd)
PIDF=$OUT/build.pid
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

case "${1:-status}" in
start)
  if running; then echo "running (pid $(cat "$PIDF"))"; exit 0; fi
  mkdir -p "$OUT/bin"
  [ "$HERE/build_mw_every_flop.py" -ef "$OUT/bin/build_mw_every_flop.py" ] || cp "$HERE/build_mw_every_flop.py" "$OUT/bin/"
  cd "$OUT"
  echo "$(date '+%F %T') start: waiting for a heavy slot" >> build.log
  nohup /usr/bin/python3 -I -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    "$HOME/.local/bin/heavy" -x "$PY" "$OUT/bin/build_mw_every_flop.py" \
    --out "$OUT" --solver "$MAIN/solver" --jobs 2 ${REBUILD[@]+"${REBUILD[@]}"} >> build.log 2>&1 < /dev/null &
  echo $! > "$PIDF"
  echo "started (pid $!), log $OUT/build.log"
  ;;
stop)
  if running; then kill -TERM -- "-$(cat "$PIDF")" 2>/dev/null || kill -TERM "$(cat "$PIDF")"; echo "stopped"; else echo "not running"; fi
  ;;
status)
  if running; then echo "running (pid $(cat "$PIDF"))"; else echo "not running"; fi
  [ -f "$OUT/progress.json" ] && cat "$OUT/progress.json" && echo
  [ -f "$OUT/build.log" ] && tail -n 5 "$OUT/build.log"
  ;;
*) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
