#!/usr/bin/env python3
"""Write engine/hu_built.py: the ranges each stale published heads-up library spot was built on.

A heads-up library spot is found by the fingerprints of the two ranges its preflop line gives entering the flop
(flop_library.FlopLibrary.spot); when the charts move, the same line gives other ranges and the spot is never found
again. The 2026-11-22 equity table (lz4, docs/ACCURACY.md section 31) moved the 200bb big blind's range at its edge,
which changed four spots' fingerprints (srp BTN, CO and SB vs BB, the BB's 3bet of the BTN). engine/hu_near.py serves
such a spot as built; this writes the ranges it reads.

The ranges are recomputed from the code at the commit the published spots still match (`--commit`, default eca8152,
the last before the lz4 table): `git archive` of solver/gto and engine/*.py at that commit into a temporary directory,
flop_library.spot_setup of each heads-up spot's line in its game there (engine/pf_charts.py's repaired charts
installed, as the worker serves them) in an isolated interpreter, each range's fingerprint checked against the
published index (`--index`). Only spots today's code no longer reproduces are written, and nothing is written unless
every one of those matches at the commit. Each range is stored per hand class (every combo of a class carries the
same weight in these ranges; checked), to 1e-4 as the fingerprint rounds it, so engine/hu_built.py reproduces the
published fingerprints exactly (scripts/library/test_published_fps.py checks it).

    hu_built_ranges.py [--commit eca8152] [--index library-build/lizard-library/index.json] [--out engine/hu_built.py]

Run it again after a rebuild is published: a rebuilt spot today's code reproduces drops out of the file.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CHILD = r"""
import json, sys
sys.dont_write_bytecode = True
sys.path[:0] = [sys.argv[1] + "/solver", sys.argv[1]]
import numpy as np
import engine.pf_charts  # noqa: F401  (installed at import)
import gto.flop_library as fl
from gto.cards import ALL_COMBOS, hand_class
idx = json.load(open(sys.argv[2]))
want = set(json.loads(sys.argv[3]))
cls = [hand_class(c) for c in ALL_COMBOS]
out = {}
for sp in idx["spots"]:
    if sp["id"] not in want:
        continue
    game = {k: v for k, v in (sp.get("game") or {}).items() if k in ("players", "stack", "ante", "straddle")}
    st = fl.spot_setup(sp["line"], **game)
    rs = []
    for r in (st["full0"], st["full1"]):
        q = np.round(np.asarray(r, dtype=np.float64) * 10000).astype(int)
        by = {}
        for c, v in zip(cls, q):
            if by.setdefault(c, int(v)) != int(v):
                raise SystemExit(f"{sp['id']}: {c}'s combos differ in weight")
        rs.append({c: v for c, v in by.items() if v})
    out[sp["id"]] = {"line": sp["line"], "game": sp.get("game"), "seats": [st["oop"], st["ip"]],
                     "fp": [fl.range_fp(st["full0"]), fl.range_fp(st["full1"])], "index_fp": sp["fp"],
                     "pot": st["pot"], "stack": st["stack"], "ranges": rs}
print(json.dumps(out))
"""

TODAY = r"""
import json, sys
sys.dont_write_bytecode = True
sys.path[:0] = [sys.argv[1] + "/solver", sys.argv[1]]
import engine.pf_charts  # noqa: F401
import gto.flop_library as fl
idx = json.load(open(sys.argv[2]))
stale = []
for sp in idx["spots"]:
    game = {k: v for k, v in (sp.get("game") or {}).items() if k in ("players", "stack", "ante", "straddle")}
    st = fl.spot_setup(sp["line"], **game)
    if [fl.range_fp(st["full0"]), fl.range_fp(st["full1"])] != list(sp["fp"]):
        stale.append(sp["id"])
