// A glyph as the card reader compares it: its ink's coverage (0 to 1 a pixel), cut to its box and averaged onto a small
// grid, so a rank or suit drawn at any size lands on the same cells. The templates (templates.ts) are made by the same
// function from glyphs drawn on a canvas (scripts/screenshot/make-fixtures.mjs imports this file as it is, so it has
// no imports of its own and no syntax beyond what Node strips from TypeScript).

export const GRID_W = 12;
export const GRID_H = 16;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The coverage inside `box` (cov is w×h, row by row, 0..1), averaged onto GRID_W × GRID_H cells. */
export function toGrid(cov: Float32Array | number[], width: number, box: Box): Float32Array {
  const out = new Float32Array(GRID_W * GRID_H);
  const sx = box.w / GRID_W;
  const sy = box.h / GRID_H;
  for (let gy = 0; gy < GRID_H; gy++) {
    const y0 = box.y + gy * sy;
    const y1 = y0 + sy;
    for (let gx = 0; gx < GRID_W; gx++) {
      const x0 = box.x + gx * sx;
      const x1 = x0 + sx;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          sum += (cov[y * width + x] ?? 0) * wx * wy;
          area += wx * wy;
        }
      }
      out[gy * GRID_W + gx] = area ? sum / area : 0;
    }
  }
  return out;
}

/** A grid as text, a hex digit a cell (0 none, f full). */
export function encodeGrid(g: Float32Array): string {
  let s = "";
  for (const v of g) s += Math.max(0, Math.min(15, Math.round(v * 15))).toString(16);
  return s;
}

export function decodeGrid(s: string): Float32Array {
  const out = new Float32Array(GRID_W * GRID_H);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s[i] ?? "0", 16) / 15;
  return out;
}

/** How alike two grids are, -1 to 1 (normalised cross-correlation: the ink's weight and contrast don't count). */
export function similarity(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
