// PokerNow's hands download read as histories (pokernow.ts): made-up hands in the download's shape (the event codes
// as a real tournament download has them), each read by the importer as any site's history is, with every seat's
// result adding up to zero; and the hands it refuses, each saying why.
import { describe, expect, it } from "vitest";
import { prepare } from "@/features/analyze/analyze";
import { importHand } from "./replay";
import { parseHandHistory } from "./parse";
import { pokerNowHands } from "./pokernow";
import { resultOf } from "./results";

type Ev = Record<string, unknown>;
const ME = "me-id";
const players = (n = 4, stack = 20000) =>
  Array.from({ length: n }, (_, i) => ({ id: i === 1 ? ME : `p${i}`, seat: i + 1, name: i === 1 ? "hero one" : `villain${i}`, stack, ...(i === 1 ? { hand: ["Ah", "Kd"] } : {}) }));
const hand = (events: Ev[], over: Record<string, unknown> = {}) => ({
  id: "abcplo12",
  handVersion: 2,
  number: "7",
  gameType: "th",
  cents: true,
  smallBlind: 100,
  bigBlind: 200,
  ante: null,
  straddleSeat: null,
  dealerSeat: 4,
  startedAt: Date.UTC(2026, 10, 8, 18, 0, 0),
  bombPot: false,
  sevenDeuceBounty: null,
  doubleBoard: null,
  players: players(),
  events: events.map((payload, k) => ({ at: k, payload })),
  ...over,
});
const download = (hands: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ generatedAt: "2026-11-08T18:52:28.790Z", playerId: ME, hands, ...over });

// seats 1–4, button 4: seat 1 SB, seat 2 (you) BB, seat 3 CO
const blinds: Ev[] = [
  { type: 3, seat: 1, value: 100, allIn: false },
  { type: 2, seat: 2, value: 200, allIn: false },
];
const flop: Ev = { type: 9, turn: 1, run: 1, cards: ["Ks", "Qd", "9s"] };

