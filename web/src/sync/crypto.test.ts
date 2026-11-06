// What end-to-end encryption owes: only the passphrase opens a record, and a record can't be moved or changed unnoticed.
import { describe, expect, it } from "vitest";
import { deriveKeys, fromBase64, idHash, makeCheck, newSalt, openRecord, passesCheck, sealRecord, toBase64 } from "./crypto";

const SALT = toBase64(new Uint8Array(16).fill(7));
const PHRASE = "correct horse battery";

describe("sync's encryption", () => {
  it("opens with the same passphrase and salt, on any device", async () => {
    const a = await deriveKeys(PHRASE, SALT), b = await deriveKeys(PHRASE, SALT);
    const h = await idHash(a, 1, "spot-1");
    expect(await idHash(b, 1, "spot-1")).toBe(h);
    const body = await sealRecord(a, 1, h, { id: "spot-1", name: "Kd flop", n: [1, 2] });
    expect(await openRecord(b, 1, h, body)).toEqual({ id: "spot-1", name: "Kd flop", n: [1, 2] });
  }, 60_000);

  it("won't open with another passphrase or another salt, and says so without throwing", async () => {
    const a = await deriveKeys(PHRASE, SALT), wrong = await deriveKeys(`${PHRASE}!`, SALT), other = await deriveKeys(PHRASE, newSalt());
    const h = await idHash(a, 1, "x");
    const body = await sealRecord(a, 1, h, { secret: true });
    expect(await openRecord(wrong, 1, h, body)).toBeNull();
    expect(await openRecord(other, 1, h, body)).toBeNull();
    const check = await makeCheck(a);
    expect(await passesCheck(a, check)).toBe(true);
    expect(await passesCheck(wrong, check)).toBe(false);
  }, 60_000);

  it("gives the server nothing to read, and no two sealings alike", async () => {
    const k = await deriveKeys(PHRASE, SALT);
    const h = await idHash(k, 2, "hand-99");
    const one = await sealRecord(k, 2, h, { hero: "Ah Kd", site: "PokerStars" });
    const two = await sealRecord(k, 2, h, { hero: "Ah Kd", site: "PokerStars" });
    expect(one).not.toBe(two);
    const raw = String.fromCharCode(...fromBase64(one));
    expect(raw).not.toContain("PokerStars");
    expect(raw).not.toContain("hero");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(await idHash(k, 3, "hand-99"));
  }, 60_000);

  it("refuses a record moved to another place, changed by a bit, or cut", async () => {
    const k = await deriveKeys(PHRASE, SALT);
    const h = await idHash(k, 1, "a"), other = await idHash(k, 1, "b");
    const body = await sealRecord(k, 1, h, { v: 1 });
    expect(await openRecord(k, 1, other, body)).toBeNull();
    expect(await openRecord(k, 2, h, body)).toBeNull();
    const flipped = fromBase64(body);
    flipped[flipped.length - 1]! ^= 1;
    expect(await openRecord(k, 1, h, toBase64(flipped))).toBeNull();
    expect(await openRecord(k, 1, h, body.slice(0, 20))).toBeNull();
    expect(await openRecord(k, 1, h, "not base64 at all")).toBeNull();
    expect(await openRecord(k, 1, h, "")).toBeNull();
    const version = fromBase64(body);
    version[0] = 9;
    expect(await openRecord(k, 1, h, toBase64(version))).toBeNull();
  }, 60_000);

  it("treats the same letters typed two ways as one passphrase", async () => {
    const a = await deriveKeys("café passphrase", SALT), b = await deriveKeys("café passphrase", SALT);
    expect(await idHash(a, 1, "x")).toBe(await idHash(b, 1, "x"));
  }, 60_000);

  it("keeps the keys in the browser: none can be exported", async () => {
    const k = await deriveKeys(PHRASE, SALT);
    await expect(crypto.subtle.exportKey("raw", k.seal)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("raw", k.ids)).rejects.toThrow();
  }, 60_000);

  it("carries a large record whole", async () => {
    const k = await deriveKeys(PHRASE, SALT);
    const h = await idHash(k, 1, "big");
    const value = { text: "x".repeat(400_000) };
    expect(await openRecord(k, 1, h, await sealRecord(k, 1, h, value))).toEqual(value);
  }, 60_000);
});
