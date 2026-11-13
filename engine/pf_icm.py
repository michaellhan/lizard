"""A tournament's preflop solved in prize equity: the class-level preflop game (solver/gto/pf_game.py) with each seat's
own stack and ante, every outcome paid by the tournament's prize model (solver/gto/icm.py Model: Malmuth-Harville over
the table and stand-ins for the other tables, bounties by the proportional model) in chip equivalents.

The tree (build): pf_game.build's, with stacks that differ by seat. An unopened pot is folded, raised to one size or,
from an effective stack of JAM_OPEN or less, moved all in as well (push/fold's jam beside the open); the small blind
folded to may also complete (sb_limp) and the big blind then checks, raises or jams. Facing a raise a player folds,
calls or raises once more, a raise that would put in jam_frac of its stack or more going all in; at most `max_players`
see a single-raised flop and two a raised one, three may call an all-in. No bet is bigger than the deepest other stack
still in can call (the rest wouldn't be in play), and a call for less is all in. `pushfold=True` is the push/fold game
(fold or all in first in, then fold or call), the one advisor.py's push/fold equilibrium plays.

Terminal values: every way a terminal can end is priced in prize equity (Model.value: the equity's change from the
start of the hand, times the chips in play over the prizes, so a winner-take-all is chips exactly; with bounties, each
bust's cash to whoever took the last chips). A fold: the pot to the one left. A pot that sees a flop or an all-in: the
outcomes "this player's hand is best" (with side pots, each order of the hands), weighted per class by the same pot
shares as the chip game (all-in equity, or the realization model's share at a flop, pf_game.EQRModel): a player's
value is linear in its share, the pot won at one end and lost at the other. Players not in the pot are paid too (in
prize equity a bust at the table is worth something to everyone else): by the players' range-average shares. What the
model leaves out: a pot that sees a flop is won or lost as it stands, its stacks behind kept (the chips that go in after
the flop aren't priced in prize equity), and which opponent wins a pot a player loses three ways is by the two's average
shares, not by the player's own hand.

ICMGame is pf_game.Game (its discounted CFR, its average strategy and its exploitability, now in chip equivalents of
prize equity) with these terminals. Without a prize model (icm=None) it plays chips: the same game as pf_game's at equal
stacks (scripts/engine/test_pf_icm.py checks the two agree), the reference for the ICM-against-chips change.
"""
from __future__ import annotations

import itertools
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from gto import pf_game as G
from gto.pf_classes import CLASSES, PAIR_COMPAT, equity_matrix

K = len(CLASSES)
JAM_OPEN = 25.0        # an unopened pot can be jammed beside the open from this effective stack (bb) or less
EPS = 1e-9


@dataclass
class Sizes(G.Sizes):
    """pf_game's sizes: 2.5bb opens, 3bb from the small blind, 3bets to 3x, 4.8x from a blind (12bb), 10bb in the big blind
    over the small blind, all on the half big blind. They're the sizes the charts Practice's opponents play, so a stored
    preset's preflop (engine/pf_icm_stored.py) lines up with Practice's table (a 2.2bb open, as solved MTT charts have it,
    left every hand facing a chart's 2.5bb open off the tree: scripts/pf_icm/coverage.py). `small_open` (off by default):
    a smaller open from an effective stack of `small_open_at` bb or less."""
    small_open: Optional[float] = None
    small_open_at: float = 25.0


