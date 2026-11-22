/// <reference types="node" />
// PNG files for the screenshot reader's tests (fixtures/), read and written with zlib alone: 8-bit RGB or RGBA, not
// interlaced, which is what Chromium's screenshots are.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import type { Img } from "./image";

export const FIXTURES = join(process.cwd(), "src", "features", "analyze", "screenshot", "fixtures");

/** What a synthetic table holds (scripts/screenshot/make-fixtures.mjs writes it beside the pictures). */
export interface Truth {
  file: string;
  players: number;
  heroPos: string;
  hero: string;
  board: string;
  sb: number;
  bb: number;
  unit: "bb" | "money";
  pot: number;
  stacks: Record<string, number>;
  style: string;
  font: string;
  heldOut: boolean;
  svgSuits: boolean;
}

export const truthOf = (dir = FIXTURES): Truth[] => JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Truth[];

export function decodePng(buf: Uint8Array): Img {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let ct = 0;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
      ct = body[9]!;
    } else if (type === "IDAT") idat.push(body);
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!ch) throw new Error(`PNG colour type ${ct} isn't read here`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch]! : 0;
      const b = prev[i]!;
      const c = i >= ch ? prev[i - ch]! : 0;
      const x = line[i]!;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * ch]!;
      out[o + 1] = cur[x * ch + 1]!;
      out[o + 2] = cur[x * ch + 2]!;
      out[o + 3] = ch === 4 ? cur[x * ch + 3]! : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

export const readPng = (path: string): Img => decodePng(readFileSync(path));

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The image as a PNG file (RGBA): what OCR in Node reads. */
export function encodePng(img: Img): Buffer {
  const { width: w, height: h, data } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "latin1"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
