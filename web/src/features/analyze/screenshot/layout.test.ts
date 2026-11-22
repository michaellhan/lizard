import { describe, expect, it } from "vitest";
import type { FoundCard } from "./cards";
import { groupCards, positionsClockwise, seatLayout } from "./layout";
import type { StackRead } from "./numbers";

const card = (code: string, x: number, y: number, conf = 0.9): FoundCard => ({ code, box: { x, y, w: 40, h: 56 }, faceH: 56, conf, rankConf: conf, suitConf: conf, suitBy: "colour" });
const stack = (value: number, x: number, y: number): StackRead => ({ amount: { value, unit: "money" }, allIn: false, conf: 0.9, box: { x, y, w: 40, h: 14 }, from: String(value) });

describe("positionsClockwise", () => {
  it("names the seats from the button, clockwise", () => {
    expect(positionsClockwise(6, 0)).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "CO"]);
    expect(positionsClockwise(6, 2)).toEqual(["HJ", "CO", "BTN", "SB", "BB", "UTG"]);
    expect(positionsClockwise(9, 8)[0]).toBe("SB");
  });
  it("heads-up the button is the small blind", () => {
    expect(positionsClockwise(2, 0)).toEqual(["SB", "BB"]);
    expect(positionsClockwise(2, 1)).toEqual(["BB", "SB"]);
  });
  it("has nothing for a table size it doesn't know", () => expect(positionsClockwise(10, 0)).toEqual([]));
});

describe("groupCards", () => {
  const img = { width: 800, height: 600 };
  it("finds the board nearest the middle and the hands, lowest last", () => {
    const g = groupCards(
      [card("Kh", 300, 270), card("5h", 345, 270), card("6h", 390, 270), card("9d", 380, 480), card("Jc", 400, 480), card("Ac", 100, 100), card("Ad", 120, 100)],
      img,
    );
    expect(g.board.map((c) => c.code)).toEqual(["Kh", "5h", "6h"]);
    expect(g.hands.map((h) => h.map((c) => c.code).join(""))).toEqual(["AcAd", "9dJc"]);
    expect(g.loose).toEqual([]);
  });
  it("keeps a shown hand a little above the board out of it", () => {
    const g = groupCards([card("Kc", 60, 255), card("6h", 105, 255), card("Js", 250, 270), card("Qc", 300, 270), card("7d", 350, 270)], img);
    expect(g.board.map((c) => c.code)).toEqual(["Js", "Qc", "7d"]);
    expect(g.hands.map((h) => h.map((c) => c.code).join(""))).toEqual(["Kc6h"]);
  });
  it("takes a board with a card not read as the board, with the gap said", () => {
    // 5d 4s _ 3d 7c: the middle card unread, a card's room between two pairs side by side
    const g = groupCards([card("5d", 200, 270), card("4s", 245, 270), card("3d", 335, 270), card("7c", 380, 270), card("Kd", 380, 480), card("Tc", 400, 480)], img);
    expect(g.board.map((c) => c.code)).toEqual(["5d", "4s", "3d", "7c"]);
    expect(g.boardGap).toBe(true);
    expect(g.hands.map((h) => h.map((c) => c.code).join(""))).toEqual(["KdTc"]);
  });
  it("keeps a card on its own apart", () => {
    const g = groupCards([card("2c", 50, 50), card("9d", 380, 480), card("Jc", 400, 480)], img);
    expect(g.board).toEqual([]);
    expect(g.loose.map((c) => c.code)).toEqual(["2c"]);
  });
});

describe("seatLayout", () => {
  // six seats round a table centred at (400, 300): screen y grows down, so increasing angle is clockwise
  const ring = [stack(100, 380, 520), stack(200, 100, 400), stack(300, 100, 180), stack(400, 380, 60), stack(500, 660, 180), stack(600, 660, 400)];
  it("orders the seats clockwise and names them from the button", () => {
    const l = seatLayout(ring, { middle: { x: 400, y: 300 }, heroAt: { x: 400, y: 480 }, dealerAt: { x: 120, y: 360 } });
    const by = Object.fromEntries(l.seats.map((s) => [s.stack.amount.value, s.pos]));
    // the button's by the 200 seat; clockwise on: 300 SB, 400 BB, 500 UTG, 600 HJ, 100 CO
    expect(by).toEqual({ 200: "BTN", 300: "SB", 400: "BB", 500: "UTG", 600: "HJ", 100: "CO" });
    expect(l.seats.find((s) => s.hero)?.stack.amount.value).toBe(100);
  });
  it("names no seat without the button", () => {
    const l = seatLayout(ring, { heroAt: { x: 400, y: 480 } });
    expect(l.seats.every((s) => s.pos === null)).toBe(true);
    expect(l.dealer).toBe(-1);
  });
  it("past nine amounts keeps the outer ring (the nearer ones are bets)", () => {
    const many = [...ring, stack(1, 400, 300), stack(2, 420, 310), stack(3, 380, 290), stack(4, 390, 320)];
    const l = seatLayout(many, { middle: { x: 400, y: 300 } });
    expect(l.seats).toHaveLength(9);
    // (the one dropped: 3, nearest the middle)
    expect(l.seats.map((s) => s.stack.amount.value)).not.toContain(3);
  });
});
