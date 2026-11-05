// A player's name is whatever the site let them type: names that are also Object.prototype's keys have to read as names.
import { describe, expect, it } from "vitest";
import { handWin } from "@/features/analyze/winnings";
import { parseHandHistory } from "./parse";
import { importHand } from "./replay";
import { paidOf, resultOf } from "./results";

const history = (a: string, b: string, c: string, d: string, e: string, f: string) =>
  [
    "PokerStars Hand #1: Hold'em No Limit ($1/$2) - 2024/05/01 20:00:00",
    "Table 'x' 6-max Seat #1 is the button",
    `Seat 1: ${a} ($200)`,
    `Seat 2: ${b} ($150 in chips)`,
    `Seat 3: ${c} ($300)`,
    `Seat 4: ${d} ($200)`,
    `Seat 5: ${e} ($180)`,
    `Seat 6: ${f} ($220)`,
    `${b}: posts small blind $1`,
    `${c}: posts big blind $2`,
    `${a}: posts the ante $0.20`,
    `${d}: posts the ante $0.20`,
    "*** HOLE CARDS ***",
    `Dealt to ${a} [Ah Kd]`,
    `${d}: folds`,
    `${e}: folds`,
    `${f}: folds`,
    `${a}: raises $3 to $5`,
    `${b}: folds`,
    `${c}: calls $3`,
    "*** FLOP *** [2c 7d Ts]",
    `${c}: checks`,
    `${a}: bets $4`,
    `${c}: folds`,
    `Uncalled bet ($4) returned to ${a}`,
    `${a} collected $11.40 from pot`,
    "",
  ].join("\n");

const NAMES = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "__defineGetter__", "toLocaleString"];

describe("players named as Object.prototype's keys", () => {
  const plain = parseHandHistory(history("hero", "b", "c", "d", "e", "f"));

  it.each(NAMES)("%s in every place round the table reads as the same hand as any other name", (name) => {
    for (let k = 0; k < 6; k++) {
      const names = ["hero", "b", "c", "d", "e", "f"];
      names[k] = name;
      const [a, b, c, d, e, f] = names as [string, string, string, string, string, string];
      const h = parseHandHistory(history(a, b, c, d, e, f));
      expect(h.stacks).toEqual(plain.stacks);
      expect(Object.values(h.stacks).every(Number.isFinite)).toBe(true);
      expect(h.seats.map((s) => [s.seat, s.pos, s.stack])).toEqual(plain.seats.map((s) => [s.seat, s.pos, s.stack]));
      expect(h.actions).toEqual(plain.actions);
      expect(h.seats.every((s) => typeof s.pos === "string")).toBe(true);
      expect(importHand(history(a, b, c, d, e, f)).hand.hero).toBe(plain.hero);
      expect(resultOf(h, history(a, b, c, d, e, f)).net).toBe(resultOf(plain, history("hero", "b", "c", "d", "e", "f")).net);
      expect(paidOf(h, history(a, b, c, d, e, f))).toEqual(paidOf(plain, history("hero", "b", "c", "d", "e", "f")));
      expect(handWin(history(a, b, c, d, e, f))).toEqual(handWin(history("hero", "b", "c", "d", "e", "f")));
    }
  });

  it.each(NAMES)("reads an action by %s, who isn't at the table, as nobody's", (name) => {
    const text = history("hero", "b", "c", "d", "e", "f").replace("*** HOLE CARDS ***", `*** HOLE CARDS ***\n${name}: raises $10 to $12`);
    expect(parseHandHistory(text).actions).toEqual(plain.actions);
  });
});
