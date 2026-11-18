"""Lizard's preflop game: upstream's class-level preflop game (solver/gto/pf_game.py) with each seat's own stack, a
smaller tree for 7 to 9 players, and the payoff as a pluggable function of each terminal's chips.

What is the same as pf_game: the 169 classes with class-level card removal, one size a raise (pf_game.Sizes), the
DCFR solve level by level (Game's iterate, _down, _up and _masses are pf_game's), the flop paid by a realization
model's pot shares, three-way pots by pf_game's three-way equity and MW_REALIZE, rake on a pot that sees a flop. With
every stack equal and the default options the tree and every terminal value are pf_game's (tests/test_pf_engine.py).

What is new:

* **Each seat's own stack** (`stacks`, bb before antes). A raise is capped at the biggest stack still able to call it,
  goes all-in from Sizes.jam_frac of the most it can put at risk (its own stack, or the deepest stack left to call), and a shorter stack facing a bigger bet calls all-in for
  less. Chips are paid by pot layers: each level of the active players' investments is a pot contested by those who
  reached it (the main pot by everyone in, a side pot by the deeper players, an uncalled excess back to its owner),
  folded players' chips going into the layers they reached. A heads-up flop is valued at the shorter of the two
  stacks' depth (the realization model's depth factor: engine.pf_model). A three-way all-in's side pot is decided by
  the two eligible players' heads-up equity.
* **A smaller tree** (`cold4=False`): once the pot has been 3bet, a player who hasn't put chips in voluntarily can only
  fold (no cold 4bets or cold calls of a 3bet), so 7-9 handed trees fit in memory (9-handed: ~9k nodes instead of
  109k with at most two to a flop).
* **Tree options** (2026-11-13, the tree builder): `limps` lets any seat limp first in or over-limp (call the big
  blind) while fewer than `max_players` are in, the big blind then checking or raising, a raise over limpers going to
  the seat's open plus 1bb a limper (the small blind's sb_open, the big blind's Sizes.iso, plus 1bb a limper past the
  first); never with a straddle. `opens` gives a seat its own open size (bb, first in; the 3bet sizes then scale from
  it). Both off, the tree is the one before (tests/test_pf_engine.py).
* **More tree options** (2026-11-17): `sizing="chart"` sizes every raise as the charts do (gto/advisor.py
  _default_size and _legal_to: an open at 2.5bb, the small blind's 3bb; a 3bet 3x the bet, 4x from a seat that posted,
  the big blind's over a small-blind open 10/3x; a 4bet or more 2.3x; each plus every other live player's chips beyond
  what they posted, save the last raiser's; to the nearest half big blind, half to even, at least the smallest full
  raise), so a cold 4bet over an open and a 3bet goes to 20bb, not the tree's 17.25bb. `straddler` puts the straddle on
  another seat than the first (a Mississippi straddle from the button, or any seat but the blinds): it posts 2bb, the
  action starts left of the big blind with the straddler skipped, and it acts last once everyone else has acted.
  `five` is the 5bet's rule: None all-in (as before; with the charts' sizes, theirs: 2.3x, all-in where it would
  commit the stack), 0 no 5bet (facing a 4bet, call or fold), x > 0 a 5bet to x times the 4bet with the 6bet all-in.
  A 5bet pot that sees a flop is valued as a 4bet pot.
* **The payoff** (`payoff`, ChipPayoff by default): a function of each seat's chip result at a terminal outcome. Chip
  EV is linear and exact. A nonlinear payoff (prize equity) is evaluated per outcome: at a heads-up terminal each of
  the two winners (a folded seat's utility weighted by the pot's chance to go each way, taken over the two players'
  ranges), at a three-way terminal the main pot's winner (a side pot to the main pot's winner where eligible, else to
  the deeper of the two others). ICM itself isn't here: it plugs in as another Payoff.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from gto import pf_game as G
from gto.pf_classes import CLASSES, PAIR_COMPAT, equity_matrix

K = len(CLASSES)


# ----------------------------------------------------------------------------- payoff
class ChipPayoff:
    """Chip EV: a seat's utility is its chip result (bb won, net of what it put in)."""
    linear = True

    def utility(self, delta: np.ndarray, node: G.Node) -> np.ndarray:
        """Each seat's utility for chip results `delta` (n,) at terminal `node`."""
        return delta