describe("pokerNowHands", () => {
  it("reads a raised pot to a river showdown as the importer's history, every amount a street total", () => {
    const h = hand([
      ...blinds,
      { type: 8, seat: 3, value: 600, allIn: false }, // CO raises to 6
      { type: 11, seat: 4 },
      { type: 11, seat: 1 },
      { type: 7, seat: 2, value: 600, allIn: false }, // you call: 4 more
      flop,
      { type: 0, seat: 2 },
      { type: 7, seat: 3, value: 800, allIn: false }, // a bet into no bet
      { type: 8, seat: 2, value: 2400, allIn: false },
      { type: 7, seat: 3, value: 2400, allIn: false },
      { type: 9, turn: 2, run: 1, cards: ["2c"] },
      { type: 0, seat: 2 },
      { type: 0, seat: 3 },
      { type: 9, turn: 3, run: 1, cards: ["3h"] },
      { type: 7, seat: 2, value: 5000, allIn: false },
      { type: 11, seat: 3 },
      { type: 16, seat: 2, value: 5000 },
      { type: 10, seat: 2, value: 6100, pot: 6100, position: 1, runNumber: 1 },
      { type: 15 },
    ]);
    const [got] = pokerNowHands(download([h]))!;
    expect(got!.error).toBeUndefined();
    const t = got!.text!;
    expect(t).toContain("hero one: calls 4");
    expect(t).toContain("villain2: bets 8");
    expect(t).toContain("hero one: raises 16 to 24");
    expect(t).toContain("*** TURN *** [Ks Qd 9s] [2c]");
    const p = parseHandHistory(t);
    expect(p).toMatchObject({ site: "PokerNow", bb: 2, players: 4, hero: "BB", heroName: "hero one", hole: ["Ah", "Kd"], board: ["Ks", "Qd", "9s", "2c", "3h"] });
    expect(p.tournament).toBeUndefined(); // no tournamentSlug: a cash game
    expect(p.actions.map((a) => [a.street, a.pos, a.act, a.to])).toEqual([
      ["preflop", "CO", "raise", 3],
      ["preflop", "BTN", "fold", undefined],
      ["preflop", "SB", "fold", undefined],
      ["preflop", "BB", "call", 3],
      ["flop", "BB", "check", undefined],
      ["flop", "CO", "bet", 4],
      ["flop", "BB", "raise", 12],
      ["flop", "CO", "call", 12],
      ["turn", "BB", "check", undefined],
      ["turn", "CO", "check", undefined],
      ["river", "BB", "bet", 25],
      ["river", "CO", "fold", undefined],
    ]);
    // won the SB's 0.5bb and CO's 15bb; every seat's result adds up to zero (no rake)
    expect(resultOf(p, t).net).toBe(15.5);
    expect(p.seats.reduce((n, s) => n + resultOf(p, t, s.pos).net!, 0)).toBeCloseTo(0, 9);
    expect(importHand(t).stopped).toBeFalsy();
  });

  it("keeps a tournament's name, reads chips without cents as written, and plays only a run-it-twice's first board", () => {
    const h = hand(
      [
        ...blinds,
        { type: 8, seat: 3, value: 20000, allIn: true },
        { type: 11, seat: 4 },
        { type: 11, seat: 1 },
        { type: 7, seat: 2, value: 20000, allIn: true },
        { type: 12, seat: 3, cards: ["Qc", "Qh"] },
        { type: 12, seat: 2, cards: ["Ah", "Kd"] },
        { ...flop, cards: ["2s", "7d", "Jc"] },
        { type: 9, turn: 2, run: 1, cards: ["4c"] },
        { type: 9, turn: 3, run: 1, cards: ["Ad"] },
        { type: 9, turn: 1, run: 2, cards: ["3s", "8d", "Th"] },
        { type: 9, turn: 2, run: 2, cards: ["5c"] },
        { type: 9, turn: 3, run: 2, cards: ["6d"] },
        { type: 10, seat: 2, value: 20050, pot: 40100, position: 1, runNumber: 1 },
        { type: 10, seat: 3, value: 20050, pot: 40100, position: 1, runNumber: 2 },
        { type: 15 },
      ],
      { cents: false },
    );
    const [got] = pokerNowHands(download([h], { tournamentSlug: "plo-stud-explorers" }))!;
    const p = parseHandHistory(got!.text!);
    // (the tournament's name says "plo" and "stud": it's still a Hold'em hand)
    expect(p.tournament).toEqual({ id: "plo-stud-explorers", name: "plo-stud-explorers" });
    expect(p).toMatchObject({ bb: 200, board: ["2s", "7d", "Jc", "4c", "Ad"] });
    expect(p.actions.at(-1)).toMatchObject({ pos: "BB", act: "call", to: 100, allIn: true });
    expect(got!.text).toContain("villain2: shows [Qc Qh]");
    expect(resultOf(p, got!.text!).net).toBe(0.25); // half of the 200.5bb pot, less 100bb
  });

  it("brings every street's header when one event deals more than one street", () => {
    const h = hand([
      ...blinds,
      { type: 8, seat: 3, value: 20000, allIn: true },
      { type: 11, seat: 4 },
      { type: 11, seat: 1 },
      { type: 7, seat: 2, value: 20000, allIn: true },
      { type: 9, turn: 1, run: 1, cards: ["2s", "7d", "Jc", "4c", "Ad"] },
      { type: 10, seat: 2, value: 40100, pot: 40100, position: 1 },
      { type: 15 },
    ]);
    const t = pokerNowHands(download([h]))![0]!.text!;
    expect(t).toContain("*** FLOP *** [2s 7d Jc]\n*** TURN *** [2s 7d Jc] [4c]\n*** RIVER *** [2s 7d Jc 4c] [Ad]");
    expect(parseHandHistory(t).board).toHaveLength(5);
  });

  it("writes names the importer can't mistake for its own lines, and tells two players of one name apart", () => {
    const ps = players();
    ps[0]!.name = "Dealt to me";
    ps[2]!.name = "villain3";
    ps[3]!.name = "villain3";
    ps[1]!.name = "Cashout [king]: posts";
    const h = hand([...blinds, { type: 11, seat: 3 }, { type: 11, seat: 4 }, { type: 11, seat: 1 }, { type: 16, seat: 2, value: 100 }, { type: 10, seat: 2, value: 200, pot: 200, position: 1 }, { type: 15 }], { players: ps });
    const t = pokerNowHands(download([h]))![0]!.text!;
    const p = parseHandHistory(t);
    expect(p.seats.map((s) => s.name)).toEqual(["_Dealt to me", "cash_out _king__ posts", "villain3", "villain3_4"]);
    expect(p.actions.map((a) => [a.pos, a.act])).toEqual([["CO", "fold"], ["BTN", "fold"], ["SB", "fold"]]);
    expect(resultOf(p, t).net).toBe(0.5);
  });

  it("refuses the hands it can't read, each saying why, and leaves other text alone", () => {
    const done: Ev[] = [...blinds, { type: 11, seat: 3 }, { type: 15 }];
    const got = pokerNowHands(
      download([
        hand(done, { gameType: "omaha" }),
        hand([...done.slice(0, 2), { type: 4, seat: 3, value: 25 }, { type: 15 }]),
        hand(done.slice(0, 3)),
        hand(done, { bombPot: true }),
        "x",
      ]),
    )!;
    expect(got.map((g) => g.error)).toEqual([
      "Only Hold'em hands can be imported.",
      "PokerNow event type 4 isn't read here yet (antes, straddles and the like), so the hand is left out.",
      "This hand hadn't finished when the hands were downloaded.",
      "A bomb pot has no preflop betting: the page can't play it.",
      "A hand in the download can't be read.",
    ]);
    expect(pokerNowHands(download([], { playerId: undefined }))![0]!.error).toMatch(/no "playerId"/);
    expect(pokerNowHands('{"name": "package.json"}')![0]!.error).toMatch(/Not a PokerNow hands download/);
    expect(pokerNowHands("PokerStars Hand #1: Hold'em No Limit ($0.5/$1)")).toBeNull();
  });

  it("goes through Analyze's import: hands kept, a walk skipped, a refused hand listed with its number", async () => {
    const won: Ev[] = [...blinds, { type: 8, seat: 3, value: 500 }, { type: 11, seat: 4 }, { type: 11, seat: 1 }, { type: 11, seat: 2 }, { type: 16, seat: 3, value: 300 }, { type: 10, seat: 3, value: 500, pot: 500, position: 1 }, { type: 15 }];
    const walk: Ev[] = [...blinds, { type: 11, seat: 3 }, { type: 11, seat: 4 }, { type: 11, seat: 1 }, { type: 16, seat: 2, value: 100 }, { type: 10, seat: 2, value: 200, pot: 200, position: 1 }, { type: 15 }];
    const text = download([hand(won, { number: "1", id: "a" }), hand(walk, { number: "2", id: "b" }), hand(won.slice(0, 3), { number: "3", id: "c" })]);
    const prep = await prepare([{ name: "poker-now-hands.json", text }], { id: "i", name: "n", at: 0 }, undefined, 100, async () => {});
    expect(prep.total).toBe(3);
    expect(prep.hands.map((h) => [h.site, h.number.split("-")[0], h.hero, h.end])).toEqual([["PokerNow", "1", "BB", "folded preflop"]]);
    expect(prep.skipped).toMatchObject({ noDecisions: 1, failed: 1 });
    expect(prep.errors).toEqual([{ n: 3, number: "3", msg: "This hand hadn't finished when the hands were downloaded." }]);
    // the hand's time is this browser's clock
    const d = new Date(Date.UTC(2026, 10, 8, 18, 0, 0));
    expect(prep.hands[0]!.played).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`);
  });
});
