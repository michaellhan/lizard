"""Hand order in a preflop strategy, and its repair (engine/pf_charts.py applies it to the charts as served; the tests
hold the charts and the stored tournament solves to it).

The families, weakest first: the pairs; each high card's kickers, suited and offsuit, with the aces' wheel kickers
(A2-A5) a chain of their own beside A6-AK (A5 makes the wheel, A6 doesn't); and each offsuit hand below its suited twin.
A hand dominates the one below it in its chain: it never does worse holding the same cards around it. The repair:

- Continue frequency is pooled where it breaks a chain's order (pool adjacent violators, weighted by the combos arriving
  at the node). A pooled block plays its combo-weighted mix, so each action keeps its share of the range.
- The premiums' raises are pooled, by the same weights, where a stronger hand raises less than its weaker neighbour
  (JJ-QQ-KK-AA, AQs-AKs, AQo-AKo, AKo-AKs). The range keeps its raises and each hand its continue frequency: what it no
  longer raises, it calls.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from gto.pf_classes import CLASS_INDEX, CLASS_OF, CLASSES, N_IN

RK = "23456789TJQKA"
EPS = 1e-6           # the weight of a hand that never arrives at the node, against one that always does
TOL = 1e-9


def families() -> list:
    """The dominance chains, weakest first: the pairs; each high card's kickers, suited and offsuit, with A2-A5 (the
    wheel) a chain of their own beside A6-AK; and each offsuit hand below its suited twin."""
    chains = [[r + r for r in RK]]
    for hi in range(1, len(RK)):
        h = RK[hi]
        for s in "so":
            ks = [h + RK[k] + s for k in range(hi)]
            chains += [ks[:4], ks[4:]] if h == "A" else [ks]
    for hi in range(1, len(RK)):
        for k in range(hi):
            chains.append([RK[hi] + RK[k] + "o", RK[hi] + RK[k] + "s"])
    return [[CLASS_INDEX[c] for c in ch] for ch in chains if len(ch) > 1]


PREMIUM_CHAINS = [["JJ", "QQ", "KK", "AA"], ["AQs", "AKs"], ["AQo", "AKo"], ["AKo", "AKs"]]
CHAINS = families()
PREMIUM = [[CLASS_INDEX[c] for c in ch] for ch in PREMIUM_CHAINS]
WHEEL = frozenset(CLASS_INDEX["A" + k + s] for k in "2345" for s in "so")


def pairs() -> list:
    """(weaker, stronger) class indices: each step of each chain."""
    return [(ch[i], ch[i + 1]) for ch in CHAINS for i in range(len(ch) - 1)]


def name(i: int) -> str:
    return CLASSES[i]


def _blocks(v: np.ndarray, wt: np.ndarray) -> list:
    """Pool adjacent violators: [start, end) blocks of a chain's values (weakest first) pooled to a non-decreasing
    sequence by weighted mean."""
    blocks = []
    for i in range(len(v)):
        blocks.append([i, i + 1])
        while len(blocks) > 1:
            (s0, e0), (s1, e1) = blocks[-2], blocks[-1]
            m0 = (v[s0:e0] * wt[s0:e0]).sum() / wt[s0:e0].sum()
            m1 = (v[s1:e1] * wt[s1:e1]).sum() / wt[s1:e1].sum()
            if m1 >= m0 - TOL:
                break
            blocks[-2:] = [[s0, e1]]
    return [b for b in blocks if b[1] - b[0] > 1]


def repair_classes(M: np.ndarray, names: list, wt: np.ndarray, passes: int = 60) -> np.ndarray:
    """The class-level strategy M ((actions, 169), rows in `names`' order) repaired (the module's step 2) under weights
    wt (169: the combos arriving)."""
    M = M.copy()
    if "fold" in names:
        f = names.index("fold")
        for _ in range(passes):
            moved = False
            for ch in CHAINS:
                cont = 1.0 - M[f, ch]
                if np.all(np.diff(cont) >= -TOL):
                    continue
                w = wt[ch]
                for s0, e0 in _blocks(cont, w):
                    ix = ch[s0:e0]
                    M[:, ix] = ((M[:, ix] * wt[ix]).sum(axis=1) / wt[ix].sum())[:, None]
                    moved = True
            if not moved:
                break
    passive = "call" if "call" in names else "check" if "check" in names else None
    if "raise" in names and passive is not None:
        r, c = names.index("raise"), names.index(passive)
        for _ in range(passes):
            moved = False
            for ch in PREMIUM:
                rv = M[r, ch]
                if np.all(np.diff(rv) >= -TOL):
                    continue
                for s0, e0 in _blocks(rv, wt[ch]):
                    ix = ch[s0:e0]
                    cont = M[r, ix] + M[c, ix]
                    pooled = (M[r, ix] * wt[ix]).sum() / wt[ix].sum()
                    M[r, ix] = np.minimum(pooled, cont)
                    M[c, ix] = cont - M[r, ix]
                    moved = True
            if not moved:
                break
    return M


def repair(full: Dict[str, np.ndarray], arriving: Optional[np.ndarray] = None) -> Dict[str, np.ndarray]:
    """A chart node's strategy ({action: (1326,)} per combo, as Advisor gives it) repaired; arriving: the hero's range at
    the node (per combo, None for every hand). Classes the repair doesn't move keep their combos as they were; a moved
    class plays its new mix on every combo."""
    names = list(full)
    if not names:
        return full
    V = np.array([np.broadcast_to(np.asarray(full[a], float), CLASS_OF.shape) for a in names])
    M = np.array([np.bincount(CLASS_OF, weights=v, minlength=len(N_IN)) for v in V]) / N_IN
    w = np.ones(len(N_IN)) if arriving is None else \
        np.bincount(CLASS_OF, weights=np.asarray(arriving, float), minlength=len(N_IN)) / N_IN
    wt = (np.clip(w, 0.0, None) + EPS) * N_IN
    R = repair_classes(M, names, wt)
    changed = np.abs(R - M).max(axis=0) > 1e-12
    if not changed.any():
        return full
    m = changed[CLASS_OF]
    out = dict(full)
    for k, a in enumerate(names):
        v = V[k].copy()
        v[m] = R[k][CLASS_OF][m]
        out[a] = v
    return out
