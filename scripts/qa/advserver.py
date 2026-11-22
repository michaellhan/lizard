"""The browser worker's Advisor, natively, as a JSON-lines server for the Practice QA sweep (scripts/qa/run.mjs).

It mirrors solver/gto/static/worker.js as scripts/pyodide/worker-edits.mjs publishes it:
- the startup imports in the worker's order: gto.advisor, gto.solver, gto.flop_library first (the worker's "imports"
  stage), then the edited line: engine.pf_stored, engine.pf_icm_study, engine.tree_depth, engine.pf_charts,
  engine.bunching, engine.mw_near, engine.hu_near, engine.mw_quick, engine.size_match, then `from gto.advisor import Advisor`;
- the two advisors ('fast', 'accurate') with the worker's Config, root sizes, warm_from, spare_prior, hu_settled,
  expl_target, first_look, the multiway street configs, mw_nway_max and the shared solve cache, in the THREADED variant
  (setup.threads >= 4, which a cross-origin isolated desktop browser gets) unless QA_THREADED=0;
- both libraries (flop and 3-way) read from QA_LIBRARY, read only (FlopLibrary.from_dir opens files for reading);
- `answer(st, pl)` as edited: a Study preflop-solve request goes to engine.pf_solve, a node lock to engine.study_lock,
  an opponent's move with a read to engine.exploit_play, everything else to Advisor.play / Advisor.advise; a request's
  `cache_mb` lowers the solves kept for it as the worker's edit does;
- the answer goes out as json.dumps(...) with no `default`, as the worker's does: an answer the browser couldn't
  serialise fails here too, and a NaN goes out as NaN, which JSON.parse on the Node side refuses as the page's would.

What differs from the browser, on purpose: the solve cache budget is QA_CACHE_MB (default 150, the worker's is 700) to
keep this process under ~1 GB; the compiled cores are native (gto/core.py builds them into solver/core/build/, which is
gitignored) on QA_THREADS threads (default 2) rather than wasm on the browser's helpers; nothing is stopped part way
(should_stop is never true). Run with -B so no bytecode lands in the repo.

On macOS it runs with MallocLargeCache=0 in its environment (scripts/qa/py.ts sets it; run directly, it starts itself
again with it set): libmalloc otherwise keeps freed large blocks resident for reuse, so a stored preflop solve dropped
after a request (QA_DROP_PF, about 380 MB of live arrays) stayed resident and the next big solve's working set stacked on
top of it (docs/QA.md, issue C). libmalloc reads the variable when the process starts, so it can't be set from here. A
browser's wasm heap reuses freed memory and has no such cache. The freed pages of libmalloc's small-block regions still
count in the RSS until the system takes them back, so the process restarts past a lower cap (CAP) and reports its
physical footprint beside its RSS (memory()).

stdin, one JSON object a line: {"id", "op": "answer", "state", "play"?: {"seat", "hole", "seed"?}}
stdout, one a line: {"ready": true, ...} once, then {"id", "json": <the answer as the worker posts it, a string>,
"secs", "mem_mb", "mem_now_mb", "rss_mb", "cur_mb", "dropped"?, "bye"?} or the same with "error" in place of "json" (an
exception: the worker posts {error} and the page fails the request). "rss_mb" and "cur_mb": the process's RSS at its most
and now, which also counts pages it freed that the system hasn't taken back yet; "mem_mb" and "mem_now_mb": its physical
footprint at its most and now, what it holds (macOS; elsewhere its RSS) (memory(), below). "bye": its RSS is over
QA_RSS_CAP_MB (default 700, CAP below) and it exits after this reply. "dropped": the boards of the hands' 3-way solves
(Advisor._mw_lines, which a later street's ranges are narrowed through) the solve cache evicted while the request was
answered (Advisor._keep, least recently used past QA_CACHE_MB), so the sweep knows a hand's earlier streets are gone
without a restart and asks them again.
"""
import json
import os
import gc
import resource
import subprocess
import sys
import time
import traceback

if __name__ == "__main__" and sys.platform == "darwin" and os.environ.get("MallocLargeCache") != "0":
    os.environ["MallocLargeCache"] = "0"
    os.execv(sys.executable, [sys.executable, "-B", os.path.abspath(__file__), *sys.argv[1:]])

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
os.environ.setdefault("GTO_THREADS", os.environ.get("QA_THREADS", "2"))
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LIB = os.environ.get("QA_LIBRARY", "/Users/mhan/Desktop/projects/lizard/library-build/lizard-library")
# (the worker's /app holds gto/ and engine/ side by side: here solver/ for gto and the repo root for engine)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "solver"))