# ----------------------------------------------------------------------------- the tree
def build(positions: Sequence[str], stacks: Sequence[float], sizes: Optional[G.Sizes] = None,
          max_players: int = 3, max_players_raised: int = 2, sb_limp: bool = False, ante: float = 0.0,
          straddle: bool = False, cold4: bool = True, limps: bool = False,
          opens: Optional[Dict[str, float]] = None, sizing: str = "tree", straddler: Optional[str] = None,
          five: Optional[float] = None) -> G.Node:
    """pf_game.build with each seat's own stack (`stacks`, bb before the ante, in `positions` order), `cold4`
    (False: from the 3bet on, a player who hasn't put chips in voluntarily only folds), `limps` (any seat may limp
    first in or over-limp; not with a straddle), `opens` (a position's own open size, bb), `sizing` ("tree" or
    "chart": the charts' raise sizes), `straddler` (the straddle's seat, the first by default; not a blind) and
    `five` (the 5bet: None all-in, 0 none, x > 0 a raise to x times the 4bet)."""
    sizes = sizes or G.Sizes()
    n = len(positions)
    pos = list(positions)
    sb, bb = (n - 2, n - 1) if n > 2 else (0, 1)
    straddle = bool(straddle) and n >= 3
    st_seat = pos.index(straddler) if straddle and straddler in pos else 0
    if straddle and st_seat in (sb, bb):
        raise ValueError("a blind can't straddle")
    limps = bool(limps) and not straddle
    chart = sizing == "chart"
    open_of = {} if chart else {pos.index(p): float(v) for p, v in (opens or {}).items() if p in pos}
    # raises allowed in all: open, 3bet, 4bet, then a 5bet all-in; with a sized 5bet (or the charts' rule, which sizes
    # a 5bet as a 4bet and jams it when it would commit the stack) a 6bet all-in too
    max_raises = 3 if five == 0 else 5 if (five or chart) else 4
    jam_5bet = five is None and not chart
    stk = [float(s) - ante for s in stacks]       # what each has to bet after the ante
    rank = G.post_rank(pos)
    posted = [0.0] * n
    posted[sb] += 0.5
    posted[bb] += 1.0
    if straddle:
        posted[st_seat] += 2.0
    posted = [min(p, s) for p, s in zip(posted, stk)]
    blinds = {sb, bb} | ({st_seat} if straddle else set())

    def chart_to(p, cur, n_raises, last, bets, live, min_raise):
        """gto/advisor.py _default_size, then _legal_to's rounding (half to even) and smallest raise."""
        extra = sum(max(0.0, bets[r] - posted[r]) for r in live if r != p and r != last)
        if n_raises == 0:
            to = cur * (4.0 if p in blinds else 3.0) + extra if extra > 0 else (3.0 if p == sb else 2.5) * cur
        elif n_raises == 1:
            if p == bb and last == sb and extra == 0:
                to = cur * (10.0 / 3.0)
            else:
                to = cur * (4.0 if p in blinds else 3.0) + extra
        else:
            to = cur * 2.3 + extra
        lo = np.ceil((cur + min_raise) * 2 - 1e-9) / 2
        return max(round(float(to) * 2) / 2, lo)

    def raise_to(p, cur, n_raises, last, callers, bets, limpers=0):
        if n_raises == 3 and five:
            return cur * five + callers * cur
        if n_raises == 0:
            if p == bb and not straddle:
                return sizes.iso + max(0, limpers - 1) * cur
            base = open_of.get(p, sizes.sb_open if p == sb else sizes.open)
            return base * cur + limpers * cur
        if n_raises == 1:
            if p == sb and last == bb and abs(bets[sb] - 1.0) < 1e-9:
                return cur * sizes.limp_3bet
            if p == bb and last == sb:
                x = sizes.bvb_3bet
            elif p in (sb, bb):
                x = sizes.blind_3bet
            else:
                x = sizes.ip_3bet
            return cur * x + callers * cur
        if n_raises == 2:
            ip = rank[p] > rank[last]
            x = (sizes.four_x_ip if ip else sizes.four_x_oop) or sizes.four_x
            return cur * x + callers * cur
        return stk[p]

    def allin(q, bets):
        return bets[q] >= stk[q] - 1e-9

    def rec(bets, folded, acted, vol, n_raises, last, p, line):
        live = [q for q in range(n) if q not in folded]
        if len(live) == 1:
            return G.Node("fold", inv=np.array(bets) + ante, active=tuple(live), n_raises=n_raises, line=line)
        cur = max(bets)
        order = [(p + k) % n for k in range(n)]
        if straddle and st_seat != 0:
            # the straddler is skipped until everyone else has had a move, then acts at once (Mississippi rules); with
            # the straddle on the first seat that is the seat order itself, so that tree is unchanged
            moved = {m[0] for m in line}
            if pos[st_seat] not in moved:
                waiting = [r for r in range(n) if r != st_seat and r not in folded and not allin(r, bets)
                           and pos[r] not in moved]
                order = [q for q in order if q != st_seat]
                if not waiting:
                    order = [st_seat] + order
        nxt = next((q for q in order if q not in folded and not allin(q, bets)
                    and (q not in acted or bets[q] < cur - 1e-9)), None)
        behind = [q for q in live if not allin(q, bets)]
        if nxt is not None and len(behind) == 1 and bets[nxt] >= cur - 1e-9:
            nxt = None                              # the one player with chips has matched: nobody left to bet against
        if nxt is None:
            return G.Node("show", inv=np.array(bets) + ante, active=tuple(live), n_raises=n_raises, aggressor=last,
                          allin=len([q for q in live if not allin(q, bets)]) <= 1, line=line)
        q = nxt
        names, kids = [], []
        cold = (not cold4) and n_raises >= 2 and q not in vol
        if bets[q] < cur - 1e-9:
            names.append("fold")
            kids.append(rec(bets, folded | {q}, acted | {q}, vol, n_raises, last, q + 1,
                            line + ((pos[q], "fold", 0.0),)))
        if n_raises == 0 and limps:
            # open-limps and over-limps: a seat facing the big blind calls it while fewer than max_players are in;
            # the big blind with limpers in checks (its "call" puts nothing in)
            in_pot = sum(1 for r in live if bets[r] >= cur - 1e-9)
            if bets[q] >= cur - 1e-9 or in_pot < max_players:
                b2 = list(bets); b2[q] = min(cur, stk[q])
                names.append("call")
                kids.append(rec(b2, folded, acted | {q}, vol | ({q} if bets[q] < cur - 1e-9 else set()), 0, last,
                                q + 1, line + ((pos[q], "call", b2[q]),)))
        elif n_raises == 0 and sb_limp and not straddle and q in (sb, bb) \
                and all(x in folded for x in range(n) if x not in (sb, bb)) and bets[q] < cur + 1e-9:
            if q == sb or sb in acted:
                b2 = list(bets); b2[q] = min(cur, stk[q])
                names.append("call")
                kids.append(rec(b2, folded, acted | {q}, vol | {q}, 0, last, q + 1, line + ((pos[q], "call", b2[q]),)))
        if n_raises > 0 and not cold:
            in_level = sum(1 for r in live if bets[r] >= cur - 1e-9 or allin(r, bets))
            cap = max_players if n_raises == 1 else max_players_raised
            eff_last = min(stk[last], max(stk[r] for r in live if r != last))
            if cur >= eff_last - 1e-9 or min(cur, stk[q]) >= stk[q] - 1e-9:
                cap = max(cap, 3)                   # calling an all-in (or all-in to call): a showdown, up to three
            if in_level < cap:
                b2 = list(bets); b2[q] = min(cur, stk[q])
                names.append("call")
                kids.append(rec(b2, folded, acted | {q}, vol | {q}, n_raises, last, q + 1,
                                line + ((pos[q], "call", b2[q]),)))
        others = [r for r in live if r != q]
        reach_max = max(stk[r] for r in others)     # nobody can call more than this
        eff = min(stk[q], reach_max)                # the most this raise can put at risk
        # (no raise over three all-ins: up to three go to a showdown, as a call's cap has it; only unequal stacks get here)
        three_in = sum(1 for r in others if allin(r, bets)) >= 3
        if not cold and cur < stk[q] - 1e-9 and n_raises < max_raises and reach_max > cur + 1e-9 and not three_in:
            callers = sum(1 for r in live if r != last and r != q and bets[r] >= cur - 1e-9) if n_raises > 0 else 0
            limpers = sum(1 for r in live if r != q and r in vol) if n_raises == 0 else 0
            if chart:
                tos = [m[2] for m in line if m[1] in ("raise", "all-in")]
                to = chart_to(q, cur, n_raises, last, bets, live, max([1.0] + [y - x for x, y in zip([1.0] + tos, tos)]))
                # the charts' all-in (gto/advisor.py Advisor's preflop answer): a raise putting in COMMIT (0.4) of the
                # stack, or leaving under JAM_SPR pots behind once called (JAM_SPR_DEEP at 80bb and deeper), or an
                # open at PUSH_FOLD_STACK (12bb) or shorter
                pot_called = sum(bets) + ante * n + 2 * to - bets[q] - cur
                spr_bar = 1.25 if stk[q] + ante >= 80.0 - 1e-9 else 1.5
                jam = (to >= sizes.jam_frac * stk[q] or stk[q] - to < spr_bar * pot_called
                       or (n_raises == 0 and stk[q] + ante <= 12.0 + 1e-9))
            else:
                to = raise_to(q, cur, n_raises, last, callers, bets, limpers)
                jam = to >= sizes.jam_frac * eff
            if jam or to >= eff - 1e-9 or (n_raises == 3 and jam_5bet) or n_raises == 4:
                to = eff
            to = min(to, eff)
            if to > cur + 1e-9:
                b2 = list(bets); b2[q] = to
                names.append("all-in" if to >= eff - 1e-9 else "raise")   # covering everyone left: all-in in effect
                kids.append(rec(b2, folded, {q}, vol | {q}, n_raises + 1, q, q + 1, line + ((pos[q], names[-1], to),)))
        if not names:                               # (can't happen: a player to act always has fold or call)
            raise AssertionError("a decision with no action")
        return G.Node("dec", player=q, names=names, children=kids, n_raises=n_raises, line=line)

    first = 0 if n > 2 else sb
    if straddle and st_seat == 0:
        first = 1
    return rec(list(posted), frozenset(), frozenset(), frozenset(), 0, -1, first, ())


