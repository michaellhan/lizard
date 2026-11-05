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

  it.each([
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
    const a = new URLSearchParams(`${query(setupLink(LINK))}&other=1`);
    const b = new URLSearchParams(`${query(setupLink(LINK))}&other=2`);
    expect(setupLinkKey(a)).toBe(setupLinkKey(b));
    expect(setupLinkKey(new URLSearchParams("seat=BTN"))).toBeNull();
    expect(SETUP_PARAMS.every((k) => a.has(k))).toBe(true);
  });
});
