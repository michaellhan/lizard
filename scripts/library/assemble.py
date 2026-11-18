#!/usr/bin/env python3
"""Assemble Lizard's precomputed library (served at /lizard-library/) into a staging directory.

The solver worker reads one library base, so Lizard's library is one directory: the 6-max library of the solver
snapshot (solver/gto/static/flop_library, a verified copy of the published /gto-solver-library/) plus the heads-up
spots the offline builds have finished so far (.work/hu-lib, .work/hu-lp-lib), and Lizard's own builds of other games'
spots (library-build/sources/depths: 6-max at other stack depths, scripts/library/depths_build.py), under one merged
index.json, and the 3-way spots (mw_index.json) with the flops their own build has finished since
(library-build/sources/mw-every-flop, scripts/library/build_mw_every_flop.py) added to them. A spot of another game
carries it from its build's index (`game`: players, stack, ante, straddle), so the worker finds it by its own ranges,
pot and stack and the page labels it with its game.

Extension sources (--extend; by default library-build/sources/srp-every-flop, scripts/library/build_srp_every_flop.py)
are builds of base spots on more flops: a source's spot replaces the base's only when it is the same spot (ranges, pot,
stack, tree and old tree) holding every base flop with the same entry hash (and the same turn files), and more of them,
so a stale or partial source never loses or changes a base flop.

Safety (the heads-up builds are still running and own their directories):
  - sources are only read: nothing there is written, moved, deleted or locked;
  - only entries a source's index.json lists are copied (never .tmp files, never entries newer than the index);
  - every copied file is checked on the copy: an entry by its sha1 in the index, a turn file by the entry hash in its
    header, report.json by the index's report hash; a file that fails is left out and that flop is solved live;
  - each spot's nuts.json comes from library-build/nuts (scripts/library/nuts.py), only for the ranges and flops the
    index lists, with its hash in the index as `nuts`; a spot with none just has no Nut adv column;
  - a 3-way source's flops go into a published 3-way spot only on the same tree and the same ranges, pot and stack
    (the base's entry wins a flop both hold); a rebuild of the spot on other ranges (library-build/sources/mw-rebuild)
    replaces it whole, only once it holds every flop the published spot does; each 3-way spot gets heads.json, its entries' stored mixes in one file
    (named in mw_index.json by hash as `heads`), so the Reports page reads one file, not one per flop;
  - a spot (heads-up or 3-way) that fails or shrinks keeps its previous release (--previous), so a publish never
    loses flops.

Breadth sources (--breadth; by default library-build/sources/breadth, scripts/library/build_breadth.py) are Lizard's
builds of new spots (lines the other sources don't have). They go in last, each spot only while the stage stays under
the file cap (MAX_FILES, less a reserve), in the source index's order (its value order), so a breadth build can never
make a publish fail; a spot another source holds (by id or by ranges, pot and stack) is left to that source.

Usage: assemble.py --out library-build/stage [--previous library-build/lizard-library] [--hu DIR ...] [--mw DIR ...]
       [--formats DIR ...] [--extend DIR ...] [--breadth DIR ...]
Exit status 0 when the stage is complete and consistent; the summary goes to stdout and the stage's
lizard-library.json.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "solver" / "gto" / "static" / "flop_library"
WORK = Path("/Users/mhan/Desktop/projects/gtosolver/.work")
HU_SOURCES = [WORK / "hu-lib", WORK / "hu-lp-lib"]
SOURCES = ROOT / "library-build" / "sources"  # Lizard's own library builds (gitignored), one folder each
EXTEND_SOURCES = [SOURCES / "srp-every-flop"]
# scripts/library/mw_every_flop.sh, then the 3-way spots rebuilt on today's ranges (build_mw_every_flop.py --rebuild),
# which replace a published spot once complete (replace_mw); in this order, so the rebuild has the last word
MW_SOURCES = [SOURCES / "mw-every-flop", SOURCES / "mw-rebuild"]
# builds of other games' spots (flop_library.FORMAT_SPOTS, ids like srp_btn_bb_40bb), taken as the heads-up builds are
FORMAT_SOURCES = [SOURCES / "depths"]
BREADTH_SOURCES = [SOURCES / "breadth"]  # scripts/library/breadth.sh
BREADTH_RESERVE = 200  # files the cap keeps free after the breadth spots (nuts.json, a spot carried from --previous)
PROTECTED = Path("/Users/mhan/Desktop/projects/gtosolver")
STAGE_MARK = ".lizard-stage"
NUTS = ROOT / "library-build" / "nuts"
NUTS_FORMAT = 1  # scripts/library/nuts.py FORMAT

FORMAT = 2  # gto/flop_library.py FORMAT
MW_FORMAT = 1  # gto/mw_library.py
TURN_MAGIC = b"GTOTN1"  # gto/flop_library.py TURN_MAGIC
ENTRY_MAGIC = b"GTOFL3"  # gto/flop_library.py MAGIC
HEADS_FORMAT = 1  # <mw spot>/heads.json (web/src/library/mwReport.ts reads it)
MAX_FILE = 50 * 2**20
MAX_TOTAL = 900 * 2**20
MAX_FILES = 90_000  # (GitHub Pages: 1 GB a site, no file limit; 49,298 files deployed in 80 s on 2026-11-15)


# Build plans that differ from the snapshot's SPOT_FLOPS (solver/gto/flop_library.py): the heads-up SRP build goes on
# to every flop after its 552 (IMPLEMENTATION_PLAN.md, "Two concurrent heads-up SB-vs-BB library builds"; approved in
# the build's schedule, quoted in docs/research/05-deployment.md). Drop an entry once a re-import's SPOT_FLOPS has it.
# The five 6-max single-raised spots at 552 go on to every flop too (scripts/library/build_srp_every_flop.py, the
# owner's request of 2026-11-11), merged from EXTEND_SOURCES.
BUILD_PLANS = {"srp_sb_bb_2max": 1755, "srp_hj_co": 1755, "srp_btn_sb": 1755, "srp_utg_hj": 1755, "srp_co_sb": 1755,
               "srp_utg_btn": 1755}
# The 3-way spots' build to every flop (scripts/library/build_mw_every_flop.py, from the 185 of mw_library's build).
MW_BUILD_PLANS = {sid: 1755 for sid in ("mw_co_btn_bb", "mw_btn_sb_bb", "mw_hj_ip_bb", "mw_utg_btn_bb")}


def depth_plans() -> dict[str, int]:
    """The flops each spot of the depth builds is being built to (depths_build.BATCHES; format spots have no
    SPOT_FLOPS)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from depths_build import BATCHES
    finally:
        sys.path.pop(0)
    plans: dict[str, int] = {}
    for b in BATCHES:
        for sid in b.spots:
            plans[sid] = max(plans.get(sid, 0), b.flops)
    return plans


