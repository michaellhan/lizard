"""Quick answers (Practice's ~2 s mode) in 3-way pots: the street narrowed through a short solve after a bet in front,
a rare earlier line solved again, a caveat on the small flop game, and the hand's solves kept apart by mode.

Upstream (solver/gto/advisor.py) at Quick:

- A 3-way street someone bet or raised on before your decision is narrowed by the betting rules alone
  (Advisor._mw_walk skips the solve from the street's start that Fast runs, mw_current_solve). Here Quick runs it too,
  in Quick's own game (the flop MW_QUICK_FLOP, the turn MW_QUICK_TURN, the river the street's own config), for at most
  QUICK_NARROW seconds, stopping once the narrowing would follow it fully (PRIOR_TRUST's lower bound, checked at
  QUICK_CHECKS iterations). Upstream's note on the street says how far the solve was followed (trust_of), and the web's
  MW_PARTIAL_NOTE reads it; where it is followed not at all, the rules narrow as before and say so. The node's own
  solve keeps its whole budget and build time after it (upstream's _mw_narrow_s; the build deadline is moved here).
  Measured natively (docs/ACCURACY.md section 28): the flop's narrowing ran 69-108 iterations to 0.5-0.8% of the pot
  in 1.6-2.0 s, followed 92-100%; the turn's 48-50 iterations to 1.3-1.4% in 1.5 s, followed fully; the river's 25 to
  0.9% in 0.2 s. A Quick decision behind a bet took 1.6-2.1 s longer (the river's 0.1 s).
- The hand's 3-way solves are kept by their place in the hand (Advisor._mw_lines, keyed by gto.advisor._mw_line), which
  says nothing of the mode, and Quick and Fast share the worker's Fast advisor. A Quick answer at a node behind a bet
  stored its solve there, so a Fast request at the same node found it as "this node's own line" and skipped the street's
  narrowing (Advisor._mw_walk returns False for a hit at the street's last action): Fast then stood on the rules. Here
  a Quick request's lines carry "quick" in their key, and the walk of the street being advised on never takes the node's
  own line for its narrowing (a solve rooted where you act is no narrowing of the actions before it), so a repeated
  request narrows as the first did.
- A Quick 3-way flop is solved in the smallest game (MW_QUICK_FLOP: 6 hand buckets a player on the turn and river, the
  turn's tables over every sixth river, one bet size of half the pot). Upstream measured those buckets' values 5.3-10.9%
  of the pot from the 32-bucket game's, against Fast's 12 buckets at 2.2-3.1 (advisor.py, MW_FAST_STREETS). Its
  distance from equilibrium is measured in that small game, so a fully run solve read "converged". Its answer now
  carries solver.approximate (the web's provenance band "approximate") and QUICK_FLOP_NOTE.
- After a line an earlier heads-up street's solve rarely takes (RARE_LINE), the street is solved again from the node
  (Advisor._rare_resolver, RARE_RESOLVE), except at Quick, where the range after it was the rules'. Here Quick re-solves
  it too, for at most QUICK_RARE seconds; natively it settled (300 iterations) well inside that, and the answer took
  0.06-0.1 s longer, its own solve 15-25% fewer iterations (still 0.5-0.8% of the pot). It reaches what Quick walks
  through a solve: a library flop, or a street already solved in the hand (your advice on it); an earlier street Quick
  doesn't solve is narrowed by the rules, as before, and says so. The answer's off_solution then
  carries {"why": "rare", "resolved": true}, as Fast's does.

Imported by the worker at start (scripts/pyodide/worker-edits.mjs), after engine.mw_near; solver/ is untouched.
"""
from __future__ import annotations

import contextvars
import time

from gto import advisor as A

