"""Study's preflop Solver source for a tournament: the spot's own preflop solved in prize equity (engine/pf_icm.py),
browsed node by node as pf_study's solves are (the same requests and answers: "pf_unsolved", "pf_progress", "node",
"pf_export", "load"), with the tournament's notes for the player to act.

Upstream's Advisor._study_pf answers a tournament "pf_none" (its solve plays chips, equal stacks only). Importing this
module wraps it (as engine/pf_stored.py extends pf_study's stored games): a Study request with payouts or bounties and no
board goes here, everything else to upstream's as before. The worker imports it once at start
(scripts/pyodide/worker-edits.mjs, declared in solver/UPSTREAM.json); solver/ is untouched.

The game (Spec): the table's seats, each seat's stack and ante (the state's, in big blinds), and the prize model the rest of
the app uses for the same state (advisor._tournament: the payouts left, the other tables as stand-ins, bounties), so the
answer's prize equity is the one the Tournament panel shows. One prize and no bounties is winner-take-all: chips, solved
the same way with the stacks as they are (pf_study takes equal stacks only).

EVs: each class's EV of each action against folding now, in chip equivalents of prize equity ("bb of prize equity"), so
folding is 0 as in pf_study's answers. In prize equity folding isn't just the chips in lost: the player not in the pot
gains when others bust, which the fold's value counts.

Size: the tree grows with the players and the stacks (pf_icm.build: 6 players at 30bb 2,008 nodes, at 75bb 7,542). From
7 players nobody cold 4bets or cold-calls a 3bet (Spec.cold4, as engine/pf_engine.py's 7-9 handed tree): 9 at 20bb 1,527
nodes, at 75bb 3,318 (with cold 4bets 12,000 to 109,000, too big to build in 1 GB). A game whose arrays (nodes x seats)
would not fit is refused in words (MAX_WORK; BROWSER_WORK in the browser).
"""
from __future__ import annotations

import base64
import dataclasses
import hashlib
import random
import json
import sys
import time
import zlib
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from gto import pf_game as G
from gto import pf_study as PS
from gto.pf_classes import CLASSES, N_IN
from gto.preflop import SEATS

from engine import pf_icm as I
from engine import pf_icm_stored as ST

K = len(CLASSES)
BROWSER_WORK = 70_000      # nodes x seats a solve may hold in the browser (pf_study's 6-max 100bb is 66k: ~60 MB)
MAX_WORK = 300_000         # ... and natively
MIN_STACK = 1.5            # bb: a seat with less can't post its blind and act (and push/fold below that is all in)
MAX_STACK = 250.0
MODEL_NAME = "preflop solve in prize equity (class-level model)"
LIMITS_7UP = "7 or more players: at most two see a flop, nobody cold 4bets or cold-calls a 3bet"


