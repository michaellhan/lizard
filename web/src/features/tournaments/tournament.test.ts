// A tournament's setup: each setting maps to the engine's key (advisor.py _tournament, _bounties), what it can't be
// asked is refused first, a tournament has no rake, and it rides in Study's URL with the rest of the setup.
import { describe, expect, it } from "vitest";
import { setupProblems, setupRequest } from "@/features/solve/setup";
import { freshHand, fromSearch, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import { describeTournament, paidCurve, parsePayouts, PAYOUT_PRESETS, satellitePayouts, tidyTournament, tournamentProblems, tournamentRequest, type TournamentSetup } from "./tournament";

const KO: TournamentSetup = { payouts: [50, 30, 20], field: { players: 12, avg: 40 }, bounty: { format: "ko", each: 10, seats: { BTN: 20 }, field: 8 } };

describe("a tournament's setup", () => {
  it("maps the payouts, the other tables and the bounties to the engine's keys", () => {
    expect(tournamentRequest(KO, 3)).toEqual({
      payouts: [50, 30, 20],
      field: { players: 12, chips: 480 },
      bounties: { format: "ko", seats: { BTN: 20, SB: 10, BB: 10 }, field: 8 },
    });
    expect(tournamentRequest({ bounty: { format: "mystery", envelope: 5 } }, 6)).toEqual({ bounties: { format: "mystery", envelope: 5 } });
    expect(tournamentRequest({ payouts: [100], bounty: { format: "mystery", pool: 500, left: 40 } }, 6)).toEqual({ payouts: [100], bounties: { format: "mystery", pool: 500, left: 40 } });
    // nothing at stake, other tables without a tournament: left out
    expect(tidyTournament({ bounty: { format: "pko", each: 0 }, field: { players: 5, avg: 30 } })).toBeUndefined();
    // with the rest of the setup, in Study's request
    const h: StudyHand = { ...freshHand(6, 25), setup: { stacks: { BTN: 12 }, tournament: { payouts: [50, 30, 20] } } };
    expect(studyRequest(h)).toMatchObject({ players: 6, stack: 25, stacks: { BTN: 12 }, payouts: [50, 30, 20], study: true });
    expect(setupRequest({ tournament: KO }, 2).bounties).toEqual({ format: "ko", seats: { SB: 10, BB: 10 }, field: 8 });
  });

  it("refuses what the engine can't be asked, and rake in a tournament", () => {
    expect(tournamentProblems(6, KO)).toEqual([]);
    expect(tournamentProblems(6, { payouts: [50, NaN, -1] })).toEqual(["the payouts must be positive numbers, first place first (like 50, 30, 20)"]);
    expect(tournamentProblems(6, { payouts: Array(201).fill(1) })).toEqual(["at most 200 places paid"]);
    expect(tournamentProblems(6, { payouts: [50, 50], field: { players: 2.5, avg: 40 } })).toEqual(["the players at other tables must be a whole number, 0–10000"]);
    expect(tournamentProblems(6, { payouts: [50, 50], field: { players: 20, avg: 0 } })).toEqual(["their average stack must be 1–1000bb"]);
    expect(tournamentProblems(6, { field: { players: 20, avg: 40 } })).toEqual(["the players at other tables count only with payouts or bounties"]);
    expect(tournamentProblems(6, { bounty: { format: "mystery", pool: 500 } })).toEqual(["mystery bounties need the average envelope, or the pool and the envelopes left"]);
    expect(tournamentProblems(6, { bounty: { format: "mystery", pool: 500, left: 2.5 } })).toEqual(["the envelopes left must be a whole number"]);
    expect(tournamentProblems(2, { bounty: { format: "ko", each: -1, seats: { BTN: 5, BB: -2 } } })).toEqual([
      "the bounties must be 0 or more",
      "BTN isn't a seat at this table",
      "BB's bounty must be 0 or more",
    ]);
    expect(tournamentProblems(6, { bounty: { format: "spin" as "ko", each: 5 } })).toEqual(["the bounty format must be KO, PKO or mystery"]);
    expect(setupProblems(6, { rake: 5, tournament: { payouts: [50, 30, 20] } })).toEqual(["a tournament has no rake"]);
  });

  it("rides in Study's URL after the line, and says itself in a few words", () => {
    const h: StudyHand = { ...freshHand(3, 20), setup: { stacks: { BTN: 12 }, tournament: KO } };
    const q = toSearch(h);
    expect(q).toBe("p=3&s=20&stacks=BTN%3A12&pay=50%2C30%2C20&fld=12%3A40&bty=ko&bty.each=10&bty.field=8&bs.BTN=20");
    expect(fromSearch(q)).toEqual(h);
    const m: StudyHand = { ...freshHand(6, 30), setup: { tournament: { payouts: [100], bounty: { format: "mystery", pool: 500, left: 40 } } } };
    expect(fromSearch(toSearch(m))).toEqual(m);
    expect(describeTournament(KO)).toEqual(["payouts 50/30/20", "12 at other tables (average 40bb)", "KO bounties 10 (BTN 20), other tables 8"]);
    expect(describeTournament(m.setup!.tournament)).toEqual(["winner takes all (chips are prizes)", "mystery bounties, pool 500, 40 left"]);
    expect(describeTournament({ bounty: { format: "pko", each: 5 } })).toEqual(["no payouts (chip EV, the prizes taken as the bounties in play)", "PKO bounties 5"]);
  });

  it("reads payouts as typed, and offers generic shapes that add up to 100, and a satellite's", () => {
    expect(parsePayouts("50 30 20")).toEqual([50, 30, 20]);
    expect(parsePayouts("50/30/20")).toEqual([50, 30, 20]);
    expect(parsePayouts(" 50, 30; 20 ")).toEqual([50, 30, 20]);
    expect(parsePayouts("50 thirty")).toEqual([50, NaN]);
    for (const p of PAYOUT_PRESETS) expect(p.payouts.reduce((a, b) => a + b, 0), p.name).toBeCloseTo(100);
    // a satellite's bubble at this table: a seat each for all but one (heads-up, one seat is winner-takes-all)
    expect(satellitePayouts(6)).toEqual([1, 1, 1, 1, 1]);
    expect(satellitePayouts(3)).toEqual([1, 1]);
    // the 15%-paid curve: 100 players left pay 15 places, falling, adding to about 100; under 10 players left, none
    const c = paidCurve(100)!;
    expect(c).toHaveLength(15);
    expect(c[0]).toBe(23.7);
    expect(c[14]).toBe(2.7);
    expect(c.every((x, i) => i === 0 || x <= c[i - 1]!)).toBe(true);
    expect(Math.abs(c.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.5);
    expect(paidCurve(9)).toBeNull();
    expect(paidCurve(10)).toHaveLength(2);
    expect(paidCurve(5000)).toHaveLength(200);
    expect(satellitePayouts(2)).toBeNull();
    expect(describeTournament({ payouts: satellitePayouts(6)! })).toEqual(["a satellite, 5 equal seats"]);
  });
});
