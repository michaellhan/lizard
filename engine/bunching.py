"""Bunching: the card removal from the hands the players who folded preflop were holding.

A 6-max pot that reaches the flop two- or three-way had three or four players fold first, and they fold mostly weak,
low-card hands. So the cards still out are richer in high cards than an even deal, and a remaining player is a little
more likely to hold AK and a little less likely to hold 54s than their range alone says. Upstream's solves deal every
hand evenly from the cards the board leaves (solver/gto/solver.py _spot); this module weighs the remaining players'
combos by the folds, as an option a request asks for ("bunching"), and computes the turn and river cards' odds that the
folds give.

The model. Each folded seat j folds a combo f with weight fold_j(f) (its range at the fold times its fold frequency
there: the charts', or the preflop solve's). The folders' hands are dealt from the cards left by the board, then a
remaining player's hand h: given the line, the chance of h is its range weight times

    F(h) = P(no folder holds a card of h)  =  1 - p(a) - p(b) + p(a, b)     for h = {a, b},

under the folders' deal weighted by their folds, where p(a) is the chance a folder holds card a and p(a, b) that the
folders hold both. So only the cards' first and second moments are needed (moments()). With one or two folders they
are exact (matrix sums over the 1,326 combos, and for two over every disjoint pair); with three or more they are
sampled: the folders' hands drawn from their fold ranges and a deal kept only when no card repeats, which draws the
folders' joint deal exactly, SAMPLES of them, F's standard error being sqrt(F (1 - F) / samples) a combo (about 0.002,
0.25% of F, at 60,000).

What is approximate, and said in every answer:
- F(h) is the factor for each remaining player alone. The exact weight of a pair of hands is P(no folder holds a card
  of either), which isn't a product of the two; the solver takes independent ranges, so each player's combos get their
  own factor. docs/ACCURACY.md section 23 (Bunching) measures what that leaves out: 0.3-0.4% of a pair's weight
  (root mean square), under 0.9% at the 95th percentile, on the spots measured.
- The factor is conditioned on the flop, not on later cards (a turn's or river's own effect on the folds is the size
  of the runout odds below), so a turn's solve narrows from the same flop ranges its flop solve used.
- The solves still deal the turn and river evenly: the odds the folds give each card are computed (card_odds) and
  shown, not played. They move a rank's chance by up to 8% of itself, an ace's most (ACCURACY section 23).
- Seats that fold after the flop aren't counted: their hands are a postflop range, not a preflop fold.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs, declared in solver/UPSTREAM.json); it wraps
Advisor._advise_at, and a request without "bunching" is answered exactly as before. With it, for the length of the
request, the ranges entering the flop (gto.advisor.preflop_ranges on the hand's own preflop line, and the request's
custom ranges) are weighted by the folds, and the flop libraries are put aside so every street is solved live on those
ranges (the libraries hold solves of the even deal). The solves' caches key on the ranges, so a bunched solve and an
even one never answer for each other. solver/ is untouched.
"""
from __future__ import annotations

import hashlib
import time
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from gto import advisor as A
from gto.cards import ALL_COMBOS, RANKS, card_str

N = 1326
CA = np.array([a for a, _ in ALL_COMBOS])
CB = np.array([b for _, b in ALL_COMBOS])
MEMBER = np.zeros((52, N))
MEMBER[CA, np.arange(N)] = 1.0
MEMBER[CB, np.arange(N)] = 1.0

EXACT_MAX = 2          # folders whose moments are summed exactly; more are sampled
SAMPLES = 60_000       # deals kept when sampled
BATCH = 20_000         # deals drawn at a time
MIN_ACCEPT = 0.01      # a sampled deal kept less often than this: the folds can't all be held at once
SOURCES = ("charts", "solve")
SOURCE_WORDS = {"charts": "the preflop charts' fold ranges", "solve": "the preflop solve's fold ranges"}

_COMPAT: Optional[np.ndarray] = None


def compat() -> np.ndarray:
    """(N, N): 1 where two combos share no card (built once, 14 MB)."""
    global _COMPAT
    if _COMPAT is None:
        _COMPAT = (MEMBER.T @ MEMBER == 0).astype(np.float64)
    return _COMPAT


def live_mask(dead: Sequence[int]) -> np.ndarray:
    """(N,) 1 for a combo holding none of `dead`."""
    m = np.ones(N)
    for c in dead:
        m *= 1.0 - MEMBER[c]
    return m


