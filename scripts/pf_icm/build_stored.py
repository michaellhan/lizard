"""Builds the stored tournament preflop solves (engine/pf_icm_stored.py ALL: the stage and format presets, then the
final-table set) into engine/pf_icm/<key>.bin, the manifest engine/pf_icm/stages.json and pf_icm_stored.KEYS, as
scripts/pf/build_stored.py builds the cash grid: STORED_ITERS iterations of the same DCFR, one file a game, a line a game
in the log (engine/pf_icm/built.jsonl: name, key, nodes, iterations, seconds, mbb/hand a seat, bytes).

    .venv/bin/python scripts/pf_icm/build_stored.py all [--missing] [--set stage|final]   # every game, one process each
    .venv/bin/python scripts/pf_icm/build_stored.py stage NAME                          # one game, in this process
    .venv/bin/python scripts/pf_icm/build_stored.py index                               # KEYS from the manifest

Checkpointed by game: each file is written whole (to a temporary name, then moved), then its manifest entry and log line,
so `all --missing` after a stop builds only the games with no file yet (a game takes seconds to about 3 minutes; none is
checkpointed inside its solve). Each game is solved in its own process so its arrays are freed: the biggest (6 players
at 75bb, 7,542 nodes; 9 at 75bb, 3,318) hold under 1 GB. Over a minute of CPU in all: run it through the shared slot,

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/pf_icm/build_stored.py all --missing
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

LOG = Path(ST.DIR, "built.jsonl")


def manifest() -> list:
    try:
        return json.loads(Path(ST.MANIFEST).read_text())
    except (OSError, ValueError):
        return []


def write_manifest(m: list) -> None:
    names = [s[0] for s in ST.ALL]
    m.sort(key=lambda e: names.index(e["name"]))
    tmp = Path(ST.MANIFEST + ".tmp")
    tmp.write_text(json.dumps(m, indent=1) + "\n")
    os.replace(tmp, ST.MANIFEST)


def build(name: str) -> dict:
    import gto.native  # noqa: F401  (BLAS held to one thread, as scripts/pf/build_stored.py)
    from engine import pf_icm_study as IS
    from gto import pf_study as PS
    from gto.advisor import Advisor
    stage = next(s for s in ST.ALL if s[0] == name)
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
    out = Path(ST.DIR, spec.key + ".bin")
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(blob)
    os.replace(tmp, out)
    entry = {"name": name, "set": ST.set_of(name), "key": spec.key, "request": req, "players": spec.players,
             "nodes": g.N, "iterations": PS.STORED_ITERS, "mbb": round(mbb, 3),
             "mbb_seats": [round(1000 * x, 3) for x in expl], "seconds": round(time.time() - t0, 1), "bytes": len(blob),
             "label": spec.label()}
    write_manifest([e for e in manifest() if e["name"] != name] + [entry])
    with open(LOG, "a") as f:
        f.write(json.dumps({k: entry[k] for k in ("name", "key", "nodes", "iterations", "seconds", "mbb", "bytes")}) + "\n")
    print(f"{name}: {spec.key}, {g.N} nodes, {mbb:.3f} mbb/hand a seat, {entry['seconds']} s, {len(blob)} bytes", flush=True)
    return entry


def index() -> None:
    m = manifest()
    names = [s[0] for s in ST.ALL]
    stale = [e["name"] for e in m if e["name"] not in names]
    if stale:
        raise SystemExit(f"the manifest has games no longer in ALL: {stale}")
    body = "".join(f"    {e['key']!r}: {e['name']!r},\n" for e in m)
    p = Path(ST.__file__)
    src = p.read_text()
    new, k = re.subn(r"KEYS: Dict\[str, str\] = \{\n.*?\}", "KEYS: Dict[str, str] = {\n" + body + "}", src, flags=re.S)
    if k != 1:
        raise SystemExit("couldn't find KEYS in engine/pf_icm_stored.py")
    p.write_text(new)
    print(f"KEYS: {len(m)} stored games")


def have(name: str) -> bool:
    """A game built already: its manifest entry and its file (the file's key is the game's: a changed game rebuilds)."""
    e = next((e for e in manifest() if e["name"] == name), None)
    if e is None or not Path(ST.DIR, e["key"] + ".bin").exists():
        return False
    stage = next(s for s in ST.ALL if s[0] == name)
    return e["request"] == ST.request(stage)


if __name__ == "__main__":
    args = sys.argv[1:] or ["all"]
    cmd = args[0]
    if cmd == "stage":
        build(args[1])
    elif cmd == "index":
        index()
    elif cmd == "all":
        which = args[args.index("--set") + 1] if "--set" in args else None
        games = [s for s in ST.ALL if which is None or ST.set_of(s[0]).startswith(which)]
        games.sort(key=lambda s: s[1])          # fewest players first: the quick games land first
        for s in games:
            if "--missing" in args and have(s[0]):
                continue
            subprocess.run([sys.executable, __file__, "stage", s[0]], check=True)
        index()
    else:
        raise SystemExit(__doc__)
