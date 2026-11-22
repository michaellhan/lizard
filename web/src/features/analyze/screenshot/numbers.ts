// The numbers on a table, from the OCR's lines of text: the blinds (a "0.5/1" in the title or a corner), the pot (the
// line that says pot), and each seat's stack (a line that is an amount alone, or ends in one, or says all-in).
// Pure: the OCR itself is ocr.ts, so these are tested on lines written by hand.
import type { Box } from "./glyph";

export interface OcrWord {
  text: string;
  /** 0..100, as Tesseract gives it */
  conf: number;
  box: Box;
}

export interface OcrLine {
  text: string;
  conf: number;
  box: Box;
  words: OcrWord[];
}

export type Unit = "money" | "bb";

export interface Amount {
  value: number;
  unit: Unit;
  currency?: string;
}

/** The digits of a number as the OCR misreads them in a line of figures: O for 0, l or I for 1, S for 5. */
const fixDigits = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5");

/** "€1,234.50" -> 1234.5 money; "12.5 BB" -> 12.5 bb; "1.2K" -> 1200; "1.234,50" -> 1234.5 (a comma decimal);
 * null where it isn't one amount. */
export function parseAmount(text: string): Amount | null {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^([$€£¥₹])?\s?([0-9OoSlI|][0-9OoSlI|.,' ]*?)\s?([kKmM])?\s?(bb|BB|Bb)?$/.exec(t);
  if (!m) return null;
  const currency = m[1];
  let core = fixDigits(m[2]!.replace(/[' ]/g, ""));
  if (!/\d/.test(core) || /[^\d.,]/.test(core)) return null;
  const dot = core.lastIndexOf("."), comma = core.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    // both: the last is the decimal mark
    core = dot > comma ? core.replace(/,/g, "") : core.replace(/\./g, "").replace(",", ".");
  } else if (comma >= 0) {
    // "1,234" or "12,345,678": thousands; "12,5": a decimal comma
    core = /^\d{1,3}(,\d{3})+$/.test(core) ? core.replace(/,/g, "") : core.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(core)) core = core.replace(/\./g, ""); // ("1.234.567")
  if (!/^\d+(\.\d+)?$/.test(core)) return null;
  let value = Number(core);
  if (m[3]) value *= /k/i.test(m[3]) ? 1e3 : 1e6;
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[4] ? "bb" : "money", ...(currency ? { currency } : {}) };
}

/** The amounts in a line, left to right (each a run of words that reads as one). */
export function amountsIn(line: OcrLine): { amount: Amount; box: Box; conf: number }[] {
  const out: { amount: Amount; box: Box; conf: number }[] = [];
  const ws = line.words;
  for (let i = 0; i < ws.length; i++) {
    // up to three words: "$", "1,234", "BB"
    for (let k = Math.min(3, ws.length - i); k >= 1; k--) {
      const part = ws.slice(i, i + k);
      const a = parseAmount(part.map((w) => w.text).join(" ").replace(/[:;]$/, ""));
      if (!a) continue;
      // (a lone word with no digit at all isn't a number: "SOS", "I")
      if (!/\d/.test(part.map((w) => w.text).join(""))) continue;
      out.push({ amount: a, box: unionBox(part.map((w) => w.box)), conf: Math.min(...part.map((w) => w.conf)) });
      i += k - 1;
      break;
    }
  }
  return out;
}

export function unionBox(bs: readonly Box[]): Box {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
}

export interface Read<T> {
  value: T;
  /** 0..1 */
  conf: number;
  /** what the reading came from, in words: the line of text */
  from: string;
  box?: Box;
}

const BLINDS = /([$€£¥₹]?\s?\d[\d.,]*\s?[kKmM]?)\s?\/\s?([$€£¥₹]?\s?\d[\d.,]*\s?[kKmM]?)/;
const STAKES_WORDS = /blind|stake|hold|\bNL|\bPL|limit|\bante|cash|table/i;

/** The blinds, from a line like "NL Hold'em $0.50/$1" or "Blinds 50/100" (the big blind at most 4 small blinds). */
export function readBlinds(lines: readonly OcrLine[]): Read<{ sb: number; bb: number }> | null {
  let best: Read<{ sb: number; bb: number }> | null = null;
  for (const l of lines) {
    // the currency sign after the slash is where the OCR slips most: read as "%", "§" or "&", or doubled ("$1/$%$2"),
    // or read as a digit, 5 or 8 ("$0.5/81" for $0.5/$1), which the big blind's limit catches
    const text = l.text
      .replace(/%(?=\s?[$€£¥₹])/g, "")
      .replace(/(\/\s?)[$%§&]*([$€£¥₹])/g, "$1$2")
      .replace(/(\/\s?)[%§&](?=\d)/g, "$1");
    const m = BLINDS.exec(text);
    if (!m) continue;
    const a = parseAmount(m[1]!);
    let b = parseAmount(m[2]!);
    const fits = (x: Amount | null): x is Amount => !!a && !!x && a.value > 0 && x.value >= a.value && x.value <= 4 * a.value;
    let slip = false;
    if (!fits(b) && a?.currency && /^[58]\d/.test(m[2]!.trim())) {
      b = parseAmount(m[2]!.trim().slice(1));
      slip = true;
    }
    if (!a || !fits(b)) continue;
    const conf = (STAKES_WORDS.test(l.text) ? 1 : 0.6) * (slip ? 0.8 : 1) * Math.min(1, l.conf / 80);
    if (!best || conf > best.conf) best = { value: { sb: a.value, bb: b.value }, conf, from: l.text, box: l.box };
  }
  return best;
}

/** The pot: the amount after "pot" on its line ("Total pot" first; a side pot isn't the pot). */
export function readPot(lines: readonly OcrLine[]): Read<Amount> | null {
  let best: (Read<Amount> & { rank: number }) | null = null;
  for (const l of lines) {
    const m = /\b(total\s+|main\s+|side\s+)?p[o0]t\b/i.exec(l.text);
    if (!m || /side/i.test(m[1] ?? "")) continue;
    const at = l.words.findIndex((w) => /p[o0]t/i.test(w.text));
    const after: OcrLine = { ...l, words: l.words.slice(at + 1).map((w) => ({ ...w, text: w.text.replace(/^[:]/, "") })).filter((w) => w.text) };
    const a = amountsIn(after)[0];
    if (!a) continue;
    const rank = /total/i.test(m[1] ?? "") ? 2 : /main/i.test(m[1] ?? "") ? 0 : 1;
    const conf = Math.min(1, a.conf / 85);
    if (!best || rank > best.rank || (rank === best.rank && conf > best.conf)) best = { value: a.amount, conf, from: l.text, box: a.box, rank };
  }
  return best && { value: best.value, conf: best.conf, from: best.from, ...(best.box ? { box: best.box } : {}) };
}

/** A seat's stack as a line shows it: an amount on its own (or after a name), or all-in (no chips left). */
export interface StackRead {
  amount: Amount;
  allIn: boolean;
  conf: number;
  box: Box;
  from: string;
}

/** Every line that reads as a seat's stack, but the blinds' and the pot's own lines. */
export function readStacks(lines: readonly OcrLine[], skip: readonly OcrLine[] = []): StackRead[] {
  const out: StackRead[] = [];
  for (const l of lines) {
    if (skip.includes(l) || /p[o0]t\b/i.test(l.text) || BLINDS.test(l.text)) continue;
    if (/^all[\s-]?in$/i.test(l.text.trim())) {
      out.push({ amount: { value: 0, unit: "money" }, allIn: true, conf: Math.min(1, l.conf / 85), box: l.box, from: l.text });
      continue;
    }
    const as = amountsIn(l);
    const last = as.at(-1);
    if (!last) continue;
    // the amount must end the line (a name before it is fine; words after it aren't a stack)
    const lastWord = l.words.at(-1)!;
    if (last.box.x + last.box.w < lastWord.box.x + lastWord.box.w - 1) continue;
    // a bare small integer with no currency next to letters is likelier a name's digits ("tilt42") than a stack
    if (as.length === 1 && l.words.length > 1 && !last.amount.currency && last.amount.unit === "money" && /[a-z]\d+$/i.test(l.text.replace(/\s+/g, ""))) continue;
    out.push({ amount: last.amount, allIn: false, conf: Math.min(1, last.conf / 85), box: last.box, from: l.text });
  }
  return out;
}

/** Whether a stack is in the screenshot's money or in big blinds, by what most of the amounts say. */
export function unitOf(reads: readonly { amount: Amount }[]): Unit {
  const bb = reads.filter((r) => r.amount.unit === "bb").length;
  return bb * 2 > reads.length ? "bb" : "money";
}

/** Text a person reads: "€1,234.5", "12.5bb". */
export function formatAmount(v: number, unit: Unit, currency = ""): string {
  const n = Math.round(v * 100) / 100;
  return unit === "bb" ? `${n}bb` : `${currency}${n.toLocaleString("en-US")}`;
}