class Moments:
    """The folders' cards under their folds: p1[a] = P(a folder holds a), p2[a, b] = P(the folders hold a and b) (p2's
    diagonal is p1). `samples`: the deals they were averaged over, None where exact."""

    def __init__(self, p1: np.ndarray, p2: np.ndarray, folders: int, samples: Optional[int] = None,
                 accept: Optional[float] = None, seconds: float = 0.0):
        self.p1, self.p2, self.folders, self.samples, self.accept, self.seconds = p1, p2, folders, samples, accept, seconds

    def factor(self, dead: Sequence[int] = ()) -> np.ndarray:
        """(N,) F(h) = P(no folder holds a card of h); 0 for a combo holding a dead card."""
        f = 1.0 - self.p1[CA] - self.p1[CB] + self.p2[CA, CB]
        return np.clip(f, 0.0, 1.0) * live_mask(dead)

    def stderr(self, dead: Sequence[int] = ()) -> np.ndarray:
        """(N,) F's standard error a combo (0 where exact)."""
        if self.samples is None:
            return np.zeros(N)
        f = self.factor(dead)
        return np.sqrt(f * (1.0 - f) / self.samples)


def _folds(folds: Sequence[np.ndarray], dead: Sequence[int]) -> List[np.ndarray]:
    live = live_mask(dead)
    out = []
    for w in folds:
        w = np.asarray(w, dtype=np.float64) * live
        if not w.sum() > 0:
            raise ValueError("a folder's fold range has no combos left by the board")
        out.append(w)
    return out


def moments(folds: Sequence[np.ndarray], dead: Sequence[int] = (), samples: int = SAMPLES, seed: int = 0,
            exact_max: int = EXACT_MAX) -> Moments:
    """The folders' card moments: each fold range a (N,) weight over the combos (dead cards removed here). Exact for
    up to `exact_max` folders (at most 2), sampled past that."""
    t0 = time.time()
    ws = _folds(folds, dead)
    k = len(ws)
    if k == 0:
        return Moments(np.zeros(52), np.zeros((52, 52)), 0)
    if k <= min(exact_max, 2):
        if k == 1:
            w = ws[0]
            z = w.sum()
            p1 = MEMBER @ w / z
            p2 = (MEMBER * w) @ MEMBER.T / z
        else:
            C = compat()
            w1, w2 = ws
            cw1, cw2 = C @ w1, C @ w2
            z = float(w1 @ cw2)
            if not z > 0:
                raise ValueError("the folders' fold ranges can't both be held at once")
            u = w1 * cw2 + w2 * cw1            # each combo's chance (times z) of being one folder's hand
            p1 = MEMBER @ u / z
            cross = (MEMBER * w1) @ C @ (MEMBER * w2).T / z   # a from the first folder, b from the second
            p2 = (MEMBER * u) @ MEMBER.T / z + cross + cross.T
        np.fill_diagonal(p2, p1)
        return Moments(p1, p2, k, None, None, time.time() - t0)
    return _sampled(ws, samples, seed, t0)


def _sampled(ws: List[np.ndarray], samples: int, seed: int, t0: float) -> Moments:
    """Rejection sampling: each folder's hand from its fold range, a deal kept when no card repeats (the kept deals are
    the folders' joint deal exactly)."""
    rng = np.random.default_rng(seed)
    k = len(ws)
    cdfs = [np.cumsum(w) / w.sum() for w in ws]
    I, J = np.triu_indices(2 * k, 1)
    acc1 = np.zeros(52)
    acc2 = np.zeros(52 * 52)
    got = drawn = 0
    while got < samples:
        idx = np.stack([np.minimum(np.searchsorted(c, rng.random(BATCH), side="right"), N - 1) for c in cdfs], axis=1)
        cards = np.concatenate([CA[idx], CB[idx]], axis=1)
        s = np.sort(cards, axis=1)
        cards = cards[(np.diff(s, axis=1) != 0).all(axis=1)][:samples - got]
        drawn += BATCH
        got += len(cards)
        if drawn >= 20 * BATCH and got < MIN_ACCEPT * drawn:
            raise ValueError("the folders' fold ranges can hardly be held at once")
        acc1 += np.bincount(cards.ravel(), minlength=52)
        a, b = cards[:, I].ravel(), cards[:, J].ravel()
        acc2 += np.bincount(a * 52 + b, minlength=2704) + np.bincount(b * 52 + a, minlength=2704)
    p1 = acc1 / got
    p2 = acc2.reshape(52, 52) / got
    np.fill_diagonal(p2, p1)
    return Moments(p1, p2, k, got, got / drawn, time.time() - t0)


