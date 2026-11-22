// Randomness for the dealer, the table ids and the seat tokens: the platform's CSPRNG (crypto.getRandomValues) only,
// never Math.random. The shuffle draws each index by rejection sampling, so every one of the 52! orders is equally likely
// (a plain `% n` would favour the low indexes by a hair).
import { DECK } from "../../web/src/poker/table";

/** Fills `bytes` with random bytes: crypto.getRandomValues, swapped out only by a test. */
export type Random = (bytes: Uint8Array<ArrayBuffer>) => void;

export const cryptoRandom: Random = (bytes) => {
  crypto.getRandomValues(bytes);
};

/** A uniform integer in [0, n), n <= 2^32, by rejection: draws above the largest multiple of n are drawn again. */
export function below(n: number, random: Random): number {
  if (!(n >= 1 && n <= 2 ** 32 && Number.isInteger(n))) throw new RangeError(`below(${n})`);
  const limit = 2 ** 32 - (2 ** 32 % n);
  const b = new Uint8Array(4);
  for (;;) {
    random(b);
    const x = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if (x < limit) return x % n;
  }
}

/** The 52 cards in a fresh random order (Fisher-Yates). */
export function shuffled(random: Random): string[] {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = below(i + 1, random);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/** `bits` random bits as lowercase hex: a table's id (128 bits) or a seat's token. */
export function randomHex(random: Random, bits = 128): string {
  const b = new Uint8Array(bits / 8);
  random(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a string, as hex: a seat token is kept only so. */
export async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