# ----------------------------------------------------------------------------- the tree
def build(positions: Sequence[str], stacks: Sequence[float], antes: Sequence[float] = (), sizes: Optional[Sizes] = None,
          max_players: int = 3, max_players_raised: int = 2, sb_limp: bool = True, jam_open: float = JAM_OPEN,
          pushfold: bool = False, allin_players: int = 3, cold4: bool = True) -> G.Node:
    """The preflop tree for `positions` in seating order (the last two the blinds; heads-up SB, BB), each seat's
    `stacks` (bb at the start of the hand, its ante included) and `antes` (each seat's dead money, bb: a big blind
    ante is the big blind's alone). Nodes as pf_game's: a terminal's `inv` is every seat's chips in (antes included).
    `cold4=False` (7 or more players, as engine/pf_engine.py's): once the pot has been raised twice, a player who hasn't
    put chips in voluntarily only folds (no cold 4bets, no cold calls of a 3bet or of a jam over a raise)."""
    sizes = sizes or Sizes()
    n = len(positions)
    pos = list(positions)
    antes = list(antes) if len(antes) else [0.0] * n
    sb, bb = (n - 2, n - 1) if n > 2 else (0, 1)
    rank = G.post_rank(pos)
    cap = [max(float(stacks[q]) - float(antes[q]), 0.0) for q in range(n)]     # what each can bet
    ante = np.array(antes, dtype=float)

    def eff(q, live):
        """q's effective stack: its own, capped by the deepest other seat still in."""
        others = [cap[r] for r in live if r != q]
        return min(cap[q], max(others)) if others else cap[q]

    def raise_to(p, cur, n_raises, last, callers, bets, live):
        if n_raises == 0:
            if p == bb:                          # over a small-blind limp
                return sizes.iso
            if p == sb:
                return sizes.sb_open * cur
            small = getattr(sizes, "small_open", None)
            if small is not None and eff(p, live) <= sizes.small_open_at + EPS:
                return small * cur
            return sizes.open * cur
        if n_raises == 1:
            if p == sb and last == bb and abs(bets[sb] - 1.0) < EPS:
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
        return float("inf")

    def rec(bets, folded, acted, n_raises, last, p, line, vol=frozenset()):
        live = [q for q in range(n) if q not in folded]
        if len(live) == 1:
            return G.Node("fold", inv=np.array(bets) + ante, active=tuple(live), n_raises=n_raises, line=line)
        cur = max(bets)
        order = [(p + k) % n for k in range(n)]
        nxt = next((q for q in order if q not in folded and bets[q] < cap[q] - EPS
                    and (q not in acted or bets[q] < cur - EPS)), None)
        # (nobody left to act; or only one player with chips, who has matched every bet: nothing more to bet)
        if nxt is not None and bets[nxt] >= cur - EPS and all(bets[r] >= cap[r] - EPS for r in live if r != nxt):
            nxt = None
        if nxt is None:
            allin = any(bets[q] >= cap[q] - EPS for q in live)
            return G.Node("show", inv=np.array(bets) + ante, active=tuple(live), n_raises=n_raises, aggressor=last,
                          allin=allin, line=line)
        q = nxt
        top = eff(q, live)                       # the most q can usefully put in
        names, kids = [], []
        cold = (not cold4) and n_raises >= 2 and q not in vol
        if bets[q] < cur - EPS:
            names.append("fold")
            kids.append(rec(bets, folded | {q}, acted | {q}, n_raises, last, q + 1, line + ((pos[q], "fold", 0.0),), vol))
        if cold:
            return G.Node("dec", player=q, names=names, children=kids, n_raises=n_raises, line=line)
        if n_raises == 0 and sb_limp and not pushfold and q in (sb, bb) \
                and all(x in folded for x in range(n) if x not in (sb, bb)) and bets[q] < cur + EPS:
            # the small blind completes, or the big blind checks behind its limp ("call": a flop at 1bb each)
            if (q == sb or sb in acted) and cur < cap[q] - EPS:
                b2 = list(bets); b2[q] = cur
                names.append("call")
                kids.append(rec(b2, folded, acted | {q}, 0, last, q + 1, line + ((pos[q], "call", cur),), vol | {q}))
        if n_raises > 0:
            # (the players in the pot at this level: who has matched it, and who is all in for less)
            in_level = sum(1 for r in live if bets[r] >= cur - EPS or bets[r] >= cap[r] - EPS)
            c_cap = max_players if n_raises == 1 else max_players_raised
            # (the raise is all in, or as much as anyone still in can call, or q's call is all in)
            facing_allin = last >= 0 and bets[last] >= eff(last, live) - EPS
            if facing_allin or cur >= cap[q] - EPS:
                c_cap = max(c_cap, allin_players)    # (calling an all-in: a showdown, up to three, as pf_game)
            if in_level < c_cap:
                b2 = list(bets); b2[q] = min(cur, cap[q])
                names.append("call")
                kids.append(rec(b2, folded, acted | {q}, n_raises, last, q + 1, line + ((pos[q], "call", b2[q]),),
                                vol | {q}))
        # (a raise keeps every player all in for less in the pot, as they can't fold: with allin_players of them already
        # in, a raise would make a bigger showdown than the game values, so q calls or folds)
        all_in = sum(1 for r in live if r != q and bets[r] >= cap[r] - EPS)
        if top > cur + EPS and n_raises < 4 and all_in < allin_players \
                and any(bets[r] < cap[r] - EPS for r in live if r != q):
            callers = sum(1 for r in live if r != last and r != q and bets[r] >= cur - EPS) if n_raises > 0 else 0
            if pushfold and n_raises == 0:
                to = top
            elif pushfold:
                to = None                        # (push/fold: facing a jam, fold or call)
            else:
                to = raise_to(q, cur, n_raises, last, callers, bets, live)
                if to >= sizes.jam_frac * cap[q] or n_raises == 3 or to >= top - EPS:
                    to = top
            if to is not None:
                b2 = list(bets); b2[q] = to
                nm = "all-in" if to >= top - EPS else "raise"
                names.append(nm)
                kids.append(rec(b2, folded, {q}, n_raises + 1, q, q + 1, line + ((pos[q], nm, to),), vol | {q}))
                # beside a raise first in, the jam (shallow): push/fold's option kept in the tree
                if nm == "raise" and n_raises == 0 and top <= jam_open + EPS:
                    b3 = list(bets); b3[q] = top
                    names.append("all-in")
                    kids.append(rec(b3, folded, {q}, 1, q, q + 1, line + ((pos[q], "all-in", top),), vol | {q}))
        return G.Node("dec", player=q, names=names, children=kids, n_raises=n_raises, line=line)

    bets = [0.0] * n
    bets[sb] = min(0.5, cap[sb])
    bets[bb] = min(1.0, cap[bb])
    first = 0 if n > 2 else sb
    return rec(bets, frozenset(), frozenset(), 0, -1, first, ())


