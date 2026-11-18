#!/usr/bin/env python3
"""Write engine/mw_built.py: the ranges each published 3-way library spot was built on.

A 3-way entry stores its spot's fingerprints (flop_library.range_fp of the three ranges entering the flop), its
masks and mixes, not the ranges themselves, so they can't be read back from the library. They are recomputed here
from the solver's code at the commit the spots were built with (`--commit`, default 5b49b94, the last one before
b10afc8 moved the charts' multiway calls on 2026-11-17): `git archive` of solver/gto at that commit into a temporary
directory, mw_library.spot_setup of each spot's line there in an isolated interpreter, and every range's fingerprint
checked against the published index (`--index`). Nothing is written unless all of them match. Each range is stored
per hand class (every combo of a class carries the same weight in these ranges; checked), to 1e-4 as the fingerprint
rounds it, so engine/mw_built.py reproduces the published fingerprints exactly (scripts/library/test_published_fps.py
checks it).

    mw_built_ranges.py [--commit 5b49b94] [--index library-build/lizard-library/mw_index.json] [--out engine/mw_built.py]

Run it again (with the new build's commit) after the 3-way spots are rebuilt, or drop the spot from the file when
the rebuild's fingerprints match today's charts (engine/mw_near.py then has nothing to do for it).
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
sys.path.insert(0, sys.argv[1])
import numpy as np
import gto.mw_library as mw
import gto.flop_library as fl
from gto.cards import ALL_COMBOS, hand_class
idx = json.load(open(sys.argv[2]))
cls = [hand_class(c) for c in ALL_COMBOS]
out = {}
for sp in idx["spots"]:
    st = mw.spot_setup(sp["line"])
    fps = [fl.range_fp(r) for r in st["ranges"]]
    rs = {}
    for seat, r in zip(st["seats"], st["ranges"]):
        q = np.round(np.asarray(r, dtype=np.float64) * 10000).astype(int)
        by = {}
        for c, v in zip(cls, q):
            if by.setdefault(c, int(v)) != int(v):
                raise SystemExit(f"{sp['id']} {seat}: {c}'s combos differ in weight")
        rs[seat] = {c: v for c, v in by.items() if v}
    out[sp["id"]] = {"line": sp["line"], "seats": st["seats"], "fp": fps, "index_fp": sp["fp"],
                     "index_seats": sp.get("seats"), "pot": st["pot"], "stack": st["stack"], "ranges": rs}
print(json.dumps(out))
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", default="5b49b94")
    ap.add_argument("--index", type=Path, default=ROOT / "library-build" / "lizard-library" / "mw_index.json")
    ap.add_argument("--out", type=Path, default=ROOT / "engine" / "mw_built.py")
    a = ap.parse_args()
    if not a.index.exists():
        print(f"no 3-way index at {a.index} (pass --index)", file=sys.stderr)
        return 1
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", a.commit], check=True,
                            capture_output=True, text=True).stdout.strip()
    date = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%cs", commit], check=True,
                          capture_output=True, text=True).stdout.strip()
    with tempfile.TemporaryDirectory() as tmp:
        arc = subprocess.run(["git", "-C", str(ROOT), "archive", commit, "solver/gto"], check=True,
                             capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", tmp], input=arc, check=True)
        got = subprocess.run([sys.executable, "-I", "-c", CHILD, str(Path(tmp) / "solver"), str(a.index)],
                             check=True, capture_output=True, text=True).stdout
    spots = json.loads(got)
    bad = [k for k, s in spots.items() if s["fp"] != s["index_fp"] or s["seats"] != s["index_seats"]]
    if bad:
        print(f"{commit}'s ranges don't reproduce the index's fingerprints for {', '.join(bad)}: not writing",
              file=sys.stderr)
        return 1
    lines = [
        '"""The ranges each published 3-way library spot was built on (written by scripts/library/mw_built_ranges.py from',
        f'solver/gto at {commit}; don\'t edit by hand). The entries store fingerprints, not ranges, so these were',
        'recomputed from that commit\'s code and checked to reproduce the published fingerprints. Per spot: its preflop',
        'line, seats (postflop order), fingerprints, pot, stack, and each seat\'s range as hand class -> weight x 10000',
        '(every combo of a class the same weight). engine/mw_near.py reads them."""',
        "from __future__ import annotations",
        "",
        "import numpy as np",
        "",
        f"COMMIT = {commit!r}",
        f"DATE = {date!r}",
        "SPOTS = {",
    ]
    for k, s in spots.items():
        lines.append(f"    {k!r}: {{")
        lines.append(f"        \"line\": {s['line']!r}, \"seats\": {s['seats']!r}, \"pot\": {s['pot']!r}, "
                     f"\"stack\": {s['stack']!r},")
        lines.append(f"        \"fp\": {s['fp']!r},")
        lines.append("        \"ranges\": {")
        for seat, r in s["ranges"].items():
            body = " ".join(f"{c}:{v}" for c, v in r.items())
            lines.append(f"            {seat!r}: {body!r},")
        lines.append("        },")
        lines.append("    },")
    lines += [
        "}",
        "_CACHE: dict = {}",
        "",
        "",
        "def ranges(spot_id: str):",
        '    """The spot\'s three built ranges (1326 combos each, postflop order), or None for a spot not listed."""',
        "    s = SPOTS.get(spot_id)",
        "    if s is None:",
        "        return None",
        "    if spot_id not in _CACHE:",
        "        from gto.cards import ALL_COMBOS, hand_class",
        "        cls = [hand_class(c) for c in ALL_COMBOS]",
        "        out = []",
        "        for seat in s[\"seats\"]:",
        "            w = dict((c, int(v)) for c, v in (x.split(\":\") for x in s[\"ranges\"][seat].split()))",
        "            out.append(np.array([w.get(c, 0) for c in cls], dtype=np.float64) / 10000.0)",
        "        _CACHE[spot_id] = out",
        "    return [r.copy() for r in _CACHE[spot_id]]",
        "",
    ]
    a.out.write_text("\n".join(lines))
    print(f"wrote {a.out} ({len(spots)} spots, {commit} of {date})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