def planned_flops() -> dict[str, int]:
    """The flop count each spot is being built to: gto/flop_library.py SPOT_FLOPS (read without importing the solver)
    and the depth builds' batches, overridden by BUILD_PLANS."""
    src = (ROOT / "solver" / "gto" / "flop_library.py").read_text()
    m = re.search(r"^SPOT_FLOPS = (\{.*?\})\n", src, re.S | re.M)
    return {**(ast.literal_eval(m.group(1)) if m else {}), **depth_plans(), **BUILD_PLANS}


def target_of(sid: str, n: int, planned: dict[str, int]) -> int | None:
    """The flop set a planned spot is built over: its plan, or once a build passes it (an approved extension, as the
    heads-up SRP's to every flop) the next of 552 / every flop (1,755). None for a spot with no plan: not guessed."""
    if sid not in planned:
        return None
    return max(planned[sid], next((x for x in (184, 552, 1755) if n <= x), 1755))


def sha(b: bytes, n: int) -> str:
    return hashlib.sha1(b).hexdigest()[:n]


def read_head(data: bytes, magic: bytes) -> dict | None:
    """The JSON header after `magic` (a zlib stream of a u32 length, the header, then the body), decompressing only
    the header: a turn file's (gto/flop_library.turns_head) or an entry's (gto/flop_library.pack)."""
    if data[: len(magic)] != magic:
        return None
    d = zlib.decompressobj()
    raw = b""
    pos = len(magic)
    try:
        while len(raw) < 4 and pos < len(data):
            raw += d.decompress(data[pos : pos + 4096])
            pos += 4096
        hl = struct.unpack("<I", raw[:4])[0]
        while len(raw) < 4 + hl and pos < len(data):
            raw += d.decompress(data[pos : pos + 65536])
            pos += 65536
        head = json.loads(raw[4 : 4 + hl].decode())
        return head if isinstance(head, dict) else None
    except (zlib.error, struct.error, ValueError, UnicodeDecodeError):
        return None


def turn_entry(data: bytes) -> str | None:
    """The entry hash a turn file's header names."""
    head = read_head(data, TURN_MAGIC)
    return head.get("entry") if head else None


