import { describe, expect, it } from "vitest";
import { cmp, handName, rank7 } from "@/poker/evaluate";
import { DECK, seeded } from "@/poker/table";
import { cardId } from "./cards";
import { bestOmaha, bestOmahaHand, eval5, rankOmaha, toHandValue, FLUSH, FULL_HOUSE, HIGH_CARD, PAIR, QUADS, STRAIGHT, STRAIGHT_FLUSH, TRIPS, TWO_PAIR } from "./evaluate";
import hands from "./vectors/hands.json";

const split = (s: string) => s.match(/../g) ?? [];
const v = (hole: string, board: string) => rankOmaha(split(hole), split(board));

describe("five cards", () => {
  it("counts every one of the 2,598,960 hands as published: categories and the 7,462 distinct values", () => {
    const counts = new Array<number>(9).fill(0);
    const distinct = new Set<number>();
    for (let a = 4; a < 52; a++)
      for (let b = 3; b < a; b++)
        for (let c = 2; c < b; c++)
          for (let d = 1; d < c; d++)
            for (let e = 0; e < d; e++) {
              const x = eval5(a, b, c, d, e);
              counts[x >> 17]!++;
              distinct.add(x);
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    expect(distinct.size).toBe(7462);
  });

  it("agrees with poker/evaluate.ts's rank7 on values and on order, any card order", () => {
    const rnd = seeded(11);
    const deal = () => {
      const d = [...DECK];
      for (let i = 0; i < 5; i++) {
        const j = i + Math.floor(rnd() * (52 - i));
        [d[i], d[j]] = [d[j]!, d[i]!];
      }
      return d.slice(0, 5);
    };
    const score = (cs: string[]) => {
      const [a, b, c, d, e] = cs.map(cardId) as [number, number, number, number, number];
      return eval5(a, b, c, d, e);
    };
    for (let n = 0; n < 50_000; n++) {
      const x = deal();
      const y = deal();
      expect(toHandValue(score(x))).toEqual(rank7(x));
      expect(Math.sign(score(x) - score(y))).toBe(Math.sign(cmp(rank7(x), rank7(y))));
      expect(score([...x].reverse())).toBe(score(x));
    }
  });
});

describe("exactly two from the hand, exactly three from the board", () => {
  it("four of a suit in the hand: a flush only with three on the board", () => {
    expect(v("AsKsQsJs", "2s7s9sTd3c")[0]).toBe(FLUSH);
    expect(v("AsKsQsJs", "2s7sTd3c9h")[0]).toBe(HIGH_CARD); // two on the board: nothing, for all the spades in the hand
    expect(v("AsKsQsJs", "2s7s9sTd3c")).toEqual([FLUSH, 14, 13, 9, 7, 2]); // two of the hand: not its four
  });

  it("a one-card straight is no straight", () => {
    expect(v("8cJdJhQs", "4h5s6d7cKd")[0]).toBe(PAIR);
    expect(rank7(split("8cJd4h5s6d7cKd"))).toEqual([4, 8]); // what hold'em would call it
    expect(v("8c9dJhQs", "4h5s6d7cKd")).toEqual([STRAIGHT, 9]);
  });

  it("board two pair: three board cards hold one pair and a card", () => {
    expect(v("Ah2c3d4s", "KsKdQcQd7h")).toEqual([PAIR, 13, 14, 12, 4]);
    expect(v("Kh2c3d4s", "KsKdQcQd7h")).toEqual([TRIPS, 13, 12, 4]); // no full house off one king
    expect(v("KhQh3d4s", "KsKdQcQd7h")).toEqual([FULL_HOUSE, 13, 12]);
  });

  it("board quads: no quads, however the hand reads in hold'em", () => {
    expect(v("AdAc2h3h", "7c7d7h7sKd")).toEqual([FULL_HOUSE, 7, 14]);
    expect(v("QcQh2h3h", "7c7d7h7sKd")).toEqual([FULL_HOUSE, 7, 12]);
    expect(v("KcKh2h3h", "7c7d7h7sKd")).toEqual([FULL_HOUSE, 13, 7]); // three kings, with the board's
    expect(v("Ad2c3h4h", "7c7d7h7sKd")).toEqual([TRIPS, 7, 14, 4]); // the king stays on the board
    expect(cmp(v("AdAc2h3h", "7c7d7h7sKd"), v("QcQh2h3h", "7c7d7h7sKd"))).toBeGreaterThan(0); // a chop on 7777K in hold'em, A kicker apart
  });

  it("four to a flush on the board needs two of the suit in the hand", () => {
    expect(v("Js9d8c7h", "AsKsQs2s3d")[0]).not.toBe(FLUSH);
    expect(v("Js9s8c7h", "AsKsQs2s3d")).toEqual([FLUSH, 14, 13, 12, 11, 9]);
    // the flush is the hole cards' two with the board's best three
    expect(v("3s2c4d5h", "AsKsQsJsTs")[0]).toBe(HIGH_CARD);
  });

  it("trips on a paired board, with one of the rank in the hand", () => {
    expect(v("9sAd3c4c", "9c9d5h2sKd")).toEqual([TRIPS, 9, 14, 13]);
  });

  it("the board never plays: a royal on the board loses to a pair made from the hand", () => {
    expect(v("2c3d4h5h", "AsKsQsJsTs")).toEqual([HIGH_CARD, 14, 13, 12, 5, 4]);
    expect(v("Ac2d4h5h", "AsKsQsJsTs")).toEqual([PAIR, 14, 13, 12, 5]);
    expect(v("Kc2d9h9c", "AsKsQsJsTs")[0]).toBe(STRAIGHT); // K and 9 with the board's Q J T
  });

  it("quad deuces in the hand play as a pair", () => {
    expect(v("2c2d2h2s", "AsKd9c7h5d")).toEqual([PAIR, 2, 14, 13, 9]);
  });

  it("quads with a pocket pair and two on the board, and a royal needing both hole cards", () => {
    expect(v("7c7dAh2c", "7h7sKd3c9d")).toEqual([QUADS, 7, 13]);
    expect(v("AsKs2c3d", "QsJsTs4h4d")).toEqual([STRAIGHT_FLUSH, 14]);
  });

  it("names the five cards it played, and values them the same", () => {
    const b = bestOmahaHand(split("Js9s8c7h"), split("AsKsQs2s3d"));
    expect(b.hole).toEqual(["Js", "9s"]);
    expect(b.board).toEqual(["As", "Ks", "Qs"]);
    expect(b.value).toEqual(v("Js9s8c7h", "AsKsQs2s3d"));
    expect(handName(b.value)).toBe("A-high flush");
  });

  it("refuses a hand or a board of the wrong size", () => {
    expect(() => v("AsKs", "2c3c4c")).toThrow(/4 cards/);
    expect(() => v("AsKsQsJs", "2c3c")).toThrow(/3 to 5/);
  });
});

describe("the independent reference (scripts/engine/plo_reference.py)", () => {
  it("keeps every golden vector", () => {
    expect(hands.golden.length).toBeGreaterThanOrEqual(300);
    for (const g of hands.golden) expect([g.hole, g.board, ...v(g.hole, g.board)]).toEqual([g.hole, g.board, ...g.value]);
  });

  it("agrees on every one of 140,000 hands dealt the same way, each hand's value in a digest", () => {
    expect(hands.total).toBeGreaterThanOrEqual(100_000);
    const fnv = (text: string, h: number) => {
      let x = h;
      for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 0x01000193) >>> 0;
      return x;
    };
    for (const s of hands.sweeps) {
      const deck: number[] = [];
      for (const r of s.ranks) for (const u of s.suits) deck.push(cardId(r + u));
      const rnd = seeded(s.seed);
      const digests: number[] = [];
      const cats = new Array<number>(9).fill(0);
      let h = 0x811c9dc5;
      const need = 4 + s.board;
      const hole = [0, 0, 0, 0];
      const board = new Array<number>(s.board).fill(0);
      for (let n = 0; n < s.hands; n++) {
        const d = [...deck];
        for (let k = 0; k < need; k++) {
          const i = d.length - 1 - k;
          const j = Math.floor(rnd() * (i + 1));
          [d[i], d[j]] = [d[j]!, d[i]!];
          if (k < 4) hole[k] = d[i]!;
          else board[k - 4] = d[i]!;
        }
        const value = toHandValue(bestOmaha(hole, board));
        cats[value[0]!]!++;
        h = fnv(`${value.join(",")};`, h);
        if ((n + 1) % hands.block === 0 || n + 1 === s.hands) {
          digests.push(h);
          h = 0x811c9dc5;
        }
      }
      expect({ sweep: s.name, cats, digests }).toEqual({ sweep: s.name, cats: s.categories, digests: s.blockDigests });
    }
  });
});

it("the categories are poker/evaluate.ts's numbering", () => {
  expect([HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
