import { describe, expect, it } from "vitest";
import { amountsIn, formatAmount, parseAmount, readBlinds, readPot, readStacks, unitOf, type OcrLine } from "./numbers";
import { linesOf, type TBlock } from "./ocrPrep";

/** A line as the OCR gives it: words laid left to right, each 10px a letter, at (x, y). */
function line(text: string, x = 0, y = 0, conf = 90): OcrLine {
  let at = x;
  const words = text.split(" ").map((w) => {
    const box = { x: at, y, w: 10 * w.length, h: 14 };
    at += 10 * w.length + 8;
    return { text: w, conf, box };
  });
  return { text, conf, box: { x, y, w: at - 8 - x, h: 14 }, words };
}

describe("parseAmount", () => {
  it.each([
    ["1,234", 1234, "money", undefined],
    ["$1,234.50", 1234.5, "money", "$"],
    ["€1.234,50", 1234.5, "money", "€"],
    ["12,5", 12.5, "money", undefined],
    ["1.234.567", 1234567, "money", undefined],
    ["1.2K", 1200, "money", undefined],
    ["2M", 2e6, "money", undefined],
    ["12.5 BB", 12.5, "bb", undefined],
    ["40bb", 40, "bb", undefined],
    ["£ 7", 7, "money", "£"],
    // the OCR's usual digit slips in a line of figures
    ["1O0", 100, "money", undefined],
    ["l25", 125, "money", undefined],
  ])("%s", (text, value, unit, currency) => {
    const a = parseAmount(text);
    expect(a?.value).toBeCloseTo(value);
    expect(a?.unit).toBe(unit);
    expect(a?.currency).toBe(currency);
  });
  it.each(["", "pot", "12abc", "1.2.3", "$"])("not an amount: %j", (text) => expect(parseAmount(text)).toBeNull());
  it("a word of digit-like letters alone isn't an amount in a line", () => {
    expect(amountsIn(line("SOS"))).toEqual([]);
    expect(amountsIn(line("$ 1,204 BB")).map((a) => a.amount)).toEqual([{ value: 1204, unit: "bb", currency: "$" }]);
  });
});

describe("readBlinds", () => {
  it("reads a stakes line, the big blind at most four small blinds", () => {
    const r = readBlinds([line("NL Hold'em $0.50/$1"), line("12/1")]);
    expect(r?.value).toEqual({ sb: 0.5, bb: 1 });
    expect(r?.conf).toBeGreaterThan(0.9);
  });
  it("a line without a stakes word is less sure", () => {
    expect(readBlinds([line("50/100")])?.conf).toBeLessThan(0.7);
  });
  it("leaves out a ratio that isn't blinds", () => {
    expect(readBlinds([line("Table 1/9")])).toBeNull();
    expect(readBlinds([line("3/2")])).toBeNull();
  });
  it.each([
    ["Blinds $0.25/%$0.5", 0.25, 0.5],
    ["Blinds $1/$%$2", 1, 2],
    ["Blinds $0.5/§1", 0.5, 1],
    ["NL Hold'em $0.5/%51", 0.5, 1],
    // the second currency sign read as a digit: past the big blind's limit, so taken off
    ["Blinds $0.5/81", 0.5, 1],
    ["NL Hold'em $0.25/50.5", 0.25, 0.5],
    ["NL Hold'em $1/52", 1, 2],
  ])("forgives the OCR's slips on the second currency sign: %s", (text, sb, bb) => {
    expect(readBlinds([line(text)])?.value).toEqual({ sb, bb });
  });
  it("doesn't take a digit off where the amounts fit as read, or where there's no currency", () => {
    expect(readBlinds([line("Blinds 25/50")])?.value).toEqual({ sb: 25, bb: 50 });
    expect(readBlinds([line("Blinds 1/52")])).toBeNull();
  });
});

describe("readPot", () => {
  it("takes the total pot over a main pot, and never a side pot", () => {
    const r = readPot([line("Side pot 40"), line("Main pot: 120"), line("Total pot: 160")]);
    expect(r?.value.value).toBe(160);
    expect(readPot([line("Side pot 40")])).toBeNull();
  });
  it("reads the amount after the word", () => {
    expect(readPot([line("Pot: $12.50")])?.value).toEqual({ value: 12.5, unit: "money", currency: "$" });
    expect(readPot([line("P0T 3.5 BB")])?.value).toEqual({ value: 3.5, unit: "bb" });
  });
});

describe("readStacks", () => {
  it("reads a seat's amount, alone or after a name, and an all-in", () => {
    const lines = [line("Hero 98.5", 100, 400), line("$1,204", 600, 100), line("All-in", 300, 80), line("Pot: 12", 300, 250), line("NL 1/2", 0, 0)];
    const s = readStacks(lines);
    expect(s.map((x) => (x.allIn ? "all-in" : x.amount.value))).toEqual([98.5, 1204, "all-in"]);
  });
  it("leaves out a line where the amount doesn't end it, and a name's digits", () => {
    expect(readStacks([line("100 players"), line("tilt 42")])).toEqual([]);
  });
  it("skips the lines it is told to", () => {
    const l = line("250");
    expect(readStacks([l], [l])).toEqual([]);
  });
});

describe("unitOf and formatAmount", () => {
  it("goes by most of the amounts", () => {
    expect(unitOf([{ amount: { value: 1, unit: "bb" } }, { amount: { value: 2, unit: "bb" } }, { amount: { value: 3, unit: "money" } }])).toBe("bb");
    expect(unitOf([{ amount: { value: 1, unit: "bb" } }, { amount: { value: 3, unit: "money" } }])).toBe("money");
  });
  it("writes amounts as a person reads them", () => {
    expect(formatAmount(1234.5, "money", "$")).toBe("$1,234.5");
    expect(formatAmount(12.345, "bb")).toBe("12.35bb");
  });
});

describe("linesOf", () => {
  const word = (text: string, x0: number) => ({ text, confidence: 90, bbox: { x0, y0: 10, x1: x0 + 20, y1: 30 } });
  it("scales back to the picture and splits a line across a wide gap", () => {
    const blocks: TBlock[] = [{ paragraphs: [{ lines: [{ text: "", confidence: 90, bbox: { x0: 0, y0: 10, x1: 400, y1: 30 }, words: [word("12", 0), word("BB", 30), word("40", 300), word(" ", 330)] }] }] }];
    const ls = linesOf(blocks, 2);
    expect(ls.map((l) => l.text)).toEqual(["12 BB", "40"]);
    expect(ls[1]!.box).toEqual({ x: 150, y: 5, w: 10, h: 10 });
  });
  it("is empty for no blocks", () => expect(linesOf(null, 1)).toEqual([]));
});
