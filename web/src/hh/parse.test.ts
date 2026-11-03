/// <reference types="node" />
// The hand-history parser against the classic one (solver/gto/static/hh.js): the golden files made from it
// (scripts/hh/make_golden.mjs) for every fixture and the analyzer's synthetic sessions, the same output on 1,500
// mutated histories, and the cases of the classic suite (solver/tests/js/hh.test.js) that need no page.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEATS } from "@/poker/seats";
import { HH_SITES, HandHistoryError, parseHandHistory, splitHands, type ParsedHand } from "./parse";

const SOLVER = join(process.cwd(), "..", "solver");
const HH_DIR = join(SOLVER, "tests", "data", "hh");
const GOLDEN = join(process.cwd(), "src", "hh", "golden");
const HH = (f: string) => readFileSync(join(HH_DIR, /\.\w+$/.test(f) ? f : f + ".txt"), "utf8");
const golden = <T,>(f: string): T => JSON.parse(readFileSync(join(GOLDEN, f), "utf8")) as T;
const require = createRequire(join(process.cwd(), "package.json"));
const classic = require(join(SOLVER, "gto", "static", "hh.js")) as {
  parseHandHistory: (t: string) => ParsedHand;
  HH_SEATS: Record<number, string[]>;
};
const { synthSession } = require(join(SOLVER, "tests", "js", "hh_synth.js")) as { synthSession: (n: number, seed: number) => string };
const r2 = (x: number) => Math.round(x * 100) / 100;

type Outcome = { hand: ParsedHand } | { error: string };
const outcome = (parse: (t: string) => ParsedHand, text: string): Outcome => {
  try {
    return { hand: JSON.parse(JSON.stringify(parse(text))) as ParsedHand };
  } catch (e) {
    return { error: (e as Error).message };
  }
};
const P = (f: string) => parseHandHistory(HH(f));