def card_odds(m: Moments, dead: Sequence[int]) -> np.ndarray:
    """(52,) the next card's chance given the folds: a card no folder holds is as likely as any other, so it is
    (1 - p1) over the cards `dead` leaves, normalised (0 for a dead card). Even dealing is 1 / (cards left)."""
    live = np.ones(52)
    live[list(dead)] = 0.0
    q = (1.0 - m.p1) * live
    return q / q.sum()


def rank_odds(q: np.ndarray, dead: Sequence[int]) -> List[dict]:
    """card_odds by rank, high first, with the even deal's beside them."""
    live = np.ones(52)
    live[list(dead)] = 0.0
    n = live.sum()
    out = []
    for r in range(12, -1, -1):
        cs = list(range(4 * r, 4 * r + 4))
        k = int(live[cs].sum())
        if k:
            out.append({"rank": RANKS[r], "p": round(float(q[cs].sum()), 5), "even": round(k / float(n), 5)})
    return out


def scaled(r: np.ndarray, f: np.ndarray) -> Tuple[np.ndarray, float]:
    """A range weighed by the factor, scaled so the combo of it the folds block least keeps its weight and none goes
    over 1 (a solve doesn't change with a range's scale; the combos it shows are then relative to that combo).
    (weights, the scale)."""
    m = float(f[r > 0].max()) if (r > 0).any() else 0.0
    if not m > 0:
        return r * 0.0, 0.0
    return r * f / m, m


# ----------------------------------------------------------------------------- the folds, from the line
class Unavailable(Exception):
    """Bunching can't be computed for this request (words for the page)."""


def folds_of(preflop: List[dict]) -> List[Tuple[int, str]]:
    """(index in the line, seat) of each preflop fold."""
    return [(i, a["pos"]) for i, a in enumerate(preflop) if a.get("action") == "fold"]


def chart_folds(preflop: List[dict], positions, stack: float, pool_except: Optional[str] = None,
                locks=None) -> Dict[str, np.ndarray]:
    """Each folder's fold range by the charts the ranges entering the flop come from: its range where it folded
    (preflop_ranges on the line up to there) times the chart's fold there (adjusted as preflop_ranges adjusts it: the
    pool's, your lock's)."""
    pr = _upstream_ranges
    locks = A._lock_spec(locks)
    locked = {p: dict(kv) for p, kv in locks}
    out: Dict[str, np.ndarray] = {}
    for i, p in folds_of(preflop):
        before = preflop[:i]
        live = pr(before, positions, stack, pool_except, locks or None)
        if p not in live:
            continue
        # (every seat, as preflop_ranges' own loop hands them to the pool's and a lock's strategies)
        ranges = {q: live.get(q, np.ones(N)) for q in positions}
        depth = A._eff_stack(positions, p, before, stack)
        strat = A.preflop_strategy(p, before, positions, depth)
        if pool_except is not None and p != pool_except:
            strat = A.pool_strategy(strat, p, before, ranges)
        if p in locked:
            strat = A.lock_strategy(strat, p, before, ranges, locked[p], positions)
        fold = strat.get("fold")
        if fold is None:
            fold = np.clip(1.0 - sum(v for k, v in strat.items() if k != "fold"), 0.0, 1.0)
        w = np.asarray(ranges[p], dtype=np.float64) * fold
        if w.sum() > 0:
            out[p] = w
    return out


def solve_folds(state: dict, preflop: List[dict]) -> Dict[str, np.ndarray]:
    """Each folder's fold range by Lizard's preflop solve of this game (engine/pf_solve.py: its stored solve, or one
    run earlier in this session): its reach where it folded times the solve's fold there, by hand class. Unavailable
    where the game isn't held or the line leaves the solve's tree."""
    from gto.pf_classes import CLASSES, CLASS_OF
    from . import pf_solve as S
    spec, why = S.spec_of(state)
    if spec is None:
        raise Unavailable(f"the preflop solve doesn't take this game ({why})")
    s = S.held(spec)
    if s is None:
        raise Unavailable(f"the preflop solve of this game ({spec.label()}) isn't stored or solved yet")
    out: Dict[str, np.ndarray] = {}
    index = {c: i for i, c in enumerate(CLASSES)}
    for i, p in folds_of(preflop):
        node = s.node(preflop[:i])
        if node.get("study") != "node" or node.get("actor") != p:
            raise Unavailable(f"{p}'s fold isn't on the preflop solve's tree"
                              + (f" ({node['error']})" if node.get("error") else ""))
        names = node["grid"]["actions"]
        if "fold" not in names:
            raise Unavailable(f"the preflop solve has no fold for {p} there")
        j = names.index("fold")
        by_class = np.zeros(len(CLASSES))
        for cls, cell in node["grid"]["cells"].items():
            by_class[index[cls]] = cell["w"] * cell["f"][j]
        w = by_class[CLASS_OF]
        if w.sum() > 0:
            out[p] = w
    return out


