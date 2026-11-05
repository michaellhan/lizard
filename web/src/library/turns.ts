// A stored turn file (<spot>/<flop>.turn.bin, solver/gto/flop_library.py's encode_turns; decode_turns is this file's
// reader there), decoded in the page with no solver. It holds the flop solve's own turn: on the flop lines at least 1%
// of the hand pairs take, the turn's first decision and, after a check, the other seat's; per turn class, the strategy
// of each combo that reaches the line, in 5% steps, played on the class's one played card. Its combos are on the
// entry's canonical flop. Format 2 adds EVs, the class's and never a hand's: each action's over the range's hands that
// take it. No file holds a hand's own EV at a turn, a turn facing a bet, or anything on a river.
import { cardInt, COMBOS } from "./entry";

export const TURN_MAGIC = "GTOTN1";
const NONE = -32768;

interface TurnHeadLine {
  /** the flop actions to the turn, e.g. ["check", "bet 75%", "call"] */
  path: string[];
  /** its share of the hand pairs entering the flop */
  share: number;
  /** the pot on the turn, bb */
  pot: number;
  nodes: { at: string[]; player: 0 | 1; names: string[] }[];
}

export interface TurnHead {
  format: number;
  /** the entry's canonical flop */
  board: string;
  /** sha1 of the entry the file was solved with, 12 hex digits */
  entry: string;
  /** a stored frequency is a count out of q */
  q: number;
  /** [played card, its class's cards] */
  classes: [string, string][];
  lines: TurnHeadLine[];
  /** format 2: the EVs' step, in times the line's pot */
  ev?: number;
}

export interface TurnClass {
  /** the stored combos (indices into COMBOS, ascending): they reach the line and don't hold the played card */
  combos: number[];
  /** strat[a][j]: the frequency of action a for combos[j] */
  strat: number[][];
}

export interface TurnNode {
  /** the turn actions to the node: [] the first decision, ["check"] in position after a check */
  at: string[];
  player: 0 | 1;
  names: string[];
  classes: TurnClass[];
  /** format 2: evs[class][a] the EV in bb of those of the range's hands that take action a, null where under a
   * twentieth of a combo does; never one hand's. Null in a format-1 file. */
  evs: (number | null)[][] | null;
}

export interface TurnLine extends Omit<TurnHeadLine, "nodes"> {
  nodes: TurnNode[];
}

export interface TurnFile {
  head: TurnHead;
  /** each class's played card */
  played: number[];
  /** how many cards each class stands for */
  sizes: number[];
  lines: TurnLine[];
}

const NB = Math.ceil(COMBOS.length / 8);

/** the combos a packed 1326-bit mask holds, ascending */
function maskOf(raw: Uint8Array, o: number): boolean[] {
  return COMBOS.map((_, i) => ((raw[o + (i >> 3)]! >> (7 - (i & 7))) & 1) === 1);
}

/** the inflated body (header length, header, body) as a turn file */
export function parseTurns(raw: Uint8Array): TurnFile {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl))) as TurnHead;
  if (head.format !== 1 && head.format !== 2) throw new Error(`turn file format ${head.format}`);
  const played = head.classes.map(([c]) => cardInt(c));
  const sizes = head.classes.map(([, cs]) => cs.length / 2);
  const Q = head.q;
  let o = 4 + hl;
  const lines: TurnLine[] = head.lines.map((ln) => {
    const masks = [maskOf(raw, o), maskOf(raw, o + NB)];
    o += 2 * NB;
    const nodes = ln.nodes.map((nd): TurnNode => {
      const A = nd.names.length;
      const classes = played.map((c): TurnClass => {
        const combos = COMBOS.flatMap(([a, b], i) => (masks[nd.player]![i] && a !== c && b !== c ? [i] : []));
        const k = combos.length;
        const strat: number[][] = [];
        for (let a = 0; a < A - 1; a++) {
          strat.push(Array.from(raw.subarray(o, o + k)));
          o += k;
        }
        // the last action is what the others leave of Q
        strat.push(combos.map((_, j) => Math.max(Q - strat.reduce((s, r) => s + r[j]!, 0), 0)));
        for (let j = 0; j < k; j++) {
          const t = strat.reduce((s, r) => s + r[j]!, 0) || 1;
          for (const r of strat) r[j] = r[j]! / t;
        }
        return { combos, strat };
      });
      return { ...nd, classes, evs: null };
    });
    return { ...ln, nodes };
  });
  if (head.ev) {
    const K = played.length;
    const read = (n: number, step: number): (number | null)[] => {
      const out: (number | null)[] = [];
      for (let i = 0; i < n; i++) {
        const x = dv.getInt16(o, true);
        o += 2;
        out.push(x === NONE ? null : x * step);
      }
      return out;
    };
    for (const ln of lines) {
      const step = head.ev * ln.pot;
      read(K * 2, step); // (each class's two range EVs, at the line's first decision: no drill reads them)
      for (const nd of ln.nodes) {
        const all = read(K * nd.names.length, step);
        nd.evs = played.map((_, k) => all.slice(k * nd.names.length, (k + 1) * nd.names.length));
      }
    }
  }
  if (o !== raw.length) throw new Error(`turn file ${head.board}: its body doesn't fit its header`);
  return { head, played, sizes, lines };
}

async function inflate(u8: Uint8Array): Promise<Uint8Array> {
  const s = new Response(u8 as BodyInit).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** decode a fetched <spot>/<flop>.turn.bin */
export async function decodeTurns(buf: ArrayBuffer | Uint8Array): Promise<TurnFile> {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (new TextDecoder().decode(u8.subarray(0, TURN_MAGIC.length)) !== TURN_MAGIC) throw new Error("not a turn file");
  return parseTurns(await inflate(u8.subarray(TURN_MAGIC.length)));
}
