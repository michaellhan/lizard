// The screenshot as the reader works on it: RGBA pixels (an ImageData's shape, so a canvas's and a decoded PNG's are
// the same), cut into regions of one colour. Pure: no DOM, so the tests run it on fixture PNGs in Node.

export interface Img {
  width: number;
  height: number;
  /** RGBA, row by row */
  data: Uint8ClampedArray;
}

export interface Region {
  id: number;
  /** pixels in the region */
  count: number;
  x0: number;
  y0: number;
  /** inclusive */
  x1: number;
  y1: number;
  /** the region's mean colour */
  r: number;
  g: number;
  b: number;
}

export const widthOf = (r: Pick<Region, "x0" | "x1">) => r.x1 - r.x0 + 1;
export const heightOf = (r: Pick<Region, "y0" | "y1">) => r.y1 - r.y0 + 1;

/** Each pixel's region, grown from a seed to the 4-connected pixels within `tol` of the seed's colour (the largest
 * channel difference). A card's face, the felt and a seat's box each come out as one region; a glyph's anti-aliased
 * edge as many small ones. Time and memory in proportion to the pixels. */
export function segment(img: Img, tol = 26): { labels: Int32Array; regions: Region[] } {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const regions: Region[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;
    const id = regions.length;
    const sr = d[start * 4]!, sg = d[start * 4 + 1]!, sb = d[start * 4 + 2]!;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, tr = 0, tg = 0, tb = 0;
    while (top) {
      const p = stack[--top]!;
      const x = p % w, y = (p - x) / w;
      count++;
      tr += d[p * 4]!;
      tg += d[p * 4 + 1]!;
      tb += d[p * 4 + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // (the four neighbours, unrolled)
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    regions.push({ id, count, x0, y0, x1, y1, r: tr / count, g: tg / count, b: tb / count });
    function push(q: number) {
      if (labels[q] !== -1) return;
      const o = q * 4;
      if (Math.abs(d[o]! - sr) > tol || Math.abs(d[o + 1]! - sg) > tol || Math.abs(d[o + 2]! - sb) > tol) return;
      labels[q] = id;
      stack[top++] = q;
    }
  }
  return { labels, regions };
}

/** The image halved (a 2×2 box average), for a screenshot taken at twice the screen's pixels. */
export function halve(img: Img): Img {
  const w = Math.floor(img.width / 2), h = Math.floor(img.height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  const s = img.data, W = img.width;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = ((2 * y) * W + 2 * x) * 4, b = a + 4, c = a + W * 4, e = c + 4, o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (s[a + k]! + s[b + k]! + s[c + k]! + s[e + k]! + 2) >> 2;
    }
  return { width: w, height: h, data: out };
}

/** The pixel's colour. */
export const rgbAt = (img: Img, x: number, y: number): [number, number, number] => {
  const o = (y * img.width + x) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
};

/** A colour's broad class, as a suit colour: near-black or grey (dark), or red, green, blue by hue. */
export type Hue = "dark" | "light" | "red" | "green" | "blue";
export function hueOf(r: number, g: number, b: number): Hue {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const s = max ? (max - min) / max : 0;
  if (s < 0.3) return max > 170 ? "light" : "dark";
  if (max < 60) return "dark";
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  if (hue < 0) hue += 360;
  if (hue < 45 || hue >= 320) return "red";
  if (hue < 175) return "green";
  return "blue";
}