# ----------------------------------------------------------------------------- the request
def parse(state: dict) -> Optional[str]:
    """The fold ranges a request asks bunching from ("charts" or "solve"), None for none; ValueError with words."""
    v = state.get("bunching")
    if v in (None, False, "", "off", 0):
        return None
    if v is True or v == 1:
        return "charts"
    if isinstance(v, str) and v.strip().lower() in SOURCES:
        return v.strip().lower()
    raise ValueError(f"bunching must be one of {', '.join(SOURCES)} (or off), got {v!r}")


_CACHE: Dict[str, "Plan"] = {}
CACHE_MAX = 32


class Plan:
    """A request's bunching: the folds, their moments on the flop, and each remaining seat's factor."""

    def __init__(self, source: str, asked: str, why: Optional[str], folds: Dict[str, np.ndarray], m: Moments,
                 flop: Tuple[int, ...]):
        self.source, self.asked, self.why, self.folds, self.m, self.flop = source, asked, why, folds, m, flop
        self.F = m.factor(flop)
        self.se = m.stderr(flop)

    def weigh(self, r: np.ndarray) -> np.ndarray:
        return scaled(np.asarray(r, dtype=np.float64), self.F)[0]

    def info(self, entering: Dict[str, np.ndarray], board: Sequence[int]) -> dict:
        """The answer's "bunching": what weighed the ranges, how, and the next card's odds."""
        live = live_mask(board)
        seats = {}
        worst = 0.0
        for p, r in entering.items():
            r = np.asarray(r, dtype=np.float64) * live
            w, scale = scaled(r, self.F)
            if scale > 0:
                rel = self.se[r > 0] / self.F[r > 0].clip(1e-12)
                worst = max(worst, float(rel.max()))
            seats[p] = {"combos": round(float(r.sum()), 1), "weighted": round(float(w.sum()), 1),
                        "spread": round(float(self.F[r > 0].min() / scale), 4) if scale > 0 else None}
        folders = [{"seat": p, "combos": round(float((w * live_mask(self.flop)).sum()), 1)}
                   for p, w in self.folds.items()]
        out = {"source": self.source, "label": SOURCE_WORDS[self.source], "folders": folders, "seats": seats,
               "method": "exact" if self.m.samples is None else "sampled",
               "samples": self.m.samples, "stderr_pct": round(100 * worst, 2), "conditioned_on": "the flop",
               "runouts": "dealt evenly"}
        if self.asked != self.source:
            out["asked"] = self.asked
            out["why"] = self.why
        if len(board) < 5:
            q = card_odds(self.m, board)
            even = 1.0 / (52 - len(board))
            live_c = [c for c in range(52) if c not in board]
            dev = max(live_c, key=lambda c: abs(q[c] / even - 1.0))
            out["next_card"] = {"street": "turn" if len(board) == 3 else "river", "by_rank": rank_odds(q, board),
                                "most_moved": {"card": card_str(dev), "p": round(float(q[dev]), 5),
                                               "even": round(even, 5)}}
        return out


def _key(*parts) -> str:
    return hashlib.sha1(repr(parts).encode()).hexdigest()


def _range_bytes(w: np.ndarray) -> bytes:
    return np.round(np.asarray(w, dtype=np.float64), 9).tobytes()


def plan_for(state: dict, asked: str, preflop: List[dict], positions, stack: float, flop: Sequence[int],
             pool_except: Optional[str] = None, locks=None) -> Plan:
    """The request's Plan (cached by its folds and flop). Unavailable where nobody folded preflop."""
    if not folds_of(preflop):
        raise Unavailable("nobody folded preflop: there is no bunching")
    source, why = asked, None
    folds: Dict[str, np.ndarray] = {}
    if asked == "solve":
        try:
            folds = solve_folds(state, preflop)
        except Unavailable as e:
            source, why = "charts", str(e)
    if source == "charts":
        folds = chart_folds(preflop, positions, stack, pool_except, locks)
    if not folds:
        raise Unavailable("the folds left no range to weigh by")
    flop = tuple(int(c) for c in flop[:3])
    key = _key(source, flop, tuple((p, hashlib.sha1(_range_bytes(w)).hexdigest()) for p, w in folds.items()))
    plan = _CACHE.get(key)
    if plan is None:
        seed = int(key[:8], 16)
        m = moments(list(folds.values()), flop, seed=seed)
        plan = Plan(source, asked, why, folds, m, flop)
        if len(_CACHE) >= CACHE_MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = plan
    elif plan.asked != asked or plan.why != why:
        plan = Plan.__new__(Plan)
        plan.__dict__.update(_CACHE[key].__dict__)
        plan.asked, plan.why = asked, why
    return plan