# ----------------------------------------------------------------------------- outcomes
def outcome(put: np.ndarray, active: Sequence[int], order: Sequence[int]) -> np.ndarray:
    """Chips each seat takes from the pot when the active seats' hands rank in `order` (best first): pot by pot, from
    the smallest all-in up, each to the best hand among the seats whose chips reach it (folded seats' chips are in
    every pot they reach, any above the top one in the top one)."""
    won = np.zeros(len(put))
    levels = sorted({float(put[q]) for q in active})
    prev = 0.0
    for li, lv in enumerate(levels):
        amt = float(np.sum(np.minimum(put, lv) - np.minimum(put, prev)))
        if li == len(levels) - 1:
            amt += float(np.sum(np.maximum(put - lv, 0.0)))      # (dead money above the top level)
        elig = [q for q in active if put[q] >= lv - EPS]
        w = next(q for q in order if q in elig)
        won[w] += amt
        prev = lv
    return won


def busts(stacks: np.ndarray, put: np.ndarray, won: np.ndarray, active: Sequence[int], order: Sequence[int]) -> list:
    """[(busted seat, winner seat)]: an active seat left with nothing, and who won the pot its last chips were in."""
    out = []
    for p in active:
        if stacks[p] - put[p] + won[p] <= 1e-6:
            elig = [q for q in active if put[q] >= put[p] - EPS]
            w = next(q for q in order if q in elig)
            if w != p:
                out.append((p, w))
    return out


class Chips:
    """Chips as the payoff (no tournament): an outcome's value is the chips won less those put in."""
    bounty = None

    def __init__(self, stacks: Sequence[float]):
        self.stacks = np.asarray(stacks, dtype=float)

    def values(self, puts: np.ndarray, wons: np.ndarray, kos) -> np.ndarray:
        return wons - puts


class Prizes:
    """A tournament's payoff: icm.Model.value_batch by seat order (positions), chip equivalents of prize equity."""

    def __init__(self, model, positions: Sequence[str]):
        if list(model.seats) != list(positions):
            raise ValueError("the prize model's seats aren't the table's")
        self.model = model
        self.positions = list(positions)
        self.stacks = np.array([model.stacks[p] for p in positions], dtype=float)
        self.bounty = model.bounty

    def values(self, puts: np.ndarray, wons: np.ndarray, kos) -> np.ndarray:
        if not len(puts):
            return np.zeros((0, len(self.positions)))
        k = None
        if self.bounty is not None:
            k = [[(self.positions[b], {self.positions[w]: 1.0}) for b, w in ko] for ko in kos]
        with np.errstate(all="ignore"):
            return self.model.value_batch(puts, wons, k)