@dataclass(frozen=True)
class Spec:
    """A tournament table's preflop game: seats in order, each one's stack and ante (bb), and the prize model's key."""
    players: int
    stacks: Tuple[float, ...]
    antes: Tuple[float, ...]
    prize_key: str                       # the prize model's numbers (json), "" for chips (winner-take-all)
    prize_words: str = ""
    model: object = field(default=None, compare=False, hash=False, repr=False)
    straddle: bool = False               # (pf_study.Solve.walk reads it: never in a tournament here)

    @property
    def key(self) -> str:
        """A file-name-safe id: 'icm6_<hash>' (pf_study's Spec.key for the browser's keep)."""
        game = [dataclasses.asdict(I.Sizes()), I.JAM_OPEN]     # (the sizes too: a file of other sizes never loads)
        if not self.cold4:
            game.append("no cold 4bets")       # (7 or more players' smaller tree; 2-6 players' keys as they were)
        h = hashlib.sha1(json.dumps([self.players, self.stacks, self.antes, self.prize_key, game]).encode()).hexdigest()[:16]
        return f"icm{self.players}_{h}"

    @property
    def cold4(self) -> bool:
        """Cold 4bets and cold calls of a 3bet are in the tree up to 6 players; from 7 a player who hasn't put chips in
        voluntarily only folds once the pot is 3bet (pf_icm.build cold4=False, as engine/pf_engine.py's 7-9 handed
        tree): 9-handed 1,500 to 3,300 nodes instead of 12,000 to 109,000."""
        return self.players <= 6

    @property
    def ante(self) -> float:
        return float(max(self.antes)) if self.antes else 0.0

    @property
    def stack(self) -> float:
        return float(max(self.stacks))

    def positions(self) -> List[str]:
        return list(SEATS[self.players])

    def label(self) -> str:
        pos = self.positions()
        st = " · ".join(f"{p} {s:g}" for p, s in zip(pos, self.stacks))
        bits = [f"{self.players} players" if self.players > 2 else "heads-up", f"stacks {st}bb"]
        if any(self.antes):
            a = set(round(x, 4) for x in self.antes)
            bits.append(f"{next(iter(a)):g}bb ante each" if len(a) == 1 else "antes " + " · ".join(f"{x:g}" for x in self.antes))
        bits.append(self.prize_words or "winner takes all (chips)")
        sz = I.Sizes()
        small = f" ({sz.small_open:g} from {sz.small_open_at:g}bb)" if sz.small_open else ""
        bits.append(f"opens {sz.open:g}bb{small}, SB {sz.sb_open:g}x or limp, "
                    f"a jam beside the open from {I.JAM_OPEN:g}bb, 3bets {sz.ip_3bet:g}x / {sz.blind_3bet:g}x from the blinds")
        if not self.cold4:
            bits.append(LIMITS_7UP)
        return ", ".join(bits)

    def build(self) -> Tuple[G.Node, List[str]]:
        pos = self.positions()
        return I.build(pos, self.stacks, self.antes, max_players=3 if self.players <= 6 else 2, cold4=self.cold4), pos

    def game(self) -> I.ICMGame:
        pos = self.positions()
        g = I.game(pos, list(self.stacks), list(self.antes), icm_model=self.model, cold4=self.cold4)
        g.avg_power = PS.AVG_POWER
        return g


def work_of(spec: Spec) -> int:
    root, pos = spec.build()
    return sum(1 for _ in G.walk(root)) * len(pos)


def spec_of(adv, state: dict) -> Tuple[Optional[Spec], Optional[str]]:
    """The game of a Study request with a tournament (amounts in chips, bb the big blind), or (None, why not)."""
    from gto import advisor as A
    bb = float(state.get("bb", 1.0))
    try:
        n = int(state.get("players", 6))
    except (TypeError, ValueError):
        return None, "players must be 2 to 9"
    if n not in SEATS:
        return None, "players must be 2 to 9"
    if state.get("straddle") and n >= 3:
        return None, "a tournament's preflop is solved without a straddle"
    pos = list(SEATS[n])
    try:
        stack, stacks = A._state_stacks(state.get("stack"), state.get("stacks"), pos, bb)
        model = A._tournament(state, pos, stack, stacks, bb)
    except ValueError as e:
        return None, str(e)
    st = [round(float(stacks[p]) if stacks else float(stack), 3) for p in pos]
    ante = float(state.get("ante") or 0.0) / bb
    antes = [round(ante, 4)] * n
    for p, s in zip(pos, st):
        if s - ante < MIN_STACK:
            return None, f"{p}'s stack ({s:g}bb) is too short to solve: at least {MIN_STACK:g}bb after the ante"
        if s > MAX_STACK:
            return None, f"the solve takes stacks up to {MAX_STACK:g}bb ({p} has {s:g}bb)"
    if model is None:
        prize_key, words = "", "winner takes all (prize equity is chips)"
    else:
        prize_key = json.dumps(model.key, default=str)
        words = prize_words(model)
    spec = Spec(n, tuple(st), tuple(antes), prize_key, words, model)
    if spec.key in ST.KEYS:      # (a stored game: no need to build its tree to size it)
        return spec, None
    w = work_of(spec)
    cap = BROWSER_WORK if sys.platform == "emscripten" else MAX_WORK
    if w > cap:
        return None, (f"this table's preflop is too big to solve {'in the browser' if cap == BROWSER_WORK else 'here'} "
                      f"({w // n:,} nodes for {n} players; up to {cap // n:,}): fewer players or shorter stacks fit")
    return spec, None


