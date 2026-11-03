#!/usr/bin/env python3
"""Copy a small subset of the solver snapshot's flop library into web/src/test/fixtures/flop_library.

The library itself (solver/gto/static/flop_library, 315 MB) is git-ignored, so the web tests that decode real
entries (entry.test.ts, drills.test.ts, DrillsPanel.test.tsx) read this subset instead, which is committed and
small. Entries and ranges are copied byte for byte; index.json and each report.json keep only the chosen flops. A
3-way spot's entries are copied too, with mw_index.json keeping only them (the 3-way library has no report.json:
Reports builds one in the page from the entries' headers).

    python3 scripts/library/make_web_fixtures.py

Run it again only if the fixture set changes; the tests' expectations are tied to these flops.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "solver" / "gto" / "static" / "flop_library"
DST = ROOT / "web" / "src" / "test" / "fixtures" / "flop_library"

# the first three spots of the index (entry.test.ts decodes the first three flops of each); srp_btn_bb also gets a
# two-tone flop (the iso-class test), Ac4d3h (weights, provenance) and a monotone flop (the texture filter)
FLOPS = {
    "srp_btn_bb": ["2h2d2c", "3c2d2c", "3c2h2d", "4c3c2d", "Ac4d3h", "Ac8c6c", "9c8c7c"],
    "srp_co_bb": ["2h2d2c", "3c2d2c", "3c2h2d"],
    "3bp_bb_btn": ["2h2d2c", "3c2d2c", "3c2h2d"],
}
# a 3-way spot: a monotone flop, a paired one, two rainbow ones, a two-tone one and the extra flop (outside the sample)
MW_FLOPS = {"mw_btn_sb_bb": ["4c3c2c", "4c3h3d", "5c4d2h", "Ac4d3h", "8c7c2c", "Kc7d2h"]}


def main() -> None:
    index = json.loads((SRC / "index.json").read_text())
    if DST.exists():
        shutil.rmtree(DST)
    spots = []
    for sp in index["spots"]:
        keep = FLOPS.get(sp["id"])
        if keep is None:
            continue
        (DST / sp["id"]).mkdir(parents=True)
        spots.append({**sp, "flops": {f: h for f, h in sp["flops"].items() if f in keep}})
        report = json.loads((SRC / sp["id"] / "report.json").read_text())
        report["flops"] = [fl for fl in report["flops"] if fl["f"] in keep]
        (DST / sp["id"] / "report.json").write_text(json.dumps(report, separators=(",", ":")))
        shutil.copyfile(SRC / sp["id"] / "ranges.json", DST / sp["id"] / "ranges.json")
        for f in keep:
            shutil.copyfile(SRC / sp["id"] / f"{f}.bin", DST / sp["id"] / f"{f}.bin")
    assert [s["id"] for s in spots] == list(FLOPS), "the fixture spots must be the index's first three, in order"
    (DST / "index.json").write_text(json.dumps({**index, "spots": spots}, separators=(",", ":")))
    mw = json.loads((SRC / "mw_index.json").read_text())
    mw_spots = []
    for sp in mw["spots"]:
        keep = MW_FLOPS.get(sp["id"])
        if keep is None:
            continue
        (DST / sp["id"]).mkdir(parents=True)
        mw_spots.append({**sp, "flops": {f: h for f, h in sp["flops"].items() if f in keep}})
        for f in keep:
            shutil.copyfile(SRC / sp["id"] / f"{f}.bin", DST / sp["id"] / f"{f}.bin")
    (DST / "mw_index.json").write_text(json.dumps({**mw, "spots": mw_spots}, separators=(",", ":")))
    print(f"wrote {sum(1 for _ in DST.rglob('*') if _.is_file())} files to {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
