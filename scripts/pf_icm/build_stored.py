"""Builds the stored tournament preflop solves (engine/pf_icm_stored.py STAGES) into engine/pf_icm/<key>.bin, the
manifest engine/pf_icm/stages.json and pf_icm_stored.KEYS.

Each stage is solved in its own process (`stage NAME`): an 8-player tree isn't among them, but the 6-player ones take about
0.7 GB. `index` rewrites KEYS from the manifest. Over a minute of CPU in all: run it through the shared slot, e.g.

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/pf_icm/build_stored.py all
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_icm_stored as ST  # noqa: E402


def manifest() -> list:
    try:
        return json.loads(Path(ST.MANIFEST).read_text())
    except (OSError, ValueError):
        return []


def build(name: str) -> dict:
    from engine import pf_icm_study as IS
    from gto import pf_study as PS
    from gto.advisor import Advisor
    stage = next(s for s in ST.STAGES if s[0] == name)
    req = ST.request(stage)
    spec, why = IS.spec_of(Advisor(), {**req, "bb": 1.0, "street": "preflop", "board": ""})
    if spec is None:
        raise SystemExit(f"{name}: {why}")
    g = spec.game()
    t0 = time.time()
    for t in range(1, PS.STORED_ITERS + 1):
        g.iterate(t)
    expl = g.exploitability(per_seat=True)
    mbb = 1000.0 * sum(expl) / len(expl)
    blob = PS.pack(g, mbb)
    os.makedirs(ST.DIR, exist_ok=True)
    Path(ST.DIR, spec.key + ".bin").write_bytes(blob)
    entry = {"name": name, "key": spec.key, "request": req, "players": spec.players, "nodes": g.N,
             "iterations": PS.STORED_ITERS, "mbb": round(mbb, 3), "mbb_seats": [round(1000 * x, 3) for x in expl],
             "seconds": round(time.time() - t0, 1), "bytes": len(blob), "label": spec.label()}
    m = [e for e in manifest() if e["name"] != name] + [entry]
    m.sort(key=lambda e: [s[0] for s in ST.STAGES].index(e["name"]))
    Path(ST.MANIFEST).write_text(json.dumps(m, indent=1) + "\n")
    print(f"{name}: {spec.key}, {g.N} nodes, {mbb:.3f} mbb/hand a seat, {entry['seconds']} s, {len(blob)} bytes", flush=True)
    return entry


def index() -> None:
    m = manifest()
    names = [s[0] for s in ST.STAGES]
    stale = [e["name"] for e in m if e["name"] not in names]
    if stale:
        raise SystemExit(f"the manifest has stages no longer in STAGES: {stale}")
    body = "".join(f"    {e['key']!r}: {e['name']!r},\n" for e in m)
    p = Path(ST.__file__)
    src = p.read_text()
    new, k = re.subn(r"KEYS: Dict\[str, str\] = \{\n.*?\}", "KEYS: Dict[str, str] = {\n" + body + "}", src, flags=re.S)
    if k != 1:
        raise SystemExit("couldn't find KEYS in engine/pf_icm_stored.py")
    p.write_text(new)
    print(f"KEYS: {len(m)} stored stages")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "stage":
        build(sys.argv[2])
    elif cmd == "index":
        index()
    elif cmd == "all":
        for s in ST.STAGES:
            subprocess.run([sys.executable, __file__, "stage", s[0]], check=True)
        index()
    else:
        raise SystemExit(__doc__)
