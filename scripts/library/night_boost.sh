#!/bin/bash
# Overnight, let one Lizard library build use the performance cores too (the owner's choice, 2026-11-11: overnight only).
#
#   scripts/library/night_boost.sh on      restart the build unclamped, in a third heavy slot of its own
#   scripts/library/night_boost.sh off     restart it as by day: plain heavy, one of the 2 shared slots
#   scripts/library/night_boost.sh auto    on from 00:30 to 07:30, off otherwise (what launchd runs)
#   scripts/library/night_boost.sh status
#
# The build is the five single-raised spots to every flop (library-build/sources/srp-every-flop, its runner
# srp_every_flop.sh, merged 2026-11-13; that build finished on 2026-11-12, so "on" now says so and does nothing). heavy's
# QoS clamp (efficiency cores until 2026-11-13, utility QoS since) can't be lifted from a running process, so switching
# means stop and start; the build resumes from the entries on disk and loses at most the ones in flight. The runner calls
# `heavy` by name, so "on" puts a shim first on its PATH that runs `HEAVY_SLOTS=3 heavy -a`: nice 10 and rayon cap as
# usual, no clamp, and a slot beside the two the other jobs share.
# "on" won't start with under 35% of memory free; ~/.mem-guard stays the emergency brake. Launchd job:
# scripts/library/com.michaelhan.lizard-night.plist (log ~/Library/Logs/lizard-night.log).
set -uo pipefail
MAIN=/Users/mhan/Desktop/projects/lizard
OUT="$MAIN/library-build/sources/srp-every-flop"
SHIM="$MAIN/library-build/night-shim"
MARK="$MAIN/library-build/night-boost.on"
MIN_FREE=35

say() { echo "$(date '+%F %T') night: $*"; }

runner() {
  # The runner's start copies itself into .runner/, so it must be run from a checkout that has it, not from .runner/.
  local r
  for r in "$MAIN/scripts/library/srp_every_flop.sh" "$MAIN"/.claude/worktrees/lib-srp-every-flop-*/scripts/library/srp_every_flop.sh; do
    [ -x "$r" ] && { echo "$r"; return 0; }
  done
  return 1
}

finished() { grep -q "finished$" "$OUT/build.log" 2>/dev/null && [ ! -f "$OUT/build.pid" ]; }

free_pct() { memory_pressure 2>/dev/null | sed -n 's/.*free percentage: \([0-9]*\)%.*/\1/p'; }

restart() {  # $1 = on|off
  local r; r=$(runner) || { say "no srp_every_flop.sh found (branch merged and removed?); nothing to do"; return 1; }
  if finished; then say "the build has finished; nothing to do"; rm -f "$MARK"; return 0; fi
  "$r" stop >/dev/null
  if [ "$1" = on ]; then
    mkdir -p "$SHIM"
    printf '#!/bin/bash\nexport HEAVY_SLOTS=3\nexec %s -a "$@"\n' "$HOME/.local/bin/heavy" >"$SHIM/heavy"
    chmod +x "$SHIM/heavy"
    PATH="$SHIM:$PATH" "$r" start >/dev/null && touch "$MARK"
  else
    PATH="$HOME/.local/bin:$PATH" "$r" start >/dev/null && rm -f "$MARK"
  fi
  say "$1: restarted ($("$r" status | sed -n 1p))"
}

case "${1:-status}" in
on)
  [ -f "$MARK" ] && { say "already on"; exit 0; }
  f=$(free_pct)
  if [ -n "$f" ] && [ "$f" -lt "$MIN_FREE" ]; then say "memory ${f}% free, under ${MIN_FREE}%; staying off tonight"; exit 0; fi
  restart on
  ;;
off)
  [ -f "$MARK" ] || { say "already off"; exit 0; }
  restart off
  ;;
auto)
  hm=$((10#$(date +%H%M)))
  if [ "$hm" -ge 30 ] && [ "$hm" -lt 730 ]; then "$0" on; else "$0" off; fi
  ;;
status)
  [ -f "$MARK" ] && echo "night boost: on" || echo "night boost: off"
  r=$(runner) && "$r" status | sed -n 1p
  ;;
*) echo "usage: $0 on|off|auto|status" >&2; exit 2 ;;
esac
