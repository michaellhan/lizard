// Practice hands written as hand histories (history.ts) and read back by the importer (hh/replay.ts): the same
// seats, cards and moves, each move taken by the table as it was in Practice; only what the table showed is written.
import { describe, expect, it } from "vitest";
import { statsOf } from "@/features/analyze/stats";
import { finalSim, importHand } from "@/hh/replay";
import { resultOf } from "@/hh/results";
import { simulate, STREETS, type Lines, type Move, type Street, type TableSetup } from "@/poker/table";
import { dealNext, finish, newHand, phaseOf, runEnd, setupOf, simOf, withVillain, type PracticeHand } from "./practice";
import { practiceHistory, practiceRecord, PRACTICE_SITE, revealedMoves } from "./history";

const AT = new Date(2026, 10, 3, 10, 0, 0);
const SESSION = { id: "s1", startedAt: 1000 };

/** The hand played out move by move (each by the seat to act), cards dealt as they come, then settled. */
function played(h: PracticeHand, ...ms: Move[]): PracticeHand {
  const deal = () => {
    for (let p = phaseOf(h); p.kind === "deal"; p = phaseOf(h)) h = dealNext(h, p.street);
  };
  for (const m of ms) {
    deal();
    expect(simOf(h).toAct).toBe(m.pos);
    h = withVillain(h, m);
  }
  deal();
  expect(phaseOf(h).kind).toBe("over");
  return { ...h, result: finish(h) };
}
const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const folds = (...ps: string[]) => ps.map((p) => mv(p, "fold"));
const checks = (...ps: string[]) => ps.map((p) => mv(p, "check"));

const upTo = (l: Lines, s: Street, n: number) =>
  Object.fromEntries(STREETS.map((x, k) => [x, k < STREETS.indexOf(s) ? l[x] : x === s ? l[x].slice(0, n) : []])) as unknown as Lines;
/** each move as the table took it: who, and a fold, a check or the seat's street total after it */
const trace = (t: TableSetup, l: Lines, board: number) =>
  STREETS.flatMap((s) =>
    l[s].map((m, i) => [s, m.pos, m.action === "fold" || m.action === "check" ? m.action : simulate(t, upTo(l, s, i + 1), board).streets[s]!.bets[m.pos]]),
  );

/** written, read back, and the same hand on the table */
function roundTrip(h: PracticeHand) {
  const text = practiceHistory(h, SESSION.startedAt, AT);
  const r = importHand(text);
  expect(r.warnings).toEqual([]);
  expect(r.stopped).toBeNull();
  expect([r.hand.players, r.hand.hero, r.hand.hole, r.hand.board]).toEqual([h.players, h.hero, h.hands[h.hero], h.board.slice(0, h.shown)]);
  expect(r.setup.stacks).toEqual(setupOf(h).stacks);
  expect(trace(r.setup, r.lines, h.shown)).toEqual(trace(setupOf(h), h.lines, h.shown));
  const a = finalSim(r);
  const b = simOf(h);
  expect([a.pot, [...a.active], a.handOver]).toEqual([b.pot, [...b.active], b.handOver]);
  // what you won or lost, read back from the text as Analyze's results read it (a fold collected nothing; a hand
  // stopped as the preflop closed says nothing)
  const net = resultOf(r.hand, text).net;
  if (h.result!.cut) expect(net).toBeNull();
  else expect(net).toBeCloseTo(h.result!.net, 6);
  return { text, r, rec: practiceRecord(h, SESSION, AT) };
}
const brackets = (text: string) => text.match(/\[[^\]]*\]/g);

describe("a raise at the preflop solve's size", () => {
  // (the solve's 4-bets aren't the table's half big blind: 17.25bb, 27.6bb, kept to the cent)
  it.each([17.25, 27.6, 33.35])("goes through a history at %sbb, its chips and its result to the cent", (to) => {
    const h = newHand(6, 100, 0, 7, { pfSolve: true, pfSizes: true });
    const line = [mv("UTG", "raise", 2.5), ...folds("HJ", "CO"), mv("BTN", "raise", 7.5), mv("SB", "raise", to), ...folds("BB", "UTG", "BTN")];
    const { r, rec } = roundTrip(played(h, ...line));
    expect(r.lines.preflop.find((m) => m.pos === "SB" && m.action === "raise")?.to).toBe(to);
    expect(rec.setup).toEqual({ pfSizes: true });
  });
});

