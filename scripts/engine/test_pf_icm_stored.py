"""engine/pf_icm_stored.py: the stored tournament presets, answered by the worker's own path (Advisor.advise with study and
preflop_solve, as Practice asks, never with "run") from their files: a node with pf_solve stored and done. Each file is
its game's tree, the manifest, KEYS and ALL (the presets, the final-table set, the bounty, satellite and chip EV sets)
agree, and the request each was stored for still reads as its key. Only the entries whose key is their game's key now
(pf_icm.FLOP_MODEL_TAG in it: the flop model, class equity table and calibration) are answered from their files; one
built on another is refused (its key isn't the game's), so a stale file never loads.

Run: .venv/bin/python -m unittest scripts/engine/test_pf_icm_stored.py   (seconds)
"""
import collections
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

sys.path.insert(0, str(ROOT / "scripts" / "pf_icm"))
import build_stored as B  # noqa: E402
from engine import pf_icm_stored as ST  # noqa: E402
from engine import pf_icm_study as IS  # noqa: E402
from gto import pf_study as PS  # noqa: E402
from gto.advisor import Advisor  # noqa: E402
from gto.preflop import SEATS  # noqa: E402

MANIFEST = json.loads(Path(ST.MANIFEST).read_text())
CURRENT = [e for e in MANIFEST if B.current(e)]
STALE = [e for e in MANIFEST if e not in CURRENT]


def current(name):
    e = next((x for x in CURRENT if x["name"] == name), None)
    if e is None:
        raise unittest.SkipTest(f"{name} isn't built under its game's key now yet")
    return e


def ask(req, hero, preflop=()):
    return Advisor().advise({**req, "bb": 1.0, "street": "preflop", "board": "", "hole": "AhKd", "hero": hero,
                             "preflop": list(preflop), "study": True, "preflop_solve": True})


