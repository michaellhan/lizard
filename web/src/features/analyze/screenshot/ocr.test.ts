// @vitest-environment node
// The OCR's files are served at ocr/<version>/ from the pinned packages (vite.config.ts ocrFiles): the folder the page
// asks for must be the installed version's, and each file must be where the plugin takes it from.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { OCR_FILES, OCR_VERSION, ocrBase } from "./ocr";

const require = createRequire(import.meta.url);
const dir = (pkg: string) => dirname(require.resolve(`${pkg}/package.json`));
const versionOf = (pkg: string) => (JSON.parse(readFileSync(join(dir(pkg), "package.json"), "utf8")) as { version: string }).version;

describe("OCR files", () => {
  it("are asked for at the installed tesseract.js's version", () => {
    expect(OCR_VERSION).toBe(versionOf("tesseract.js"));
    expect(ocrBase("/lizard/")).toBe(`/lizard/ocr/${OCR_VERSION}/`);
  });
  it("are pinned exactly", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies["tesseract.js"]).toBe(OCR_VERSION);
    expect(pkg.devDependencies["@tesseract.js-data/eng"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("are where vite.config.ts's ocrFiles takes them from", () => {
    const from: Record<(typeof OCR_FILES)[number], string> = {
      "worker.min.js": join(dir("tesseract.js"), "dist/worker.min.js"),
      "tesseract-core-simd-lstm.wasm.js": join(dir("tesseract.js-core"), "tesseract-core-simd-lstm.wasm.js"),
      "tesseract-core-lstm.wasm.js": join(dir("tesseract.js-core"), "tesseract-core-lstm.wasm.js"),
      "eng.traineddata.gz": join(dir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"),
    };
    for (const f of OCR_FILES) expect(existsSync(from[f]), f).toBe(true);
  });
});
