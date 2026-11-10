import { describe, expect, it } from "vitest";
import { following, gameLabel, newHand, nextTable, stateFor, type DealOptions, type HandTournament } from "./practice";
import { draftOf, readDraft } from "./TournamentFields";
import { LEVEL_HANDS, moveOn, ordinal } from "./tournamentPlay";

const hand = (players: number, hero: string, stacks: Record<string, number>, tournament: HandTournament) => ({ players, hero, stacks, tournament });

describe("a tournament played out", () => {
  it("says places in words", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  it("moves the button on as a ring game's chips do when nobody's out", () => {
    const stacks = { UTG: 40, HJ: 25, CO: 60, BTN: 33, SB: 18, BB: 50 };
    const chips = { UTG: 38, HJ: 25, CO: 70, BTN: 31, SB: 17, BB: 45 };
    const m = moveOn(hand(6, "CO", stacks, { model: "icm", payouts: [50, 30, 20], field: { players: 30, avg: 40 } }), chips);
    const ring = nextTable({ players: 6, stack: 40 } as never, chips);
    expect(m.table!.stacks).toEqual(ring.stacks);
    expect(m.table!.hero).toBe("HJ");
    expect(m.table!.players).toBe(6);
    expect(m.table!.tournament).toEqual({ model: "icm", payouts: [50, 30, 20], field: { players: 30, avg: 40 }, played: 1 });
    expect(m.news).toEqual([]);
  });

  it("replaces a player out from the other tables, unpaid before the money", () => {
    const m = moveOn(hand(3, "BTN", { BTN: 20, SB: 10, BB: 30 }, { model: "icm", payouts: [50, 30, 20], field: { players: 2, avg: 20 } }), { BTN: 30, SB: 0, BB: 30 });
    expect(m.news).toEqual(["SB is out in 5th.", "A player from another table takes SB's seat with 20bb."]);
    // (the button goes to the newcomer in the small blind's place, the big blind's player to the small blind, you to the big blind)
    expect(m.table).toEqual({
      players: 3,
      hero: "BB",
      stacks: { BTN: 20, SB: 30, BB: 30 },
      tournament: { model: "icm", payouts: [50, 30, 20], field: { players: 1, avg: 20 }, played: 1, news: m.news },
    });
  });

  it("shortens the table with nobody left elsewhere, and bursts the bubble", () => {
    const m = moveOn(hand(3, "BTN", { BTN: 20, SB: 10, BB: 30 }, { model: "icm", payouts: [65, 35] }), { BTN: 30, SB: 0, BB: 30 });
    expect(m.news).toEqual(["SB is out in 3rd.", "The table is heads-up now.", "The bubble bursts: 2 left, all paid."]);
    expect(m.table).toMatchObject({ players: 2, hero: "BB", stacks: { SB: 30, BB: 30 }, tournament: { payouts: [65, 35] } });
  });

  it("pays a player out in the money the lowest prize left, and the prizes lose it", () => {
    const m = moveOn(hand(4, "BTN", { CO: 5, BTN: 30, SB: 30, BB: 35 }, { model: "icm", payouts: [50, 30, 20] }), { CO: 0, BTN: 35, SB: 30, BB: 35 });
    expect(m.news[0]).toBe("CO is out in 4th.");
    const m2 = moveOn({ ...m.table!, tournament: m.table!.tournament }, { BTN: 0, SB: 40, BB: 60 });
    expect(m2.news[0]).toBe("BTN is out in 3rd, paid 20.");
    expect(m2.table!.tournament.payouts).toEqual([50, 30]);
  });

  it("places two out in one hand by the chips they started it with", () => {
    const m = moveOn(hand(4, "BB", { CO: 12, BTN: 8, SB: 40, BB: 40 }, { model: "icm", payouts: [50, 30, 20] }), { CO: 0, BTN: 0, SB: 40, BB: 60 });
    expect(m.news.slice(0, 2)).toEqual(["BTN is out in 4th.", "CO is out in 3rd, paid 20."]);
    expect(m.table!.tournament.payouts).toEqual([50, 30]);
  });

  it("is over for you when you're out, or when you have every chip", () => {
    const t: HandTournament = { model: "icm", payouts: [65, 35], played: 7 };
    expect(moveOn(hand(2, "SB", { SB: 20, BB: 30 }, t), { SB: 0, BB: 50 })).toEqual({ table: null, news: ["You're out in 2nd, paid 35. A new tournament starts from the setup."] });
    expect(moveOn(hand(2, "SB", { SB: 20, BB: 30 }, t), { SB: 50, BB: 0 })).toEqual({ table: null, news: ["BB is out in 2nd, paid 35.", "You won the tournament: first place, 65. A new tournament starts from the setup."] });
    const early = moveOn(hand(3, "BTN", { BTN: 5, SB: 30, BB: 30 }, { model: "icm", payouts: [50, 30], field: { players: 40, avg: 30 } }), { BTN: 0, SB: 35, BB: 30 });
    expect(early.news).toEqual(["You're out in 43rd, out of the money (2 paid). A new tournament starts from the setup."]);
    expect(moveOn(hand(2, "BB", { SB: 20, BB: 30 }, { model: "chips" }), { SB: 0, BB: 50 }).news).toEqual(["SB is out in 2nd.", "You won the tournament. A new tournament starts from the setup."]);
  });

  it("raises the blinds every level, and the other tables lose players", () => {
    const m = moveOn(hand(2, "SB", { SB: 50, BB: 50 }, { model: "icm", payouts: [50, 30, 20], field: { players: 20, avg: 25 }, played: LEVEL_HANDS - 1 }), { SB: 60, BB: 40 });
    expect(m.table!.stacks).toEqual({ SB: 32, BB: 48 });
    expect(m.table!.tournament).toMatchObject({ played: LEVEL_HANDS, field: { players: 18, avg: 22.22 }, payouts: [50, 30, 20] });
    expect(m.news).toEqual(["2 players are out at the other tables.", "The blinds go up (level 2): every stack is 1.25× fewer big blinds."]);
  });

  it("pays a KO bounty to whoever won the chips, and it follows its player round the table", () => {
    const ko = { format: "ko" as const, seats: { BTN: 10, SB: 10, BB: 12 }, field: 10 };
    const m = moveOn(hand(3, "BTN", { BTN: 20, SB: 10, BB: 30 }, { model: "icm", payouts: [50, 30, 20], field: { players: 2, avg: 20 }, bounty: ko }), { BTN: 30, SB: 0, BB: 30 });
    expect(m.news).toEqual(["SB is out in 5th.", "You take SB's bounty, 10.", "A player from another table takes SB's seat with 20bb."]);
    // (you to the big blind with your 10, BB's player to the small blind with 12, the newcomer on the button with 10)
    expect(m.table!.tournament.bounty).toEqual({ format: "ko", seats: { BTN: 10, SB: 12, BB: 10 }, field: 10 });
    expect(m.table!.tournament.won).toBe(10);
  });

  it("splits a PKO bounty: half paid, half onto the taker's own", () => {
    const pko = { format: "pko" as const, seats: { CO: 8, BTN: 10, SB: 10, BB: 10 }, field: 10 };
    const m = moveOn(hand(4, "BB", { CO: 12, BTN: 30, SB: 30, BB: 28 }, { model: "icm", payouts: [50, 30, 20], bounty: pko, won: 3 }), { CO: 0, BTN: 42, SB: 30, BB: 28 });
    expect(m.news.slice(0, 2)).toEqual(["CO is out in 4th.", "BTN takes CO's bounty, 8: 4 paid, 4 onto theirs."]);
    // (BTN's player is the big blind now, 3-handed)
    expect(m.table!.tournament.bounty!.seats).toEqual({ BTN: 10, SB: 10, BB: 14 });
    expect(m.table!.tournament.won).toBe(3);
  });

  it("says the bounties you collected when it's over, a winner's own bounty theirs too", () => {
    const pko = { format: "pko" as const, seats: { SB: 15, BB: 20 }, field: 10 };
    expect(moveOn(hand(2, "SB", { SB: 20, BB: 30 }, { model: "icm", payouts: [65, 35], bounty: pko, won: 5 }), { SB: 50, BB: 0 }).news).toEqual([
      "BB is out in 2nd, paid 35.",
      "You take BB's bounty, 20: 10 paid, 10 onto yours.",
      "You won the tournament: first place, 65, and your own bounty, 25. You collected 40 in bounties. A new tournament starts from the setup.",
    ]);
    expect(moveOn(hand(2, "SB", { SB: 20, BB: 30 }, { model: "icm", payouts: [65, 35], bounty: pko }), { SB: 0, BB: 50 }).news).toEqual([
      "BB takes your bounty, 15: 7.5 paid, 7.5 onto theirs.",
      "You're out in 2nd, paid 35. You collected 0 in bounties. A new tournament starts from the setup.",
    ]);
  });
});

describe("Practice's tournament session played out", () => {
  const opts: DealOptions = { carry: true, tournament: { model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 30 }, stacks: { BTN: 30, SB: 20, BB: 40 } } };

  it("deals each hand from where the last left the tournament, and starts it over on a reset", () => {
    const h0 = newHand(3, 40, 0, 1, opts);
    expect(h0.hero).toBe("BTN");
    expect(h0.stacks).toEqual({ BTN: 30, SB: 20, BB: 40 });
    // (a hand not finished leaves the chips as they were: the seats move on)
    const h1 = following(h0, 2, opts);
    expect(h1.hero).toBe("BB");
    expect(h1.stacks).toEqual({ BTN: 20, SB: 40, BB: 30 });
    expect(h1.tournament).toEqual({ model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 30 }, played: 1 });
    const again = following(h1, 3, opts, true);
    expect(again.stacks).toEqual({ BTN: 30, SB: 20, BB: 40 });
    expect(again.tournament).toEqual({ model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 30 }, played: 0 });
  });

  it("stays frozen without Play it out", () => {
    const frozen = { ...opts, carry: false };
    const h1 = following(newHand(3, 40, 0, 1, frozen), 2, frozen);
    expect(h1.stacks).toEqual({ BTN: 30, SB: 20, BB: 40 });
    expect(h1.tournament!.played).toBeUndefined();
  });

  it("sends each seat's bounty with every answer, and sets them up on the form", () => {
    const d = { ...draftOf(undefined, 40), bounty: "pko" as const, each: "10", bountyField: "" };
    const { value, problems } = readDraft(d, 3, 40, 250);
    expect(problems).toEqual([]);
    expect(value!.bounty).toEqual({ format: "pko", seats: { BTN: 10, SB: 10, BB: 10 }, field: 10 });
    expect(readDraft({ ...d, each: "" }, 3, 40, 250).problems).toEqual(["each seat's bounty must be more than 0, in the prizes' units"]);
    const o: DealOptions = { carry: true, tournament: value! };
    const h = newHand(3, 40, 0, 1, o);
    expect(stateFor(h).bounties).toEqual({ format: "pko", seats: { BTN: 10, SB: 10, BB: 10 }, field: 10 });
    expect(gameLabel(h.tournament!)).toBe("tournament in prize equity, prizes 50/30/20, PKO bounties");
    expect(draftOf(value!, 40)).toMatchObject({ bounty: "pko", each: "10", bountyField: "10" });
  });
});