# ----------------------------------------------------------------------------- the game
class ICMGame(G.Game):
    """pf_game.Game on build()'s tree with every terminal priced by `payoff` (Prizes or Chips): see the module's doc.
    Up to four actions a node (the open, the jam, a limp and a fold); otherwise Game's arrays and solve.

    bystanders=False (a check, not the model): a seat not in a pot that sees a flop or an all-in is paid as if the pot
    were shared by the players in it, so it gains nothing when they bust each other; the push/fold equilibrium the advice
    uses (pf_classes.push_fold) prices folding that way."""

    bystanders: bool = True

    def __init__(self, root: G.Node, positions: Sequence[str], model: G.EQRModel, payoff, stack: float = 100.0):
        self.payoff = payoff
        self.root, self.positions, self.model, self.stack, self.rake = root, list(positions), model, stack, None
        self.root_reach = np.tile(G.PRIOR, (len(self.positions), 1))
        self.n = len(self.positions)
        self.post_rank = G.post_rank(self.positions)
        nodes, parent, act, depth = [root], [-1], [-1], [0]
        i = 0
        while i < len(nodes):
            for a, c in enumerate(nodes[i].children):
                nodes.append(c); parent.append(i); act.append(a); depth.append(depth[i] + 1)
            i += 1
        self.nodes_all = nodes
        for k, nd in enumerate(nodes):
            nd.index = k
        N = self.N = len(nodes)
        self.parent, self.act, self.depth = np.array(parent), np.array(act), np.array(depth)
        self.dec = np.array([k for k, nd in enumerate(nodes) if nd.kind == "dec"])
        self.dec_of = -np.ones(N, dtype=int)
        self.dec_of[self.dec] = np.arange(len(self.dec))
        D = len(self.dec)
        self.A = max(len(nodes[k].children) for k in self.dec)
        self.player = np.array([nodes[k].player for k in self.dec])
        self.ch = np.full((D, self.A), N, dtype=int)
        for d, k in enumerate(self.dec):
            for a, c in enumerate(nodes[k].children):
                self.ch[d, a] = c.index
        self.valid = self.ch < N
        self.regret = np.zeros((D, self.A, K))
        self.ssum = np.zeros((D, self.A, K))
        self.maxd = int(self.depth.max())
        self.by_depth = [np.nonzero(self.depth == d)[0] for d in range(self.maxd + 1)]
        self.dec_by_depth = [self.dec_of[x][self.dec_of[x] >= 0] for x in self.by_depth]
        self._prep_terminals()

    # -------------------------------------------------------------- terminals
    def _prep_terminals(self):
        nodes, n = self.nodes_all, self.n
        terms = [k for k, nd in enumerate(nodes) if nd.kind != "dec"]
        self.terms = np.array(terms)
        T = len(terms)
        self.inv = np.array([nodes[k].inv for k in terms], dtype=float)
        self.t_active = np.array([[q in nodes[k].active for q in range(n)] for k in terms])
        stacks = self.payoff.stacks
        # every outcome to price: (row, which) -> index into one batch
        puts, wons, kos, index = [], [], [], []
        hu_rows, three_rows, groups = [], [], {}
        for r, k in enumerate(terms):
            nd = nodes[k]
            put = self.inv[r]
            act = list(nd.active)
            if nd.kind == "fold":
                won = np.zeros(n); won[act[0]] = put.sum()
                index.append((r, "fold", 0)); puts.append(put); wons.append(won); kos.append([])
                continue
            split = np.zeros(n); split[act] = put.sum() / len(act)
            index.append((r, "split", 0)); puts.append(put); wons.append(split); kos.append([])
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
                groups.setdefault(key, []).append((r, a, c))
                for which, order in (("a", (a, c)), ("c", (c, a))):
                    won = outcome(put, act, order)
                    index.append((r, which, 0)); puts.append(put); wons.append(won)
                    kos.append(busts(stacks, put, won, act, order) if nd.allin else [])
                hu_rows.append(r)
            else:
                if len(act) > 3:
                    raise ValueError(f"a showdown of {len(act)} players: the tree lets three in at most")
                ranks = sorted(act, key=lambda q: self.post_rank[q])
                place = "last" if nd.aggressor == ranks[-1] else "middle"
                fac = [1.0 if nd.allin else G.MW_REALIZE[place][j] for j in range(3)]
                three_rows.append((r, ranks, fac))
                for pi, perm in enumerate(itertools.permutations(range(3))):
                    order = [ranks[j] for j in perm]
                    won = outcome(put, ranks, order)
                    index.append((r, "perm", pi)); puts.append(put); wons.append(won)
                    kos.append(busts(stacks, put, won, ranks, order) if nd.allin else [])
        V = self.payoff.values(np.array(puts).reshape(-1, n), np.array(wons).reshape(-1, n), kos)
        self.pay = np.zeros((T, n))
        VA, VC = np.zeros((T, n)), np.zeros((T, n))
        self.split = np.zeros((T, n))
        VP = {}
        for (r, which, pi), v in zip(index, V):
            if which == "fold":
                self.pay[r] = v
            elif which == "split":
                self.split[r] = v
            elif which == "a":
                VA[r] = v
            elif which == "c":
                VC[r] = v
            else:
                VP.setdefault(r, [None] * 6)[pi] = v
        eq = equity_matrix()
        self.hu = []
        for key, rows in groups.items():
            S = PAIR_COMPAT * (eq if key == ("allin",) else self.model.share(key))
            R = np.array(rows)
            rr = R[:, 0].astype(int)
            self.hu.append((key, S, rr, R[:, 1].astype(int), R[:, 2].astype(int), VA[rr], VC[rr]))
        self.three = None
        if three_rows:
            rr = np.array([x[0] for x in three_rows])
            self.three = (rr, np.array([x[1] for x in three_rows]), np.array([x[2] for x in three_rows]),
                          np.array([VP[r] for r in rr]))           # (T3, 6, n)
        self.s_rows = np.nonzero(~np.array([nodes[k].kind == "fold" for k in terms]))[0]
        self.f_rows = np.nonzero(np.array([nodes[k].kind == "fold" for k in terms]))[0]

    _PERMS = list(itertools.permutations(range(3)))
    _PIDX = {p: i for i, p in enumerate(_PERMS)}

    def _term_values(self, reach: np.ndarray, V: np.ndarray):
        """Each seat's counterfactual value at the terminals, as pf_game's, every outcome at its prize value: the
        seats in the pot by their own pot share, the others by the range-average shares (the module's doc)."""
        T = self.terms
        RT = reach[T]
        m = self._masses(reach)[T]
        pay = self.pay.copy()
        fold_f = np.prod(m, axis=1, where=~self.t_active[:, :, None])
        hu_out = []
        for key, S, rows, a, c, VA, VC in self.hu:
            ra, rc = RT[rows, a], RT[rows, c]
            ma, mc = m[rows, a], m[rows, c]
            sa = G._live_mm(rc, lambda x: G._mm(x, S.T))            # (R, K): a's share mass by a's class
            sc = G._live_mm(ra, lambda x: G._mm(x, S))              # (R, K): a's share mass by c's class
            den = (ra * mc).sum(1)
            sbar = np.where(den > 1e-300, (ra * sa).sum(1) / np.maximum(den, 1e-300), 0.5)
            pay[rows] = VC + (VA - VC) * sbar[:, None]
            hu_out.append((rows, a, c, ma, mc, sa, sc, VA, VC))
        three_out = None
        if self.three is not None:
            rows, act, fac, VP = self.three
            E = PAIR_COMPAT * equity_matrix()
            corr = G.three_way_corr()
            er = np.stack([G._live_mm(RT[rows, act[:, k]], lambda x: G._mm(x, E.T)) for k in range(3)], 1)
            ms = np.stack([m[rows, act[:, k]] for k in range(3)], 1)
            shares, masses = [], []
            for k in range(3):
                o = [j for j in range(3) if j != k]
                shares.append(corr * er[:, o[0]] * er[:, o[1]])
                masses.append(ms[:, o[0]] * ms[:, o[1]])
            own = [RT[rows, act[:, k]] for k in range(3)]
            tot = sum((own[k] * shares[k]).sum(1) for k in range(3))
            mass = sum((own[k] * masses[k]).sum(1) for k in range(3)) / 3
            norm = np.where(tot > 1e-300, mass / np.maximum(tot, 1e-300), 1.0)[:, None]
            ws = [shares[k] * norm * fac[:, k][:, None] for k in range(3)]          # (T3, K): share mass
            sb = np.stack([(own[k] * ws[k]).sum(1) / np.maximum((own[k] * masses[k]).sum(1), 1e-300)
                           for k in range(3)], 1)
            sb = np.maximum(sb, 0.0)
            st = sb.sum(1, keepdims=True)
            sb = np.where(st > 1e-12, sb / np.maximum(st, 1e-12), 1.0 / 3.0)
            # W[k]: every seat's value when k's hand is best (the other two's order for a side pot by their shares)
            W = []
            for k in range(3):
                j, l = [x for x in range(3) if x != k]
                rj = np.where(sb[:, j] + sb[:, l] > 1e-12, sb[:, j] / np.maximum(sb[:, j] + sb[:, l], 1e-12), 0.5)
                W.append(rj[:, None] * VP[:, self._PIDX[(k, j, l)]] + (1 - rj)[:, None] * VP[:, self._PIDX[(k, l, j)]])
            pay[rows] = sum(sb[:, k][:, None] * W[k] for k in range(3))
            three_out = (rows, act, ws, masses, sb, W)
        if not self.bystanders:
            pay[self.s_rows] = self.split[self.s_rows]
        out = np.empty_like(m)
        out[:, 0] = 1.0
        np.cumprod(m[:, :-1], axis=1, out=out[:, 1:])
        suf = np.empty_like(m)
        suf[:, -1] = 1.0
        np.cumprod(m[:, :0:-1], axis=1, out=suf[:, -2::-1])
        out *= suf
        out *= pay[:, :, None]
        for rows, a, c, ma, mc, sa, sc, VA, VC in hu_out:
            ff = fold_f[rows]
            R = np.arange(len(rows))
            da, dc = (VA - VC)[R, a][:, None], (VA - VC)[R, c][:, None]
            out[rows, a] = (VC[R, a][:, None] * mc + da * sa) * ff
            out[rows, c] = (VC[R, c][:, None] * ma + dc * sc) * ff
        if three_out is not None:
            rows, act, ws, masses, sb, W = three_out
            ff = fold_f[rows]
            R = np.arange(len(rows))
            for k in range(3):
                seat = act[:, k]
                lose = 1.0 - sb[:, k]
                A = np.zeros(len(rows))
                for j in range(3):
                    if j != k:
                        A += np.where(lose > 1e-12, sb[:, j] / np.maximum(lose, 1e-12), 0.5) * W[j][R, seat]
                B = W[k][R, seat] - A
                out[rows, seat] = (A[:, None] * masses[k] + B[:, None] * ws[k]) * ff
        V[T] = out


