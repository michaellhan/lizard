// The cards in a screenshot, read without OCR (which reads card corners badly): a card is a region of one colour (a
// white face, or a coloured one in a four-colour deck) with a card's shape, and its corner index is a rank glyph with
// a suit glyph under it. Each glyph is matched against templates (templates.ts, glyph.ts); the suit also by colour,
// and the deck's colours are read once for the whole picture: blue or green anywhere means a four-colour deck, where
// colour alone names the suit. A card half covered by the next one still shows its corner, so it's read the same way.
// What can't be read this way (rotated or fanned cards, a deck with no corner index, a white table) isn't found, and
// the form says so.
import { decodeGrid, similarity, toGrid, type Box } from "./glyph";
import { heightOf, hueOf, segment, widthOf, type Hue, type Img, type Region } from "./image";
import { TEMPLATES, type Template } from "./templates";

export interface FoundCard {
  /** "As", "Td" */
  code: string;
  /** the card's box (a half-covered card's: its visible part) */
  box: Box;
  /** the face's height, px */
  faceH: number;
  /** 0..1: how sure, the lower of the rank's and the suit's */
  conf: number;
  rankConf: number;
  suitConf: number;
  /** how the suit was read */
  suitBy: "colour" | "shape" | "colour and shape";
}

export interface CardScan {
  cards: FoundCard[];
  /** the dealer button's centre and radius, where one was found */
  dealer: { x: number; y: number; r: number; conf: number } | null;
  fourColour: boolean;
  /** the regions looked at and left out, for the record (counts) */
  looked: number;
}

interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
  /** mean colour of the blob's solid part */
  r: number;
  g: number;
  b: number;
}

const compiled = TEMPLATES.map((t) => ({ ...t, grid: decodeGrid(t.bits) }));
const RANK_T = compiled.filter((t) => t.kind === "rank");
const SUIT_T = compiled.filter((t) => t.kind === "suit");
const DEALER_T = compiled.filter((t) => t.kind === "dealer");

/** the least distance from the face's colour that counts as ink */
const INK = 70;

/** The best score for each label among templates, against a glyph's grid and width/height. */
function scores(grid: Float32Array, aspect: number, ts: readonly (Template & { grid: Float32Array })[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of ts) {
    const s = similarity(grid, t.grid) - 0.2 * Math.abs(Math.log(aspect / t.aspect));
    if (s > (out.get(t.label) ?? -Infinity)) out.set(t.label, s);
  }
  return out;
}

const ranked = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);