def prize_words(model) -> str:
    """The prize model in a few words, for the game's label."""
    pay = model.payouts
    if getattr(model, "assumed_prizes", False):
        p = "no payouts given: chip EV, the prizes taken as the bounties in play"
    elif len(pay) == 1 and not model.approx:
        p = "winner takes all (prize equity is chips)"
    else:
        shown = "/".join(f"{x:g}" for x in pay[:3]) + ("/…" if len(pay) > 3 else "")
        p = f"prize equity (ICM, Malmuth-Harville): {len(pay)} paid in the model ({shown})"
        if model.approx:
            p += f", {model.players} players modelled by {len(model.seats) + len(model.field)}"
    if model.bounty is not None:
        from gto.icm import BOUNTY_FORMATS
        p += f", {BOUNTY_FORMATS[model.bounty.fmt]} bounties (proportional model)"
    return p


# ----------------------------------------------------------------------------- a solve
class Solve(PS.Solve):
    """pf_study's Solve on the tournament's game: its chunks, status, packing and stall rule as they are; the node's answer
    with each seat's own stack and ante and its EVs against folding in prize equity."""

    def status(self) -> dict:
        out = super().status()
        out["model"] = MODEL_NAME
        out["icm"] = bool(self.spec.prize_key)
        return out

    def _fold_base(self, node: G.Node, bets: Dict[str, float]) -> float:
        """Where the player to act can't fold (a check), the value of giving up what's in: its chips in lost, the pot to
        the others still in (shared), in prize-equity chip equivalents (chips: minus what's in)."""
        g = self.game
        p = node.player
        put = np.array([bets[q] + self.spec.antes[i] for i, q in enumerate(g.positions)])
        live = [q for q in range(g.n) if q != p and all(not (x == g.positions[q] and a == "fold") for x, a, _ in node.line)]
        won = np.zeros(g.n)
        for q in live:
            won[q] = put.sum() / max(len(live), 1)
        return float(g.payoff.values(put[None, :], won[None, :], [[]])[0, p])

    def node(self, preflop: List[dict]) -> dict:
        node, notes, bets = self.walk(preflop)
        if node is None:
            return {"error": notes[0]}
        g = self.game
        pos = g.positions
        if node.kind == "fold":
            return {"study": "over", "street": "preflop", "winner": pos[node.active[0]]}
        if node.kind == "show":
            return {"study": "deal", "street": "flop", "allin": bool(node.allin)}
        # (the tree's own amounts: a short stack's blind is all it has)
        bets = self._bets_on_tree(node)
        s, reach, M, V, never = self._at(node.index)
        d = int(g.dec_of[node.index])
        k = node.index
        p = node.player
        norm = np.ones(K)
        for q in range(g.n):
            if q != p:
                norm = norm * M[k, q]
        cur = max(bets.values())
        nA = len(node.names)
        raw = np.zeros((nA, K))
        with np.errstate(all="ignore"):
            for a in range(nA):
                raw[a] = V[node.children[a].index, p] / np.maximum(norm, 1e-300)
        if "fold" in node.names:
            base = raw[node.names.index("fold")].copy()
        else:
            base = np.full(K, self._fold_base(node, bets))
        evs = raw - base[None, :]
        w = reach[k, p] / G.PRIOR
        mix = s[d, :nA]
        live = w > PS.LIVE_W
        if not live.any():
            live = w >= w.max() * 0.01
        evm = (mix * evs).sum(0)
        order = sorted(range(nA), key=lambda a: {"raise": 0, "all-in": 1, "call": 2, "fold": 3}[node.names[a]])
        names, amounts = [], []
        for a in order:
            nm = node.names[a]
            if nm == "call" and cur - bets[pos[p]] < 1e-9:
                nm = "check"
            names.append(nm)
            amounts.append(node.children[a].line[-1][2] if nm in ("raise", "all-in") else None)
        combos = w * N_IN
        tot = float(combos[live].sum())
        held = combos * norm / max(float(norm[live].max()), 1e-300)
        acts = []
        for j, a in enumerate(order):
            c = combos * mix[a]
            share = float(c[live].sum())
            h = (held * mix[a])[live]
            acts.append({"action": names[j], "amount_bb": None if amounts[j] is None else round(amounts[j], 2),
                         "freq": round(share / max(tot, 1e-12), 4), "combos": round(share, 1),
                         "ev_bb": round(float((h * evs[a][live]).sum() / h.sum()), 3) if share > 1e-9 else None})
        cells = {}
        for i in np.nonzero(live)[0]:
            cells[CLASSES[i]] = {"w": round(float(min(1.0, w[i])), 4),
                                 "f": [round(float(mix[a, i]), 4) for a in order],
                                 "ev": [round(float(evs[a, i]), 3) for a in order],
                                 "evm": round(float(evm[i]), 3), "eq": None}
        folded = {x for x, act, _ in node.line if act == "fold"}
        acted = []
        for x, act, _ in node.line:
            if act != "fold" and x not in folded and x not in acted and x != pos[p]:
                acted.append(x)
        opps = []
        for x in acted:
            q = pos.index(x)
            wq = reach[k, q] / G.PRIOR
            lq = wq > PS.LIVE_W
            opps.append({"seat": x, "combos": round(float((wq * N_IN)[lq].sum()), 1),
                         "grid": {"actions": [], "cells": {CLASSES[i]: {"w": round(float(min(1.0, wq[i])), 4)}
                                                            for i in np.nonzero(lq)[0]}}})
        pot = sum(bets.values()) + sum(self.spec.antes)
        # a jam bigger than anyone still in can call is played to the deepest of them (I.build): the rest, which a table
        # counts in its pot, is no chip in play (pfGrade.ts chipsOff takes it off the table's pot)
        cap = {q: self.spec.stacks[i] - self.spec.antes[i] for i, q in enumerate(pos)}
        jammed = {x for x, act, _ in node.line if act == "all-in"}
        uncalled = sum(max(0.0, cap[x] - bets[x]) for x in jammed)
        st = self.status()
        regret = float((held * (evs.max(0) - evm))[live].sum() / max(float(held[live].sum()), 1e-300))
        if never:
            notes.append(f"the solve never brings {' and '.join(never)} here: "
                         + ("their ranges are" if len(never) > 1 else "the range is") + " as before the 0% move")
        thin = [o["seat"] for o in opps if o["combos"] < 1.0] + ([pos[p]] if tot < 1.0 else [])
        unit = "bb of prize equity" if self.spec.prize_key else "bb"
        notes.append(f"{MODEL_NAME}: every outcome paid in prize equity, EVs in {unit} against folding now"
                     if self.spec.prize_key else
                     "preflop solve in chips (winner takes all: prize equity is chips), each seat's own stack")
        return {"study": "node", "street": "preflop", "actor": pos[p], "players": g.n, "board": "",
                "pot_bb": round(pot, 2), "uncalled_bb": round(uncalled, 2),
                "to_call_bb": round(min(cur, self.spec.stacks[p] - self.spec.antes[p]) - bets[pos[p]], 2),
                "stack_bb": round(self.spec.stacks[p] - self.spec.antes[p] - bets[pos[p]], 2),
                "actions": acts, "grid": {"actions": names, "cells": cells}, "range_combos": round(tot, 1),
                "range_ev_bb": round(float((held * evm)[live].sum() / max(float(held[live].sum()), 1e-300)), 3),
                "range_eq": None,
                "opponents": opps, "opponent": " and ".join(acted) if acted else None,
                "solver": {"by": "the preflop solve", "model": MODEL_NAME, "iterations": self.iters,
                           "mbb": st["mbb"], "exploitability_bb": None if self.expl is None else round(sum(self.expl), 4)},
                "pf_solve": st, "pf_icm": True, "source": "solver", "notes": notes, "regret_bb": round(regret, 3),
                "rough": bool(never or thin or regret >= PS.ROUGH_BB),
                **({} if self.spec.cold4 else {"pf_limits": LIMITS_7UP})}

    def _bets_on_tree(self, node: G.Node) -> Dict[str, float]:
        """Each seat's chips in this round at `node`, from the tree's own line (the blinds as posted, short ones all in)."""
        g = self.game
        pos = g.positions
        n = g.n
        sb, bb = (pos[-2], pos[-1]) if n > 2 else (pos[0], pos[1])
        cap = {q: self.spec.stacks[i] - self.spec.antes[i] for i, q in enumerate(pos)}
        bets = {q: 0.0 for q in pos}
        bets[sb] = min(0.5, cap[sb])
        bets[bb] = min(1.0, cap[bb])
        for x, act, to in node.line:
            if act != "fold":
                bets[x] = to
        return bets