T0 = time.time()
# the worker's "imports" stage, then its edited startup line (scripts/pyodide/worker-edits.mjs), in that order
import gto.advisor, gto.solver, gto.flop_library  # noqa: E401,E402,F401
import engine.pf_stored  # noqa: E402,F401
import engine.pf_icm_study  # noqa: E402,F401
import engine.tree_depth  # noqa: E402,F401
import engine.pf_charts  # noqa: E402,F401
import engine.bunching  # noqa: E402,F401
import engine.mw_near  # noqa: E402,F401
import engine.hu_near  # noqa: E402,F401
import engine.mw_quick  # noqa: E402,F401
import engine.size_match  # noqa: E402,F401
from gto.advisor import Advisor, MW_FAST_STREETS, MW4_FAST_STREETS  # noqa: E402
from gto.solver import Config, Cancelled  # noqa: E402
from gto.flop_library import FlopLibrary  # noqa: E402
from gto.mw_library import MWLibrary  # noqa: E402
from gto import mwcore as _mwc  # noqa: E402
from gto.cards import cards_str as _cards_str  # noqa: E402

THREADED = os.environ.get("QA_THREADED", "1") != "0"
FAST_RIVER = [0.33, 0.75, 1.25] if THREADED else [0.33, 1.25]
RAISES = {'flop': [0.5], 'turn': [0.75], 'river': [0.75]}
advs = {
    'fast': Advisor(Config(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4,
                           river_buckets=32, turn_buckets=True, bucket_river_step=3, river_classes=True, river_strength=32,
                           bet_sizes={'flop': [0.33, 0.75], 'turn': [0.33, 0.75, 1.25], 'river': FAST_RIVER},
                           raise_sizes=dict(RAISES))),
    'accurate': Advisor(Config(n_turns=4, leaf_turns=4, leaf_rivers_flop=8, n_rivers_from_flop=8, river_classes=True,
                               river_buckets=64, turn_buckets=True, bucket_river_step=1, river_strength=32,
                               bet_sizes={'flop': [0.33, 0.75], 'turn': [0.33, 0.75, 1.25], 'river': [0.33, 0.75, 1.25]},
                               raise_sizes=dict(RAISES))),
}
for _a in advs.values():
    _a.root_sizes = {'river': {'bet': [0.33, 0.75, 1.25, 2.5]}}
advs['accurate'].warm_from = advs['fast']
advs['fast'].spare_prior = True
advs['fast'].hu_settled = 0.2 if THREADED else 0.3
if not THREADED:
    advs['fast'].hu_settled_from['turn'] = 200
advs['fast'].expl_target = 0.2 if THREADED else 0.3
advs['accurate'].expl_target = 0.1
advs['fast'].first_look = {'flop': (100, 200, 300, 400), 'turn': (100, 200, 300, 400)}
advs['accurate'].first_look = {'flop': (100, 300, 600), 'turn': (100, 300, 600)}
if not THREADED:
    advs['fast'].spr_sizes = {'turn': (4.5, {'bet': [0.33, 0.75], 'river': [0.75]})}
NOLIB = os.environ.get("QA_NOLIB") == "1"
if not NOLIB:
    lib = FlopLibrary.from_dir(LIB)
    advs['fast'].library = advs['accurate'].library = lib
    mwlib = MWLibrary(lib._fetch)
    advs['fast'].mw_library = advs['accurate'].mw_library = mwlib
advs['fast'].mw_solve_streets = advs['accurate'].mw_solve_streets = ('flop', 'turn', 'river')
advs['fast'].mw_street_config = {s: dict(c) for s, c in MW_FAST_STREETS.items()}
advs['fast'].mw4_street_config = {s: dict(c) for s, c in MW4_FAST_STREETS.items()}
_slow = _mwc.lib() is None
if _slow:
    advs['accurate'].mw_street_config = {s: dict(advs['accurate'].mw_street_config[s], buckets=12, bucket_river_step=3)
                                         for s in ('flop', 'turn')}
    advs['fast'].mw_street_config = {s: dict(c, buckets=6, bucket_river_step=6) for s, c in advs['fast'].mw_street_config.items()}
    advs['fast'].mw4_street_config = None
    advs['accurate'].mw4_street_config = None
