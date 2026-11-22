// @vitest-environment node
// The reader's accuracy on synthetic tables (scripts/screenshot/make-fixtures.mjs): drawn by Lizard in Chromium, not
// taken from any poker room, so these numbers say how the reader does on that drawing alone. The cards are read on
// every run, over the committed fixtures; the OCR (Tesseract, about a second a table) only with LIZARD_SHOT_OCR=1, and a
// bigger set with LIZARD_SHOT_DIR=<a sweep's folder> (run it through gtosolver's slot.sh: it takes minutes).
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { dealerBox, scanCards } from "./cards";
import { prepareForOcr, linesOf, ocrScale, type TBlock } from "./ocrPrep";
import { readTable } from "./read";
import { draftOf } from "./spot";
import { encodePng, FIXTURES, readPng, truthOf, type Truth } from "./testPng";

const DIR = process.env.LIZARD_SHOT_DIR ?? FIXTURES;
const OCR = process.env.LIZARD_SHOT_OCR === "1";
const tables = truthOf(DIR);

type Tally = Record<string, [number, number]>;
const tally: Tally = {};
const count = (k: string, ok: boolean) => {
  const t = (tally[k] ??= [0, 0]);
  t[0] += ok ? 1 : 0;
  t[1] += 1;
};

afterAll(() => {
  const rows = Object.entries(tally).map(([k, [a, n]]) => `${k.padEnd(34)} ${String(a).padStart(4)} / ${String(n).padEnd(4)} ${((100 * a) / n).toFixed(1)}%`);
  console.log(`\nScreenshot reader on ${tables.length} synthetic tables (${DIR === FIXTURES ? "committed fixtures" : DIR})\n${rows.join("\n")}`);
});

const cardsOf = (s: string) => s.match(/../g) ?? [];

describe("cards (synthetic tables)", () => {
  it.each(tables.map((t) => [t.file, t] as const))("%s", (_f, t: Truth) => {
    const img = readPng(join(DIR, t.file));
    const scan = scanCards(img);
    const r = readTable(img, scan, []);
    const group = t.heldOut ? "held-out font" : "template font";
    const hero = r.hero?.cards.map((c) => c.code).join("") ?? "";
    const board = r.groups.board.map((c) => c.code).join("");
    for (const c of cardsOf(t.hero)) count(`hero card, ${group}`, hero.includes(c));
    for (const c of cardsOf(t.board)) count(`board card, ${group}`, board.includes(c));
    count("hero hand exactly", hero === t.hero);
    count("board exactly", board === t.board);
    count("dealer button found", !!scan.dealer);
    // a wrong card read with high confidence is the reader's worst mistake: count those apart
    for (const c of [...(r.hero?.cards ?? []), ...r.groups.board]) if (!(t.hero + t.board).includes(c.code)) count("wrong card marked to check (conf < 0.6)", c.conf < 0.6);
  });
});

describe.runIf(OCR)("numbers by OCR (synthetic tables)", () => {
  const require = createRequire(import.meta.url);
  let worker: { recognize: (img: Buffer, o: object, out: object) => Promise<{ data: { blocks: TBlock[] | null } }>; setParameters: (p: object) => Promise<unknown>; terminate: () => Promise<unknown> } | null = null;
  afterAll(async () => {
    await worker?.terminate();
  });
  it.each(tables.map((t) => [t.file, t] as const))("%s", async (_f, t: Truth) => {
    if (!worker) {
      const { createWorker } = (await import("tesseract.js")) as unknown as { createWorker: (l: string, oem: number, o: object) => Promise<NonNullable<typeof worker>> };
      const langPath = join(require.resolve("@tesseract.js-data/eng/package.json"), "..", "4.0.0_best_int");
      worker = await createWorker("eng", 1, { langPath, cacheMethod: "none", gzip: true });
      await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", thresholding_method: "2", debug_file: "/dev/null" });
    }
    const img = readPng(join(DIR, t.file));
    const scan = scanCards(img);
    const scale = ocrScale(img);
    const prep = prepareForOcr(img, [...scan.cards.map((c) => c.box), ...(scan.dealer ? [dealerBox(scan.dealer)] : [])], scale);
    const { data } = await worker.recognize(encodePng(prep), {}, { blocks: true });
    const r = readTable(img, scan, linesOf(data.blocks, scale));
    const d = draftOf(r);
    const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) <= Math.max(0.011, 0.005 * b);
    count("big blind", near(r.blinds?.value.bb, t.bb));
    count("pot", near(r.pot?.value.value, t.pot));
    count("players (seats read)", (r.layout?.seats.length ?? 0) === t.players);
    const seats = r.layout?.seats ?? [];
    for (const [pos, v] of Object.entries(t.stacks)) count("stack, by position", seats.some((s) => s.pos === pos && near(s.stack.amount.value, v)));
    count("your position", d.heroPos.value === t.heroPos);
  });
});

it("measures something", () => expect(tables.length).toBeGreaterThan(0));