/** What's inside a face region: its ink (distance from the face colour, inside the face's outline), in blobs. */
class Face {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly dist: Float32Array;
  readonly blobs: Blob[] = [];
  /** pixels inside the face's outline */
  inside = 0;
  constructor(
    readonly img: Img,
    labels: Int32Array,
    readonly reg: Region,
  ) {
    this.x0 = reg.x0;
    this.y0 = reg.y0;
    this.w = widthOf(reg);
    this.h = heightOf(reg);
    const { w, h } = this;
    const W = img.width;
    // inside: between the face's first and last pixel on the row and on the column (so the felt showing past a rounded
    // corner, and the card's own border, are left out)
    const rowL = new Int32Array(h).fill(w), rowR = new Int32Array(h).fill(-1);
    const colT = new Int32Array(w).fill(h), colB = new Int32Array(w).fill(-1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (labels[(this.y0 + y) * W + this.x0 + x] === reg.id) {
          if (x < rowL[y]!) rowL[y] = x;
          if (x > rowR[y]!) rowR[y] = x;
          if (y < colT[x]!) colT[x] = y;
          if (y > colB[x]!) colB[x] = y;
        }
    this.dist = new Float32Array(w * h);
    const d = img.data;
    for (let y = 0; y < h; y++)
      for (let x = rowL[y]!; x <= rowR[y]!; x++) {
        if (y < colT[x]! || y > colB[x]!) continue;
        this.inside++;
        const o = ((this.y0 + y) * W + this.x0 + x) * 4;
        const dr = d[o]! - reg.r, dg = d[o + 1]! - reg.g, db = d[o + 2]! - reg.b;
        this.dist[y * w + x] = Math.sqrt(dr * dr + dg * dg + db * db);
      }
    this.findBlobs();
  }

  private findBlobs() {
    const { w, h, dist } = this;
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    const d = this.img.data, W = this.img.width;
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || dist[s]! < INK) continue;
      let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0, max = 0;
      const members: number[] = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % w, y = (p - x) / w;
        members.push(p);
        count++;
        if (dist[p]! > max) max = dist[p]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (!seen[q] && dist[q]! >= INK) {
              seen[q] = 1;
              stack.push(q);
            }
          }
      }
      if (count < 4) continue;
      // its solid part's colour: the pixels at least 70% of the way to its ink
      let r = 0, g = 0, b = 0, k = 0;
      for (const p of members)
        if (dist[p]! >= 0.7 * max) {
          const o = ((this.y0 + (p - (p % w)) / w) * W + this.x0 + (p % w)) * 4;
          r += d[o]!;
          g += d[o + 1]!;
          b += d[o + 2]!;
          k++;
        }
      this.blobs.push({ x0, y0, x1, y1, count, r: r / k, g: g / k, b: b / k });
    }
  }

  /** A glyph's grid: the ink's coverage over the box, relative to the strongest ink in it. */
  glyph(box: Box): { grid: Float32Array; aspect: number } {
    const { w, dist } = this;
    let max = 0;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) max = Math.max(max, dist[y * w + x]!);
    const full = max * 0.9;
    const cov = new Float32Array(box.w * box.h);
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++) cov[y * box.w + x] = Math.min(1, dist[(box.y + y) * w + box.x + x]! / full);
    // (cut to the coverage of 0.4 and over, as the templates were)
    let x0 = box.w, y0 = box.h, x1 = -1, y1 = -1;
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++)
        if (cov[y * box.w + x]! >= 0.4) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return { grid: new Float32Array(0), aspect: 1 };
    const cut = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return { grid: toGrid(cov, box.w, cut), aspect: cut.w / cut.h };
  }

  /** The solid ink's mean colour in a box (the pixels at least 70% of the way to its strongest). */
  inkColour(box: Box): [number, number, number] {
    const { w, dist } = this;
    const W = this.img.width, d = this.img.data;
    let max = 0;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) max = Math.max(max, dist[y * w + x]!);
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++)
        if (dist[y * w + x]! >= 0.7 * max && max >= INK) {
          const o = ((this.y0 + y) * W + this.x0 + x) * 4;
          r += d[o]!;
          g += d[o + 1]!;
          b += d[o + 2]!;
          k++;
        }
    return k ? [r / k, g / k, b / k] : [this.reg.r, this.reg.g, this.reg.b];
  }
}

const boxOf = (...bs: Blob[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x0)), y0 = Math.min(...bs.map((b) => b.y0));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x1)) - x0 + 1, h: Math.max(...bs.map((b) => b.y1)) - y0 + 1 };
};
const bh = (b: Blob) => b.y1 - b.y0 + 1;
const bw = (b: Blob) => b.x1 - b.x0 + 1;

interface Index {
  rank: string;
  rankConf: number;
  rankBox: Box;
  /** the suit by shape, each suit's score */
  shape: Map<string, number>;
  /** the suit's colour: the ink's, or the face's where the ink is white on a coloured face */
  hue: Hue;
  /** x of the index in the image */
  x: number;
  /** the suit was cut from where it should be, not found as a glyph of its own */
  suitCut: boolean;
}

/** The box, cut to the face (none if nothing is left). */
function clip(b: Box, face: { w: number; h: number }): Box | null {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const w = Math.min(face.w, b.x + b.w) - x, h = Math.min(face.h, b.y + b.h) - y;
  return w >= 3 && h >= 3 ? { x, y, w, h } : null;
}