print(json.dumps(stale))
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", default="eca8152")
    ap.add_argument("--date", default="2026-11-16", help="when the spots were built (the text says 'as built on the "
                                                         "charts of DATE')")
    ap.add_argument("--index", type=Path, default=ROOT / "library-build" / "lizard-library" / "index.json")
    ap.add_argument("--out", type=Path, default=ROOT / "engine" / "hu_built.py")
    a = ap.parse_args()
    if not a.index.exists():
        print(f"no heads-up index at {a.index} (pass --index)", file=sys.stderr)
        return 1
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", a.commit], check=True,
                            capture_output=True, text=True).stdout.strip()
    stale = json.loads(subprocess.run([sys.executable, "-I", "-c", TODAY, str(ROOT), str(a.index)], check=True,
                                      capture_output=True, text=True).stdout)
    with tempfile.TemporaryDirectory() as tmp:
        arc = subprocess.run(["git", "-C", str(ROOT), "archive", commit, "solver/gto", ":(glob)engine/*.py"],
                             check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", tmp], input=arc, check=True)
        got = subprocess.run([sys.executable, "-I", "-c", CHILD, tmp, str(a.index), json.dumps(stale)], check=True,
                             capture_output=True, text=True).stdout
    spots = json.loads(got)
    bad = [k for k, s in spots.items() if s["fp"] != s["index_fp"]]
    if bad or set(spots) != set(stale):
        print(f"{commit}'s ranges don't reproduce the index's fingerprints for "
              f"{', '.join(bad or sorted(set(stale) - set(spots)))}: not writing", file=sys.stderr)
        return 1
    lines = [
        '"""The ranges each stale published heads-up library spot was built on (written by',
        f'scripts/library/hu_built_ranges.py from solver/gto and engine at {commit}; don\'t edit by hand): the spots',
        'today\'s code no longer reproduces. The entries store fingerprints, not ranges, so these were recomputed from',
        'that commit\'s code and checked to reproduce the published fingerprints. Per spot: its preflop line, game,',
        'seats (out of position first), fingerprints, pot, stack, and both ranges as hand class -> weight x 10000 (every',
        'combo of a class the same weight). engine/hu_near.py reads them."""',
        "from __future__ import annotations",
        "",
        "import numpy as np",
        "",
        f"COMMIT = {commit!r}",
        f"DATE = {a.date!r}",
        "SPOTS = {",
    ]
    for k, s in spots.items():
        lines.append(f"    {k!r}: {{")
        lines.append(f"        \"line\": {s['line']!r}, \"seats\": {s['seats']!r}, \"pot\": {s['pot']!r}, "
                     f"\"stack\": {s['stack']!r},")
        lines.append(f"        \"game\": {s['game']!r},")
        lines.append(f"        \"fp\": {s['fp']!r},")
        lines.append("        \"ranges\": [")
        for r in s["ranges"]:
            lines.append(f"            {' '.join(f'{c}:{v}' for c, v in r.items())!r},")
        lines.append("        ],")
        lines.append("    },")
    lines += [
        "}",
        "_CACHE: dict = {}",
        "",
        "",
        "def ranges(spot_id: str):",
        '    """The spot\'s two built ranges (1326 combos each, out of position first), or None for a spot not listed."""',
        "    s = SPOTS.get(spot_id)",
        "    if s is None:",
        "        return None",
        "    if spot_id not in _CACHE:",
        "        from gto.cards import ALL_COMBOS, hand_class",
        "        cls = [hand_class(c) for c in ALL_COMBOS]",
        "        out = []",
        "        for body in s[\"ranges\"]:",
        "            w = dict((c, int(v)) for c, v in (x.split(\":\") for x in body.split()))",
        "            out.append(np.array([w.get(c, 0) for c in cls], dtype=np.float64) / 10000.0)",
        "        _CACHE[spot_id] = out",
        "    return [r.copy() for r in _CACHE[spot_id]]",
        "",
    ]
    a.out.write_text("\n".join(lines))
    print(f"wrote {a.out} ({len(spots)} spots: {', '.join(spots)}; {commit})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