class Stored(unittest.TestCase):
    def test_manifest_keys_and_stages_agree(self):
        names = [s[0] for s in ST.ALL]
        self.assertEqual([e["name"] for e in MANIFEST], sorted((e["name"] for e in MANIFEST), key=names.index))
        self.assertEqual(ST.KEYS, {e["key"]: e["name"] for e in MANIFEST})
        for e in MANIFEST:
            s = ST.ALL[names.index(e["name"])]
            self.assertEqual(e["request"], ST.request(s), e["name"])
            self.assertEqual(e["set"], ST.set_of(e["name"]), e["name"])

    def test_solved_on_the_flop_model_now(self):
        """The presets were solved on the equities and calibration whose digest is pf_icm.MODEL_DIGEST: other ones key
        every game apart ("cal2-<digest>"), and the presets need solving again under those keys."""
        from engine import pf_icm as I
        self.assertEqual(I.model_digest(), I.MODEL_DIGEST,
                         "the equities or the calibration changed: solve the presets again "
                         "(scripts/pf_icm/build_stored.py all --missing) and rewrite the manifest and KEYS")
        self.assertEqual(I.FLOP_MODEL_TAG, "cal2")

    def test_the_sets(self):
        self.assertEqual(len(set(s[0] for s in ST.ALL)), len(ST.ALL))
        count = collections.Counter(ST.set_of(s[0]) for s in ST.ALL)
        self.assertEqual(count, {"stage": 10, "final table": 490, "bounty": 36, "satellite": 117, "chips": 114})
        bounty = [s for s in ST.ALL if ST.set_of(s[0]) == "bounty"]
        for s in bounty:
            r = ST.request(s)
            self.assertEqual(set(r["bounties"]["seats"].values()), {s[6]["each"]}, s[0])
            self.assertEqual(r["bounties"]["field"], s[6]["each"])
        for s in ST.ALL:
            if ST.set_of(s[0]) == "chips":
                self.assertEqual(ST.request(s)["payouts"], [1], s[0])
                self.assertNotIn("field", ST.request(s))
            if ST.set_of(s[0]) == "satellite":
                pay = ST.request(s)["payouts"]
                self.assertEqual(set(pay), {1})
                self.assertIn(len(pay), (s[1] - 1, s[1] - 2))

    def test_the_final_table_set_is_every_count_depth_shape_and_structure(self):
        ft = [s for s in ST.ALL if ST.set_of(s[0]).startswith("final")]
        self.assertEqual(len(ft), len(ST.FT_PLAYERS) * len(ST.FT_DEPTHS)
                         * (len(ST.FT_SHAPES) * len(ST.FT_PAYS) + len(ST.FT_MORE_SHAPES)))
        self.assertEqual(ST.ft_stacks(6, 20, "leader"), (16, 16, 16, 40, 16, 16))
        self.assertEqual(ST.ft_stacks(6, 20, "leader_bb"), (16, 16, 16, 16, 16, 40))
        self.assertEqual(ST.ft_stacks(6, 20, "short_btn"), (22.4, 22.4, 22.4, 8, 22.4, 22.4))
        self.assertEqual(ST.ft_stacks(3, 15, "short"), (19.5, 19.5, 6))
        for pk, (pay, _) in ST.FT_PAYS.items():       # (nine places, first first: the posted tables' first nine)
            self.assertEqual(len(pay), 9, pk)
            self.assertEqual(sorted(pay, reverse=True), list(pay), pk)
        for s in ft:
            n, stacks = s[1], s[2]
            with self.subTest(s[0]):
                self.assertEqual(len(stacks), n)
                avg = next(d for d in ST.FT_DEPTHS if f", {d:g}bb average" in s[0])
                self.assertLessEqual(abs(sum(stacks) - n * avg), 0.1 * n)    # chips kept, to the tenth a seat

    def test_the_key_names_the_game_and_the_equity_table(self):
        """A file built on another game or class equity table is never loaded: its key isn't the game's."""
        spec, why = IS.spec_of(Advisor(), {**ST.request(ST.ALL[0]), "bb": 1.0})
        self.assertIsNone(why)
        k = spec.key
        from engine import pf_icm as I
        old = I.FLOP_MODEL_TAG
        try:
            I.FLOP_MODEL_TAG = "cal2-anothertable"       # (what another equity table or calibration's digest gives)
            self.assertNotEqual(spec.key, k)
        finally:
            I.FLOP_MODEL_TAG = old
        self.assertEqual(spec.key, k)
        for e in STALE:
            with self.subTest(e["name"]):
                spec, _ = IS.spec_of(Advisor(), {**e["request"], "bb": 1.0})
                self.assertNotEqual(spec.key, e["key"])

    def test_seven_or_more_players_say_their_limits(self):
        for e in MANIFEST:
            with self.subTest(e["name"]):
                self.assertEqual("nobody cold 4bets" in e["label"], e["players"] >= 7)

    def test_each_file_is_its_games_tree(self):
        for e in CURRENT:
            with self.subTest(e["name"]):
                spec, why = IS.spec_of(Advisor(), {**e["request"], "bb": 1.0})
                self.assertIsNone(why)
                self.assertEqual(spec.key, e["key"])
                blob = ST.read(spec.key)
                self.assertIsNotNone(blob, f"engine/pf_icm/{spec.key}.bin is missing")
                PS.unpack(spec.game(), blob)       # raises where the tree doesn't match
                self.assertAlmostEqual(PS.stored_mbb(blob), e["mbb"], places=2)
                self.assertLess(e["mbb"], 10.0, "further from equilibrium than any measured floor (ACCURACY 20.3)")

    def test_answered_from_the_file_as_practice_asks(self):
        for e in CURRENT:
            with self.subTest(e["name"]):
                IS._HELD.clear()
                first = SEATS[e["players"]][0]
                a = ask(e["request"], first)
                self.assertEqual(a.get("study"), "node", a)
                self.assertTrue(a["pf_solve"]["stored"])
                self.assertTrue(a["pf_solve"]["done"])
                self.assertTrue(a["pf_icm"])
                if e["set"] != "chips":
                    self.assertTrue(a["notes"][0].startswith("tournament:"), a["notes"])
                self.assertAlmostEqual(sum(x["freq"] for x in a["actions"]), 1.0, places=2)
                self.assertEqual("pf_limits" in a, e["players"] >= 7, a.get("pf_limits"))

    def test_the_opponents_play_the_stored_mix_where_asked(self):
        """Practice's `pf_play`: an opponent's preflop move is drawn from the node's mix for its class, at the tree's sizes
        (so the line stays on the tree); without it, or off the tree, the chart's, as upstream."""
        e = current("Sit & go bubble")
        first = SEATS[e["players"]][0]
        req = {**e["request"], "bb": 1.0, "street": "preflop", "board": "", "preflop": [], "hero": "BB", "hole": "2c2d"}
        IS._HELD.clear()
        node = ask(e["request"], first)
        seen = collections.Counter()
        for seed in range(400):
            m = Advisor().play({**req, "pf_play": True}, first, "AsKs", seed)
            self.assertTrue(m.get("pf_icm"), m)
            seen[m["action"]] += 1
            if m["action"] == "raise":
                self.assertEqual(m["to"], next(a["amount_bb"] for a in node["actions"] if a["action"] == "raise"))
        f = dict(zip(node["grid"]["actions"], node["grid"]["cells"]["AKs"]["f"]))
        for name, n in seen.items():
            self.assertAlmostEqual(n / 400, f[name], delta=0.08, msg=(name, f))
        self.assertFalse(Advisor().play(req, first, "AsKs", 1).get("pf_icm"))
        off = {**req, "pf_play": True, "preflop": [{"pos": first, "action": "raise", "to": 4.0}]}
        self.assertFalse(Advisor().play(off, SEATS[e["players"]][1], "AsKs", 1).get("pf_icm"))

    def test_a_jam_no_one_can_call_is_counted_apart(self):
        """CO's 23.75bb jam at the sit & go bubble (BB 17.75 behind the deepest left): the tree plays it to 17.75, and
        says the 6bb the table counts besides (`uncalled_bb`), so Practice's pot is the tree's with it."""
        e = current("Sit & go bubble")
        IS._HELD.clear()
        a = ask(e["request"], "BB", [{"pos": "CO", "action": "all-in"}, {"pos": "BTN", "action": "fold"},
                                     {"pos": "SB", "action": "fold"}])
        self.assertEqual(a.get("study"), "node", a)
        table_pot = 23.75 + 0.5 + 1.0 + 4 * 0.25
        self.assertAlmostEqual(a["pot_bb"] + a["uncalled_bb"], table_pot, places=2)
        self.assertAlmostEqual(a["uncalled_bb"], 6.0, places=2)
        self.assertAlmostEqual(a["to_call_bb"], 16.75, places=2)

    def test_a_preset_changed_is_not_stored(self):
        e = MANIFEST[0]
        req = {**e["request"], "stacks": {**e["request"].get("stacks", {}), "BB": 15}}
        IS._HELD.clear()
        self.assertEqual(ask(req, SEATS[e["players"]][0]).get("study"), "pf_unsolved")


if __name__ == "__main__":
    unittest.main()