def place(src: Path, dst: Path, link: bool) -> bytes:
    """Copy (or hard-link, for the static base) src to dst; return the bytes as written at dst."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if link:
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)
    else:
        shutil.copyfile(src, dst)
    return dst.read_bytes()


def turns_set(spot: dict) -> set[str] | bool:
    t = spot.get("turns")
    if t is True:
        return True
    return set(t) if isinstance(t, list) else set()


def copy_spot(src_root: Path, stage: Path, spot: dict, link: bool, log: list[str]) -> dict | None:
    """Copy one format-2 spot's listed files into the stage, validated; return its index entry as staged."""
    sid = spot["id"]
    sdir, ddir = src_root / sid, stage / sid
    out = dict(spot)
    for name in ("report.json", "ranges.json"):
        p = sdir / name
        if not p.exists():
            continue
        data = place(p, ddir / name, link)
        if name == "report.json" and spot.get("report") and sha(data, 10) != spot["report"]:
            log.append(f"{sid}: report.json does not match the index (an index rewrite in progress?)")
            return None
    want_turns = turns_set(spot)
    flops: dict[str, str] = {}
    turned: list[str] = []
    dropped = 0
    for flop, h in spot.get("flops", {}).items():
        p = sdir / f"{flop}.bin"
        if not p.exists():
            dropped += 1
            continue
        data = place(p, ddir / f"{flop}.bin", link)
        if sha(data, 10) != h:
            (ddir / f"{flop}.bin").unlink()
            dropped += 1
            continue
        flops[flop] = h
        if want_turns is True or (isinstance(want_turns, set) and flop in want_turns):
            tp = sdir / f"{flop}.turn.bin"
            if tp.exists():
                tdata = place(tp, ddir / f"{flop}.turn.bin", link)
                if turn_entry(tdata) == sha(data, 12):
                    turned.append(flop)
                else:
                    (ddir / f"{flop}.turn.bin").unlink()
    if dropped:
        log.append(f"{sid}: {dropped} listed flop(s) missing or failing their hash, left out")
    out["flops"] = flops
    if want_turns is True and len(turned) == len(flops):
        out["turns"] = True
    elif turned:
        out["turns"] = sorted(turned)
    else:
        out.pop("turns", None)
    return out


def copy_mw(src_root: Path, stage: Path, link: bool, log: list[str]) -> dict | None:
    p = src_root / "mw_index.json"
    if not p.exists():
        return None
    idx = json.loads(p.read_bytes())
    if idx.get("format") != MW_FORMAT:
        log.append(f"{p}: unexpected format {idx.get('format')}, multiway spots left out")
        return None
    for spot in idx.get("spots", []):
        keep = {}
        for flop, h in spot.get("flops", {}).items():
            src = src_root / spot["id"] / f"{flop}.bin"
            if not src.exists():
                continue
            data = place(src, stage / spot["id"] / f"{flop}.bin", link)
            if sha(data, 10) == h:
                keep[flop] = h
            else:
                (stage / spot["id"] / f"{flop}.bin").unlink()
        if len(keep) != len(spot.get("flops", {})):
            log.append(f"{spot['id']}: {len(spot['flops']) - len(keep)} multiway flop(s) failed validation")
        spot["flops"] = keep
    return idx


def mw_same_spot(a: dict, b: dict) -> bool:
    """Whether two 3-way index spots are one game: the same ranges, pot and stack (MWLibrary.spot's key)."""
    return list(a["fp"]) == list(b["fp"]) and round(float(a["pot"]), 2) == round(float(b["pot"]), 2) and \
        round(float(a["stack"]), 2) == round(float(b["stack"]), 2)


def merge_mw(src: Path, stage: Path, mw: dict | None, log: list[str]) -> dict | None:
    """Add a 3-way build's finished flops to the staged 3-way spots (in place); returns {spot: flops added}, or
    None when the source is left out. Only a spot the base publishes takes flops, on the same tree and game; each
    copied entry is checked by its sha1 in the source's index, and the base's entry wins a flop both hold."""
    p = src / "mw_index.json"
    if not p.exists():
        log.append(f"{src}: no mw_index.json yet")
        return None
    if mw is None:
        log.append(f"{src}: the base has no 3-way spots to add flops to, left out")
        return None
    try:
        idx = json.loads(p.read_bytes())  # written by os.replace: never torn
    except ValueError:
        log.append(f"{src}: mw_index.json won't read, left out")
        return None
    if idx.get("format") != MW_FORMAT or idx.get("tree") != mw.get("tree"):
        log.append(f"{src}: 3-way index format or tree differs from the base, left out")
        return None
    now = {s["id"]: s for s in mw.get("spots", [])}
    added: dict[str, int] = {}
    for s in idx.get("spots", []):
        cur = now.get(s["id"])
        if cur is None:
            log.append(f"{src}: {s['id']} is not a published 3-way spot, left out")
            continue
        if not mw_same_spot(cur, s):
            missing = set(cur["flops"]) - set(s.get("flops", {}))
            if missing:
                log.append(f"{src}: {s['id']} has other ranges, pot or stack than the published spot, left out "
                           f"(a rebuild replaces the spot once it holds every flop the published one does: "
                           f"{len(missing)} to go)")
                continue
            got = replace_mw(src, stage, cur, s, log)
            if got is not None:
                added[s["id"]] = got
            continue
        n = bad = 0
        for flop, h in s.get("flops", {}).items():
            if flop in cur["flops"]:
                continue
            sp = src / s["id"] / f"{flop}.bin"
            if not sp.exists():
                bad += 1
                continue
            dst = stage / s["id"] / f"{flop}.bin"
            if sha(place(sp, dst, link=False), 10) != h:
                dst.unlink()
                bad += 1
                continue
            cur["flops"][flop] = h
            n += 1
        if bad:
            log.append(f"{s['id']}: {bad} 3-way flop(s) from {src} missing or failing their hash, left out")
        cur["flops"] = dict(sorted(cur["flops"].items()))
        added[s["id"]] = n
    return added