describe("parseHandHistory", () => {
  it("parses every fixture as the classic importer did (golden files)", () => {
    const files = readdirSync(HH_DIR).sort();
    expect(files.length).toBeGreaterThanOrEqual(23);
    for (const f of files) {
      const { fixture, ...want } = golden<Outcome & { fixture: string }>(`${f.replace(/\.\w+$/, "")}.json`);
      expect(fixture).toBe(f);
      expect(outcome(parseHandHistory, HH(f)), f).toEqual(want);
    }
  });

  it("parses the analyzer's synthetic sessions hand by hand as the classic importer did (golden files)", () => {
    for (const [n, seed] of [[60, 3], [50, 11]] as const) {
      const hands = splitHands(synthSession(n, seed));
      const want = golden<Outcome[]>(`synth_${n}_${seed}.json`);
      expect(hands).toHaveLength(n);
      expect(hands.map((t) => outcome(parseHandHistory, t))).toEqual(want);
    }
  });

  it("agrees with the classic importer on mutated histories: the same hand or the same message", () => {
    // lines dropped, cut, swapped, duplicated or with an amount changed (the classic suite's mutations)
    const texts = readdirSync(HH_DIR).map(HH);
    let seed = 7;
    let errors = 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
    for (let it = 0; it < 1500; it++) {
      let lines = pick(texts).split("\n");
      for (let k = 1 + Math.floor(rnd() * 3); k > 0 && lines.length; k--) {
        const r = rnd();
        const i = Math.floor(rnd() * lines.length);
        if (r < 0.3) lines.splice(i, 1);
        else if (r < 0.45) lines = lines.slice(0, i);
        else if (r < 0.55) lines = lines.slice(i);
        else if (r < 0.7) {
          const t = Math.floor(rnd() * lines.length);
          [lines[i], lines[t]] = [lines[t]!, lines[i]!];
        } else if (r < 0.85) lines[i] = lines[i]!.replace(/[\d.]+/, String(Math.floor(rnd() * 500) / (rnd() < 0.5 ? 1 : 100)));
        else lines.splice(i, 0, pick(lines));
      }
      const text = lines.join("\n");
      const mine = outcome(parseHandHistory, text);
      expect(mine, text).toEqual(outcome(classic.parseHandHistory, text));
      if ("error" in mine) errors++;
    }
    expect(errors).toBeGreaterThan(100);
    expect(errors).toBeLessThan(1400);
  });

  it("parsed details: sites, seats, names and amounts in big blinds", () => {
    const h = P("stars_3bet_pot");
    expect([h.site, h.bb, h.heroName]).toEqual(["PokerStars", 2, "HeroName"]);
    expect(h.seats.map((s) => [s.seat, s.pos, s.stack])).toEqual([[1, "CO", 100], [2, "BTN", 156.2], [3, "SB", 94], [4, "BB", 120], [6, "HJ", 100]]);
    expect(h.actions.find((a) => a.act === "bet" && a.allIn)).toEqual({ street: "turn", pos: "CO", act: "bet", to: 67, allIn: true });
    expect(P("gg_limped_multiway").site).toBe("GGPoker");
    const t = P("stars_9max_mtt_ante");
    expect([t.bb, t.ante, t.seats.find((s) => s.seat === 3)?.pos]).toEqual([300, 0.1, "HJ"]); // sitting out but dealt in (posted the ante)
    // Windows line endings, a trailing hand and a "10" card are fine
    const two = parseHandHistory(HH("stars_heads_up").replace(/\n/g, "\r\n") + "\r\n\r\n" + HH("stars_6max_srp"));
    expect(two.players).toBe(2);
    expect(two.warnings).toEqual(["2 hands pasted: imported the first."]);
    expect(parseHandHistory(HH("stars_heads_up").replace("[9c 9d]", "[10c 9d]")).hole).toEqual(["Tc", "9d"]);
  });

  it("other sites: detected, seats, amounts and the hero", () => {
    const SAME: Record<string, string> = {
      "888_6max_srp": "stars_6max_srp", ignition_6max_srp: "stars_6max_srp", "888_9max_mtt_ante": "stars_9max_mtt_ante",
      winamax_mtt_ante: "stars_9max_mtt_ante", acr_9max_mtt_ante: "stars_9max_mtt_ante", party_6max_allin: "gg_allin_preflop",
      party_mtt_bounty_allin: "stars_bounty_allin", ignition_mtt_allin: "stars_bounty_allin", winamax_3bet_pot: "stars_3bet_pot",
      "ipoker_3bet_pot.xml": "stars_3bet_pot", acr_run_twice: "stars_run_twice",
    };
    expect(Object.keys(SAME).map((f) => P(f).site)).toEqual([
      "888poker", "Ignition/Bovada", "888poker", "Winamax", "WPN/ACR", "partypoker", "partypoker", "Ignition/Bovada", "Winamax", "iPoker", "WPN/ACR",
    ]);
    // the parsed hand is the PokerStars/GG one but for the names and seat numbers
    const strip = (h: ParsedHand) => ({ ...h, site: 0, heroName: 0, tournament: !!h.tournament, seats: h.seats.map((s) => [s.pos, s.stack]).sort() });
    for (const [f, like] of Object.entries(SAME)) expect(strip(P(f)), f).toEqual(strip(P(like)));
    // 888's tournament amounts with dots for thousands; Ignition's hero is "[ME]" among everyone's cards, its seat numbers aren't the table's order
    expect(P("888_9max_mtt_ante").seats[0]!.stack).toBe(r2(18250 / 300));
    const ig = P("ignition_mtt_allin");
    expect([ig.heroName, ig.hole, ig.seats.map((s) => s.name + "=" + s.pos).join()]).toEqual([
      "Big Blind [ME]", ["Jh", "Js"], "UTG+1=CO,Dealer=BTN,Small Blind=SB,Big Blind [ME]=BB,UTG=HJ",
    ]);
    // iPoker: a session of several hands imports the first you're seated in; entities in names, comma decimals
    const x = HH("ipoker_3bet_pot.xml");
    const game = x.match(/<game\b[\s\S]*<\/game>/)![0];
    const two = parseHandHistory(x.replace(game, game.replace(/HeroName/g, "someone_else") + "\n" + game));
    expect([two.heroName, two.warnings]).toEqual(["HeroName", ["2 hands pasted: imported the first."]]);
    const odd = parseHandHistory(x.replace(/grinder_pl/g, "R&amp;D").replace(/€(\d+)\.(\d\d)/g, "€$1,$2"));
    expect([odd.seats[0]!.name, odd.seats[0]!.stack, odd.actions.find((a) => a.pos === "CO" && a.allIn)?.to]).toEqual(["R&D", 100, 67]);
    // a trailing hand of another site is cut off; party's "players : 6/6" isn't the stakes
    expect(parseHandHistory(HH("888_6max_srp") + "\n\n" + HH("888_9max_mtt_ante")).warnings).toEqual(["2 hands pasted: imported the first."]);
    expect(parseHandHistory(HH("party_6max_allin").replace("$0.25/$0.50 USD ", "$50 USD fastforward ")).bb).toBe(0.5);
    // the import box names every site
    const sites = new Set(readdirSync(HH_DIR).map((f) => P(f).site));
    expect(sites.size).toBeGreaterThanOrEqual(8);
    for (const s of sites) expect(HH_SITES).toContain(s);
  });

  it("odd histories: no button line, mixed games, short deck, a hero without a seat line", () => {
    // a paste that starts at the seat lines: the button is the seat before the blinds, no dead-button warning
    const part = parseHandHistory(HH("stars_6max_srp").split("\n").slice(2).join("\n"));
    expect(part.warnings).toEqual([]);
    expect(part.hero).toBe("BTN");
    expect(part.seats.map((s) => s.pos)).toEqual(P("stars_6max_srp").seats.map((s) => s.pos));
    const mixed = HH("stars_6max_srp").replace("Hold'em No Limit ($0.50/$1.00 USD)", "Mixed NLH/PLO (Hold'em No Limit, $0.50/$1.00 USD)");
    expect(parseHandHistory(mixed).hero).toBe("BTN");
    expect(() => parseHandHistory(mixed.replace("(Hold'em No Limit,", "(Omaha Pot Limit,"))).toThrow(/Only Hold'em/);
    expect(() => parseHandHistory(HH("stars_6max_srp").replace("Hold'em No Limit", "6+ Hold'em No Limit"))).toThrow(/Only Hold'em/);
    expect(P("stars_zoom_names").warnings[0]).toMatch(/small blind is 0.4bb/);
    expect(() => parseHandHistory(HH("stars_6max_srp").replace("Dealt to HeroName", "Dealt to Hero Name"))).toThrow(/no "Seat N: Hero Name/);
  });

  it("errors: no hero cards, not Hold'em, not a hand history, each a HandHistoryError", () => {
    const err = (t: string) => {
      try {
        parseHandHistory(t);
      } catch (e) {
        expect(e).toBeInstanceOf(HandHistoryError);
        return (e as Error).message;
      }
      return null;
    };
    expect(err(HH("stars_6max_srp").replace("Dealt to HeroName [Ah Qd]\n", ""))).toMatch(/hole cards aren't in this history/);
    expect(err(HH("stars_6max_srp").replace("Hold'em No Limit", "Omaha Pot Limit"))).toMatch(/Only Hold'em/);
    expect(err(HH("stars_6max_srp").replace("[Ah Qd]", "[Ah Qd 7c 2c]"))).toMatch(/Only Hold'em/);
    expect(err("hello")).toMatch(/No players found/);
    expect(err("UTG raises, I call, flop A72")).toMatch(/No players found/);
  });

  it("tournaments: the header's id, name, buy-in and level (Roman or not); a cash game has none", () => {
    const T = (f: string) => P(f).tournament ?? null;
    expect(T("stars_9max_mtt_ante")).toEqual({ id: "3712345678", buyin: "$10+$1", level: 7 });
    expect(T("stars_bounty_allin")).toEqual({ id: "3800000000", buyin: "$4.40+$4.40+$1.20", level: 4 });
    expect(T("winamax_mtt_ante")).toEqual({ id: "812345678", name: "Monster Stack", buyin: "9€+1€", level: 7 });
    expect(T("888_9max_mtt_ante")).toEqual({ id: "198765432", buyin: "$10+$1" });
    expect(T("acr_9max_mtt_ante")).toEqual({ id: "33339185", level: 7 });
    expect(T("ignition_mtt_allin")).toEqual({ id: "M-20241002003411", buyin: "$8.80+$1.20", level: 4 });
    expect(T("party_mtt_bounty_allin")).toEqual({ id: "301084002", buyin: "$8.8+$1.2" });
    for (const f of ["stars_6max_srp", "gg_straddle", "888_6max_srp", "winamax_3bet_pot", "ipoker_3bet_pot.xml"]) expect(T(f), f).toBeNull();
    // GGPoker's tournament header, and iPoker's tournament tags
    const gg = HH("gg_straddle").replace(
      /^Poker Hand #\w+: [^\n]*/,
      "Poker Hand #TM2345678901: Tournament #123456789, Bounty Hunters $10 Hold'em No Limit - Level10(300/600(80)) - 2024/06/15 20:31:44",
    );
    expect(parseHandHistory(gg).tournament).toEqual({ id: "123456789", level: 10 });
    const ip = HH("ipoker_3bet_pot.xml").replace("<gametype>", '<tournamentcode>777123</tournamentcode><tournamentname>Sunday "Big"</tournamentname><gametype>');
    expect(parseHandHistory(ip).tournament).toEqual({ id: "777123", name: "Sunday 'Big'" });
  });

  it("names the seats as the table does", () => {
    expect(classic.HH_SEATS).toEqual(JSON.parse(JSON.stringify(SEATS)));
  });
});

describe("splitHands", () => {
  it("cuts a file into one text per hand, iPoker a session per game", () => {
    expect(splitHands(synthSession(5, 1))).toHaveLength(5);
    expect(splitHands(HH("stars_heads_up") + "\n\n" + HH("888_6max_srp"))).toHaveLength(2);
    const x = HH("ipoker_3bet_pot.xml");
    const game = x.match(/<game\b[\s\S]*<\/game>/)![0];
    const both = splitHands(x.replace(game, game + "\n" + game));
    expect(both).toHaveLength(2);
    expect(both.every((t) => t.startsWith("<session><general>") && parseHandHistory(t).site === "iPoker")).toBe(true);
    expect(splitHands("")).toEqual([]);
  });
});