advs['fast'].mw4_quick_flop = None
advs['fast'].mw_nway_max = 5
advs['accurate'].mw_nway_max = 6
advs['accurate']._held = advs['fast']._held
KEEP_MB = float(os.environ.get("QA_CACHE_MB", "150"))
advs['fast'].cache_mb = advs['accurate'].cache_mb = KEEP_MB
for _a in advs.values():
    _a.should_stop = lambda: False

# the 3-way solves the cache evicts (Advisor._keep), by board, since the last reply
EVICTED: set = set()
_keep_own = Advisor._keep


def _keep_seen(self, store, key, sol):
    before = [(a, set(a._mw_lines)) for a in advs.values()]
    _keep_own(self, store, key, sol)
    for a, keys in before:
        for k in keys - set(a._mw_lines):
            EVICTED.add(_cards_str(list(k[0])))


Advisor._keep = _keep_seen


def answer(st, pl):
    """The worker's answer() as worker-edits.mjs leaves it."""
    adv = advs.get(st.get('speed'), advs['fast'])
    _mb = min(KEEP_MB, max(64.0, float(st.get('cache_mb') or KEEP_MB)))
    for _x in advs.values():
        _x.cache_mb = _mb
    try:
        if st.get('study') and st.get('preflop_solve') and not pl and not str(st.get('board') or '') \
                and not st.get('payouts') and not st.get('bounties'):
            from engine.pf_solve import answer as pf_answer
            return json.dumps(pf_answer(adv, st))
        if st.get('nodelock') and not pl:
            from engine.study_lock import answer as locked
            return json.dumps(locked(adv, st, lambda p: None))
        if pl and st.get('locks'):
            from engine.exploit_play import play as read_play
            return json.dumps(read_play(adv, st, pl['seat'], pl['hole'], pl.get('seed')))
        return json.dumps(adv.play(st, pl['seat'], pl['hole'], pl.get('seed')) if pl else adv.advise(st))
    except Cancelled:
        return json.dumps({'cancelled': True})


def rss_mb() -> float:
    """The process's peak RSS, MB."""
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1024 * 1024) if sys.platform == "darwin" else r / 1024


def cur_mb() -> float:
    """Its RSS now, MB (ps; the peak where ps fails)."""
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True, timeout=5).stdout
        return float(out.strip()) / 1024
    except Exception:  # noqa: BLE001
        return rss_mb()


# The RSS counts more than the process holds: libmalloc hands the empty pages of its small-block regions back with
# madvise(MADV_FREE), and they stay resident, and counted in the RSS, until the system needs them, when it takes them
# without writing anything out. Large blocks don't reuse them, so a big read's arrays land on top. vmmap showed 262 MB of
# "MALLOC_SMALL (empty)" resident with 336 KB of it dirty after a run of 5-way solves; a stored 6-max preflop solve read
# after two of them peaked at 1084 MB of RSS and a 570 MB physical footprint (the pages the process has written and still
# holds: what Activity Monitor's Memory column and top's MEM show), and the same sequence run again at 711 MB and 590 MB
# (how much freed memory the RSS still counts moves with how much the rest of the machine wants). memory() gives both; the
# cap below and the sweep's perf.rss rule read the RSS, the project's rule, and the footprint says what of it is held.
if sys.platform == "darwin":
    import ctypes

    class _RusageV4(ctypes.Structure):
        # rusage_info_v4 (sys/resource.h): a 16-byte uuid, then 64-bit counters, ri_resident_size the 7th,
        # ri_phys_footprint the 8th and ri_lifetime_max_phys_footprint the 29th (40 slots: room past its 35)
        _fields_ = [("uuid", ctypes.c_uint8 * 16), ("f", ctypes.c_uint64 * 40)]

    _libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    _libc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
else:
    _libc = None


def memory() -> dict:
    """The process's memory, MB: `now` and `peak` its physical footprint now and the most it has been (macOS; the RSS
    elsewhere), `rss_now` and `rss_peak` its RSS."""
    if _libc is not None:
        r = _RusageV4()
        if _libc.proc_pid_rusage(os.getpid(), 4, ctypes.byref(r)) == 0:
            return {"now": r.f[7] / 2 ** 20, "peak": r.f[28] / 2 ** 20, "rss_now": r.f[6] / 2 ** 20, "rss_peak": rss_mb()}
    now, peak = cur_mb(), rss_mb()
    return {"now": now, "peak": peak, "rss_now": now, "rss_peak": peak}