def replace_mw(src: Path, stage: Path, cur: dict, s: dict, log: list[str]) -> int | None:
    """A rebuild of a published 3-way spot on other ranges (the charts moved under it: scripts/library/
    build_mw_every_flop.py --rebuild), holding every flop the published spot does: it replaces the staged spot, ranges,
    pot, stack and every entry, all or nothing. Each entry is checked by its sha1 in the source's index; one missing or
    failing leaves the published spot as it was. The staged base files are hard links into the base, so each is
    unlinked and replaced by rename, never written through. The number of flops, or None where it was left out."""
    tmp = stage / f".{s['id']}.rebuild"
    if tmp.exists():
        shutil.rmtree(tmp)
    flops = {}
    for flop, h in sorted(s["flops"].items()):
        sp = src / s["id"] / f"{flop}.bin"
        if not sp.exists() or sha(place(sp, tmp / f"{flop}.bin", link=False), 10) != h:
            shutil.rmtree(tmp)
            log.append(f"{src}: {s['id']} rebuild: {flop} missing or failing its hash, the published spot kept")
            return None
        flops[flop] = h
    d = stage / cur["id"]
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("*.bin"):
        old.unlink()
    for flop in flops:
        os.replace(tmp / f"{flop}.bin", d / f"{flop}.bin")
    tmp.rmdir()
    was = cur["fp"]
    for k in ("fp", "pot", "stack", "seats", "line", "label"):
        if k in s:
            cur[k] = s[k]
    cur["flops"] = flops
    cur.pop("heads", None)
    log.append(f"{cur['id']}: replaced by the rebuild in {src} on new ranges ({len(flops)} flops; fingerprints "
               f"{was} -> {cur['fp']})")
    return len(flops)


def keep_previous_mw(prev: Path, stage: Path, mw: dict, allow_shrink: bool, log: list[str]) -> None:
    """Never publish a 3-way spot with fewer flops than the previous release: carry the previous spot over."""
    p = prev / "mw_index.json"
    if not p.exists():
        return
    old = json.loads(p.read_bytes())
    if old.get("format") != MW_FORMAT or old.get("tree") != mw.get("tree"):
        return
    now = {s["id"]: s for s in mw.get("spots", [])}
    for ps in old.get("spots", []):
        cur = now.get(ps["id"])
        if cur is not None and len(cur["flops"]) >= len(ps["flops"]):
            continue
        if allow_shrink:
            log.append(f"{ps['id']}: shrinks from {len(ps['flops'])} flops (allowed)")
            continue
        if (stage / ps["id"]).exists():
            shutil.rmtree(stage / ps["id"])
        kept = dict(ps, flops={})
        for flop, h in ps["flops"].items():
            src = prev / ps["id"] / f"{flop}.bin"
            if not src.exists() or sha(place(src, stage / ps["id"] / f"{flop}.bin", link=True), 10) != h:
                sys.exit(f"{ps['id']}: shrank and the previous release failed validation; not publishing")
            kept["flops"][flop] = h
        kept.pop("heads", None)
        log.append(f"{ps['id']}: kept the previous release ({len(kept['flops'])} flops)")
        if cur is None:
            mw["spots"].append(kept)
        else:
            mw["spots"] = [kept if s["id"] == ps["id"] else s for s in mw["spots"]]


