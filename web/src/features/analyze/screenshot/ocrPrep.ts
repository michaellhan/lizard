// What the OCR is given and what it gives back, both pure: the picture made plain for it (the cards and the dealer
// button painted over, since their glyphs only read as noise; grey; dark text on light, as Tesseract reads best; and
// enlarged where the text is small), and its blocks of words turned into lines in the picture's own coordinates.
import type { Box } from "./glyph";
import type { Img } from "./image";
import type { OcrLine, OcrWord } from "./numbers";

/** The picture for the OCR: boxes painted over, grey, light on dark turned round, enlarged `scale` times. */
export function prepareForOcr(img: Img, cover: readonly Box[], scale: number): Img {
  const { width: w, height: h, data } = img;
  const grey = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
  // each box filled with the grey just outside its left edge
  for (const b of cover) {
    const x0 = Math.max(0, Math.floor(b.x) - 2), y0 = Math.max(0, Math.floor(b.y) - 2);
    const x1 = Math.min(w - 1, Math.ceil(b.x + b.w) + 2), y1 = Math.min(h - 1, Math.ceil(b.y + b.h) + 2);
    const fill = grey[Math.floor((y0 + y1) / 2) * w + Math.max(0, x0 - 3)]!;
    for (let y = y0; y <= y1; y++) grey.fill(fill, y * w + x0, y * w + x1 + 1);
  }
  // mostly dark: the text is light, so turn it round
  const hist = new Uint32Array(256);
  for (const v of grey) hist[v]!++;
  let acc = 0, median = 0;
  for (; median < 256; median++) if ((acc += hist[median]!) * 2 >= grey.length) break;
  if (median < 128) for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i]!;
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    // (bilinear)
    const sy = Math.min(h - 1, (y + 0.5) / scale - 0.5), y0 = Math.max(0, Math.floor(sy)), fy = Math.max(0, sy - y0), y1 = Math.min(h - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x + 0.5) / scale - 0.5), x0 = Math.max(0, Math.floor(sx)), fx = Math.max(0, sx - x0), x1 = Math.min(w - 1, x0 + 1);
      const v = (grey[y0 * w + x0]! * (1 - fx) + grey[y0 * w + x1]! * fx) * (1 - fy) + (grey[y1 * w + x0]! * (1 - fx) + grey[y1 * w + x1]! * fx) * fy;
      const o = (y * W + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/** How much to enlarge: text under about 20px tall reads better at twice the size (a picture already big, not). */
export const ocrScale = (img: Pick<Img, "width" | "height">) => (Math.max(img.width, img.height) <= 1400 ? 2 : 1);

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Tesseract.js's blocks, as much of them as is read here. */
export interface TBlock {
  paragraphs: { lines: { text: string; confidence: number; bbox: TBox; words: { text: string; confidence: number; bbox: TBox }[] }[] }[];
}

const toBox = (b: TBox, scale: number): Box => ({ x: b.x0 / scale, y: b.y0 / scale, w: (b.x1 - b.x0) / scale, h: (b.y1 - b.y0) / scale });

/** The blocks' lines, in the original picture's pixels; empty words dropped. A line Tesseract joined across a wide gap
 * (two seats' stacks on one row, say) is split there. */
export function linesOf(blocks: readonly TBlock[] | null | undefined, scale: number): OcrLine[] {
  const out: OcrLine[] = [];
  for (const b of blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const words: OcrWord[] = l.words.map((w) => ({ text: w.text.trim(), conf: w.confidence, box: toBox(w.bbox, scale) })).filter((w) => w.text);
        let part: OcrWord[] = [];
        const flush = () => {
          if (!part.length) return;
          const x0 = Math.min(...part.map((w) => w.box.x)), y0 = Math.min(...part.map((w) => w.box.y));
          const x1 = Math.max(...part.map((w) => w.box.x + w.box.w)), y1 = Math.max(...part.map((w) => w.box.y + w.box.h));
          out.push({ text: part.map((w) => w.text).join(" "), conf: Math.min(...part.map((w) => w.conf)), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, words: part });
          part = [];
        };
        for (const w of words) {
          const prev = part.at(-1);
          if (prev && w.box.x - (prev.box.x + prev.box.w) > 3 * Math.max(prev.box.h, w.box.h)) flush();
          part.push(w);
        }
        flush();
      }
  return out;
}
