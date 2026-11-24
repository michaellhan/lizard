#!/usr/bin/env python3
"""Write scripts/library/published_fps.json: every published library spot's fingerprints, for test_published_fps.py.

A library spot is found by the fingerprints (flop_library.range_fp) of the ranges its preflop line gives entering the
flop: heads-up FlopLibrary.spot, 3-way MWLibrary.spot. When the charts change, the line gives other ranges and the spot
is never found again, with nothing said (the 3-way spots went unread from 2026-11-17 to 2026-11-18 that way). The
fixture holds each published spot's line, game, seats, pot, stack and fingerprints, from the published indexes;
test_published_fps.py recomputes them from today's code in seconds, with no library download, so CI fails the change
that moves the charts under a spot.

A spot today's code no longer reproduces is written with "now" (today's fingerprints) and "stale" (why, from
--reason): the test then holds today's to "now", so a further change still fails, and checks that the spot is still
served (a 3-way spot as built, engine/mw_near.py). A 3-way spot from another game's build that engine/mw_near.py
withholds (today's ranges past its near_dist: mw_near.withheld) is written with "withheld" too, and the test checks it
stays withheld (never served) rather than served. Rewrite the fixture only on purpose: after a rebuild is published,
or to accept a chart change knowingly (say why with --reason).

    published_fps.py [--index library-build/lizard-library] [--reason "b10afc8 (2026-11-17) moved ..."]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "published_fps.json"


def today(spot: dict, kind: str) -> dict:
    """{seats, fp, pot, stack} of the spot's line as today's code sets it up."""
    from gto import flop_library as fl
    from gto import mw_library as ML
    game = {k: v for k, v in (spot.get("game") or {}).items() if k in ("players", "stack", "ante", "straddle")}
    if kind == "mw":
        st = ML.spot_setup(spot["line"], **game)
        return {"seats": st["seats"], "fp": [fl.range_fp(r) for r in st["ranges"]], "pot": st["pot"], "stack": st["stack"]}
    st = fl.spot_setup(spot["line"], **game)
    return {"seats": [st["oop"], st["ip"]], "fp": [fl.range_fp(st["full0"]), fl.range_fp(st["full1"])],
            "pot": st["pot"], "stack": st["stack"]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--index", type=Path, default=ROOT / "library-build" / "lizard-library")
    ap.add_argument("--reason", default="", help="why a spot today's code no longer reproduces is accepted as it is "
                    "(a spot the fixture already lists stale on the same fingerprints keeps its reason)")
    a = ap.parse_args()
    sys.path.insert(0, str(ROOT / "solver"))
    sys.path.insert(0, str(ROOT))
    # (the ranges as the browser worker serves them: engine/pf_charts.py's repaired charts, installed at import)
    import engine.pf_charts  # noqa: F401
    from engine import mw_near
    old = {s["id"]: s for s in json.loads(OUT.read_text())["spots"]} if OUT.exists() else {}
    spots = []
    for kind, name in (("hu", "index.json"), ("mw", "mw_index.json")):
        idx = json.loads((a.index / name).read_text())
        for sp in idx["spots"]:
            row = {"kind": kind, "id": sp["id"], "line": sp["line"], "game": sp.get("game"), "seats": sp.get("seats"),
                   "pot": sp["pot"], "stack": sp["stack"], "fp": sp["fp"]}
            now = today(sp, kind)
            if now["fp"] != list(sp["fp"]):
                # (a spot already listed stale on these fingerprints keeps its reason; --reason says why for the rest)
                why = (old.get(sp["id"], {}).get("stale") if old.get(sp["id"], {}).get("now") == now["fp"]
                       else None) or a.reason
                if not why:
                    print(f"{sp['id']}: today's code gives {now['fp']}, the published spot {sp['fp']}: say why with "
                          f"--reason (or rebuild it)", file=sys.stderr)
                    return 1
                row.update(now=now["fp"], stale=why)
                if kind == "mw" and mw_near.withheld(sp):
                    row["withheld"] = ("another game's build whose ranges today's charts move past its near_dist "
                                       "(engine/mw_near.py): never served, its pots solved live")
            spots.append(row)
    OUT.write_text("{\"from\": " + json.dumps(f"{a.index.name}/index.json and mw_index.json") + ", \"spots\": [\n"
                   + ",\n".join(json.dumps(s) for s in spots) + "\n]}\n")    # (a spot a line: diffs read per spot)
    print(f"wrote {OUT} ({len(spots)} spots, {sum('now' in s for s in spots)} stale, "
          f"{sum('withheld' in s for s in spots)} withheld)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