def write_mw_heads(stage: Path, spot: dict, log: list[str]) -> None:
    """<spot>/heads.json: every staged entry's stored mixes (its header's nodes), for the Reports page:
    {format, nodes {path ('|'-joined): action names}, flops {flop: {path: range frequencies, in the names' order}}}.
    Named in the index by hash as `heads`; left out (the page then reads the entries) where a header won't read or
    a node's actions differ between flops."""
    spot.pop("heads", None)
    nodes: dict[str, list] = {}
    flops: dict[str, dict] = {}
    for flop in sorted(spot["flops"]):
        head = read_head((stage / spot["id"] / f"{flop}.bin").read_bytes(), ENTRY_MAGIC)
        if head is None or head.get("board") != flop:
            log.append(f"{spot['id']}: {flop}'s header won't read, no heads.json")
            return
        row = {}
        for nd in head.get("nodes", []):
            k = "|".join(nd["path"])
            if nodes.setdefault(k, list(nd["names"])) != list(nd["names"]):
                log.append(f"{spot['id']}: node '{k}' has other actions on {flop}, no heads.json")
                return
            row[k] = nd["freqs"]
        flops[flop] = row
    data = json.dumps({"format": HEADS_FORMAT, "nodes": nodes, "flops": flops}, separators=(",", ":")).encode()
    (stage / spot["id"] / "heads.json").write_bytes(data)
    spot["heads"] = sha(data, 10)


def attach_nuts(src: Path, out: Path, spot: dict, log: list[str]) -> int:
    """Put a spot's nut shares in the stage, as far as they go, and name them in its index entry; returns the flops."""
    spot.pop("nuts", None)  # (a spot carried from the previous release)
    p = src / f"{spot['id']}.json"
    if not p.exists():
        return 0
    try:
        d = json.loads(p.read_bytes())
    except ValueError:
        log.append(f"{spot['id']}: nuts file won't read, left out")
        return 0
    if d.get("format") != NUTS_FORMAT or d.get("fp") != spot.get("fp"):
        log.append(f"{spot['id']}: nuts file is for other ranges, left out")
        return 0
    flops = {f: v for f, v in d["flops"].items() if f in spot["flops"]}
    if not flops:
        return 0
    data = json.dumps({**d, "flops": flops}, separators=(",", ":")).encode()
    (out / spot["id"] / "nuts.json").write_bytes(data)
    spot["nuts"] = sha(data, 10)
    return len(flops)


def spot_key(s: dict) -> tuple:
    return (s["fp"][0], s["fp"][1], round(float(s["pot"]), 2), round(float(s["stack"]), 2))


def extends(new: dict, cur: dict) -> str | None:
    """Why `new` (an extension source's spot) can't stand for `cur` (the spot so far), or None when it can: the same
    spot (id, ranges, pot, stack, game, tree, old tree), every flop of cur with the same entry hash, on the same tree
    (old or not), with its turn file if cur has one, and more flops than cur."""
    if new.get("id") != cur["id"] or spot_key(new) != spot_key(cur) or new.get("game") != cur.get("game"):
        return "another spot (ranges, pot, stack or game)"
    if new.get("tree") != cur.get("tree") or (cur.get("old") and new.get("old_tree") != cur.get("old_tree")):
        return "another tree"
    nf, cf = new.get("flops", {}), cur["flops"]
    if any(nf.get(f) != h for f, h in cf.items()):
        return f"{sum(nf.get(f) != h for f, h in cf.items())} base flop(s) missing or with another entry"
    n_old, c_old = set(new.get("old", ())), set(cur.get("old", ()))
    if any((f in n_old) != (f in c_old) for f in cf):
        return "a base flop on another tree"
    nt, ct = turns_set(new), turns_set(cur)
    if ct and nt is not True and any(f not in nt for f in (cf if ct is True else ct)):
        return "a base flop's turn file missing"
    if len(nf) <= len(cf):
        return "no flops beyond the base's"
    return None


def extend_spots(src: Path, out: Path, spots: list[dict], base_root: Path, log: list[str]) -> dict[str, int] | None:
    """Replace each spot of `spots` (staged from base_root) that the extension source `src` builds on more flops by
    the source's, copied and validated (copy_spot); a spot whose copy fails or no longer holds the base's flops is
    staged from the base again. Returns {id: flops} taken from the source, or None if it has no usable index."""
    ip = src / "index.json"
    if not ip.exists():
        log.append(f"{src}: no index.json yet")
        return None
    idx = json.loads(ip.read_bytes())  # written by os.replace: never torn
    got: dict[str, int] = {}
    pos = {s["id"]: i for i, s in enumerate(spots)}
    for s in idx.get("spots", []):
        if s["id"] not in pos:
            log.append(f"{src}: {s['id']} is not a base spot, left out (an extension source only adds flops)")
            continue
        cur = spots[pos[s["id"]]]
        why = extends(s, cur)
        if why:
            log.append(f"{s['id']}: extension left out ({why})")
            continue
        shutil.rmtree(out / s["id"])
        staged = copy_spot(src, out, s, link=False, log=log)
        why = extends(staged, cur) if staged else "report.json does not match its index"
        if why:
            log.append(f"{s['id']}: extension left out after copying ({why}); the base's kept")
            if (out / s["id"]).exists():
                shutil.rmtree(out / s["id"])
            staged = copy_spot(base_root, out, cur, link=True, log=log)
            if staged is None:
                sys.exit(f"{s['id']}: the base failed validation on a second copy")
        else:
            got[s["id"]] = len(staged["flops"])
        spots[pos[s["id"]]] = staged
    return got