def note_of(info: dict) -> str:
    """The answer's note, in words."""
    who = [f["seat"] for f in info["folders"]]
    seats = ", ".join(f"{p} {s['combos']:g} → {s['weighted']:g}" for p, s in info["seats"].items())
    how = ("exact" if info["method"] == "exact" else
           f"sampled over {info['samples']:,} deals, ±{info['stderr_pct']:g}% a combo at most")
    words = (f"bunching: the ranges are weighed by the hands {', '.join(who)} folded ({info['label']}; {how}): "
             f"combos {seats}, relative to the combo of each range the folds block least; the turn and river are still dealt evenly")
    if info.get("asked"):
        words += f". Asked from the preflop solve, but {info['why']}, so the charts' folds were used"
    return words


# ----------------------------------------------------------------------------- the Advisor's wrap
_upstream_ranges = getattr(A.preflop_ranges, "upstream", A.preflop_ranges)
_upstream = getattr(A.Advisor._advise_at, "bunching_upstream", A.Advisor._advise_at)


def _same_line(a: List[dict], b: List[dict]) -> bool:
    return len(a) == len(b) and all(x == y for x, y in zip(a, b))


def _with_ranges(plan: Plan, line: List[dict]) -> Callable:
    def bunched(actions, positions, stack, pool_except=None, locks=None):
        out = _upstream_ranges(actions, positions, stack, pool_except, locks)
        if not _same_line(actions, line):
            return out
        new = A.PreflopRanges({p: plan.weigh(r) for p, r in out.items()})
        new.rebuilt = list(getattr(out, "rebuilt", []))
        return new
    bunched.upstream = _upstream_ranges
    return bunched


def _wrapping(upstream):
    """Advisor._advise_at over `upstream`, held in this closure rather than a module global, so importing this module
    again (importlib.reload) over another module's wrap can't turn the chain into a loop."""
    def _advise_at(self, state, actor, t0, hero, hole, board, positions, stack, streets, sizes, custom, locks):
        try:
            asked = parse(state)
        except ValueError as e:
            return {"error": str(e)}
        if asked is None or len(board) < 3:
            return upstream(self, state, actor, t0, hero, hole, board, positions, stack, streets, sizes, custom, locks)
        preflop = streets["preflop"]
        pool_except = hero if state.get("opponents") == "pool" else None
        try:
            plan = plan_for(state, asked, preflop, positions, stack, board, pool_except, locks)
        except (Unavailable, ValueError) as e:
            res = upstream(self, state, actor, t0, hero, hole, board, positions, stack, streets, sizes, custom, locks)
            if isinstance(res, dict) and "error" not in res:
                res["bunching"] = {"off": str(e)}
                res.setdefault("notes", []).append(f"bunching: off ({e})")
            return res
        entering = dict(_upstream_ranges(preflop, positions, stack, pool_except, locks))
        for p, r in (custom or {}).items():
            if p in entering:
                entering[p] = r
        bunched_custom = {p: plan.weigh(r) for p, r in (custom or {}).items()}
        saved = A.preflop_ranges, self.library, self.mw_library
        A.preflop_ranges = _with_ranges(plan, preflop)
        self.library = self.mw_library = None
        try:
            res = upstream(self, state, actor, t0, hero, hole, board, positions, stack, streets, sizes,
                            bunched_custom, locks)
        finally:
            A.preflop_ranges, self.library, self.mw_library = saved
        if isinstance(res, dict) and "error" not in res and "skipped" not in res:
            info = plan.info(entering, board)
            res["bunching"] = info
            res.setdefault("notes", []).insert(0, note_of(info))
        return res

    _advise_at.bunching_upstream = upstream
    return _advise_at


_advise_at = _wrapping(_upstream)


def install() -> None:
    """Wraps Advisor._advise_at (idempotent)."""
    A.Advisor._advise_at = _advise_at


install()