def layers(inv: np.ndarray, active: Sequence[int]) -> List[Tuple[float, Tuple[int, ...]]]:
    """A terminal's pots: [(chips, the active seats contesting them)], the main pot first; each level of the active
    seats' investments takes every seat's chips up to it (folded seats' included)."""
    levels = sorted({float(inv[q]) for q in active})
    out, prev = [], 0.0
    for lv in levels:
        amt = float(np.clip(inv, prev, lv).sum() - np.clip(inv, prev, prev).sum())
        elig = tuple(q for q in active if inv[q] >= lv - 1e-9)
        if amt > 1e-12:
            out.append((amt, elig))
        prev = lv
    top = float(inv.max())
    if top > prev + 1e-9:                          # (folded chips above every active level: can't happen in this tree)
        out.append((float(np.clip(inv, prev, top).sum() - np.clip(inv, prev, prev).sum()), (max(active, key=lambda q: inv[q]),)))
    return out


# ----------------------------------------------------------------------------- the game
class Game(G.Game):
    """pf_game.Game on engine.pf_engine's tree: per-seat stacks (pot layers, each heads-up flop at its effective depth),
    and the payoff. `model_at(depth)` gives the realization model at a stack depth (engine.pf_model.flop_model)."""

    def __init__(self, root: G.Node, positions: Sequence[str], model_at, stacks: Sequence[float],
                 rake: Optional[Tuple[float, Optional[float]]] = None, payoff=None, ante: float = 0.0,
                 root_reach: Optional[np.ndarray] = None):
        self.stacks = np.asarray(stacks, float)
        self.ante = float(ante)
        self.model_at = model_at
        self.payoff = payoff or ChipPayoff()
        self._models: Dict[float, G.EQRModel] = {}
        super().__init__(root, positions, self._model(float(self.stacks.min())), float(self.stacks.max()), rake,
                         root_reach)

    def _model(self, depth: float) -> G.EQRModel:
        d = round(depth, 1)
        m = self._models.get(d)
        if m is None:
            m = self._models[d] = self.model_at(d)
        return m

    def _pe(self, pot: float, behind: float) -> float:
        return self._pot_eff(pot, behind)

    def _prep_terminals(self):
        nodes, n = self.nodes_all, self.n
        terms = [k for k, nd in enumerate(nodes) if nd.kind != "dec"]
        self.terms = np.array(terms)
        self.inv = np.array([nodes[k].inv for k in terms])                   # (T, n), antes in
        pot = self.inv.sum(1)
        self.t_active = np.array([[q in nodes[k].active for q in range(n)] for k in terms])
        is_fold = np.array([nodes[k].kind == "fold" for k in terms])
        pay = np.zeros_like(self.inv)
        stk = self.stacks
        lin = self.payoff.linear
        self.fold_split = []                   # (row, a, c, U_q if a wins, U_q if c wins) for folded seats, nonlinear
        groups: Dict[tuple, list] = {}
        three = []
        for r, k in enumerate(terms):
            nd = nodes[k]
            inv = self.inv[r]
            if nd.kind == "fold":
                w = nd.active[0]
                delta = -inv.copy()
                delta[w] += pot[r]
                pay[r] = self.payoff.utility(delta, nd)
                continue
            act = list(nd.active)
            behind = float(min(stk[q] - inv[q] for q in act))
            pe = self._pe(float(pot[r]), max(behind, 0.0))
            f = pe / float(pot[r])                  # rake comes off every layer alike
            L = layers(inv, act)
            if len(act) == 2:
                if nd.allin:
                    a, c = act
                    key = ("allin",)
                elif nd.n_raises == 0:
                    a = max(act, key=lambda q: self.post_rank[q])
                    c = act[0] if act[1] == a else act[1]
                    key = G.LIMP_KEY + (self.positions[a], self.positions[c])
                else:
                    a = nd.aggressor
                    c = act[0] if act[1] == a else act[1]
                    key = (min(nd.n_raises, 3), self.post_rank[a] > self.post_rank[c],
                           self.positions[a], self.positions[c])
                depth = float(min(stk[a], stk[c]))
                # chips if a wins everything a can, and if c does (uncalled excess back to its owner either way)
                da, dc = -inv.copy(), -inv.copy()
                for amt, el in L:
                    if a in el:
                        da[a] += amt * f
                    if c in el:
                        dc[c] += amt * f
                    if a not in el:                 # a layer a can't win goes to c in both outcomes
                        da[c] += amt * f
                    if c not in el:
                        dc[a] += amt * f
                ua, uc = self.payoff.utility(da, nd), self.payoff.utility(dc, nd)
                gk = key + (round(depth, 1),) if key != ("allin",) else key
                groups.setdefault(gk, []).append((r, a, c, ua[a] - uc[a], uc[a], uc[c] - ua[c], ua[c]))
                for q in range(n):
                    if q not in act:
                        pay[r, q] = uc[q]
                if not lin and np.any(np.abs(ua - uc)[[q for q in range(n) if q not in act]] > 1e-12):
                    self.fold_split.append((r, a, c, ua, uc, gk))
            else:
                ranks = sorted(act, key=lambda q: self.post_rank[q])[:3]
                place = "last" if nd.aggressor == ranks[-1] else "middle"
                fac = [1.0 if nd.allin else G.MW_REALIZE[place][0 if j == 0 else 2 if j == len(ranks) - 1 else 1]
                       for j in range(len(ranks))]
                main_amt = L[0][0] * f
                pair = [(amt * f, el) for amt, el in L[1:] if len(el) == 2]
                sure = [(amt * f, el) for amt, el in L[1:] if len(el) == 1]
                side_amt, side_x, side_y = (pair[0][0], ranks.index(pair[0][1][0]), ranks.index(pair[0][1][1])) \
                    if pair else (0.0, 0, 1)
                # per main winner m: each seat's utility; Um leaves the two-player side pot out (chips add it by the
                # two players' heads-up equity), Uf gives it to m where eligible, else to the deeper of the two
                Um, Uf = [], []
                for m in ranks:
                    d = -inv.copy()
                    d[m] += main_amt
                    for amt, el in sure:
                        d[el[0]] += amt
                    Um.append(d.copy())
                    for amt, el in pair:
                        d[m if m in el else max(el, key=lambda q: inv[q])] += amt
                    Uf.append(d)
                Um = np.array([self.payoff.utility(d, nd) for d in Um]) if lin else None
                Uf = np.array([self.payoff.utility(d, nd) for d in Uf])
                for q in range(n):
                    if q not in act:
                        pay[r, q] = Uf[:, q].mean()   # (chips: every row the same)
                three.append((r, ranks, fac, Um if lin else Uf, side_amt, side_x, side_y))
        self.pay = pay
        self.f_rows = np.nonzero(is_fold)[0]
        eq = equity_matrix()
        self.hu = []
        for gk, rows in groups.items():
            if gk == ("allin",):
                S = PAIR_COMPAT * eq
            else:
                S = PAIR_COMPAT * self._model(gk[-1]).share(gk[:-1])
            R = np.array(rows)
            self.hu.append((gk, S, R[:, 0].astype(int), R[:, 1].astype(int), R[:, 2].astype(int),
                            R[:, 3], R[:, 4], R[:, 5], R[:, 6]))
        self.three = None
        if three:
            rows = np.array([x[0] for x in three])
            act = np.array([x[1] for x in three])
            U = np.array([x[3][:, x[1]] for x in three])          # (T3, winner k, seat k'): act's seats only
            self.three = (rows, act, np.array([x[2] for x in three]), U, np.array([x[4] for x in three]),
                          np.array([x[5] for x in three]), np.array([x[6] for x in three]))
        self.s_rows = np.nonzero(~is_fold)[0]

    def _term_values(self, reach: np.ndarray, V: np.ndarray):
        T = self.terms
        RT = reach[T]
        m = self._masses(reach)[T]
        out = np.empty_like(m)
        out[:, 0] = 1.0
        np.cumprod(m[:, :-1], axis=1, out=out[:, 1:])
        suf = np.empty_like(m)
        suf[:, -1] = 1.0
        np.cumprod(m[:, :0:-1], axis=1, out=suf[:, -2::-1])
        out *= suf
        out *= self.pay[:, :, None]
        fold_f = np.prod(m, axis=1, where=~self.t_active[:, :, None])
        Sof = {}
        for gk, S, rows, a, c, wa, ka, wc, kc in self.hu:
            Sof[gk] = S
            ra, rc = RT[rows, a], RT[rows, c]
            ma, mc = m[rows, a], m[rows, c]
            ff = fold_f[rows]
            win_a = G._live_mm(rc, lambda x: G._mm(x, S.T))           # (rows, K): a's class against c's range
            win_c = ma - G._live_mm(ra, lambda x: G._mm(x, S))
            out[rows, a] = (wa[:, None] * win_a + ka[:, None] * mc) * ff
            out[rows, c] = (wc[:, None] * win_c + kc[:, None] * ma) * ff
        for r, a, c, ua, uc, gk in self.fold_split:
            # a folded seat's utility by the chance the pot goes to a, over the two players' ranges (card removal
            # against the folded seat's own class not taken: the chips are the same either way)
            S = Sof[gk]
            ra, rc = RT[r, a], RT[r, c]
            tot = float(ra @ PAIR_COMPAT @ rc)
            p = float(ra @ S @ rc) / tot if tot > 1e-300 else 0.5
            for q in range(self.n):
                if q != a and q != c:
                    others = [x for x in range(self.n) if x != q]
                    prod = np.prod([m[r, x] for x in others], axis=0)
                    out[r, q] = (p * ua[q] + (1 - p) * uc[q]) * prod
        if self.three is not None:
            rows, act, fac, U, side_amt, sx, sy = self.three
            E = PAIR_COMPAT * equity_matrix()
            corr = G.three_way_corr()
            T3 = np.arange(len(rows))
            er = np.stack([G._live_mm(RT[rows, act[:, k]], lambda x: G._mm(x, E.T)) for k in range(3)], 1)  # (T3,3,K)
            ms = np.stack([m[rows, act[:, k]] for k in range(3)], 1)
            ff = fold_f[rows]
            shares, masses = [], []
            for k in range(3):
                o = [j for j in range(3) if j != k]
                shares.append(corr * er[:, o[0]] * er[:, o[1]])
                masses.append(ms[:, o[0]] * ms[:, o[1]])
            own = [RT[rows, act[:, k]] for k in range(3)]
            tot = sum((own[k] * shares[k]).sum(1) for k in range(3))
            mass = sum((own[k] * masses[k]).sum(1) for k in range(3)) / 3
            norm = np.where(tot > 1e-300, mass / np.maximum(tot, 1e-300), 1.0)[:, None]
            has_side = side_amt > 1e-12
            for k in range(3):
                o = [j for j in range(3) if j != k]
                win = shares[k] * norm * fac[:, k][:, None]          # (T3, K): seat k's mass-weighted main-pot wins
                u_win = U[:, k, k][:, None]
                u_lose = U[:, o, k].mean(1)[:, None]                 # (chips: both the same)
                val = (u_win - u_lose) * win + u_lose * masses[k]
                if self.payoff.linear and has_side.any():
                    # the side pot between the two deeper players by their heads-up equity (times the third's mass)
                    is_x, is_y = sx == k, sy == k
                    other = np.where(is_x, sy, sx)
                    third = 3 - sx - sy
                    elig = (is_x | is_y) & has_side
                    if elig.any():
                        hu = er[T3, other] * ms[T3, third]           # k's class: wins against the other, third's mass
                        val = val + np.where(elig[:, None], side_amt[:, None] * hu, 0.0)
                out[rows, act[:, k]] = val * ff
        V[T] = out