# ----------------------------------------------------------------------------- a spot
def flop_model(stack: float) -> G.EQRModel:
    """The flop valuation the preflop solve uses (pf_study.flop_model), at the effective depth."""
    from gto import pf_study
    return pf_study.flop_model(max(10.0, min(250.0, stack)))


def game(positions: Sequence[str], stacks: Sequence[float], antes: Sequence[float] = (), icm_model=None,
         sizes: Optional[Sizes] = None, model: Optional[G.EQRModel] = None, pushfold: bool = False,
         max_players: Optional[int] = None, bystanders: bool = True, **kw) -> ICMGame:
    """The game for a table: in prize equity with `icm_model` (icm.Model over these seats), else in chips."""
    n = len(positions)
    mp = max_players if max_players is not None else (3 if n <= 6 else 2)
    root = build(positions, stacks, antes, sizes, max_players=mp, pushfold=pushfold, **kw)
    eff = sorted(stacks)[-2] if n > 1 else stacks[0]
    payoff = Prizes(icm_model, positions) if icm_model is not None else Chips(stacks)
    g = ICMGame.__new__(ICMGame)
    g.bystanders = bystanders
    g.__init__(root, positions, model or flop_model(eff), payoff, stack=float(max(stacks)))
    return g


if sys.platform == "emscripten":   # (nothing to set: Game picks its products for Pyodide itself)
    pass
