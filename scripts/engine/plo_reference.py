"""A deliberately brute-force reference for PLO4, to check web/src/engine/plo/ against. It shares nothing with that code
but the file format of its output: standard library only, no tables, no bit tricks, written to be read and believed
rather than to be fast. Every hand is every one of the 60 ways to take 2 of 4 hole cards and 3 of 5 board cards.

    .venv/bin/python scripts/engine/plo_reference.py hands      # ~30 s: 140,000 hands, digests and golden vectors
    .venv/bin/python scripts/engine/plo_reference.py classes    # ~20 s: the 270,725 hands and their suit classes
    .venv/bin/python scripts/engine/plo_reference.py equity     # ~20 s: exact flop, turn and river equities
    .venv/bin/python scripts/engine/plo_reference.py preflop    # ~10 s: exact preflop equities
    .venv/bin/python scripts/engine/plo_reference.py cited      # ~60 s: exact for a published flop's ranges
    .venv/bin/python scripts/engine/plo_reference.py betting    # ~10 s: pot-limit hands played out, with side pots

Each writes a JSON file in web/src/engine/plo/vectors/, which web/src/engine/plo/*.test.ts read. The generators are
seeded (mulberry32, the same one web/src/poker/table.ts seeded() has), so a run reproduces its file byte for byte, and
the 140,000 hands can be checked in vitest without being stored: it deals the same hands, and compares a digest (FNV-1a,
32 bits, per 10,000 hands) of every hand's value.

Run its own checks with: .venv/bin/python -m unittest scripts/engine/test_plo_reference.py
"""
import json
import sys
from itertools import combinations, permutations
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "engine" / "plo" / "vectors"

RANK_CHARS = "23456789TJQKA"
SUIT_CHARS = "shdc"
MASK = 0xFFFFFFFF


def parse(text):
    """'AsKd' -> [(14, 's'), (13, 'd')]"""
    t = text.replace(" ", "")
    return [(RANK_CHARS.index(t[i]) + 2, t[i + 1]) for i in range(0, len(t), 2)]


def show(cards):
    return "".join(RANK_CHARS[r - 2] + s for r, s in cards)


DECK = [(r, s) for r in range(14, 1, -1) for s in SUIT_CHARS]

# ---- hand values


