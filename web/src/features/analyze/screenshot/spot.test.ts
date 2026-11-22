import { describe, expect, it } from "vitest";
import { fromSearch } from "@/features/study/studyState";
import type { FoundCard } from "./cards";
import type { Reading } from "./read";
import { draftOf, spotOf, valuesOf, type Values } from "./spot";

const card = (code: string, x: number, y: number, conf = 0.9): FoundCard => ({ code, box: { x, y, w: 40, h: 56 }, faceH: 56, conf, rankConf: conf, suitConf: conf, suitBy: "colour" });
const seat = (pos: string, value: number, hero = false, conf = 0.9) => ({
  stack: { amount: { value, unit: "money" as const }, allIn: false, conf, box: { x: 0, y: 0, w: 1, h: 1 }, from: String(value) },
  pos,
  hero,
  dealer: pos === "BTN",
});

function reading(over: Partial<Reading> = {}): Reading {
  const hero = [card("9d", 380, 480), card("Jc", 400, 480)];
  const board = [card("Kh", 300, 270), card("5h", 345, 270), card("6h", 390, 270)];
  return {
    width: 800,
    height: 600,
    cards: [...hero, ...board],
    groups: { board, hands: [hero], loose: [], boardGap: false },
    hero: { cards: hero, conf: 0.9 },
    fourColour: false,
    dealer: { x: 0, y: 0, r: 10, conf: 0.9 },
    blinds: { value: { sb: 1, bb: 2 }, conf: 0.9, from: "NL 1/2" },
    pot: { value: { value: 11, unit: "money" }, conf: 0.9, from: "Pot: 11" },
    unit: "money",
    currency: "",
    layout: {
      seats: [seat("CO", 180, true), seat("BTN", 300), seat("SB", 150), seat("BB", 260), seat("UTG", 400), seat("HJ", 90)],
      middle: { x: 400, y: 300 },
      hero: 0,
      dealer: 1,
    },
    lines: [],
    notes: [],
    ...over,
  };
}

describe("draftOf", () => {
  it("prefills what was read, each field marked", () => {
    const d = draftOf(reading());
    expect(d.players).toEqual({ value: 6, mark: "read" });
    expect(d.heroPos).toEqual({ value: "CO", mark: "read" });
    expect(d.hero).toEqual({ value: "9dJc", mark: "read" });
    expect(d.board).toEqual({ value: "Kh5h6h", mark: "read" });
    expect(d.bb).toEqual({ value: "2", mark: "read" });
    // yours (90bb) against the deepest other (200bb): the stacks shown are after the hand's bets, so always to check
    expect(d.stack).toEqual({ value: "90", mark: "check" });
    // the betting isn't in a picture: the line is a default, you open
    expect(d.line).toEqual({ value: "srp", mark: "guess" });
    expect(d.opener.value).toBe("CO");
    expect(d.caller.value).toBe("BB");
    expect(d.street).toEqual({ value: "flop", mark: "read" });
  });
  it("a turn or river board opens on the flop, a default rather than a reading", () => {
    const river = [card("Kh", 300, 270), card("5h", 345, 270), card("6h", 390, 270), card("2c", 435, 270), card("9s", 480, 270)];
    const d = draftOf(reading({ groups: { board: river, hands: [], loose: [], boardGap: false } }));
    expect(d.board.value).toBe("Kh5h6h2c9s");
    expect(d.street).toEqual({ value: "flop", mark: "guess" });
  });
  it("marks a board with an unread card in it to check", () => {
    expect(draftOf(reading({ groups: { ...reading().groups, boardGap: true } })).board.mark).toBe("check");
  });
  it("marks a card read without much confidence to check", () => {
    const hero = [card("9d", 380, 480, 0.4), card("Jc", 400, 480)];
    expect(draftOf(reading({ hero: { cards: hero, conf: 0.4 } })).hero.mark).toBe("check");
  });
  it("falls back to defaults marked not read where nothing was", () => {
    const d = draftOf(reading({ cards: [], groups: { board: [], hands: [], loose: [], boardGap: false }, hero: null, dealer: null, blinds: null, pot: null, layout: null }));
    expect(d.players).toEqual({ value: 6, mark: "guess" });
    expect(d.hero).toEqual({ value: "", mark: "guess" });
    expect(d.board.mark).toBe("guess");
    expect(d.stack).toEqual({ value: "100", mark: "guess" });
    expect(d.line.value).toBe("none");
    expect(d.street.value).toBe("preflop");
  });
  it("needs the blinds to turn money into big blinds, unless the room shows big blinds", () => {
    expect(draftOf(reading({ blinds: null })).stack.mark).toBe("guess");
    const bb = reading({ blinds: null, unit: "bb" });
    expect(draftOf(bb).stack.value).toBe("180");
  });
});

