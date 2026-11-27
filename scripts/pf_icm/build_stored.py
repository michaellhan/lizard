"""Builds the stored tournament preflop solves (engine/pf_icm_stored.py ALL: the stage and format presets, the
final-table set, the bounty set, the satellite set and the chip EV set; engine/pf_icm.py's game on the calibrated flop model)
into engine/pf_icm/<key>.bin, the manifest engine/pf_icm/stages.json and pf_icm_stored.KEYS, as scripts/pf/build_stored.py
builds the cash grid: STORED_ITERS iterations of the same DCFR, one file a game, a line a game in the log
(engine/pf_icm/built.jsonl: name, key, nodes, iterations, seconds, mbb/hand a seat, bytes).

    .venv/bin/python scripts/pf_icm/build_stored.py all [--missing] [--set stage|final|bounty|satellite|chips] [--jobs 2]
                                                        # every game (of a set), one process each, up to --jobs at once
    .venv/bin/python scripts/pf_icm/build_stored.py stage NAME                          # one game, in this process
    .venv/bin/python scripts/pf_icm/build_stored.py index    # KEYS, the page's list of built spots, old files deleted
    .venv/bin/python scripts/pf_icm/build_stored.py sets     # engine/pf_icm/sets.json: every spot's name, set, request

`index` also writes web/src/features/practice/pfIcmBuilt.json: the flop model's tag (pf_icm.FLOP_MODEL_TAG, which names
the class equity table and the calibration) and the spots (indexes into ALL) whose files are under the key their game has
now, the only ones the page matches; and `sets` the list the page's tests hold its presets to (pfIcmStored.test.ts),
every spot whether built or not.

Checkpointed by game: each file is written whole (to a temporary name, then moved), then its manifest entry and log line,
so `all --missing` after a stop builds only the games with no file yet (a game takes seconds to about 3 minutes; none is
checkpointed inside its solve). Each game is solved in its own process so its arrays are freed: the biggest (6 players
at 75bb, 7,542 nodes; 9 at 75bb, 3,318) hold under 1 GB. Over a minute of CPU in all: run it through the shared slot,

    /Users/mhan/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/pf_icm/build_stored.py all --missing

A game whose manifest key isn't the key it has now (another flop model, equity table or calibration: pf_icm.FLOP_MODEL_TAG
is in the key) rebuilds under --missing; `index` deletes the files no manifest entry names (a changed game's old key). A
game that fails is said and skipped; the rest go on.
"""
import fcntl
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
WEB_BUILT = ROOT / "web/src/features/practice/pfIcmBuilt.json"


def manifest() -> list:
    try:
        return json.loads(Path(ST.MANIFEST).read_text())
    except (OSError, ValueError):
        return []


class _Locked:
    """The manifest's read-modify-write under a lock file (--jobs: games finish at once)."""

    def __enter__(self):
        os.makedirs(ST.DIR, exist_ok=True)
        self.f = open(Path(ST.DIR, ".lock"), "w")
        fcntl.flock(self.f, fcntl.LOCK_EX)

    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def write_manifest(m: list) -> None:
    names = [s[0] for s in ST.ALL]
    m.sort(key=lambda e: names.index(e["name"]))
    tmp = Path(ST.MANIFEST + ".tmp")
    tmp.write_text(json.dumps(m, indent=1) + "\n")
    os.replace(tmp, ST.MANIFEST)


def build(name: str) -> dict:
    import gto.native  # noqa: F401  (BLAS held to one thread, as scripts/pf/build_stored.py)
    from engine import pf_icm as I
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
             "label": spec.label(), "model": I.FLOP_MODEL_TAG}
    if len(stage) > 6 and stage[6]:
        entry["bounty"] = dict(stage[6])
    with _Locked():
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
    keep = {e["key"] + ".bin" for e in m}
    gone = [f for f in os.listdir(ST.DIR) if f.endswith(".bin") and f not in keep]
    for f in gone:
        os.remove(Path(ST.DIR, f))
    size = sum(Path(ST.DIR, f).stat().st_size for f in keep if Path(ST.DIR, f).exists())
    from engine import pf_icm as I
    cur = []
    with _Locked():
        m = manifest()
        for e in m:
            if current(e):
                e["model"] = I.FLOP_MODEL_TAG          # (an entry built before the tag was written down)
                cur.append(names.index(e["name"]))
            else:
                e.pop("model", None)
        write_manifest(m)
    out = {"model": I.FLOP_MODEL_TAG, "built": sorted(cur)}
    WEB_BUILT.write_text(json.dumps(out) + "\n")
    print(f"KEYS: {len(m)} stored games, {len(cur)} under their games' keys now, {size / 1e6:.2f} MB; "
          f"{len(gone)} files no entry names deleted", flush=True)