def rank5(cards):
    """Five cards, spelled out: (category, tie-breakers...), compared left to right. Ranks 2..14."""
    ranks = sorted((c[0] for c in cards), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    counts = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    groups = sorted(counts.items(), key=lambda kv: (-kv[1], -kv[0]))
    shape = tuple(n for _, n in groups)
    order = tuple(r for r, _ in groups)
    straight = 0
    if shape == (1, 1, 1, 1, 1):
        if ranks[0] - ranks[4] == 4:
            straight = ranks[0]
        elif ranks == [14, 5, 4, 3, 2]:
            straight = 5
    if flush and straight:
        return (8, straight)
    if shape == (4, 1):
        return (7,) + order
    if shape == (3, 2):
        return (6,) + order
    if flush:
        return (5,) + tuple(ranks)
    if straight:
        return (4, straight)
    if shape == (3, 1, 1):
        return (3,) + order
    if shape == (2, 2, 1):
        return (2,) + order
    if shape == (2, 1, 1, 1):
        return (1,) + order
    return (0,) + tuple(ranks)


def best_plo(hole, board):
    """The best of every way to use exactly two hole cards and exactly three board cards."""
    return max(rank5(list(h) + list(b)) for h in combinations(hole, 2) for b in combinations(board, 3))


# ---- the shared deal: mulberry32, a partial Fisher-Yates from the end of the deck


class Mulberry32:
    def __init__(self, seed):
        self.a = seed & MASK

    def __call__(self):
        self.a = (self.a + 0x6D2B79F5) & MASK
        x = self.a
        x = ((x ^ (x >> 15)) * (x | 1)) & MASK
        x ^= (x + (((x ^ (x >> 7)) * (x | 61)) & MASK)) & MASK
        return ((x ^ (x >> 14)) & MASK) / 4294967296


def draw(deck, n, rnd):
    d = list(deck)
    out = []
    for k in range(n):
        i = len(d) - 1 - k
        j = int(rnd() * (i + 1))
        d[i], d[j] = d[j], d[i]
        out.append(d[i])
    return out


def fnv1a(text, h=0x811C9DC5):
    for b in text.encode("ascii"):
        h = ((h ^ b) * 0x01000193) & MASK
    return h


def deck_of(ranks, suits):
    return [(RANK_CHARS.index(r) + 2, s) for r in ranks for s in suits]


# name, seed, deck, board cards, hands. The narrow decks put the rare categories and the rule's traps on nearly every
# hand: two suits for flushes and straight flushes, few ranks for quads, full houses, wheels and paired boards.
SWEEPS = [
    ("river", 1001, ("AKQJT98765432", "shdc"), 5, 100_000),
    ("turn", 1002, ("AKQJT98765432", "shdc"), 4, 10_000),
    ("flop", 1003, ("AKQJT98765432", "shdc"), 3, 10_000),
    ("two-suits", 1004, ("AKQJT98765432", "sh"), 5, 10_000),
    ("low-ranks", 1005, ("A65432", "shdc"), 5, 5_000),
    ("broadway", 1006, ("AKQJT", "shdc"), 5, 5_000),
]
GOLDEN_EACH = 60
BLOCK = 10_000


def cmd_hands():
    sweeps, golden, total = [], [], 0
    for name, seed, (ranks, suits), nboard, n in SWEEPS:
        deck = deck_of(ranks, suits)
        rnd = Mulberry32(seed)
        digests, cats, h = [], [0] * 9, 0x811C9DC5
        for i in range(n):
            cards = draw(deck, 4 + nboard, rnd)
            hole, board = cards[:4], cards[4:]
            v = best_plo(hole, board)
            cats[v[0]] += 1
            h = fnv1a(",".join(map(str, v)) + ";", h)
            if i < GOLDEN_EACH:
                golden.append({"sweep": name, "hole": show(hole), "board": show(board), "value": list(v)})
            if (i + 1) % BLOCK == 0 or i + 1 == n:
                digests.append(h)
                h = 0x811C9DC5
        total += n
        sweeps.append({"name": name, "seed": seed, "ranks": ranks, "suits": suits, "board": nboard, "hands": n, "blockDigests": digests, "categories": cats})
    write("hands.json", {"source": "scripts/engine/plo_reference.py hands", "block": BLOCK, "total": total, "sweeps": sweeps, "golden": golden})


# ---- combinatorics: cards as r * 4 + s, r 0..12 for 2..A, s 0..3 for s h d c


def hand_index(cards):
    """The colexicographic index of four ascending cards: C(a,1) + C(b,2) + C(c,3) + C(d,4)."""
    a, b, c, d = cards
    return a + b * (b - 1) // 2 + c * (c - 1) * (c - 2) // 6 + d * (d - 1) * (d - 2) * (d - 3) // 24


def relabel(cards, perm):
    return tuple(sorted((c & ~3) | perm[c & 3] for c in cards))


def cmd_classes():
    perms = list(permutations(range(4)))
    reps, sizes, n = {}, {}, 0
    for hand in combinations(range(52), 4):
        n += 1
        images = {relabel(hand, p) for p in perms}
        rep = min(hand_index(x) for x in images)
        reps[rep] = len(images)
    for s in reps.values():
        sizes[s] = sizes.get(s, 0) + 1
    # Burnside, as a second count that never looks at a class: the mean, over the 24 relabellings, of the hands each fixes
    burnside = []
    fixed_sum = 0
    for perm, mult, name in [((0, 1, 2, 3), 1, "identity"), ((1, 0, 2, 3), 6, "one swap"), ((1, 0, 3, 2), 3, "two swaps"), ((1, 2, 0, 3), 8, "3-cycle"), ((1, 2, 3, 0), 6, "4-cycle")]:
        fixed = sum(1 for hand in combinations(range(52), 4) if relabel(hand, perm) == hand)
        burnside.append({"cycle": name, "of24": mult, "fixed": fixed})
        fixed_sum += fixed * mult
    assert fixed_sum % 24 == 0
    h = 0x811C9DC5
    for rep in sorted(reps):
        h = fnv1a(f"{rep}:{reps[rep]};", h)
    write(
        "classes.json",
        {
            "source": "scripts/engine/plo_reference.py classes",
            "hands": n,
            "classes": len(reps),
            "burnsideClasses": fixed_sum // 24,
            "burnside": burnside,
            "orbitSizes": {str(k): sizes[k] for k in sorted(sizes)},
            "digest": h,
        },
    )


# ---- equity: every remaining board, a player's share of each counted in 2520ths (1..9 way ties are whole numbers)

UNITS = 2520


def equity_exact(hands, board, dead=()):
    known = set(board) | set(dead)
    for h in hands:
        known |= set(h)
    live = [c for c in DECK if c not in known]
    wins, ties, shares, boards = [0] * len(hands), [0] * len(hands), [0] * len(hands), 0
    for extra in combinations(live, 5 - len(board)):
        full = list(board) + list(extra)
        values = [best_plo(h, full) for h in hands]
        top = max(values)
        best = [i for i, v in enumerate(values) if v == top]
        boards += 1
        for i in best:
            shares[i] += UNITS // len(best)
            if len(best) == 1:
                wins[i] += 1
            else:
                ties[i] += 1
    return {"boards": boards, "wins": wins, "ties": ties, "shares": shares}


def fixed_vector(hands, board, dead=()):
    return {"players": [show(h) for h in hands], "board": show(board), "dead": show(dead), **equity_exact(hands, board, dead)}


def range_vector(ranges, board):
    """Each range a list of (hand text, weight), the matchups weighted by the product, collisions dropped."""
    n = len(ranges)
    total, shares = 0.0, [0.0] * n
    matchups = 0
    tuples = [()]
    for r in ranges:
        tuples = [t + (x,) for t in tuples for x in r]
    for t in tuples:
        hs = [parse(x[0]) for x in t]
        cards = [c for h in hs for c in h] + list(board)
        if len(set(cards)) != len(cards):
            continue
        weight = 1
        for x in t:
            weight *= x[1]
        e = equity_exact(hs, board)
        matchups += 1
        total += weight * e["boards"]
        for i in range(n):
            shares[i] += weight * e["shares"][i] / UNITS
    return {"ranges": [[list(x) for x in r] for r in ranges], "board": show(board), "matchups": matchups, "equity": [s / total for s in shares]}


def random_spot(rnd, players, nboard, ndead=0):
    cards = draw(DECK, players * 4 + nboard + ndead, rnd)
    return [cards[i * 4 : i * 4 + 4] for i in range(players)], cards[players * 4 : players * 4 + nboard], cards[players * 4 + nboard :]


def cmd_equity():
    rnd = Mulberry32(2001)
    vectors = []
    for players, nboard, n, ndead in [(2, 5, 40, 0), (3, 5, 20, 0), (6, 5, 20, 0), (2, 4, 40, 0), (3, 4, 20, 0), (4, 4, 10, 0), (2, 4, 10, 3), (2, 3, 16, 0), (3, 3, 8, 0), (4, 3, 4, 0), (2, 3, 4, 5)]:
        for _ in range(n):
            hands, board, dead = random_spot(rnd, players, nboard, ndead)
            vectors.append(fixed_vector(hands, board, dead))
    # spots with the rule's traps in them, on flops with real draws
    for hands, board in [
        (["AsAhKsKh", "JdTd9c8c"], "Ad7c2h"),
        (["AsKsQsJs", "ThTd9c8c"], "2s7sTc"),
        (["KhKd9s8s", "AcQc7h6h"], "Ks5c4c"),
        (["7h7d5s4s", "AdKdQdJd", "9c9hTcTh"], "2d7c8d"),
    ]:
        vectors.append(fixed_vector([parse(h) for h in hands], parse(board)))
    ranges = [
        ([[("AsAhKsKh", 1), ("AdAcKdKc", 3), ("AsAdQsQd", 2)], [("JsTs9h8h", 2), ("JdTd9c8c", 1)]], "2c7h9d"),
        ([[("AsKsQhJh", 1), ("AhKhQdJd", 1), ("AdKdQcJc", 1), ("KsKhQsQh", 2)], [("9s9h7d6d", 1), ("9d9c7s6s", 1), ("TsTh8d7d", 1)]], "Qd8s3c"),
        ([[("AsAhKsKh", 1), ("AdAcKdKc", 1)], [("QsQhJsJh", 1), ("QdQcJdJc", 1)], [("9s9h8s8h", 2), ("9d9c8d8c", 1)]], "Tc4h2s"),
    ]
    range_vectors = [range_vector(r, parse(b)) for r, b in ranges]
    write("equity.json", {"source": "scripts/engine/plo_reference.py equity", "units": UNITS, "vectors": vectors, "rangeVectors": range_vectors})


def preflop_exact(hands):
    """Every 5-card board, read from a table of each hand's best with every 3 of them: the same 60 hands as
    best_plo, which at 130 million five-card values for one matchup would take some minutes."""
    known = {c for h in hands for c in h}
    live = [c for c in DECK if c not in known]
    tables = []
    for hole in hands:
        pairs = list(combinations(hole, 2))
        tables.append({t: max(rank5(list(p) + list(t)) for p in pairs) for t in combinations(live, 3)})
    index = {v: i for i, v in enumerate(sorted({v for t in tables for v in t.values()}))}
    tables = [{k: index[v] for k, v in t.items()} for t in tables]
    n = len(hands)
    wins, ties, shares, boards = [0] * n, [0] * n, [0] * n, 0
    for a, b, c, d, e in combinations(live, 5):
        triples = ((a, b, c), (a, b, d), (a, b, e), (a, c, d), (a, c, e), (a, d, e), (b, c, d), (b, c, e), (b, d, e), (c, d, e))
        values = [max(t[x] for x in triples) for t in tables]
        top = max(values)
        best = [i for i in range(n) if values[i] == top]
        boards += 1
        if len(best) == 1:
            wins[best[0]] += 1
            shares[best[0]] += UNITS
        else:
            for i in best:
                ties[i] += 1
                shares[i] += UNITS // len(best)
    return {"boards": boards, "wins": wins, "ties": ties, "shares": shares}


def cmd_preflop():
    vectors = []
    for hands in [["AsAhKsKh", "JdTd9c8c"], ["AsAhKdQc", "9s8s7h6h"], ["AsKsQhJh", "9d9c8d7c", "TsTh6c5d"]]:
        parsed = [parse(h) for h in hands]
        vectors.append({"players": hands, "board": "", "dead": "", **preflop_exact(parsed)})
    write("equity_preflop.json", {"source": "scripts/engine/plo_reference.py preflop", "units": UNITS, "vectors": vectors})


def hand_against_range(hero, flop, holds):
    """Exact, one hand on a flop against every hand `holds` picks: every hand with every turn and river it doesn't
    block. Each board's value for a two-card pair is worked out once, and a hand's is the best of its six pairs."""
    live = [c for c in DECK if c not in hero and c not in flop]
    hands = [(h, list(combinations(h, 2))) for h in combinations(live, 4) if holds(h)]
    matchups, units = 0, 0
    for x, y in combinations(live, 2):
        board = list(flop) + [x, y]
        mine = best_plo(hero, board)
        triples = list(combinations(board, 3))
        rest = [c for c in live if c != x and c != y]
        pairs = {p: max(rank5(list(p) + list(t)) for t in triples) for p in combinations(rest, 2)}
        for h, ps in hands:
            if x in h or y in h:
                continue
            theirs = max(pairs[p] for p in ps)
            matchups += 1
            units += 2 if mine > theirs else 1 if mine == theirs else 0
    return {"hero": show(hero), "board": show(flop), "hands": len(hands), "matchups": matchups, "halves": units}


def cmd_cited():
    """The hands of the one published flop example with its opponents fully defined (see equity.test.ts), counted."""
    hero, flop = parse("Jc9c8d7d"), parse("KdQdTh")
    ace_jack = hand_against_range(hero, flop, lambda h: any(c[0] == 14 for c in h) and any(c[0] == 11 for c in h))
    ad_jd = hand_against_range(hero, flop, lambda h: (14, "d") in h and (11, "d") in h)
    write("equity_cited.json", {"source": "scripts/engine/plo_reference.py cited", "AJxx": ace_jack, "AdJdxx": ad_jd})


# ---- pot-limit hands, in cents. Written from the rules, not from web/src/poker/table.ts:
#  - the most a seat may make it: call first, then raise by the pot as it stands after the call (TDA Rule 56-C);
#  - preflop that pot is counted as if every blind were posted in full (TDA Rule 56-B), antes as the chips they are;
#  - a seat that has acted may raise again only when it faces at least the last full bet or raise, one or several
#    short all-ins together (TDA Rule 49-A); a raise under that size can only be all-in;
#  - the smallest raise is by the last full bet or raise of the round, on the highest bet (Rule 45-A, 49-A);
#  - a bet nobody matched goes back; the pots are found one chip at a time.

SEATS = {
    2: ["SB", "BB"],
    3: ["BTN", "SB", "BB"],
    4: ["CO", "BTN", "SB", "BB"],
    5: ["HJ", "CO", "BTN", "SB", "BB"],
    6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
    7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    8: ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    9: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
}
BB = 100


def post_order(seats):
    return ["BB", "SB"] if len(seats) == 2 else ["SB", "BB"] + [p for p in seats if p not in ("SB", "BB")]


def bb(cents):
    return cents / 100


class PotLimitHand:
    def __init__(self, stacks, sb, ante, straddle, rnd, shallow=False):
        self.seats = SEATS[len(stacks)]
        self.stacks = stacks
        self.left = dict(stacks)
        self.closed_in = {p: 0 for p in self.seats}  # from closed streets, and antes
        self.put = {p: 0 for p in self.seats}  # this street
        self.folded = set()
        self.rnd = rnd
        self.shallow = shallow
        self.steps = []
        self.straddler = self.seats[0] if straddle and len(self.seats) >= 3 else None
        for p in self.seats:
            paid = min(ante, self.left[p])
            self.left[p] -= paid
            self.closed_in[p] += paid
        self.missing = 0  # chips the blinds came up short, counted in the preflop pot all the same
        nominal = {"SB": sb, "BB": BB}
        if self.straddler:
            nominal[self.straddler] = 2 * BB
        for p, amount in nominal.items():
            paid = min(amount, self.left[p])
            self.left[p] -= paid
            self.put[p] += paid
            self.missing += amount - paid
        self.cur = 2 * BB if self.straddler else BB

    def can_act(self, p):
        return p not in self.folded and self.left[p] > 0

    def live(self):
        return [p for p in self.seats if p not in self.folded]

    def pot_count(self, street):
        pot = sum(self.closed_in.values()) + sum(self.put.values())
        return pot + self.missing if street == "preflop" else pot

    def street(self, name):
        order = (self.seats[1:] + [self.straddler] if self.straddler else list(self.seats)) if name == "preflop" else post_order(self.seats)
        if name != "preflop":
            self.cur = 0
            self.put = {p: 0 for p in self.seats}
        full = self.cur if name == "preflop" else BB  # the last full bet or raise
        moved = {}  # acted at all, this street: how many full raises there had been when it last did
        full_raises = 0
        waiting = set()  # has answered the latest raise
        i = 0
        while len(self.live()) > 1:
            can = [p for p in order if self.can_act(p)]
            need = [p for p in can if p not in waiting]
            if not need or (len(can) <= 1 and all(self.put[p] >= self.cur for p in can)):
                break
            # the next seat in order that still has to answer
            while order[i % len(order)] not in need:
                i += 1
            p = order[i % len(order)]
            i += 1
            to_call = self.cur - self.put[p]
            all_in_to = self.put[p] + self.left[p]
            call = min(to_call, self.left[p])
            pot_after_call = self.pot_count(name) + to_call
            cap = self.cur + pot_after_call
            may_raise = (p not in moved or to_call >= full) and any(q != p and self.can_act(q) for q in self.live())
            min_to = min(self.cur + full, all_in_to)
            max_to = min(cap, all_in_to)
            move = self.choose(p, call, to_call, may_raise, min_to, max_to, all_in_to)
            # a seat that acted, reopened by short all-ins alone: no full raise since, and yet it faces a full one's worth
            by_shorts = may_raise and moved.get(p) == full_raises
            self.steps.append(
                {"street": name, "pos": p, "pot": bb(sum(self.closed_in.values()) + sum(self.put.values())), "toCall": bb(call), "canRaise": may_raise, "minTo": bb(min_to), "maxTo": bb(max_to), "allInTo": bb(all_in_to), "reopened": by_shorts, "move": move}
            )
            action = move["action"]
            if action == "fold":
                self.folded.add(p)
            elif action in ("check", "call"):
                self.pay(p, call)
                waiting.add(p)
            else:
                to = all_in_to if action == "all-in" else round(move["to"] * 100)
                self.pay(p, to - self.put[p])
                if to > self.cur:
                    if to - self.cur >= full:
                        full = to - self.cur
                        full_raises += 1
                    self.cur = to
                    waiting = {p}
                else:
                    waiting.add(p)
            moved[p] = full_raises
        self.return_uncalled()

    def pay(self, p, chips):
        self.left[p] -= chips
        self.put[p] += chips

    def return_uncalled(self):
        ordered = sorted(self.put.values(), reverse=True)
        extra = ordered[0] - ordered[1]
        if extra > 0:
            top = next(p for p in self.seats if self.put[p] == ordered[0])
            self.put[top] -= extra
            self.left[top] += extra
        for p in self.seats:
            self.closed_in[p] += self.put[p]
            self.put[p] = 0

    def choose(self, p, call, to_call, may_raise, min_to, max_to, all_in_to):
        x = self.rnd()
        size = None
        if may_raise and self.left[p] > call:
            if self.shallow and x < 0.6:
                size = all_in_to if self.rnd() < 0.5 and all_in_to <= max_to else min_to
            elif x < 0.2:
                size = min_to
            elif x < 0.45:
                size = max_to
            elif x < 0.55:
                size = min_to + int(self.rnd() * (max_to - min_to + 1))
        if size is not None:
            if size >= all_in_to:
                return {"pos": p, "action": "all-in"}
            return {"pos": p, "action": "raise" if self.cur > 0 else "bet", "to": bb(size)}
        if to_call <= 0:
            return {"pos": p, "action": "check"}
        if x < 0.8:
            return {"pos": p, "action": "call"}
        return {"pos": p, "action": "fold"}


def side_pots(invested, live):
    """One chip at a time: each chip's layer is eligible to the live seats who reached it. A layer no live seat reached
    (a folded seat's chips over everyone's) falls to the pot under it. Main pot first."""
    pots = []
    for level in range(1, max(invested.values()) + 1):
        reached = [p for p, x in invested.items() if x >= level]
        eligible = sorted(p for p in reached if p in live)
        if pots and (not eligible or pots[-1]["eligible"] == eligible):
            pots[-1]["amount"] += len(reached)
        else:
            pots.append({"amount": len(reached), "eligible": eligible})
    return pots


def showdown(hand, holes, board):
    live = hand.live()
    invested = hand.closed_in
    if len(live) == 1:
        return {"pots": [], "pays": {live[0]: bb(sum(invested.values()))}, "values": {}}
    values = {p: best_plo(holes[p], board) for p in live}
    order = post_order(hand.seats)
    pays = {}
    pots = side_pots(invested, set(live))
    out = []
    for pot in pots:
        top = max(values[p] for p in pot["eligible"])
        winners = sorted((p for p in pot["eligible"] if values[p] == top), key=order.index)
        share, odd = divmod(pot["amount"], len(winners))
        for k, p in enumerate(winners):
            pays[p] = pays.get(p, 0) + share + (1 if k < odd else 0)
        out.append({"amount": bb(pot["amount"]), "eligible": pot["eligible"], "winners": winners})
    return {"pots": out, "pays": {p: bb(x) for p, x in pays.items()}, "values": {p: list(v) for p, v in values.items()}}


def play(rnd, shallow=False):
    """`shallow`: stacks a few big blinds apart, which is where short all-ins come one after another."""
    n = (4 + int(rnd() * 6)) if shallow else 2 + int(rnd() * 8)
    seats = SEATS[n]
    stacks = {}
    for p in seats:
        if shallow:
            stacks[p] = 150 + int(rnd() * 10) * 25
        else:
            stacks[p] = 10000 if rnd() < 0.3 else 20 + int(rnd() * 12000)
    sb = [50, 50, 50, 100, 40][int(rnd() * 5)]
    ante = [0, 0, 0, 10, 25, 50][int(rnd() * 6)]
    straddle = rnd() < 0.3
    cards = draw(DECK, 4 * n + 5, rnd)
    holes = {p: cards[i * 4 : i * 4 + 4] for i, p in enumerate(seats)}
    board = cards[4 * n :]
    hand = PotLimitHand(stacks, sb, ante, straddle, rnd, shallow)
    for name in ("preflop", "flop", "turn", "river"):
        hand.street(name)
        if len(hand.live()) == 1:
            break
    result = showdown(hand, holes, board)
    return {
        "players": n,
        "stacks": {p: bb(x) for p, x in stacks.items()},
        "smallBlind": bb(sb),
        "ante": bb(ante),
        "straddle": straddle,
        "hands": {p: show(h) for p, h in holes.items()},
        "board": show(board),
        "steps": hand.steps,
        "invested": {p: bb(x) for p, x in hand.closed_in.items()},
        "live": hand.live(),
        **result,
    }


def cmd_betting():
    rnd = Mulberry32(3001)
    write("betting.json", {"source": "scripts/engine/plo_reference.py betting", "hands": [play(rnd) for _ in range(200)] + [play(rnd, shallow=True) for _ in range(200)]})


def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, separators=(",", ":"))
    (OUT / name).write_text(text + "\n")
    print(f"{OUT / name}: {len(text):,} bytes")


if __name__ == "__main__":
    cmds = {"hands": cmd_hands, "classes": cmd_classes, "equity": cmd_equity, "preflop": cmd_preflop, "cited": cmd_cited, "betting": cmd_betting}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmds[sys.argv[1]]()
