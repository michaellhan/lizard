// A Practice setup as a link: what comes back is what went in, and a link from anywhere that makes no sense starts nothing.
import { describe, expect, it } from "vitest";
import { linkSetup, readSetupLink, SETUP_PARAMS, setupLink, setupLinkKey, type LinkSetup } from "./setupLink";

const LINK: LinkSetup = { play: "srp", seat: "BTN", players: 6, stack: 100 };
const read = (q: Record<string, string>) => readSetupLink(new URLSearchParams(q));
const query = (l: string) => new URL(l, "http://x").searchParams;

describe("a setup link", () => {
  it("reads back as the setup it was made from", () => {
    expect(readSetupLink(query(setupLink(LINK)))).toEqual(linkSetup(LINK));
    expect(linkSetup(LINK)).toMatchObject({ players: 6, stack: 100, opts: { seat: "BTN", pot: "srp", preflopOnly: false } });
    expect(linkSetup({ ...LINK, play: "preflop" })?.opts).toMatchObject({ preflopOnly: true, pot: null });
    expect(linkSetup({ ...LINK, play: "full", seat: "moves" })?.opts).toMatchObject({ seat: "moves", preflopOnly: false, pot: null });
  });

  it("grades preflop by the preflop solve where the game is stored, as a new session does, and by the charts elsewhere", () => {
    expect(linkSetup({ ...LINK, play: "full" })?.opts).toMatchObject({ pfSolve: true });
    expect(linkSetup({ ...LINK, play: "preflop", players: 3, stack: 40 })?.opts).toMatchObject({ pfSolve: true });
    // (no stored solve at 7 players or 90bb, and a pot drill has no preflop of yours to grade)
    expect(linkSetup({ ...LINK, play: "full", players: 7, seat: "moves" })?.opts).not.toHaveProperty("pfSolve");
    expect(linkSetup({ ...LINK, play: "full", stack: 90 })?.opts).not.toHaveProperty("pfSolve");
    expect(linkSetup(LINK)?.opts).not.toHaveProperty("pfSolve");
  });

  it("carries a pot drill's hand filter", () => {
    const l = { ...LINK, hand: "m:top_tk" };
    expect(readSetupLink(query(setupLink(l)))?.opts).toMatchObject({ pot: "srp", hand: "m:top_tk" });
    expect(setupLink(LINK)).not.toContain("hand");
    expect(linkSetup(LINK)?.opts).not.toHaveProperty("hand");
    expect(setupLinkKey(query(setupLink(l)))).toContain("hand=m%3Atop_tk");
    expect(SETUP_PARAMS).toContain("hand");
  });

  it.each([
    ["a hand that isn't one", { play: "srp", seat: "BTN", players: "6", stack: "100", hand: "m:nonsense" }],
    ["a hand with no pot drill", { play: "full", seat: "BTN", players: "6", stack: "100", hand: "m:set" }],
    ["a blank hand", { play: "srp", seat: "BTN", players: "6", stack: "100", hand: "" }],
    ["a play that isn't one", { play: "__proto__", seat: "BTN", players: "6", stack: "100" }],
    ["a seat not at the table", { play: "srp", seat: "UTG1", players: "6", stack: "100" }],
    ["no table", { play: "srp", seat: "BTN", players: "1", stack: "100" }],
    ["a table too big", { play: "srp", seat: "BTN", players: "99", stack: "100" }],
    ["half a player", { play: "srp", seat: "BTN", players: "5.5", stack: "100" }],
    ["a stack that isn't a number", { play: "srp", seat: "BTN", players: "6", stack: "lots" }],
    ["a negative stack", { play: "srp", seat: "BTN", players: "6", stack: "-5" }],
    ["half the link", { play: "srp" }],
  ])("starts nothing from %s", (_, q) => {
    expect(read(q)).toBeNull();
  });

  it("stands still in an address while nothing about it moves, and is no link without a play", () => {
    const link = setupLink({ ...LINK, hand: "m:set" });
    const a = new URLSearchParams(`${query(link)}&other=1`);
    const b = new URLSearchParams(`${query(link)}&other=2`);
    expect(setupLinkKey(a)).toBe(setupLinkKey(b));
    expect(setupLinkKey(new URLSearchParams("seat=BTN"))).toBeNull();
    expect(SETUP_PARAMS.every((k) => a.has(k))).toBe(true);
  });
});