# ----------------------------------------------------------------------------- the solves held
_HELD: Dict[str, Solve] = {}
MAX_HELD = 3


def held(spec: Spec) -> Optional[Solve]:
    """The game's solve in hand: one run here, else a stored one (engine/pf_icm_stored.py), else None."""
    s = _HELD.get(spec.key)
    if s is None:
        blob = ST.read(spec.key)
        if blob is not None:
            try:
                s = _keep(Solve(spec, blob))
            except ValueError:      # (a file from another tree: the game changed since it was stored)
                s = None
    return s


def _keep(s: Solve) -> Solve:
    _HELD.pop(s.spec.key, None)
    _HELD[s.spec.key] = s
    while len(_HELD) > MAX_HELD:
        _HELD.pop(next(iter(_HELD)))
    return s


def solve(spec: Spec, seconds: float, should_stop: Optional[Callable[[], bool]] = None) -> Solve:
    s = held(spec) or Solve(spec)
    _keep(s)
    return s.run(seconds, should_stop)


def export(spec: Spec) -> Optional[dict]:
    s = held(spec)
    if s is None or s.stored or not s.done:
        return None
    mbb = s.mbb
    blob = PS.pack(s.game, float("nan") if mbb is None else mbb)
    return {"key": spec.key, "iterations": s.iters, "mbb": None if mbb is None else round(mbb, 3),
            "blob": base64.b64encode(blob).decode("ascii")}


