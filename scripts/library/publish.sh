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

prev=()
[ -f "$CLONE/index.json" ] && prev=(--previous "$CLONE")
nice -n 10 "$PY" "$ROOT/scripts/library/assemble.py" --out "$STAGE" ${prev[@]+"${prev[@]}"}

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

rsync -a --delete --exclude .git --exclude .lizard-stage "$STAGE/" "$CLONE/"
"${G[@]}" add -A
if "${G[@]}" diff --cached --quiet; then
  echo "lizard-library: nothing changed since the last publish"
  exit 0
fi
msg=$("$PY" - "$CLONE/lizard-library.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
hu = [f"{k} {v['flops']}" for k, v in s["spots"].items() if (v.get("game") or {}).get("players") == 2]
print(f"lizard-library: {len(s['spots'])} spots, {s['files']} files" + (f"; heads-up: {', '.join(hu)}" if hu else ""))
PY
)
"${G[@]}" commit --quiet -m "$msg"
echo "$msg"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN: committed locally in $CLONE; not pushed"
  exit 0
fi
nice -n 10 "${G[@]}" push --quiet origin main

# GitHub Pages takes a minute or two to publish: wait until the live index is the one just pushed
want=$(shasum -a 1 "$CLONE/index.json" | cut -d' ' -f1)
for _ in $(seq 1 40); do
  got=$(curl -fsS -H 'Cache-Control: no-cache' "$URL?t=$(date +%s)" 2>/dev/null | shasum -a 1 | cut -d' ' -f1 || true)
  if [ "$got" = "$want" ]; then echo "live: $URL matches the published index"; exit 0; fi
  sleep 15
done
echo "pushed, but $URL does not serve the new index yet (Pages may still be building)" >&2
exit 2