describe("Practice hands as hand histories", () => {
  it("a single-raised pot to a showdown: every move, the cards shown, the pot collected", () => {
    // (hand 1 of the session: you're on the button)
    const h = played(
      newHand(6, 100, 0, 7),
      ...folds("UTG", "HJ", "CO"),
      mv("BTN", "raise", 2.5),
      mv("SB", "fold"),
      mv("BB", "call"),
      mv("BB", "check"),
      mv("BTN", "bet", 1.8),
      mv("BB", "raise", 6),
      mv("BTN", "call"),
      ...checks("BB", "BTN"),
      mv("BB", "bet", 10),
      mv("BTN", "call"),
    );
    const { text, rec } = roundTrip(h);
    const lines = text.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Lizard Practice Hand #L1000-1: Hold'em No Limit (0.5/1) - 2026/11/03 10:00:00",
      "Table 'Lizard Practice' 6-max Seat #4 is the button",
      "Seat 1: UTG (100 in chips)",
    ]);
    expect(lines).toContain("Seat 4: You (100 in chips)");
    expect(lines).toContain(`Dealt to You [${h.hands.BTN!.join(" ")}]`);
    expect(lines).toContain("Dealt to UTG");
    for (const l of ["You: raises 1.5 to 2.5", "BB: calls 1.5", "You: bets 1.8", "BB: raises 4.2 to 6", "You: calls 4.2", "BB: bets 10", "You: calls 10"])
      expect(lines).toContain(l);
    expect(lines).toContain("*** SHOW DOWN ***");
    expect(lines).toContain(`BB: shows [${h.hands.BB!.join(" ")}]`);
    expect(lines).toContain("Total pot 37.5 | Rake 0");
    const won = Object.entries(h.result!.pays).map(([p, x]) => `${p === "BTN" ? "You" : p} collected ${x} from pot`);
    expect(lines.filter((l) => l.includes(" collected "))).toEqual(won);
    // the folded seats' cards stay hidden
    expect(brackets(text)).not.toContainEqual(`[${h.hands.UTG!.join(" ")}]`);
    expect(rec).toMatchObject({
      id: `${PRACTICE_SITE}|L1000-1|${h.hands.BTN!.join("")}`,
      site: PRACTICE_SITE,
      number: "L1000-1",
      played: "2026-11-03 10:00",
      hero: "BTN",
      players: 6,
      board: h.board.join(""),
      bb: "1bb",
      potType: "SRP",
      pot: 37.5,
      end: "showdown",
      decisions: 5,
      importId: "practice:s1",
      importedAt: AT.getTime(),
      text,
    });
  });

  it("a hand dealt to a pot: your preflop was drawn from the charts, so the history says so and its record is marked", async () => {
    // (hand 1 of a drill: you're on the button; your open and everyone's folds are the charts', the flop's yours)
    const line = [...folds("UTG", "HJ", "CO"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"), mv("BB", "check"), mv("BTN", "bet", 2), mv("BB", "fold")];
    const fresh = () => newHand(6, 100, 0, 21);
    const drill = played({ ...fresh(), pot: "srp" }, ...line);
    const { text, rec } = roundTrip(drill);
    expect(text).toContain("Preflop played for you from the charts: those moves aren't yours.");
    expect(rec).toMatchObject({ playedFor: "preflop", decisions: 1 });

    // none of it in your stats, what you did from the flop is
    const stats = (await statsOf([rec]))!;
    expect(stats.hands).toBe(1);
    for (const k of ["vpip", "pfr", "rfi"] as const) expect(stats.by[k].n).toBe(0);
    expect(stats.by.cbet).toMatchObject({ n: 1, k: 1 });

    // the same moves played by you are yours
    const own = roundTrip(played({ ...fresh(), n: 1 }, ...line));
    expect(own.text).not.toContain("played for you");
    expect(own.rec).not.toHaveProperty("playedFor");
    expect(own.rec.decisions).toBe(2);
    expect((await statsOf([own.rec]))!.by.vpip).toMatchObject({ n: 1, k: 1 });
  });

  it("your fold: every seat still dealt in, nothing after it written, no card the table didn't show", () => {
    // (hand 4: you're under the gun, first to act)
    const h = played(newHand(6, 100, 3, 11), mv("UTG", "fold"));
    const { text, rec } = roundTrip(h);
    expect(brackets(text)).toEqual([`[${h.hands.UTG!.join(" ")}]`]);
    expect(text).toContain("You folded: the rest of the hand wasn't played.");
    expect(text).not.toContain("collected");
    expect(rec).toMatchObject({ hero: "UTG", players: 6, board: "", end: "folded preflop", decisions: 1 });

    // a fold on the flop: the flop shown, not the turn
    const f = played(newHand(6, 100, 0, 12), ...folds("UTG", "HJ", "CO"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"), mv("BB", "bet", 4), mv("BTN", "fold"));
    const ff = roundTrip(f);
    const flop = f.board.slice(0, 3).join(" ");
    expect(brackets(ff.text)).toEqual([`[${f.hands.BTN!.join(" ")}]`, `[${flop}]`, `[${flop}]`]);
    expect(ff.rec.end).toBe("folded flop");
  });

  it("run it out after your fold: the others' moves, their showdown and the pot written; your fold kept as it was", () => {
    // (hand 1 of 3-max: you're on the button, first to act)
    let h: PracticeHand = { ...played(newHand(3, 100, 0, 7), mv("BTN", "fold")), run: "played" };
    for (const m of [mv("SB", "raise", 3), mv("BB", "call"), mv("SB", "bet", 4), mv("BB", "call"), ...checks("SB", "BB", "SB", "BB")]) {
      for (let p = phaseOf(h); p.kind === "deal"; p = phaseOf(h)) h = dealNext(h, p.street);
      expect(simOf(h).toAct).toBe(m.pos);
      h = withVillain(h, m);
    }
    const end = runEnd(h)!;
    const { text, rec } = roundTrip(h);
    expect(text).toContain(`*** SHOW DOWN ***\nSB: shows [${h.hands.SB!.join(" ")}]\nBB: shows [${h.hands.BB!.join(" ")}]\n`);
    for (const p of ["SB", "BB"]) if (end.pays[p]) expect(text).toContain(`${p} collected ${end.pays[p]} from pot`);
    expect(text).toContain("Total pot 14 | Rake 0\n");
    expect(text).toContain("You folded: the others played the rest of the hand by their strategies.");
    expect(rec).toMatchObject({ hero: "BTN", end: "folded preflop" });
  });

  it("everyone folds to you: the bet nobody called back, the pot collected", () => {
    const h = played(newHand(6, 100, 0, 13), ...folds("UTG", "HJ", "CO"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"), mv("BB", "check"), mv("BTN", "bet", 3), mv("BB", "fold"));
    const { text, rec } = roundTrip(h);
    expect(text).toContain("Uncalled bet (3) returned to You\nYou collected 5.5 from pot\n*** SUMMARY ***\nTotal pot 5.5 | Rake 0");
    expect(text).not.toContain("SHOW DOWN");
    expect(rec.end).toBe("won, all folded");
    // in the big blind, folded to: the small blind's half back
    const bb = played(newHand(6, 100, 4, 14), ...folds("UTG", "HJ", "CO", "BTN", "SB"));
    expect(roundTrip(bb).text).toContain("Uncalled bet (0.5) returned to You\nYou collected 1 from pot");
  });

  it("all-ins: a jam and its call run the board out; a bet all-in on the flop", () => {
    // heads-up, 20bb: you're the small blind and the button
    const h = played(newHand(2, 20, 0, 21), mv("SB", "raise", 2.5), mv("BB", "all-in"), mv("SB", "all-in"));
    const { text, rec } = roundTrip(h);
    expect(text).toContain("Table 'Lizard Practice' 2-max Seat #1 is the button");
    expect(text).toContain("BB: raises 17.5 to 20 and is all-in\nYou: calls 17.5 and is all-in\n*** FLOP ***");
    expect(text).toContain("*** RIVER ***");
    expect(text).toContain("Total pot 40 | Rake 0");
    expect(rec).toMatchObject({ hero: "SB", players: 2, potType: "3bet pot", pot: 40 });

    const f = played(newHand(3, 10, 0, 22), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"), mv("BB", "all-in"), mv("BTN", "call"));
    const ff = roundTrip(f);
    expect(ff.text).toContain("BB: bets 7.5 and is all-in\nYou: calls 7.5 and is all-in");
    expect(ff.rec.pot).toBe(20.5);
  });

  it("preflop only: stopped as the preflop closes, nothing after it written", () => {
    const h = played(newHand(6, 100, 0, 41, { preflopOnly: true }), ...folds("UTG", "HJ", "CO"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"));
    expect(h.result!.cut).toBe(true);
    const { text, rec } = roundTrip(h);
    expect(brackets(text)).toEqual([`[${h.hands.BTN!.join(" ")}]`]);
    expect(text).toContain("BB: calls 1.5\n*** SUMMARY ***\nPreflop only: the hand stopped as the preflop closed.");
    expect(rec).toMatchObject({ end: "preflop only", board: "", potType: "SRP", pot: 5.5, decisions: 1 });
  });

  it("an ante and a straddle: posted in the history, read back as the same game", () => {
    // (you're on the button; the straddler acts last preflop and first after it)
    const h = played(
      newHand(6, 100, 0, 7, { ante: 0.2, straddle: true }),
      ...folds("HJ", "CO"),
      mv("BTN", "raise", 6),
      ...folds("SB", "BB"),
      mv("UTG", "call"),
      ...checks("UTG", "BTN", "UTG", "BTN", "UTG", "BTN"),
    );
    const { text, r, rec } = roundTrip(h);
    expect(text).toContain("You: posts the ante 0.2\nSB: posts the ante 0.2\nBB: posts the ante 0.2\nSB: posts small blind 0.5\nBB: posts big blind 1\nUTG: posts straddle 2\n");
    expect([r.setup.ante, r.setup.straddle]).toEqual([0.2, true]);
    expect(finalSim(r).pot).toBeCloseTo(14.7);
    expect(rec).toMatchObject({ hero: "BTN", players: 6, potType: "SRP", end: "showdown" });
  });

  it("a rake: what it took in the summary, the pot paid less it", () => {
    const h = played(newHand(2, 100, 0, 7, { rake: 5, rakeCap: 0.2 }), mv("SB", "raise", 3), mv("BB", "call"), ...checks("BB", "SB", "BB", "SB", "BB", "SB"));
    expect(h.result?.rake).toBeCloseTo(0.2);
    const { text } = roundTrip(h);
    expect(text).toContain("Total pot 6 | Rake 0.2\n");
    expect(text).toMatch(/collected 5\.8 from pot/);
  });

  it("chips carried: each seat's own chips in the history, read back as the same stacks", () => {
    const h = played(
      newHand(3, 100, 1, 7, { carry: true }, { stacks: { BTN: 62.5, SB: 100, BB: 137.5 }, rebuys: ["SB"] }),
      mv("BTN", "raise", 3),
      ...folds("SB"),
      mv("BB", "call"),
      ...checks("BB", "BTN", "BB", "BTN", "BB", "BTN"),
    );
    const { text, r } = roundTrip(h);
    expect(text).toContain("Seat 1: BTN (62.5 in chips)\nSeat 2: SB (100 in chips)\nSeat 3: You (137.5 in chips)\n");
    expect(r.setup.stacks).toEqual({ BTN: 62.5, SB: 100, BB: 137.5 });
    expect(finalSim(r).pot).toBeCloseTo(6.5);
  });

  it("nine-handed, a limp and an isolation raise checked down: the seats' names apart", () => {
    // (hand 6: you're UTG1)
    const h = played(
      newHand(9, 100, 5, 31),
      mv("UTG", "call"),
      mv("UTG1", "raise", 4),
      ...folds("UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
      mv("UTG", "call"),
      ...checks("UTG", "UTG1", "UTG", "UTG1", "UTG", "UTG1"),
    );
    const { text, rec } = roundTrip(h);
    expect(text).toContain("UTG: calls 1\nYou: raises 3 to 4\nUTG2: folds");
    expect(rec).toMatchObject({ hero: "UTG1", players: 9, potType: "SRP", end: "showdown" });
  });
});

describe("a decision after Reveal, in a hand kept", () => {
  // (heads-up: the small blind's raise, the big blind's call, the big blind's check, your bet, its fold)
  const line = [mv("SB", "raise", 2.5), mv("BB", "call"), mv("BB", "check"), mv("SB", "bet", 2), mv("BB", "fold")];
  const dec = (street: Street, revealed: boolean) => ({ street, chose: "x", grade: null, provenance: null, mix: [], pot: 1, ...(revealed ? { revealed: true as const } : {}) });

  it("marks that decision by street and move: the second of yours is the fourth on the flop's line", () => {
    const base = played(newHand(2, 100, 0, 7), ...line);
    const h = { ...base, hero: "SB", decisions: [dec("preflop", false), dec("flop", true)] } as unknown as PracticeHand;
    expect(revealedMoves(h)).toEqual(["flop|1"]);
    expect(practiceRecord(h, SESSION, AT).revealed).toEqual(["flop|1"]);
  });

  it("says nothing on a hand with none", () => {
    const h = played(newHand(2, 100, 0, 7), ...line);
    expect(revealedMoves(h)).toEqual([]);
    expect(practiceRecord(h, SESSION, AT)).not.toHaveProperty("revealed");
  });

  it("keeps the rake and sizes the history can't say, and nothing on a hand with neither", () => {
    expect(practiceRecord(played(newHand(2, 100, 0, 7), ...line), SESSION, AT)).not.toHaveProperty("setup");
    const raked = played(newHand(2, 100, 0, 7, { rake: 5, rakeCap: 3, sizes: { flop: [50] } }), ...line);
    expect(practiceRecord(raked, SESSION, AT).setup).toEqual({ rake: 5, rakeCap: 3, sizes: { flop: [50] } });
    expect(practiceRecord(played(newHand(2, 100, 0, 7, { rake: 5 }), ...line), SESSION, AT).setup).toEqual({ rake: 5 });
  });
});
