// A flop's texture (classic reports.js): high card, pairing, suits, connectedness. Connected: any straight with two
// hole cards; semi-connected: two ranks within a straight's span; else disconnected. Paired and trips flops count their
// distinct ranks. Drills, Reports and the pot-type modes' board filter share it.
import { DECK } from "@/poker/table";

const RANKS = "23456789TJQKA";
export interface Texture {
  high: string;
  hi: string;
  pair: "unpaired" | "paired" | "trips";
  suits: "mono" | "twotone" | "rainbow";
  conn: "conn" | "semi" | "dry";
}

/** a flop as one string of its three cards */
export function texture(f: string): Texture {
  const cs = [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)];
  const r = cs.map((c) => RANKS.indexOf(c[0]!)).sort((a, b) => b - a);
  const su = new Set(cs.map((c) => c[1])).size;
  const d = [...new Set(r)];
  const lo = d.map((x) => (x === 12 ? -1 : x)); // (the ace plays low too)
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs) <= 4;
  const near = (xs: number[]) => xs.some((a, i) => xs.some((b, j) => j > i && Math.abs(a - b) <= 4));
  const conn = d.length === 3 && (span(d) || span(lo)) ? "conn" : near(d) || near(lo) ? "semi" : "dry";
  const high = RANKS[r[0]!]!;
  return {
    high,
    hi: "AKQJT".includes(high) ? high : "9-",
    pair: d.length === 3 ? "unpaired" : d.length === 2 ? "paired" : "trips",
    suits: su === 1 ? "mono" : su === 2 ? "twotone" : "rainbow",
    conn,
  };
}

export type TextureKey = "hi" | "suits" | "pair" | "conn";
export type TextureFilter = Partial<Record<TextureKey, string>>;
export const TEXTURE_GROUPS: readonly { key: TextureKey; label: string; values: Record<string, string> }[] = [
  { key: "hi", label: "High card", values: { A: "A high", K: "K high", Q: "Q high", J: "J high", T: "T high", "9-": "9 high or lower" } },
  { key: "suits", label: "Suits", values: { rainbow: "Rainbow", twotone: "Two-tone", mono: "Monotone" } },
  { key: "pair", label: "Pairing", values: { unpaired: "Unpaired", paired: "Paired", trips: "Trips" } },
  { key: "conn", label: "Connectedness", values: { conn: "Connected", semi: "Semi-connected", dry: "Disconnected" } },
];

/** A filter as one string, its groups in order ("hi:A,pair:paired"; "" for none): how a drill session counts its decisions
 * by the flops they were dealt from (meta.byDeal). */
export const textureKey = (filter: TextureFilter): string =>
  TEXTURE_GROUPS.flatMap((g) => (filter[g.key] ? [`${g.key}:${filter[g.key]}`] : [])).join(",");

/** What a drill dealt from, as a session counts it: the texture filter's key, then "|" and the hand asked for, if any. */
export const dealtFrom = (filter: TextureFilter, hand: string | null): string => `${textureKey(filter)}${hand ? `|${hand}` : ""}`;

export const fitsTexture = (t: Texture, filter: TextureFilter): boolean => Object.entries(filter).every(([k, v]) => !v || t[k as TextureKey] === v);

/** A filter as a hand or a kept session holds it: known groups and values only (an empty one is no filter). */
export const isTextureFilter = (x: unknown): x is TextureFilter =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.entries(x).every(([k, v]) => TEXTURE_GROUPS.some((g) => g.key === k && typeof v === "string" && Object.hasOwn(g.values, v)));

const LIKE = new Map<string, string[]>();

/** Every flop of the 22,100, as a card string, with this texture (kept: each filter is worked out once). */
export function flopsLike(filter: TextureFilter): string[] {
  const key = JSON.stringify(TEXTURE_GROUPS.map((g) => filter[g.key] ?? ""));
  let out = LIKE.get(key);
  if (!out) {
    out = [];
    for (let a = 0; a < DECK.length; a++)
      for (let b = a + 1; b < DECK.length; b++)
        for (let c = b + 1; c < DECK.length; c++) {
          const f = DECK[a]! + DECK[b]! + DECK[c]!;
          if (fitsTexture(texture(f), filter)) out.push(f);
        }
    LIKE.set(key, out);
  }
  return out;
}