describe("spotOf", () => {
  const base = (): Values => valuesOf(draftOf(reading()));
  it("makes Study's link: the line in seat order, the board, your cards", () => {
    const { spot, problems } = spotOf(base());
    expect(problems).toEqual([]);
    expect(spot!.study.startsWith("/study?")).toBe(true);
    expect(spot!.study).toContain("hand=9dJc");
    expect(spot!.solve.startsWith("/solve?")).toBe(true);
    const h = fromSearch(spot!.study.slice("/study?".length))!;
    expect(h).toMatchObject({ players: 6, stack: 90, board: "Kh5h6h", flop: [], turn: [], river: [] });
    expect(h.preflop.map((a) => `${a.pos}:${a.action}${a.to ?? ""}`)).toEqual(["UTG:fold", "HJ:fold", "CO:raise2.5", "BTN:fold", "SB:fold", "BB:call"]);
  });
  it("a 3-bet pot: the 3-bettor raises and the opener calls", () => {
    const { spot } = spotOf({ ...base(), line: "3bet", opener: "CO", caller: "BTN", threeBet: "7.5" });
    expect(spot!.hand.preflop.filter((a) => a.action !== "fold").map((a) => `${a.pos}:${a.action}${a.to ?? ""}`)).toEqual(["CO:raise2.5", "BTN:raise7.5", "CO:call"]);
  });
  it("on the river the flop and turn check through, said so", () => {
    const { spot, notes } = spotOf({ ...base(), board: "Kh5h6h2c9s", street: "river" });
    expect(spot!.hand.flop.map((a) => `${a.pos}:${a.action}`)).toEqual(["BB:check", "CO:check"]);
    expect(spot!.hand.turn).toHaveLength(2);
    expect(notes.join(" ")).toMatch(/checked through/);
  });
  it("opens on an earlier street than the board, the rest dealt later", () => {
    const { spot, notes } = spotOf({ ...base(), board: "Kh5h6h2c" });
    expect(spot!.hand.board).toBe("Kh5h6h");
    expect(notes.join(" ")).toMatch(/2c comes later/);
  });
  it("preflop with no line opens Study's first decision", () => {
    const { spot } = spotOf({ ...base(), board: "", street: "preflop", line: "none" });
    expect(spot!.hand.preflop).toEqual([]);
    expect(spot!.hand.board).toBe("");
  });
  it("says what's wrong", () => {
    const p = (v: Partial<Values>) => spotOf({ ...base(), ...v }).problems.join(" | ");
    expect(p({ hero: "9d" })).toMatch(/your cards/);
    expect(p({ hero: "9d9d" })).toMatch(/your cards/);
    expect(p({ board: "Kh5h" })).toMatch(/the board/);
    expect(p({ hero: "Kh9d" })).toMatch(/both yours and on the board/);
    expect(p({ stack: "0" })).toMatch(/the stack/);
    expect(p({ street: "turn" })).toMatch(/the turn needs 4/);
    expect(p({ opener: "BB", caller: "CO" })).toMatch(/acts after the opener/);
    expect(p({ open: "500" })).toMatch(/the open/);
    expect(p({ line: "none" })).toMatch(/opens preflop/);
    expect(spotOf({ ...base(), hero: "" }).spot).toBeNull();
  });
  it("notes when your seat isn't in the pot", () => {
    expect(spotOf({ ...base(), heroPos: "UTG" }).notes.join(" ")).toMatch(/isn't one of the two in the pot/);
  });
});
