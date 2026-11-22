// The OCR in this browser: Tesseract.js, its worker, wasm core and English data all served from Lizard's own site
// (ocr/<version>/, put there by vite.config.ts's ocrFiles from the pinned npm packages), so no image and no request
// leaves for anywhere else, and the page's COEP and CSP hold. Loaded only when a screenshot is read: none of it is in
// the first script, or in Analyze's own chunk (this module is imported by ScreenshotImport's chunk, and tesseract.js
// itself only by the dynamic import below). The worker is made from its own URL, not a blob: a blob worker would take
// the page's CSP, which doesn't allow compiling WebAssembly. The language data is kept in IndexedDB once fetched
// (Tesseract.js's own cache), so a later read works offline.
import type { Img } from "./image";
import { linesOf, ocrScale, prepareForOcr, type TBlock } from "./ocrPrep";
import type { Box } from "./glyph";
import type { OcrLine } from "./numbers";

/** tesseract.js's version, the folder its files are served from (ocr.test.ts checks it against the installed one) */
export const OCR_VERSION = "7.0.0";
export const ocrBase = (base = import.meta.env.BASE_URL) => `${base}ocr/${OCR_VERSION}/`;

/** The files the OCR fetches, by name: the worker script, a core (SIMD or not), the English data. About 6.5 MB in all
 * the first time (the core 3.9 MB and the data 2.9 MB, both compressed in transfer), none after. */
export const OCR_FILES = ["worker.min.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js", "eng.traineddata.gz"] as const;

// (wasm-feature-detect's SIMD test, a module using one v128 instruction: valid only where SIMD is)
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const simd = () => {
  try {
    return WebAssembly.validate(SIMD_TEST);
  } catch {
    return false;
  }
};

interface TWorker {
  recognize(image: HTMLCanvasElement | OffscreenCanvas, opts: object, out: object): Promise<{ data: { blocks: TBlock[] | null } }>;
  setParameters(p: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
}

export type OcrProgress = (status: string, progress: number) => void;

let worker: Promise<TWorker> | null = null;

/** The one OCR worker, started on first use. */
function getWorker(progress?: OcrProgress): Promise<TWorker> {
  if (worker) return worker;
  const base = new URL(ocrBase(), location.href).href;
  worker = (async () => {
    const { createWorker } = (await import("tesseract.js")) as unknown as {
      createWorker: (langs: string, oem: number, opts: object) => Promise<TWorker>;
    };
    const w = await createWorker("eng", 1 /* LSTM only */, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}${simd() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"}`,
      langPath: base.replace(/\/$/, ""),
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => progress?.(m.status, m.progress),
    });
    // sparse text (a table's words lie anywhere), and a local threshold (Sauvola): a global one lost text on the felt
    // (its notes, "Estimating resolution as ...", to nowhere: they would print to the console as errors. A resolution
    // given instead, 300, lost a tenth of the stacks on the synthetic sweep)
    await w.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", thresholding_method: "2", debug_file: "/dev/null" });
    return w;
  })();
  worker.catch(() => (worker = null));
  return worker;
}

/** The picture's lines of text, the boxes in `cover` (cards, the dealer button) left out. */
export async function readText(img: Img, cover: readonly Box[], progress?: OcrProgress): Promise<OcrLine[]> {
  const w = await getWorker(progress);
  const scale = ocrScale(img);
  const prep = prepareForOcr(img, cover, scale);
  const canvas = document.createElement("canvas");
  canvas.width = prep.width;
  canvas.height = prep.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(prep.data), prep.width, prep.height), 0, 0);
  const { data } = await w.recognize(canvas, {}, { blocks: true });
  return linesOf(data.blocks, scale);
}

/** Stop the worker (the page left): the next read starts it again. */
export function stopOcr(): void {
  void worker?.then((w) => w.terminate()).catch(() => undefined);
  worker = null;
}