def load(spec: Spec, blob: str, iterations: int) -> Solve:
    try:
        s = Solve(spec, base64.b64decode(blob))
    except zlib.error as e:
        raise ValueError(f"not a packed solve: {e}") from e
    s.iters, s.cached = int(iterations), True
    return _keep(s)


def estimate_seconds(spec: Spec, per_iter: Optional[float] = None) -> float:
    """pf_study.estimate_seconds' rule on this tree (its iteration time in proportion to nodes x seats)."""
    w = work_of(spec)
    base = per_iter if per_iter is not None else (0.21 if sys.platform == "emscripten" else 0.12)
    it = base * w / (11010 * 6)
    n = PS.MAX_ITERS if w < PS.SMALL_WORK else 800
    return it * n + it * 1.2 * spec.players * (n // PS.CHECK_EVERY)


# ----------------------------------------------------------------------------- the request
def answer(adv, st: dict, pfs) -> dict:
    """Advisor._study_pf's answer for a tournament (see the module's doc)."""
    from gto import advisor as A
    t0 = time.time()
    spec, why = spec_of(adv, st)
    if spec is None:
        return {"study": "pf_none", "street": "preflop", "reason": why}
    if isinstance(pfs, dict) and pfs.get("run"):
        sec = max(0.5, min(30.0, float(pfs["run"])))
        s = solve(spec, sec, adv.should_stop)
        return {"study": "pf_progress", "street": "preflop", "pf_solve": s.status(), "seconds": round(time.time() - t0, 2)}
    if isinstance(pfs, dict) and pfs.get("export"):
        out = export(spec) or {"key": spec.key, "blob": None}
        return {"study": "pf_export", "street": "preflop", **out}
    if isinstance(pfs, dict) and pfs.get("load") and held(spec) is None:
        try:
            load(spec, str(pfs["load"]), int(pfs.get("iterations") or 0))
        except (ValueError, TypeError):
            pass
    s = held(spec)
    if s is None:
        return {"study": "pf_unsolved", "street": "preflop", "game": spec.label(), "key": spec.key,
                "model": MODEL_NAME, "estimate_s": round(estimate_seconds(spec)), "seconds": round(time.time() - t0, 2)}
    res = s.node(A._norm_actions(st.get("preflop"), float(st.get("bb", 1.0))))
    if spec.model is not None and res.get("study") == "node":
        out = {a["pos"] for a in A._norm_actions(st.get("preflop"), float(st.get("bb", 1.0))) if a["action"] == "fold"}
        t = A._tournament_info(spec.model, res["actor"], spec.positions(), "preflop", out, named=True)
        res["tournament"] = t
        res["notes"].insert(0, t["note"])
        if "bounties" in t:
            res["notes"].insert(1, t["bounties"]["note"])
    res["seconds"] = round(time.time() - t0, 3)
    return res


def _tourney(st: dict) -> bool:
    return bool(st.get("payouts") or st.get("bounties")) and not str(st.get("board") or "")


def play(adv, st: dict, seat: str, hole, seed: Optional[int] = None) -> Optional[dict]:
    """A Practice opponent's preflop move in a session graded by a stored preset (the request's `pf_play`, which
    practice.ts stateFor sends only there): drawn from the stored solve's mix for its hand class at the node, so the hand
    stays on the tree the player's own decisions are graded on (with the charts' moves, whose sizes and options aren't
    the tree's, few were: scripts/pf_icm/coverage.py). In Advisor.play's format, with `pf_icm`. None where the node isn't
    this spot (another game, a line off the tree or the line's size not the tree's, past the preflop, a class the line
    has left without weight): the chart's move, as upstream."""
    if not st.get("pf_play") or not _tourney(st):
        return None
    from gto import advisor as A
    spec, _ = spec_of(adv, st)
    if spec is None or spec.key not in ST.KEYS:
        return None
    s = held(spec)
    if s is None:
        return None
    res = s.node(A._norm_actions(st.get("preflop"), float(st.get("bb", 1.0))))
    if res.get("study") != "node" or res.get("actor") != seat:
        return None
    if any("played as the solve's size" in n for n in res.get("notes", [])):
        return None
    cards = tuple(A.parse_cards(hole)) if isinstance(hole, str) else tuple(hole)
    cell = res["grid"]["cells"].get(_class_of(A.cards_str(cards)))
    if cell is None or not sum(cell["f"]):
        return None
    names = res["grid"]["actions"]
    amount = {a["action"]: a.get("amount_bb") for a in res["actions"]}
    rng = random.Random(seed) if seed is not None else adv.rng
    r, i = rng.random() * sum(cell["f"]), len(names) - 1
    for k, f in enumerate(cell["f"]):
        r -= f
        if r <= 0 and f > 0:
            i = k
            break
    name = names[i]
    mix = [{"action": n, "amount_bb": amount.get(n), "freq": round(float(f), 4)} for n, f in zip(names, cell["f"])]
    out = {"pos": seat, "action": name, "name": name, "freq": round(float(cell["f"][i]), 4), "street": "preflop",
           "actions": mix, "pf_icm": True}
    if name == "raise":
        out["to"] = round(float(amount[name]) * float(st.get("bb", 1.0)), 2)
    return out


_RANKS = "23456789TJQKA"


def _class_of(hole: str) -> str:
    """'AhKd' -> 'AKo'."""
    a, b = hole[:2], hole[2:]
    if _RANKS.index(a[0]) < _RANKS.index(b[0]):
        a, b = b, a
    return a[0] + b[0] if a[0] == b[0] else a[0] + b[0] + ("s" if a[1] == b[1] else "o")


def install() -> None:
    """Sends a tournament's Study preflop solve here, and a stored preset's Practice opponents' preflop moves (idempotent):
    Advisor._study_pf and Advisor.play wrapped."""
    from gto.advisor import Advisor
    if not getattr(Advisor._study_pf, "_pf_icm", False):
        upstream = Advisor._study_pf

        def _study_pf(self, st, pfs):
            if _tourney(st):
                return answer(self, st, pfs)
            return upstream(self, st, pfs)

        _study_pf._pf_icm = True
        _study_pf.upstream = upstream
        Advisor._study_pf = _study_pf
    if not getattr(Advisor.play, "_pf_icm", False):
        up_play = Advisor.play

        def _play(self, state, seat, hole, seed=None):
            out = play(self, state, str(seat).upper(), hole, seed)
            return out if out is not None else up_play(self, state, seat, hole, seed)

        _play._pf_icm = True
        _play.upstream = up_play
        Advisor.play = _play


install()
