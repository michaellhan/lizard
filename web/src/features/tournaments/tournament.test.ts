// A tournament's setup: each setting maps to the engine's key (advisor.py _tournament, _bounties), what it can't be
// asked is refused first, a tournament has no rake, and it rides in Study's URL with the rest of the setup.
import { describe, expect, it } from "vitest";
import { setupProblems, setupRequest } from "@/features/solve/setup";
import { freshHand, fromSearch, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import { anteWords, describeTournament, FORMAT_PRESETS, paidCurve, presetAnte, parsePayouts, pastedPayouts, PAYOUT_PRESETS, satellitePayouts, STAGE_PRESETS, stageAnte, tidyTournament, tournamentProblems, tournamentRequest, type TournamentSetup } from "./tournament";

const KO: TournamentSetup = { payouts: [50, 30, 20], field: { players: 12, avg: 40 }, bounty: { format: "ko", each: 10, seats: { BTN: 20 }, field: 8 } };

describe("a pasted payout table", () => {
  it("reads places, ranges and amounts, line by line", () => {
    const site = "Place\tPrize\n1st\t$10,000\n2nd\t$6,000\n3rd\t$4,000\n4-6\t$2,000\n7th – 9th: $1,000.50\nTotal $28,003";
    expect(pastedPayouts(site)).toBe("10000 6000 4000 2000 2000 2000 1000.5 1000.5 1000.5");
    expect(pastedPayouts("1: 25%\n2: 15%\n3) 10%\n4. 8%")).toBe("25 15 10 8");
    expect(pastedPayouts("1\t500\n2\t300")).toBe("500 300");
    expect(pastedPayouts("1st place 40\n2nd place 25 (25%)")).toBe("40 25");
    // one amount a line, in order
    expect(pastedPayouts("50\n30\n20")).toBe("50 30 20");
    expect(pastedPayouts("12.5\n7.5")).toBe("12.5 7.5");
    expect(pastedPayouts("50 30\n20")).toBe("50 30 20");
    // out of order is put in order; a place left out stays a gap, which the check names
    expect(pastedPayouts("2nd $600\n1st $1,000")).toBe("1000 600");
    expect(parsePayouts(pastedPayouts("1st 100\n3rd 50")!)).toEqual([100, NaN, 50]);
    // a range too long to be a payout table isn't spelled out
    expect(parsePayouts(pastedPayouts("1st 100\n2-100000 1")!).length).toBeLessThan(300);
    // a plain one-line list is left to the box as it is
    expect(pastedPayouts("50 30 20")).toBeNull();
    expect(pastedPayouts("$1,000 $600")).toBeNull();
    expect(pastedPayouts("1st $1,000")).toBe("1000");
    expect(pastedPayouts("no numbers here")).toBeNull();
  });
});

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
    // money as people write it: a currency sign, thousands commas, a percent sign
    expect(parsePayouts("$10,000 $6,000 $4,000")).toEqual([10000, 6000, 4000]);
    expect(parsePayouts("€1,250.50, £600")).toEqual([1250.5, 600]);
    expect(parsePayouts("50% 30% 20%")).toEqual([50, 30, 20]);
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

describe("the stages of an MTT", () => {
  it("each sets up a table the checks pass, with its seats, prizes adding to 100 and the right players left", () => {
    for (const st of STAGE_PRESETS) {
      expect(st.stacks, st.name).toHaveLength(st.players);
      const t: TournamentSetup = { payouts: st.payouts, ...(st.field ? { field: st.field } : {}) };
      expect(tournamentProblems(st.players, t), st.name).toEqual([]);
      const setup = { stacks: Object.fromEntries(st.stacks.map((v, i) => [String(i), v])), ante: stageAnte(st.players), tournament: t };
      expect(setupProblems(st.players, { ...setup, stacks: {} }), st.name).toEqual([]);
      if (st.payouts.length > 3) expect(Math.abs(st.payouts.reduce((a, b) => a + b, 0) - 100), st.name).toBeLessThan(0.5);
      expect(st.payouts.every((x, i) => i === 0 || x <= st.payouts[i - 1]!), st.name).toBe(true);
    }
    const left = (name: string) => {
      const st = STAGE_PRESETS.find((x) => x.name === name)!;
      return [st.players + (st.field?.players ?? 0), st.payouts.length];
    };
    expect(left("Early")).toEqual([1000, 150]);
    expect(left("Bubble")).toEqual([116, 115]);
    expect(left("Final-table bubble")).toEqual([10, 9]);
    expect(left("Final table")).toEqual([9, 9]);
    expect(left("Three left")).toEqual([3, 3]);
    expect(left("Heads-up")).toEqual([2, 2]);
    expect(describeTournament({ payouts: STAGE_PRESETS[1]!.payouts })).toEqual(["payouts 11.8/6.8/4.9 … 115 places, the last 0.3"]);
    expect(stageAnte(8)).toBe(0.13);
    expect(stageAnte(9)).toBe(0.11);
  });
});

describe("the sit & go and spin formats", () => {
  it("each sets up a table the checks pass, with its own ante", () => {
    for (const st of FORMAT_PRESETS) {
      expect(st.stacks, st.name).toHaveLength(st.players);
      const t: TournamentSetup = { payouts: st.payouts };
      expect(tournamentProblems(st.players, t), st.name).toEqual([]);
      expect(setupProblems(st.players, { stacks: {}, ante: presetAnte(st), tournament: t }), st.name).toEqual([]);
      // (fewer paid than players: someone goes home with nothing)
      expect(st.payouts.length, st.name).toBeLessThan(st.players);
    }
    const by = (name: string) => FORMAT_PRESETS.find((x) => x.name === name)!;
    expect(presetAnte(by("Sit & go, 9 players"))).toBe(0);
    expect(anteWords(by("Sit & go, 9 players"))).toBe("no ante");
    expect(presetAnte(by("Sit & go bubble"))).toBe(0.25);
    expect(anteWords(by("Sit & go bubble"))).toBe("a 1bb big-blind ante, as 0.25bb a seat");
    expect(anteWords({ players: 6, ante: 0.1 })).toBe("an ante of 0.1bb a seat");
    expect(describeTournament({ payouts: by("Double or nothing").payouts })).toEqual(["a satellite, 3 equal seats"]);
    expect(by("Spin, 3 players").payouts).toEqual([100]);
  });
});
