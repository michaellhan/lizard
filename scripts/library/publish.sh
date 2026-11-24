#!/usr/bin/env bash
# Publish Lizard's library to michaellhan/lizard-library, served by GitHub Pages at
# https://www.michael-han.com/lizard-library/ (same origin as the app, so no CORS and COEP-safe).
#
#   scripts/library/publish.sh            assemble, commit what changed, push, then verify the live index
#   DRY_RUN=1 scripts/library/publish.sh  assemble and commit locally; push nothing
#
# The heads-up builds in /Users/mhan/Desktop/projects/gtosolver/.work are only read (see assemble.py). The release
# is a persistent local clone (library-build/lizard-library, gitignored), so each publish pushes only the files that
# changed, not the whole ~255 MB. Low CPU by design: niced, single-threaded git packing, no recompression of the
# already-compressed .bin files. Safe to run while the builds run, by hand or on a timer.
#
# What Pages can't hold (900 MiB, 120k files) goes to a Cloudflare R2 bucket, whole spot directories at a time, when an
# R2 config is there: ~/.config/lizard/r2.env (or $LIZARD_R2_ENV) setting LIZARD_R2_BASE (the bucket's public https
# base, ending in /) and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (docs/DEPLOYMENT.md, "The
# library on R2"). assemble.py then writes hosts.json naming the moved sets, r2_upload.py sends what changed in them
# before Pages is pushed, the clone leaves them out, and library-build/release-full keeps the whole release for the
# next run's --previous. Without the config nothing changes: the library must fit Pages, or assemble.py stops.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO=michaellhan/lizard-library
BUILD="$ROOT/library-build"
STAGE="$BUILD/stage"
CLONE="$BUILD/lizard-library"
URL="https://www.michael-han.com/lizard-library/index.json"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY=python3
case "$REPO" in michaellhan/gto-solver-library|*michaellhan.github.io) echo "refusing to publish to $REPO" >&2; exit 1;; esac

# Each flop's nut share, while no heads-up build runs (nuts.py says "not yet" then, and picks up where it stopped).
# It's worked from the last stage, so flops new in this one get theirs on the next run; a stop here publishes what's there.
if [ -f "$STAGE/index.json" ]; then
  nice -n 10 "$PY" "$ROOT/scripts/library/nuts.py" --stage "$STAGE" || echo "nuts: left for the next run"
fi

