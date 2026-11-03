// A flop library entry (<spot>/<flop>.bin, solver/gto/flop_library.py's pack, format 2), decoded in the page as
// classic drills.js does (`decode`, `parse`, `isoReps`, `handWeights`): no solver involved. The file is MAGIC, then
// zlib of a u32 header length, the JSON header and the body. The body has a value per suit-isomorphic combo (the
// combos the canonical flop's suit stabilizer maps to each other share it; each class is stored once, at its least
// combo index, and per node in hand order: ranks high to low, suited first).
export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const cardStr = (c: number): string => RANKS[c >> 2]! + SUITS[c & 3]!;
export const cardInt = (s: string): number => RANKS.indexOf(s[0]!) * 4 + SUITS.indexOf(s[1]!);
export const flopCards = (f: string): [string, string, string] => [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)];

/** cards.ALL_COMBOS: (a, b) with a < b, in order; ranges and entries index combos by position here */
export const COMBOS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) out.push([a, b]);
  return out;
})();
const CIDX = new Map(COMBOS.map(([a, b], i) => [a * 52 + b, i]));
const PERMS: number[][] = [];
(function perms(p: number[], rest: number[]) {
  if (!rest.length) PERMS.push(p);
  rest.forEach((x, i) => perms([...p, x], rest.filter((_, j) => j !== i)));
})([], [0, 1, 2, 3]);

export const MAGIC = "GTOFL3";
export const FORMAT = 2;

export interface EntryHeadNode {
  /** the flop actions to the node, e.g. ["check", "bet 33%"] */
  path: string[];
  /** 0 out of position, 1 in position (the spot's seats) */
  player: 0 | 1;
  names: string[];
  /** the first action is a fold, whose EV is 0 and not stored */
  fold0: boolean;
  /** the range's frequency of each action, in `names` order */
  freqs: number[];
  /** the acting range's size at the node, in combos */
  combos: number;
}

export interface EntryHead {
  spot: string;
  /** the ranges' fingerprints, as ranges.json's `fp` */
  fp: string[];
  pot: number;
  stack: number;
  seats: [string, string];
  board: string;
  iters: number;
  seconds: number;
  /** exploitability of the stored solve, % of the pot, in the solved game */
  expl: number;
  format: number;
  tree: string;
  /** strategy quantum: a stored frequency is a count out of q */
  q: number;
  /** EV coding: [step bb, linear codes, growth past them] */
  ev: [number, number, number];
  nodes: EntryHeadNode[];
}

export interface EntryNode extends Omit<EntryHeadNode, "freqs"> {
  freqs: Record<string, number>;
  /** strat[a][j]: the frequency of action a for the j-th combo of `combos[player]` */
  strat: number[][];
  /** evs[a][j]: that action's EV in bb */
  evs: number[][];
}

export interface Entry {
  head: EntryHead;
  /** each player's combos (indices into COMBOS, ascending): in its range and off the board */
  combos: [number[], number[]];
  nodes: EntryNode[];
}

/** <spot>/ranges.json: the range entering the flop, per combo (in units of 1/10000) */
export interface LibraryRanges {
  format: number;
  id: string;
  fp: string[];
  w: [number[], number[]];
}

/** rep[i]: the least combo index of combo i's class under the board's suit stabilizer (flop_library.iso_reps) */
export function isoReps(board: number[]): number[] {
  const key = [...board].sort((x, y) => x - y).join();
  const rep = COMBOS.map((_, i) => i);
  for (const p of PERMS) {
    const mapped = board.map((c) => (c >> 2) * 4 + p[c & 3]!).sort((x, y) => x - y);
    if (mapped.join() !== key) continue;
    COMBOS.forEach(([a, b], i) => {
      const x = (a >> 2) * 4 + p[a & 3]!;
      const y = (b >> 2) * 4 + p[b & 3]!;
      const j = CIDX.get(Math.min(x, y) * 52 + Math.max(x, y))!;
      if (j < rep[i]!) rep[i] = j;
    });
  }
  return rep;
}

// combo indices in hand order (flop_library._hand_order): the higher card's rank, then the lower's (high to low),
// suited first, then index
function handOrder(idx: number[]): number[] {
  return idx.slice().sort((i, j) => {
    const [a, b] = COMBOS[i]!;
    const [c, d] = COMBOS[j]!;
    const offI = Number((a & 3) !== (b & 3));
    const offJ = Number((c & 3) !== (d & 3));
    return (d >> 2) - (b >> 2) || (c >> 2) - (a >> 2) || offI - offJ || i - j;
  });
}

