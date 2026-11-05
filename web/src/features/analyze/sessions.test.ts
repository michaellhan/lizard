// Sittings read from the hands kept: where one ends, what keeps kinds and sites apart, and the `sess` filter's range
// test (the hands' own clock, whatever the browser's zone).
import { describe, expect, it, vi } from "vitest";
import type { HandRecord, SessionRecord } from "@/data/db";
import { CLASSIC_SITE, PRACTICE_SITE } from "@/data/hands";
import { filterHands, GAME_EQUILIBRIUM, GAME_WORDS, HAND_FILTERS } from "./analyze";
import { leakDrillAbout, leakDrillLink } from "./leakDrill";
import { BREAK, exploitImports, handKind, inSess, isEquilibriumHand, parseSess, sessionImport, sessionsOf, sessKey, sessWords } from "./sessions";
import { tallyWinnings } from "./winnings";

const T0 = Date.UTC(2026, 2, 4, 21, 30);
const MIN = 60_000;
let id = 0;
const hand = (over: Partial<HandRecord>): HandRecord =>
  ({ id: `h${++id}`, number: String(1000 + id), site: "PokerStars", played: "", playedAt: T0, hero: "BTN", players: 6, hole: "AhKd", board: "", bb: "$1", potType: "SRP", pot: 5, end: "showdown", decisions: 2, text: "", importId: "i", importName: "i", importedAt: 0, ...over }) as HandRecord;
const at = (mins: number, over: Partial<HandRecord> = {}) => hand({ playedAt: T0 + mins * MIN, ...over });
const sizes = (hs: HandRecord[]) => sessionsOf(hs).map((s) => s.hands.length);

describe("sessionsOf", () => {
  it("keeps a sitting through a 30:00 break and ends it at 30:01", () => {
    const a = at(0);
    expect(sizes([a, hand({ playedAt: a.playedAt + BREAK.sitting })])).toEqual([2]);
    expect(sizes([a, hand({ playedAt: a.playedAt + BREAK.sitting + 1000 })])).toEqual([1, 1]);
  });

  it("orders hands as played, whatever order they're kept in", () => {
    const [s] = sessionsOf([at(10), at(0), at(5)]);
    expect(s!.hands.map((h) => h.playedAt - T0)).toEqual([0, 5 * MIN, 10 * MIN]);
    expect([s!.first - T0, s!.last - T0]).toEqual([0, 10 * MIN]);
  });

  it("lets a tournament break for hours, and keeps a name that repeats a week later apart", () => {
    const t = { tournament: "Sunday 50" };
    expect(sizes([at(0, t), at(7 * 60, t)])).toEqual([2]);
    expect(sizes([at(0, t), at(7 * 24 * 60, t)])).toEqual([1, 1]);
  });

  it("keeps cash and a tournament apart when they overlap on a site", () => {
    const s = sessionsOf([at(0), at(1, { tournament: "T" }), at(2), at(3, { tournament: "T" })]);
    expect(s.map((x) => [x.kind, x.hands.length])).toEqual([["cash", 2], ["tour", 2]]);
  });

  it("keeps two sites apart within a minute", () => {
    expect(sessionsOf([at(0), at(1, { site: "GGPoker" })]).map((s) => s.site)).toEqual(["PokerStars", "GGPoker"]);
  });

  it("files a tournament with no name or number as a tournament, here and in the results", () => {
    const h = at(0, { tournament: "" });
    expect(handKind(h)).toBe("tour");
    const [s] = sessionsOf([h]);
    expect(s).toMatchObject({ kind: "tour", tournament: "" });
    const w = tallyWinnings([{ h, w: { net: 3, bb: 1 } }]);
    expect(w.tour?.hands).toBe(1);
    expect(w.cash).toBeNull();
  });

  it("files Practice and the classic app's hands as neither, a tournament there or not", () => {
    expect(handKind(hand({ site: PRACTICE_SITE }))).toBe("practice");
    expect(handKind(hand({ site: CLASSIC_SITE, tournament: "T" }))).toBe("practice");
  });

  it("makes one undated session of each kind and site's hands with no date, last", () => {
    const s = sessionsOf([hand({ playedAt: 0 }), hand({ playedAt: 0 }), at(0), hand({ playedAt: 0, site: "GGPoker" })]);
    expect(s.map((x) => [x.site, x.first, x.hands.length])).toEqual([["PokerStars", T0, 1], ["GGPoker", 0, 1], ["PokerStars", 0, 2]]);
  });

  it("draws the same sittings whatever the filters show, as it's given every hand", () => {
    const hs = [at(0, { hero: "BTN" }), at(10, { hero: "BB" }), at(20, { hero: "BTN" }), at(90, { hero: "BB" })];
    const [first] = sessionsOf(hs);
    const q = new URLSearchParams({ pos: "BTN", sess: first!.key });
    expect(first!.hands).toHaveLength(3);
    expect(filterHands(hs, q).map((h) => h.hero)).toEqual(["BTN", "BTN"]);
    expect(sessionsOf(hs).map((s) => s.key)).toEqual(sessionsOf([...hs].reverse()).map((s) => s.key));
  });
});

