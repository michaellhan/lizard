// Text that isn't a hand history must not hold the page: a paste, or a hand restored from a backup, which stats and
// winnings read again each time Analyze opens. Each input here took seconds or more when its regex could backtrack over
// it (the audit's took 8 to 30 s); the bound is far over what these take now, for a machine busy with other work.
import { describe, expect, it } from "vitest";
import { handNumber, playedOf, prepare } from "@/features/analyze/analyze";
import { handWin } from "@/features/analyze/winnings";
import { parseRange } from "@/features/ranges/rangeText";
import { HandHistoryError, MAX_LINE, parseHandHistory, splitHands } from "./parse";
import { importHand } from "./replay";

const BOUND_MS = 2500;
const timed = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
/** Read or refused as a hand history's readers do, within the bound. */
const readsInTime = (text: string) => {
  const refused = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      if (!(e instanceof HandHistoryError)) throw e;
    }
  };
  expect(timed(() => refused(() => importHand(text)))).toBeLessThan(BOUND_MS);
  expect(timed(() => handWin(text))).toBeLessThan(BOUND_MS);
  expect(timed(() => handNumber(text))).toBeLessThan(BOUND_MS);
  expect(timed(() => playedOf(text))).toBeLessThan(BOUND_MS);
};
/** A hand that reaches the stakes, whatever comes first. */
const hand = (head: string, body = "") =>
  `${head}\nSeat 1: a ($100)\nSeat 2: b ($100)\nb: posts big blind $1\n*** HOLE CARDS ***\nDealt to a [Ah Kd]\n${body}a: folds\n`;
const lines = (l: string, n = 2400) => Array.from({ length: n }, () => l).join("\n");
const xml = (s: string) => `<session>${s}</session>`;

describe("what took seconds on the page's thread", () => {
  it.each<[string, string]>([
    ["the stakes: commas after a hand number", hand(`Hand #1 ${",".repeat(4000)}`)],
    ["the stakes: commas over many lines", hand(lines(`Hand #1 ${",".repeat(MAX_LINE - 8)}`, 8))],
    ["the stakes: digits", hand(`Hand #1 ${"1".repeat(4000)}`)],
    ["a street's header: spaces between the stars", `**${" ".repeat(4000)}x`],
    ["street headers: spaces, line after line", hand("Hand #1", `${lines(`**${" ".repeat(MAX_LINE - 3)}x`)}\n`)],
    ["a seat's stack: commas", `Seat 1: a (${",".repeat(200000)}`],
    ["seat lines: 20,000 of them", Array.from({ length: 20000 }, (_, i) => `Seat ${i + 1}: p${i} ($100)`).join("\n")],
    ["seat lines: stacks with no close, line after line", lines(`Seat 1: a ${"(1 ".repeat(150)}`)],
    ["a dealt line: brackets, line after line", hand("Hand #1", `${lines(`Dealt to ${"[".repeat(MAX_LINE - 9)}`)}\n`)],
    ["a dealt line: spaces, line after line", hand("Hand #1", `${lines(`Dealt to x${" ".repeat(MAX_LINE - 12)}x`)}\n`)],
    ["a board's brackets, line after line", hand("Hand #1", `${lines(`*** FLOP *** ${"[".repeat(MAX_LINE - 14)}`)}\n`)],
    ["a tournament's buy-in: digits", hand(`Tournament ${"1".repeat(4000)}`)],
    ["a tournament's level: spaces", hand(`Tournament Level${" ".repeat(4000)}x`)],
    ["Ignition's lines: spaces before a colon", `Ignition Hand #1\n${lines(`x${" ".repeat(MAX_LINE - 2)}x`)}`],
    ["Ignition's all-in", `Ignition Hand #1\n${lines("All-in(raise ".repeat(40))}`],
    ["a hand number: spaces", `Hand${" ".repeat(4000)}x`],
    ["2,000 actions: each replayed over all before it", hand("Hand #1", Array.from({ length: 2000 }, (_, i) => `${i % 2 ? "a" : "b"}: raises $1 to $${i + 2}\n`).join(""))],
    ["unclosed <game", "<game ".repeat(200000)],
    ["unclosed <player", xml(`<game>${"<player ".repeat(150000)}</game>`)],
    ["unclosed <round", xml(`<game>${'<round no="1">'.repeat(80000)}</game>`)],
    ["unclosed <cards", xml(`<game><round no="1">${"<cards ".repeat(180000)}</round></game>`)],
    ["unclosed <action", xml(`<game><round no="1">${"<action ".repeat(150000)}</round></game>`)],
    ["a board of a thousand rounds", xml(`<game>${'<round no="2"><cards type="Flop">HA HK HQ</cards></round>'.repeat(20000)}</game>`)],
  ])("%s", (_, text) => readsInTime(text));

  it("cuts a file of unclosed tags into nothing, at once, and a long <general> isn't repeated before each hand", () => {
    let out: string[] = [];
    expect(timed(() => (out = splitHands("<game ".repeat(200000))))).toBeLessThan(BOUND_MS);
    expect(out).toEqual([]);
    expect(timed(() => (out = splitHands(`<general ${"x".repeat(100000)}></general>${"<game></game>".repeat(20000)}`)))).toBeLessThan(BOUND_MS);
    expect(out).toHaveLength(20000);
    expect(out[0]).toBe("<session><game></game></session>");
  });

  it("imports a file of it in time, as Analyze does", async () => {
    const text = lines(`Hand #1 ${",".repeat(MAX_LINE - 8)}`, 1200);
    const t = performance.now();
    const p = await prepare([{ name: "x", text }], { id: "i", name: "x", at: 1 });
    expect(performance.now() - t).toBeLessThan(BOUND_MS);
    expect(p.hands).toEqual([]);
  });

  it.each<[string, string]>([
    ["spaces", " ".repeat(200000) + "x"],
    ["spaces round colons", `AKs${" ".repeat(100000)}:${" ".repeat(100000)}0.5`],
    ["colons", ":".repeat(200000)],
  ])("reads a range of %s", (_, text) => {
    expect(timed(() => parseRange(text))).toBeLessThan(BOUND_MS);
  });

  it("still reads what's round a colon as it did", () => {
    expect(parseRange("AKs : 0.5 , QQ  :  0.25").weights).toEqual({ AKs: 0.5, QQ: 0.25 });
    expect(parseRange(" AKs:0.5 ").weights).toEqual({ AKs: 0.5 });
    expect(parseRange("AKs:0.5:1").unknown).toEqual(["AKs:0.5:1"]);
  });
});

describe("what a history needs from the limits", () => {
  it("reads a line up to the limit, and leaves the rest of a longer one out", () => {
    const h = parseHandHistory(hand(`Hand #1 ($1/$2) ${"x".repeat(MAX_LINE * 2)}`));
    expect(h.bb).toBe(2);
  });

  it("refuses a hand of more seats than a table has, with the page's own words", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Seat ${i + 1}: p${i} ($100)`).join("\n");
    expect(() => parseHandHistory(text)).toThrow(/players in this hand: the page plays 2 to 9/);
  });
});