def sets() -> None:
    """engine/pf_icm/sets.json: every spot of ALL, built or not (its name, set and request), for the page's tests."""
    out = [{"name": s[0], "set": ST.set_of(s[0]), "request": ST.request(s)} for s in ST.ALL]
    Path(ST.DIR, "sets.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"sets.json: {len(out)} spots")


def current(e: dict) -> bool:
    """A manifest entry whose file is there under the key its request's game has now (so on this flop model, equity
    table and calibration)."""
    return Path(ST.DIR, e["key"] + ".bin").exists() and e["key"] == key_of(e["request"])


_ADVISOR = []


def key_of(req: dict) -> str:
    """The game's key as the worker computes it now (its flop model's tag included, pf_icm.FLOP_MODEL_TAG)."""
    from engine import pf_icm_study as IS
    from gto.advisor import Advisor
    if not _ADVISOR:
        _ADVISOR.append(Advisor())
    spec, why = IS.spec_of(_ADVISOR[0], {**req, "bb": 1.0, "street": "preflop", "board": ""})
    return spec.key if spec is not None else ""


def have(name: str) -> bool:
    """A game built already: its manifest entry and its file, under the key the game has now (a changed game, or the
    same game on other equities or calibration, rebuilds)."""
    e = next((e for e in manifest() if e["name"] == name), None)
    if e is None or not current(e):
        return False
    stage = next(s for s in ST.ALL if s[0] == name)
    req = ST.request(stage)
    return e["request"] == req and e["key"] == key_of(req)


if __name__ == "__main__":
    args = sys.argv[1:] or ["all"]
    cmd = args[0]
    if cmd == "stage":
        build(args[1])
    elif cmd == "index":
        index()
    elif cmd == "sets":
        sets()
    elif cmd == "all":
        which = args[args.index("--set") + 1] if "--set" in args else None
        games = [s for s in ST.ALL if which is None or ST.set_of(s[0]).startswith(which)]
        jobs = max(1, min(2, int(args[args.index("--jobs") + 1]))) if "--jobs" in args else 1   # (at most 2: the budget)
        # what Practice graded by before first (the stages and the 105 final-table spots), then the bounty set, the
        # final table's other structures and shapes, the satellites and chip EV; fewest players first within each, so
        # the quick games land first and a build stopped early leaves the most used spots done
        core = {s[0] for s in ST.FINAL_TABLE_SET[:len(ST.FT_PLAYERS) * len(ST.FT_DEPTHS) * len(ST.FT_SHAPES)]}
        tier = {"stage": 0, "bounty": 2, "final table": 3, "satellite": 4, "chips": 5}
        games.sort(key=lambda s: (1 if s[0] in core else tier.get(ST.set_of(s[0]), 6), s[1]))
        todo = [s[0] for s in games if not ("--missing" in args and have(s[0]))]
        print(f"{len(todo)} of {len(games)} games to build, {jobs} at once", flush=True)
        running, failed = [], []
        while todo or running:
            while todo and len(running) < jobs:
                nm = todo.pop(0)
                running.append((nm, subprocess.Popen([sys.executable, __file__, "stage", nm])))
            time.sleep(0.5)
            for nm, pr in list(running):
                if pr.poll() is not None:
                    running.remove((nm, pr))
                    if pr.returncode:
                        failed.append(nm)
                        print(f"FAILED ({pr.returncode}): {nm}", flush=True)
        index()
        if failed:
            raise SystemExit(f"{len(failed)} games failed: {failed}")
    else:
        raise SystemExit(__doc__)