/** Every corner index in a face: a rank (one glyph, or two side by side for 10) with a suit glyph right under it. */
function indexesOf(face: Face): Index[] {
  // a face's height: its own, but a strip (a card half covered) is as tall as a card
  const H = face.h;
  const faceHue = hueOf(face.reg.r, face.reg.g, face.reg.b);
  const used = new Set<Blob>();
  const out: Index[] = [];
  const ranks = face.blobs
    .filter((b) => b.y0 <= 0.4 * H && bh(b) >= 0.1 * H && bh(b) <= 0.5 * H && bw(b) <= 0.6 * H)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const rb of ranks) {
    if (used.has(rb)) continue;
    // 10: a second glyph beside it (either side: a round 0 can stand taller than its 1), as tall and level with it
    const level = (o: Blob) => Math.abs((o.y0 + o.y1) / 2 - (rb.y0 + rb.y1) / 2) <= 0.2 * bh(rb) && Math.abs(bh(o) - bh(rb)) <= 0.25 * bh(rb);
    const gap = (a: Blob, b: Blob) => b.x0 - a.x1;
    const pair = face.blobs.find((o) => o !== rb && !used.has(o) && level(o) && (o.x0 > rb.x0 ? gap(rb, o) : gap(o, rb)) <= 0.45 * bh(rb) && (o.x0 > rb.x0 ? gap(rb, o) : gap(o, rb)) >= -0.2 * bh(rb));
    let best: { blobs: Blob[]; label: string; score: number; second: number } | null = null;
    const judge = (t: Blob[]) => {
      const { grid, aspect } = face.glyph(boxOf(...t));
      if (!grid.length) return null;
      const [first, next] = ranked(scores(grid, aspect, RANK_T));
      return first ? { blobs: t, label: first[0], score: first[1], second: next?.[1] ?? 0, t: scores(grid, aspect, RANK_T).get("T") ?? -1 } : null;
    };
    // two glyphs level and side by side are only ever a 10: taken as one where they look like one at all
    const two = pair ? judge([rb, pair]) : null;
    if (two && two.t >= 0.4) best = { ...two, label: "T", score: Math.max(two.t, 0.5), second: two.label === "T" ? two.second : two.score };
    else best = judge([rb]);
    if (!best || best.score < 0.45) continue;
    const rbox = boxOf(...best.blobs);
    const rcx = rbox.x + rbox.w / 2;
    // the suit: the nearest glyph under the rank, about level with it
    const suit = face.blobs
      .filter((o) => !best.blobs.includes(o) && !used.has(o) && o.y0 >= rbox.y + rbox.h - 0.08 * H && o.y0 <= rbox.y + rbox.h + 0.22 * H)
      .filter((o) => Math.abs((o.x0 + o.x1) / 2 - rcx) <= 0.6 * Math.max(rbox.w, bw(o)) && bh(o) >= 0.05 * H && bh(o) <= 0.45 * H)
      .sort((a, b) => a.y0 - b.y0)[0];
    // none on its own (it touches the big pip): the ink in the place under the rank where it would be
    const sbox: Box | null = suit
      ? boxOf(suit)
      : clip({ x: Math.round(rbox.x - 0.15 * rbox.w), y: rbox.y + rbox.h + 1, w: Math.round(rbox.w * 1.3), h: Math.round(0.24 * H) }, face);
    if (!sbox) continue;
    const sg = face.glyph(sbox);
    if (!sg.grid.length) continue;
    const shape = scores(sg.grid, sg.aspect, SUIT_T);
    if (!suit && (ranked(shape)[0]?.[1] ?? 0) < 0.5) continue;
    const [ir, ig, ib] = suit ? [suit.r, suit.g, suit.b] : face.inkColour(sbox);
    const inkHue = hueOf(ir, ig, ib);
    // white ink on a coloured (or dark) face: the face is the suit's colour
    const hue: Hue = inkHue === "light" ? faceHue : inkHue;
    for (const b of best.blobs) used.add(b);
    if (suit) used.add(suit);
    out.push({ rank: best.label, rankConf: conf(best.score, best.second), rankBox: rbox, shape, hue, x: face.x0 + rbox.x, suitCut: !suit });
  }
  return out;
}

/** 0..1 from a template score and the next label's: high where it matched well and nothing else came close. */
const conf = (score: number, second: number) => Math.max(0, Math.min(1, (score - 0.45) * 2)) * Math.max(0, Math.min(1, (score - second) * 6));

/** A region shaped like a card face (or a run of overlapping ones), not too small or large for this picture. */
function faceLike(r: Region, img: Img): boolean {
  const w = widthOf(r), h = heightOf(r);
  if (h < 20 || w < 6 || h > 0.45 * img.height || w > 0.45 * img.width) return false;
  const aspect = w / h;
  if (aspect < 0.15 || aspect > 1.6) return false;
  return r.count / (w * h) >= 0.45;
}

const FOUR: Partial<Record<Hue, string>> = { dark: "s", red: "h", blue: "d", green: "c" };
const TWO: Partial<Record<Hue, string[]>> = { dark: ["s", "c"], red: ["h", "d"] };