# R2 (above): the config, if there is one
R2_ENV="${LIZARD_R2_ENV:-$HOME/.config/lizard/r2.env}"
if [ -f "$R2_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$R2_ENV"
  set +a
fi
FULL="$BUILD/release-full"   # (the last release whole, R2 sets and all: the clone lacks those)

# the last release, for spots that fail or shrink: the whole one where the clone is it less its R2 sets
prev=()
if [ -f "$FULL/index.json" ] && [ -f "$CLONE/index.json" ] && cmp -s "$FULL/index.json" "$CLONE/index.json"; then
  prev=(--previous "$FULL")
elif [ -f "$CLONE/index.json" ]; then
  prev=(--previous "$CLONE")
fi
nice -n 10 "$PY" "$ROOT/scripts/library/assemble.py" --out "$STAGE" ${prev[@]+"${prev[@]}"}

# the sets served from R2: sent (only what changed) before Pages is pushed, and left out of the clone
r2_sets=()
if [ -f "$STAGE/hosts.json" ]; then
  [ -n "${LIZARD_R2_BASE:-}" ] || { echo "the stage has hosts.json but LIZARD_R2_BASE isn't set ($R2_ENV)" >&2; exit 1; }
  sets_txt=$("$PY" -c '
import json, re, sys
for s in sorted(json.load(open(sys.argv[1]))["sets"]):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", s) or s in (".", ".."):
        sys.exit(f"hosts.json: set id {s!r}")
    print(s)' "$STAGE/hosts.json")
  for s in $sets_txt; do r2_sets+=("$s"); done
  if [ "${DRY_RUN:-0}" = "1" ]; then
    nice -n 10 "$PY" "$ROOT/scripts/library/r2_upload.py" --stage "$STAGE" --dry-run
  else
    nice -n 10 "$PY" "$ROOT/scripts/library/r2_upload.py" --stage "$STAGE"
  fi
fi

if [ ! -d "$CLONE/.git" ]; then
  mkdir -p "$CLONE"
  if gh repo view "$REPO" --json name >/dev/null 2>&1 && [ "$(gh api "repos/$REPO/commits?per_page=1" --jq length 2>/dev/null || echo 0)" != "0" ]; then
    git clone --quiet "https://github.com/$REPO.git" "$CLONE"
  else
    git -C "$CLONE" init --quiet -b main
    git -C "$CLONE" remote add origin "https://github.com/$REPO.git"
  fi
fi
G=(git -C "$CLONE" -c core.compression=0 -c pack.threads=1 -c pack.compression=0)

excl=(--exclude .git --exclude .lizard-stage)
for s in ${r2_sets[@]+"${r2_sets[@]}"}; do excl+=(--exclude "/$s/"); done
rsync -a --delete ${excl[@]+"${excl[@]}"} "$STAGE/" "$CLONE/"
# (an R2 set that Pages served before: gone from the clone, as rsync leaves excluded paths alone)
for s in ${r2_sets[@]+"${r2_sets[@]}"}; do [ -d "$CLONE/$s" ] && rm -rf "${CLONE:?}/$s"; done
# the whole release, R2 sets and all, for the next run's --previous (none needed while Pages holds it all)
if [ ${#r2_sets[@]} -gt 0 ]; then
  rsync -a --delete --exclude .lizard-stage "$STAGE/" "$FULL/"
fi
"${G[@]}" add -A
if "${G[@]}" diff --cached --quiet; then
  # A push that failed leaves its commit here, with nothing new to commit: it's still to send, or it never would be.
  ahead=$("${G[@]}" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
  if [ "$ahead" = "0" ]; then
    echo "lizard-library: nothing changed since the last publish"
    exit 0
  fi
  echo "lizard-library: nothing new, but $ahead commit(s) from a push that failed are still to send"
else
msg=$("$PY" - "$CLONE/lizard-library.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
hu = [f"{k} {v['flops']}" for k, v in s["spots"].items() if (v.get("game") or {}).get("players") == 2]
deep = [f"{k} {v['flops']}" for k, v in s["spots"].items() if (v.get("game") or {}).get("players") == 6]
r2 = s.get("r2")
print(f"lizard-library: {len(s['spots'])} spots, {s['files']} files" + (f"; heads-up: {', '.join(hu)}" if hu else "")
      + (f"; other depths: {', '.join(deep)}" if deep else "")
      + (f"; {len(r2['sets'])} set(s), {r2['files']} files on R2" if r2 else ""))
PY
)
"${G[@]}" commit --quiet -m "$msg"
echo "$msg"
fi
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN: committed locally in $CLONE; not pushed"
  exit 0
fi
nice -n 10 "${G[@]}" push --quiet origin main

# GitHub Pages takes a minute or two to publish: wait until the live index and summary are the ones just pushed (the
# summary too: a publish that changes only targets leaves index.json as it was)
SITE=${URL%index.json}
live_sha() { curl -fsS -H 'Cache-Control: no-cache' "$SITE$1?t=$(date +%s)" 2>/dev/null | shasum -a 1 | cut -d' ' -f1 || true; }
want_index=$(shasum -a 1 "$CLONE/index.json" | cut -d' ' -f1)
want_summary=$(shasum -a 1 "$CLONE/lizard-library.json" | cut -d' ' -f1)
for _ in $(seq 1 40); do
  if [ "$(live_sha index.json)" = "$want_index" ] && [ "$(live_sha lizard-library.json)" = "$want_summary" ]; then
    echo "live: ${SITE}index.json and lizard-library.json match the published ones"
    exit 0
  fi
  sleep 15
done
echo "pushed, but $SITE does not serve the new index and summary yet (Pages may still be building)" >&2
exit 2