# seconds: the most the current 3-way street's narrowing solve runs at Quick, behind a bet or raise, by street (0 or
# none: the rules). It stops sooner once the narrowing would follow it fully (PRIOR_TRUST's lower bound: 0.5% of the
# pot on the flop, 2% on the turn and river), checked at QUICK_CHECKS iterations.
QUICK_NARROW = {"flop": 2.0, "turn": 1.5, "river": 0.6}
QUICK_CHECKS = (25, 50, 100, 150, 200, 300, 400, 700)
QUICK_NARROW_GAME = {"flop": A.MW_QUICK_FLOP, "turn": A.MW_QUICK_TURN}   # (the river: the street's own config)
QUICK_GAME_WORDS = {"flop": "the quick game: 6 hand buckets a player on the turn and river, one bet size of half the pot",
                    "turn": "the quick game: 8 hand buckets a player on the river",
                    "river": "the river's own game"}
QUICK_RARE = 0.5       # seconds: the most a rare line's re-solve runs at Quick (0: off, the rules' range after it)
QUICK_FLOP_NOTE = ("Approximate: a quick answer's 3-way flop is solved in a small game (6 hand buckets a player on the "
                   "turn and river, one bet size of half the pot), so its mix and EVs are a rough guide: its distance "
                   "from equilibrium is measured in that game, not the full one (Fast plays 12 buckets and bets of 33 "
                   "and 75% pot)")
QUICK_NARROW_NOTE = "{street}: a quick answer's narrowing solve of this street ran {secs:.1f} s in {game}"

_QUICK = contextvars.ContextVar("lizard_quick_request", default=False)   # (set for each request: _advise_at)


def _wrap_line(upstream):
    """gto.advisor._mw_line with the mode: a Quick request's keys end in "quick"."""
    def _mw_line(board, hero, hole, stk, streets, street, n):
        key = upstream(board, hero, hole, stk, streets, street, n)
        return key + ("quick",) if _QUICK.get() else key
    _mw_line.mw_quick_upstream = upstream
    return _mw_line


def _wrap_advise_at(upstream):
    """Advisor._advise_at with the request's mode set for _mw_line."""
    def _advise_at(self, state, *args, **kwargs):
        tok = _QUICK.set(bool(state.get("quick")))
        try:
            return upstream(self, state, *args, **kwargs)
        finally:
            _QUICK.reset(tok)
    _advise_at.mw_quick_upstream = upstream
    return _advise_at


def _wrap_walk(upstream):
    """Advisor._mw_walk: the street advised on without the node's own line, and at Quick narrowed by a short solve."""
    def _mw_walk(self, ranges, before, board, st, stk, hero, hole, streets, notes, current=False):
        if not current:
            return upstream(self, ranges, before, board, st, stk, hero, hole, streets, notes, current)
        acts = list(streets.get(st.name) or [])
        bk = board[:{"flop": 3, "turn": 4, "river": 5}[st.name]]
        heroes = [hero] + ([p for p in st.players_start if p != hero] if self._study else [])
        hidden = {}
        for x in heroes:
            key = A._mw_line(bk, x, hole, stk, streets, st.name, len(acts))
            if key in self._mw_lines:
                hidden[key] = self._mw_lines.pop(key)
        secs = float((QUICK_NARROW or {}).get(st.name) or 0.0)
        quick = bool(getattr(self, "_quick", False)) and secs > 0
        saved = (self._quick, self.time_budget, self.mw_street_config, A.MW_SETTLED, A.MW_CHECKS) if quick else None
        if quick:
            self._quick = False
            self.time_budget = secs / max(A.MW_CURRENT_NARROW, 1e-9)
            self.mw_street_config = {**self.mw_street_config, **{k: dict(v) for k, v in QUICK_NARROW_GAME.items()}}
            A.MW_SETTLED = max(A.MW_SETTLED, A.PRIOR_TRUST[st.name][0])    # (read by Advisor._mw_run as it runs)
            A.MW_CHECKS = QUICK_CHECKS
        s0 = self._mw_narrow_s
        try:
            ok = upstream(self, ranges, before, board, st, stk, hero, hole, streets, notes, current)
        finally:
            if saved is not None:
                self._quick, self.time_budget, self.mw_street_config, A.MW_SETTLED, A.MW_CHECKS = saved
            for k, v in hidden.items():
                self._mw_lines.setdefault(k, v)
        if quick and ok and self._mw_narrow_s > s0:   # (narrowed through it: upstream's note before says how far)
            notes.append(QUICK_NARROW_NOTE.format(street=st.name, secs=self._mw_narrow_s - s0,
                                                  game=QUICK_GAME_WORDS.get(st.name, "the quick game")))
        return ok
    _mw_walk.mw_quick_upstream = upstream
    return _mw_walk