/** the inflated body (header length, header, body) as an entry */
export function parseEntry(raw: Uint8Array): Entry {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl))) as EntryHead;
  if (head.format !== FORMAT) throw new Error(`flop library entry format ${head.format}`);
  const Q = head.q;
  const [step, lin, base] = head.ev;
  const dValue = (c: number) => (c < lin ? c * step : lin * step * Math.pow(base, c - lin));
  const rep = isoReps(flopCards(head.board).map(cardInt));
  const own = rep.flatMap((r, i) => (r === i ? [i] : []));
  let o = 4 + hl;
  const nb = Math.ceil(own.length / 8);
  const masks: Uint8Array[] = [];
  const combos: [number[], number[]] = [[], []];
  for (const p of [0, 1] as const) {
    const m = new Uint8Array(COMBOS.length);
    own.forEach((c, k) => {
      m[c] = (raw[o + (k >> 3)]! >> (7 - (k & 7))) & 1;
    });
    o += nb;
    masks.push(m);
    for (let i = 0; i < COMBOS.length; i++) if (m[rep[i]!]) combos[p].push(i);
  }
  const nodes = head.nodes.map((nd): EntryNode => {
    const stored = handOrder(own.filter((c) => masks[nd.player]![c]));
    const pos = new Map(stored.map((c, k) => [c, k]));
    const col = combos[nd.player].map((i) => pos.get(rep[i]!)!);
    const k = stored.length;
    const A = nd.names.length;
    const strat: number[][] = [];
    const evs: number[][] = [];
    for (let a = 0; a < A - 1; a++) {
      strat.push(Array.from(raw.subarray(o, o + k)));
      o += k;
    }
    // the last action's frequency is what the others leave of Q
    strat.push(strat.length ? strat[0]!.map((_, j) => Math.max(Q - strat.reduce((s, r) => s + r[j]!, 0), 0)) : new Array<number>(k).fill(Q));
    for (let j = 0; j < k; j++) {
      const t = strat.reduce((s, r) => s + r[j]!, 0) || 1;
      for (const r of strat) r[j] = r[j]! / t;
    }
    // the hand's best value (int16, low bytes then high bytes), each action's EV coded as a drop from it
    const v = new Array<number>(k);
    for (let j = 0; j < k; j++) {
      const x = raw[o + j]! | (raw[o + k + j]! << 8);
      v[j] = (x > 32767 ? x - 65536 : x) * step;
    }
    o += 2 * k;
    if (nd.fold0) evs.push(new Array<number>(k).fill(0));
    for (let r = nd.fold0 ? 1 : 0; r < A; r++) {
      evs.push(v.map((x, j) => x - dValue(raw[o + j]!)));
      o += k;
    }
    const freqs = Object.fromEntries(nd.names.map((n, a) => [n, nd.freqs[a]!]));
    return { ...nd, freqs, strat: strat.map((r) => col.map((c) => r[c]!)), evs: evs.map((r) => col.map((c) => r[c]!)) };
  });
  return { head, combos, nodes };
}

async function inflate(u8: Uint8Array): Promise<Uint8Array> {
  const s = new Response(u8 as BodyInit).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** decode a fetched <spot>/<flop>.bin */
export async function decodeEntry(buf: ArrayBuffer | Uint8Array): Promise<Entry> {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (new TextDecoder().decode(u8.subarray(0, MAGIC.length)) !== MAGIC) throw new Error("not a flop library entry");
  return parseEntry(await inflate(u8.subarray(MAGIC.length)));
}

export const nodeAt = (e: Entry, path: readonly string[]): EntryNode | null =>
  e.nodes.find((n) => n.path.join("|") === path.join("|")) ?? null;

/** The acting player's hand weights at a node, by column of `combos[player]`: the range entering the flop, none
 * touching the board, times the player's own frequency of each earlier action on the path. */
export function handWeights(e: Entry, path: readonly string[], ranges: LibraryRanges): number[] | null {
  const nd = nodeAt(e, path);
  if (!nd) return null;
  const p = nd.player;
  const board = new Set(flopCards(e.head.board).map(cardInt));
  const w = e.combos[p].map((ci) => {
    const [a, b] = COMBOS[ci]!;
    return board.has(a) || board.has(b) ? 0 : ranges.w[p][ci]! / 10000;
  });
  for (let i = 0; i < path.length; i++) {
    const anc = nodeAt(e, path.slice(0, i));
    if (anc && anc.player === p) {
      const a = anc.names.indexOf(path[i]!);
      w.forEach((x, j) => (w[j] = x * anc.strat[a]![j]!));
    }
  }
  return w;
}