# The stored preflop solves read for a request (pf_study, Lizard's pf_solve and pf_icm_study keep each in _HELD, a 6-max
# one about 380 MB of live arrays) are dropped after it, so a postflop solve after a preflop-solve read doesn't take the
# process past ~1 GB (with MallocLargeCache=0, above, the freed large blocks go back to the system). They are read
# again (0.4 s) at the next preflop-solve request, to the same answer; the browser's worker keeps them. QA_DROP_PF=0
# keeps them, as the worker does. A solve run here, not read from the store, is kept either way.
DROP_PF = os.environ.get("QA_DROP_PF", "1") != "0"


def drop_stored() -> int:
    n = 0
    for name in ("gto.pf_study", "engine.pf_solve", "engine.pf_icm_study"):
        held = getattr(sys.modules.get(name), "_HELD", None)
        if not held:
            continue
        for k in [k for k, s in held.items() if getattr(s, "stored", False)]:
            del held[k]
            n += 1
    if n:
        gc.collect()
    return n


# Past the cap by its RSS after a reply, the process exits and the bridge starts a fresh one for what comes next (a fresh
# one holds none of the pages libmalloc freed; the sweep asks a hand's earlier streets again where its process restarted,
# sweep.ts). In the default matrix (2026-11-18, QA_RSS_LOG) the request that added most to the RSS was a stored preflop
# solve's read, up to 494 MB at its peak, and the bridge starts a process afresh before a preflop request past
# QA_PF_CAP_MB (500, py.ts), where the hand has no earlier street to lose; a postflop request added up to 431 MB in the
# configs' processes. With 700 here each config's process stayed under 1 GB (867 MB at most). It isn't a bound: an
# Accurate reference's turn added 611 MB on top of its hand's flop, to 1130 MB (a 718 MB footprint).
CAP = float(os.environ.get("QA_RSS_CAP_MB", "700"))
# (a file to append each request's memory before and after to, for finding what holds it)
TRACE = os.environ.get("QA_RSS_LOG", "")


def over_cap(m: dict):
    """The reply's "bye" where the process's RSS now (memory()) is over CAP, else None."""
    if m["rss_now"] > CAP:
        return (f"rss {m['rss_now']:.0f} MB over the cap {CAP:.0f} (peak {m['rss_peak']:.0f}; held {m['now']:.0f}): "
                "exiting")
    return None


def main() -> None:
    out = sys.stdout
    m = memory()
    print(json.dumps({"ready": True, "threaded": THREADED, "nolib": NOLIB, "core": not _slow, "cache_mb": KEEP_MB,
                      "drop_pf": DROP_PF, "large_cache": os.environ.get("MallocLargeCache", ""),
                      "secs": round(time.time() - T0, 2), "mem_mb": round(m["peak"]), "rss_mb": round(m["rss_peak"])}),
          file=out, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        t = time.time()
        before = memory() if TRACE else None
        EVICTED.clear()
        try:
            text = answer(req.get("state") or {}, req.get("play"))
            msg = {"id": req.get("id"), "json": text}
        except Exception as e:  # noqa: BLE001  (the worker posts {error} and the page's request fails)
            msg = {"id": req.get("id"), "error": f"{type(e).__name__}: {e}", "tb": traceback.format_exc()[-2000:]}
        msg["secs"] = round(time.time() - t, 3)
        if EVICTED:
            msg["dropped"] = sorted(EVICTED)
        if DROP_PF:
            drop_stored()
        m = memory()
        msg.update(mem_mb=round(m["peak"]), mem_now_mb=round(m["now"]), rss_mb=round(m["rss_peak"]),
                   cur_mb=round(m["rss_now"]))
        if TRACE:
            st = req.get("state") or {}
            kind = "pf" if st.get("preflop_solve") else "play" if req.get("play") else "advise"
            held = round(sum(advs['fast']._held.values()) / 2 ** 20)
            with open(TRACE, "a") as f:
                f.write(json.dumps({"pid": os.getpid(), "kind": kind, "board": st.get("board"),
                                    "before": round(before["now"]), "after": msg["mem_now_mb"], "peak": msg["mem_mb"],
                                    "rss_before": round(before["rss_now"]), "rss_after": msg["cur_mb"],
                                    "rss_peak": msg["rss_mb"], "held_mb": held, "secs": msg["secs"]}) + "\n")
        # (over the cap the reply says so, and the bridge sends what comes next to a fresh process, so no request is sent
        # to one about to exit)
        bye = over_cap(m)
        if bye:
            msg["bye"] = bye
        print(json.dumps(msg), file=out, flush=True)
        if bye:
            sys.exit(3)


if __name__ == "__main__":
    main()
