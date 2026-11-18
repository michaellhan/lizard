"""Writes web/src/test/fixtures/pf_untrained.json: real answers of the stored cash grid (engine/pf/<tag>_*.bin) through
the worker's own entry (engine.pf_solve.answer, what a Practice or Analyze grade asks), beside the charts' answer
(Advisor.advise) at the same spot, for pfGrade.test.ts's spots where the solve never makes a move:

  hj40     6-max 40bb at the charts' sizes, UTG opens 2.5, the HJ to act: the solve never 3-bets (its EV for AA's 3-bet is
           -7.5, folding to whatever comes next), the chart 3-bets AA
  co100    6-max 100bb at the charts' sizes, UTG opens, the HJ 3-bets to 7.5, the CO to act: the solve never cold 4-bets
  utg40    6-max 40bb, UTG first in: every move learned (folding AA is still graded by the solve)
  trap50   6-max 50bb at the charts' sizes, UTG opens, the CO calls, the BTN squeezes to 10: UTG calls 0.5% of its range
           (AA's trap is learned: AA's EV of the call is +9), so it stays graded by the solve

Seconds of CPU (it reads four nodes). Run from the repo root after a change to the stored grid:

    .venv/bin/python scripts/pf/untrained_nodes.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_solve as PSV  # noqa: E402
from gto.advisor import Advisor  # noqa: E402

OUT = ROOT / "web" / "src" / "test" / "fixtures" / "pf_untrained.json"
CHART_SIZES = {"blind_3bet": 4}

SPOTS = {
    "hj40": (40, "HJ", "AhAd", [("UTG", "raise", 2.5)]),
    "co100": (100, "CO", "AhAd", [("UTG", "raise", 2.5), ("HJ", "raise", 7.5)]),
    "utg40": (40, "UTG", "AhAd", []),
    "trap50": (50, "UTG", "AhAd", [("UTG", "raise", 2.5), ("HJ", "fold", None), ("CO", "call", None),
                                   ("BTN", "raise", 10.0), ("SB", "fold", None), ("BB", "fold", None)]),
}


def state(stack, hero, hole, line):
    pre = [{"pos": p, "action": a, **({"to": t} if t is not None else {})} for p, a, t in line]
    return {"players": 6, "stack": stack, "bb": 1.0, "street": "preflop", "board": "", "hole": hole, "hero": hero,
            "preflop": pre}


def main():
    adv = Advisor()
    out = {"model_tag": PSV.MODEL_TAG}
    for name, (stack, hero, hole, line) in SPOTS.items():
        st = state(stack, hero, hole, line)
        node = PSV.answer(adv, {**st, "study": True, "preflop_solve": True, "pf_sizes": CHART_SIZES})
        if node.get("study") != "node":
            raise SystemExit(f"{name}: {node}")
        node.pop("seconds", None)
        chart = adv.advise(dict(st))
        out[name] = {"state": st, "solve": node,
                     "chart": {k: chart[k] for k in ("street", "pot_bb", "to_call_bb", "actions") if k in chart}}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {', '.join(SPOTS)} ({PSV.MODEL_TAG})")


if __name__ == "__main__":
    main()
