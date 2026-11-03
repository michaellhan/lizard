#!/usr/bin/env python3
"""Copy a small subset of the solver snapshot's flop library into web/src/test/fixtures/flop_library.

The library itself (solver/gto/static/flop_library, 315 MB) is git-ignored, so the web tests that decode real
entries (entry.test.ts, drills.test.ts, DrillsPanel.test.tsx) read this subset instead, which is committed and
small. Entries and ranges are copied byte for byte; index.json and each report.json keep only the chosen flops.

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
    print(f"wrote {sum(1 for _ in DST.rglob('*') if _.is_file())} files to {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