def spot_files(s: dict) -> int:
    """Files a staged spot holds: its entries, their turn files, report.json, ranges.json (nuts.json is reserved)."""
    t = turns_set(s)
    return len(s["flops"]) + (len(s["flops"]) if t is True else len(t)) + 2


def add_breadth(src: Path, out: Path, merged: list[dict], tree: dict, log: list[str]) -> tuple[list[dict], dict | None]:
    """Stage a breadth source's spots (new lines, built by scripts/library/build_breadth.py) after every other source:
    each in the index's order while the stage stays within MAX_FILES - BREADTH_RESERVE; one another source holds (id
    or lookup key) is left out, and one already staged (carried from --previous) is replaced only by a copy with more
    flops. Returns the merged spots and the source's summary (None without a usable index)."""
    ip = src / "index.json"
    if not ip.exists():
        log.append(f"{src}: no index.json yet")
        return merged, None
    idx = json.loads(ip.read_bytes())  # written by os.replace: never torn
    if idx.get("format") != FORMAT or idx.get("tree") != tree:
        log.append(f"{src}: index format or tree differs from the base, left out")
        return merged, None
    try:
        plan = json.loads((src / "plan.json").read_bytes()).get("spots", {})
    except (OSError, ValueError):
        plan = {}
    n_files = sum(1 for p in out.rglob("*") if p.is_file())
    got: dict[str, int] = {}
    for s in idx.get("spots", []):
        by_id = {x["id"]: x for x in merged}
        keys = {spot_key(x): x["id"] for x in merged}
        cur = by_id.get(s["id"])
        if keys.get(spot_key(s), s["id"]) != s["id"]:
            log.append(f"{s['id']}: {keys[spot_key(s)]} holds these ranges, pot and stack; the breadth spot left out")
            continue
        if cur is not None and len(cur["flops"]) >= len(s.get("flops", {})):
            continue
        need = spot_files({"flops": s.get("flops", {}), "turns": s.get("turns")}) - (spot_files(cur) if cur else 0)
        if n_files + need > MAX_FILES - BREADTH_RESERVE:
            log.append(f"{s['id']}: left out, {need} more files would pass the {MAX_FILES:,} file cap")
            continue
        held = out / f".{s['id']}.held"  # the copy carried from --previous, put back if the new one falls short
        if cur is not None:
            os.replace(out / s["id"], held)
        staged = copy_spot(src, out, s, link=False, log=log)
        if staged is None or (cur is not None and len(staged["flops"]) <= len(cur["flops"])):
            if (out / s["id"]).exists():
                shutil.rmtree(out / s["id"])
            if cur is not None:
                os.replace(held, out / s["id"])
            log.append(f"{s['id']}: breadth copy failed validation, "
                       + ("the previous release kept" if cur is not None else "left out"))
            continue
        if cur is not None:
            shutil.rmtree(held)
            # (the carry-over's note is moot: the breadth build's own copy, with more flops, stands)
            log[:] = [x for x in log if not x.startswith(f"{s['id']}: kept the previous release")]
        n_files += spot_files(staged) - (spot_files(cur) if cur else 0)
        merged = [staged if x["id"] == s["id"] else x for x in merged] if cur else [*merged, staged]
        got[s["id"]] = len(staged["flops"])
    return merged, {"path": str(src), "kind": "breadth build", "indexMtime": ip.stat().st_mtime, "spots": got,
                    "plan": {k: int(v) for k, v in plan.items()}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--base", type=Path, default=BASE)
    ap.add_argument("--hu", type=Path, action="append", help="a heads-up build directory (repeatable)")
    ap.add_argument("--extend", type=Path, action="append", help="a build of base spots on more flops (repeatable; "
                    "default: library-build/sources/srp-every-flop)")
    ap.add_argument("--mw", type=Path, action="append", help="a 3-way build directory (repeatable)")
    ap.add_argument("--breadth", type=Path, action="append", help="a build of new spots (repeatable; default: "
                    "library-build/sources/breadth)")
    ap.add_argument("--previous", type=Path, help="the last published release (to keep spots that fail or shrink)")
    ap.add_argument("--allow-shrink", action="store_true")
    ap.add_argument("--nuts", type=Path, default=NUTS, help="where nuts.py wrote each spot's nut shares")
    ap.add_argument("--formats", type=Path, action="append",
                    help="a build directory of other games' spots, e.g. other depths (repeatable; default FORMAT_SOURCES)")
    a = ap.parse_args()
    hu_sources = a.hu if a.hu else HU_SOURCES
    ext_sources = a.extend if a.extend else EXTEND_SOURCES
    mw_sources = a.mw if a.mw else MW_SOURCES
    format_sources = a.formats if a.formats else FORMAT_SOURCES
    breadth_sources = a.breadth if a.breadth else BREADTH_SOURCES
    builds = [(p, "heads-up build") for p in hu_sources] + [(p, "format build") for p in format_sources]

    out = a.out.resolve()
    for p in [a.base, *hu_sources, *ext_sources, *mw_sources, *format_sources, *breadth_sources]:
        if out == p.resolve() or p.resolve() in out.parents:
            sys.exit(f"refusing: --out {out} is inside a source")
    if out == PROTECTED or PROTECTED in out.parents:
        sys.exit(f"refusing: --out {out} is inside {PROTECTED}")
    if out.exists():
        if any(out.iterdir()) and not (out / STAGE_MARK).exists():
            sys.exit(f"refusing: {out} exists and is not a stage this script made")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / STAGE_MARK).write_text("made by scripts/library/assemble.py; safe to delete\n")

    t0 = time.time()
    log: list[str] = []
    base_idx = json.loads((a.base / "index.json").read_bytes())
    if base_idx.get("format") != FORMAT:
        sys.exit(f"base index format {base_idx.get('format')} != {FORMAT}")
    tree = base_idx["tree"]

    spots: list[dict] = []
    sources: list[dict] = []
    for s in base_idx["spots"]:
        staged = copy_spot(a.base, out, s, link=True, log=log)
        if staged:
            spots.append(staged)
    sources.append({"path": str(a.base), "kind": "base", "spots": {s["id"]: len(s["flops"]) for s in spots}})
    mw = copy_mw(a.base, out, link=True, log=log)
    for src in mw_sources:
        added = merge_mw(src, out, mw, log)
        if added is not None:
            mp = src / "mw_index.json"
            sources.append({"path": str(src), "kind": "3-way build", "indexMtime": mp.stat().st_mtime, "spots": added})

    for src in ext_sources:
        got = extend_spots(src, out, spots, a.base, log)
        if got is not None:
            sources.append({"path": str(src), "kind": "extension build", "indexMtime": (src / "index.json").stat().st_mtime,
                            "spots": got})

    taken = {s["id"] for s in spots}
    for src, kind in builds:
        ip = src / "index.json"
        if not ip.exists():
            log.append(f"{src}: no index.json yet")
            continue
        raw = ip.read_bytes()  # written by os.replace: never torn
        idx = json.loads(raw)
        if idx.get("format") != FORMAT or idx.get("tree") != tree:
            log.append(f"{src}: index format or tree differs from the base, left out")
            continue
        got = {}
        for s in idx.get("spots", []):
            if kind == "format build" and (not s.get("game") or s["id"] in taken):
                # (a format build holds other games' spots only: one of the default game's, or an id an earlier source
                # has, would be staged over that source's files)
                log.append(f"{src}: {s['id']} is not another game's spot of its own, left out")
                continue
            staged = copy_spot(src, out, s, link=False, log=log)
            if staged is None:
                # (a report rewrite raced the read) one retry after the index settles
                time.sleep(2)
                idx2 = json.loads(ip.read_bytes())
                s2 = next((x for x in idx2.get("spots", []) if x["id"] == s["id"]), None)
                staged = copy_spot(src, out, s2, link=False, log=log) if s2 else None
            if staged:
                spots.append(staged)
                taken.add(staged["id"])
                got[staged["id"]] = len(staged["flops"])
        sources.append({"path": str(src), "kind": kind, "indexMtime": ip.stat().st_mtime, "spots": got})

    # one spot per id and per lookup key (FlopLibrary keys spots by fingerprints, pot and stack): keep the larger
    by_key: dict[tuple, dict] = {}
    for s in spots:
        k = spot_key(s)
        if k not in by_key or len(s["flops"]) > len(by_key[k]["flops"]):
            by_key[k] = s
    merged = list({s["id"]: s for s in by_key.values()}.values())

    # never publish fewer flops than the previous release: carry the previous spot over
    if a.previous and (a.previous / "index.json").exists():
        prev = json.loads((a.previous / "index.json").read_bytes())
        if prev.get("format") == FORMAT and prev.get("tree") == tree:
            now = {s["id"]: s for s in merged}
            for ps in prev.get("spots", []):
                cur = now.get(ps["id"])
                if cur is not None and len(cur["flops"]) >= len(ps["flops"]):
                    continue
                if a.allow_shrink:
                    log.append(f"{ps['id']}: shrinks from {len(ps['flops'])} flops (allowed)")
                    continue
                if (out / ps["id"]).exists():
                    shutil.rmtree(out / ps["id"])
                kept = copy_spot(a.previous, out, ps, link=True, log=log)
                if kept is None:
                    sys.exit(f"{ps['id']}: shrank and the previous release failed validation; not publishing")
                log.append(f"{ps['id']}: kept the previous release ({len(kept['flops'])} flops)")
                merged = [kept if s["id"] == ps["id"] else s for s in merged]
                if cur is None:
                    merged.append(kept)

    if mw is not None:
        if a.previous:
            keep_previous_mw(a.previous, out, mw, a.allow_shrink, log)
        for s in mw.get("spots", []):
            write_mw_heads(out, s, log)

    breadth_plan: dict[str, int] = {}
    for src in breadth_sources:
        merged, summary = add_breadth(src, out, merged, tree, log)
        if summary is not None:
            breadth_plan.update(summary.pop("plan"))
            sources.append(summary)

    nut_flops = {s["id"]: attach_nuts(a.nuts, out, s, log) for s in merged}

    index = {"format": FORMAT, "tree": tree, "spots": merged}
    (out / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    if mw is not None:
        (out / "mw_index.json").write_text(json.dumps(mw, separators=(",", ":")))
    (out / ".nojekyll").write_text("")

    # consistency: every listed file exists, nothing unexpected, within GitHub Pages limits
    listed = {"index.json", "mw_index.json", ".nojekyll", STAGE_MARK, "lizard-library.json"}
    for s in merged:
        listed |= {f"{s['id']}/report.json", f"{s['id']}/ranges.json"}
        if s.get("nuts"):
            listed.add(f"{s['id']}/nuts.json")
        t = turns_set(s)
        for f in s["flops"]:
            listed.add(f"{s['id']}/{f}.bin")
            if t is True or (isinstance(t, set) and f in t):
                listed.add(f"{s['id']}/{f}.turn.bin")
                if not (out / s["id"] / f"{f}.turn.bin").exists():
                    sys.exit(f"{s['id']}/{f}.turn.bin listed but missing")
            if not (out / s["id"] / f"{f}.bin").exists():
                sys.exit(f"{s['id']}/{f}.bin listed but missing")
    for s in (mw or {}).get("spots", []):
        listed |= {f"{s['id']}/{f}.bin" for f in s["flops"]}
        if s.get("heads"):
            listed.add(f"{s['id']}/heads.json")
        for f in s["flops"]:
            if not (out / s["id"] / f"{f}.bin").exists():
                sys.exit(f"{s['id']}/{f}.bin listed but missing")
    total = n = 0
    for p in out.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(out).as_posix()
        if rel not in listed:
            sys.exit(f"unexpected file in the stage: {rel}")
        size = p.stat().st_size
        if size > MAX_FILE:
            sys.exit(f"{rel} is {size} bytes, over the {MAX_FILE} limit")
        total += size
        n += 1
    if total > MAX_TOTAL or n > MAX_FILES:
        sys.exit(f"stage is {total} bytes in {n} files, over the limits")

    planned = {**breadth_plan, **planned_flops()}
    summary = {
        "assembledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": sources,
        "spots": {
            s["id"]: {"flops": len(s["flops"]), "target": target_of(s["id"], len(s["flops"]), planned), "game": s.get("game"), "nuts": nut_flops[s["id"]]}
            for s in merged
        },
        "multiway": {s["id"]: len(s["flops"]) for s in (mw or {}).get("spots", [])},
        "multiwayTargets": {s["id"]: MW_BUILD_PLANS.get(s["id"]) for s in (mw or {}).get("spots", [])},
        "files": n,
        "bytes": total,
        "notes": log,
    }
    # a run that changes nothing keeps the previous summary's time, so the stage matches the release and publish.sh
    # has nothing to commit (a fresh time alone would publish an unchanged library on every run)
    prev_summary = a.previous / "lizard-library.json" if a.previous else None
    if prev_summary and prev_summary.exists():
        try:
            old = json.loads(prev_summary.read_text())
        except ValueError:
            old = None
        if isinstance(old, dict) and {**old, "assembledAt": None} == {**summary, "assembledAt": None}:
            summary["assembledAt"] = old.get("assembledAt", summary["assembledAt"])
    (out / "lizard-library.json").write_text(json.dumps(summary, indent=1))
    for s in merged:
        g = s.get("game")
        game = "6-max" if not g else ("heads-up" if g.get("players") == 2 else f"{g.get('players')}-max") + \
            (f" {g['stack']:g}bb" if g.get("stack", 100.0) != 100.0 else "")
        print(f"  {s['id']:<18} {len(s['flops']):>5} flops  {game}")
    for note in log:
        print(f"  note: {note}")
    print(f"stage: {n} files, {total / 2**20:.1f} MB, {time.time() - t0:.1f} s -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