def _wrap_multiway_solve(upstream):
    """Advisor._multiway_solve: a Quick 3-way flop in the small game is marked approximate (QUICK_FLOP_NOTE)."""
    def _multiway_solve(self, hero, hole, board, ranges, remaining, cur, stk, t0, notes, line=None, positions=None):
        # (a Quick answer's tables must be built by MW_QUICK_BUILD of its budget from t0, or the rules answer; upstream
        # gives the node's solve its whole budget after the narrowing (_mw_narrow_s) but not its build: from the
        # narrowing's end here, as upstream never narrows at Quick)
        narrow = float(getattr(self, "_mw_narrow_s", 0.0) or 0.0)
        shift = narrow if getattr(self, "_quick", False) and not self._study and narrow > 0 else 0.0
        if shift:
            self._mw_narrow_s = 0.0      # (upstream's `left` adds it back to a t0 it doesn't move: moved here instead)
        try:
            res = upstream(self, hero, hole, board, ranges, remaining, cur, stk, t0 + shift, notes, line=line,
                           positions=positions)
        finally:
            if shift:
                self._mw_narrow_s = narrow
        if shift and isinstance(res, dict) and "seconds" in res:
            res["seconds"] = round(time.time() - t0, 2)
        if isinstance(res, dict) and getattr(self, "_quick", False) and not self._study and cur.name == "flop" \
                and isinstance(res.get("solver"), dict) and len(remaining) == 3 \
                and not set(remaining) & set(cur.allin) and A._mw_applies(remaining, cur, stk):
            res["solver"]["approximate"] = True
            res.setdefault("notes", []).append(QUICK_FLOP_NOTE)
        return res
    _multiway_solve.mw_quick_upstream = upstream
    return _multiway_solve


def _wrap_rare(upstream):
    """Advisor._rare_resolver at Quick with QUICK_RARE seconds (off at 0, as upstream)."""
    def _rare_resolver(self, board, st, eff, cfg):
        if not getattr(self, "_quick", False) or QUICK_RARE <= 0:
            return upstream(self, board, st, eff, cfg)
        self._quick = False
        try:
            inner = upstream(self, board, st, eff, cfg)
        finally:
            self._quick = True
        if inner is None:
            return None

        def resolve(*args):
            saved = self.prior_budget
            self.prior_budget = QUICK_RARE
            try:
                return inner(*args)
            finally:
                self.prior_budget = saved
        return resolve
    _rare_resolver.mw_quick_upstream = upstream
    return _rare_resolver


def _up(obj, name):
    f = getattr(obj, name)
    return getattr(f, "mw_quick_upstream", f)


_mw_line = _wrap_line(_up(A, "_mw_line"))
_advise_at = _wrap_advise_at(_up(A.Advisor, "_advise_at"))
_walk = _wrap_walk(_up(A.Advisor, "_mw_walk"))
_mws = _wrap_multiway_solve(_up(A.Advisor, "_multiway_solve"))
_rare = _wrap_rare(_up(A.Advisor, "_rare_resolver"))


def install() -> None:
    """Wraps gto.advisor (idempotent)."""
    A._mw_line = _mw_line
    A.Advisor._advise_at = _advise_at
    A.Advisor._mw_walk = _walk
    A.Advisor._multiway_solve = _mws
    A.Advisor._rare_resolver = _rare


install()