describe("the sess filter", () => {
  const hs = [at(0), at(10), at(100)];
  const [first] = sessionsOf(hs);

  it("is last in HAND_FILTERS: filterHands reads them by place", () => {
    expect(HAND_FILTERS.at(-1)).toBe("sess");
  });

  it("round-trips a sitting, and keeps its hands alone", () => {
    expect(parseSess(first!.key)).toEqual({ kind: "cash", site: "PokerStars", first: first!.first, last: first!.last });
    expect(filterHands(hs, new URLSearchParams({ sess: first!.key }))).toHaveLength(2);
  });

  it("reads a tournament's name whatever it holds", () => {
    const t = at(0, { tournament: "Sunday ~ Special~$5" });
    const [s] = sessionsOf([t]);
    expect(parseSess(s!.key)?.tournament).toBe("Sunday ~ Special~$5");
    expect(inSess(s!.key)(t)).toBe(true);
    expect(inSess(s!.key)(at(0, { tournament: "Sunday ~ Special" }))).toBe(false);
    expect(inSess(s!.key)(at(0))).toBe(false);
  });

  it("keeps nothing for a value that can't be read, and never every hand", () => {
    const bad = ["x", "1~2", `${T0}~${T0}~poker~PokerStars~`, `${T0 + 1}~${T0}~cash~PokerStars~`, `0~${T0}~cash~PokerStars~`, `${T0}~${T0}~cash~PokerStars~a name`, "99999999999999999~99999999999999999~cash~PokerStars~"];
    for (const v of bad) {
      expect(parseSess(v)).toBeNull();
      expect(filterHands(hs, new URLSearchParams({ sess: v }))).toEqual([]);
      expect(() => sessWords(v)).not.toThrow();
    }
  });

  it("is a range, so a link to a sitting since grown still finds what's in it", () => {
    const stale = sessKey({ ...first!, last: T0 + 5 * MIN });
    expect(filterHands(hs, new URLSearchParams({ sess: stale })).map((h) => h.playedAt - T0)).toEqual([0]);
  });

  it("finds the undated hands", () => {
    const u = [hand({ playedAt: 0 }), hand({ playedAt: 0 }), at(0)];
    expect(filterHands(u, new URLSearchParams({ sess: sessionsOf(u).at(-1)!.key }))).toHaveLength(2);
  });

  it("says a session in the hands' own clock, whatever the browser's zone", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    try {
      expect(sessWords(first!.key)).toBe("PokerStars cash, 2026-03-04 21:30 to 21:40");
      expect(sessWords(sessionsOf([at(150, { tournament: "T" }), at(200, { tournament: "T" })])[0]!.key)).toBe("PokerStars tournament T, 2026-03-05 00:00 to 00:50");
      expect(sessWords(sessionsOf([at(0, { tournament: "" }), at(26 * 60, { tournament: "" })])[0]!.key)).toBe("PokerStars tournament, 2026-03-04 21:30");
      expect(sessWords(sessionsOf([hand({ playedAt: 0, site: PRACTICE_SITE })])[0]!.key)).toBe(`${PRACTICE_SITE}, undated`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("round-trips through a saved drill's link and reads as words", () => {
    const leak = { kind: "pf", key: "RFI" } as const;
    const link = leakDrillLink(leak, new URLSearchParams({ sess: first!.key, pos: "BTN", hand: "x" }));
    const back = new URLSearchParams(link.split("?")[1]);
    expect(back.get("sess")).toBe(first!.key);
    expect(back.has("hand")).toBe(false);
    expect(leakDrillAbout(leak, back)).toBe("Leak: RFI · your seat BTN, session PokerStars cash, 2026-03-04 21:30 to 21:40");
  });
});

describe("the hands an equilibrium can be read from", () => {
  const sessions = (["practice", "exploit", "drill"] as const).map((kind): SessionRecord => ({ id: `s-${kind}`, kind, startedAt: 1, decisions: 0, evLossBb: 0, meta: {} }));
  const exploits = exploitImports(sessions);
  const cash = hand({ importId: sessionImport("s-practice") });
  const exploit = hand({ importId: sessionImport("s-exploit") });
  const tour = hand({ tournament: "Practice" });

  it("knows an exploit session's hands by the session, and no other's", () => {
    expect([...exploits]).toEqual(["practice:s-exploit"]);
    expect(isEquilibriumHand(cash, exploits)).toBe(true);
    expect(isEquilibriumHand(exploit, exploits)).toBe(false);
    expect(isEquilibriumHand(tour, exploits)).toBe(false);
  });

  it("filters them with `game`, keeps all without it, and keeps none on a value it doesn't know", () => {
    const hands = [cash, exploit, tour];
    expect(filterHands(hands, new URLSearchParams(), new Map(), exploits)).toEqual(hands);
    expect(filterHands(hands, new URLSearchParams({ game: GAME_EQUILIBRIUM }), new Map(), exploits)).toEqual([cash]);
    expect(filterHands(hands, new URLSearchParams({ game: "x" }), new Map(), exploits)).toEqual([]);
  });

  it("carries it on a leak's drill, and says it", () => {
    const params = new URLSearchParams({ game: GAME_EQUILIBRIUM });
    expect(leakDrillLink({ kind: "pf", key: "RFI" }, params)).toBe("/analyze?drill=pf%3ARFI&game=equilibrium");
    expect(leakDrillAbout({ kind: "pf", key: "RFI" }, params)).toContain(GAME_WORDS);
  });
});