function suitOf(ix: Index, fourColour: boolean): { suit: string; conf: number; by: FoundCard["suitBy"] } {
  const byShape = ranked(ix.shape);
  const shapeBest = byShape[0]!;
  if (fourColour && FOUR[ix.hue]) {
    const s = FOUR[ix.hue]!;
    const agrees = shapeBest[0] === s;
    return { suit: s, conf: agrees ? 1 : 0.75, by: agrees ? "colour and shape" : "colour" };
  }
  const among = TWO[ix.hue];
  if (among) {
    const [a, b] = among.map((s) => [s, ix.shape.get(s) ?? -1] as const).sort((x, y) => y[1] - x[1]);
    return { suit: a![0], conf: conf(a![1], b![1]), by: "colour and shape" };
  }
  return { suit: shapeBest[0], conf: conf(shapeBest[1], byShape[1]?.[1] ?? 0) * 0.8, by: "shape" };
}

/** The dealer button: a small round region (any colour) holding one glyph that reads as D. */
function dealerOf(face: Face): CardScan["dealer"] {
  const { w, h } = face;
  if (h < 10 || h > 80 || w / h < 0.8 || w / h > 1.25) return null;
  const round = face.inside / (w * h);
  if (round < 0.6 || round > 0.9) return null;
  const big = face.blobs.filter((b) => bh(b) >= 0.3 * h);
  if (big.length !== 1) return null;
  const g = face.glyph(boxOf(big[0]!));
  if (!g.grid.length) return null;
  const s = ranked(scores(g.grid, g.aspect, DEALER_T))[0]?.[1] ?? 0;
  const vsRank = ranked(scores(g.grid, g.aspect, RANK_T))[0]?.[1] ?? 0;
  if (s < 0.6 || s < vsRank) return null;
  return { x: face.x0 + w / 2, y: face.y0 + h / 2, r: Math.max(w, h) / 2, conf: Math.min(1, (s - 0.5) * 2) };
}

/** The dealer button's box, for the OCR to leave out. */
export const dealerBox = (d: NonNullable<CardScan["dealer"]>) => ({ x: d.x - d.r - 2, y: d.y - d.r - 2, w: 2 * d.r + 4, h: 2 * d.r + 4 });

/** Every card the picture shows face up, and the dealer button. */
export function scanCards(img: Img): CardScan {
  const { labels, regions } = segment(img);
  const faces: Face[] = [];
  let dealer: CardScan["dealer"] = null;
  let looked = 0;
  for (const r of regions) {
    const w = widthOf(r), h = heightOf(r);
    if (h >= 10 && h <= 80 && w / h >= 0.8 && w / h <= 1.25 && r.count >= 40) {
      const d = dealerOf(new Face(img, labels, r));
      if (d && (!dealer || d.conf > dealer.conf)) dealer = d;
    }
    if (!faceLike(r, img)) continue;
    looked++;
    faces.push(new Face(img, labels, r));
  }
  const found: { face: Face; ix: Index }[] = [];
  for (const face of faces) {
    // a dark face (a seat's box, a dark four-colour spade) only as a single card's shape, or as the strip of one that
    // the next card covers (its right edge against another face as tall)
    const hue = hueOf(face.reg.r, face.reg.g, face.reg.b);
    const aspect = face.w / face.h;
    const covered = () => faces.some((o) => o !== face && Math.abs(o.x0 - (face.x0 + face.w)) <= 4 && Math.abs(o.h - face.h) <= 0.12 * face.h && Math.abs(o.y0 - face.y0) <= 0.12 * face.h);
    if (hue === "dark" && aspect > 0.9) continue;
    if (hue === "dark" && aspect < 0.5 && !covered()) continue;
    for (const ix of indexesOf(face)) found.push({ face, ix });
  }
  const fourColour = found.some(({ ix }) => ix.hue === "blue" || ix.hue === "green");
  const cards: FoundCard[] = found.map(({ face, ix }) => {
    const s = suitOf(ix, fourColour);
    // the card's box: from its index to the face's right edge, or to the next index in the same face
    const next = found.filter((o) => o.face === face && o.ix.x > ix.x).map((o) => o.ix.x).sort((a, b) => a - b)[0];
    const x = Math.max(face.x0, ix.x - Math.round(ix.rankBox.x === 0 ? 0 : face.h * 0.05));
    const right = next ?? face.x0 + face.w;
    return {
      code: ix.rank + s.suit,
      box: { x, y: face.y0, w: right - x, h: face.h },
      faceH: face.h,
      conf: Math.min(ix.rankConf, s.conf),
      rankConf: ix.rankConf,
      suitConf: s.conf,
      suitBy: s.by,
    };
  });
  return { cards, dealer, fourColour, looked };
}
