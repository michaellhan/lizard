/// <reference types="node" />
// The colors and rules the stylesheet owes accessibility: WCAG ratios worked out from the tokens themselves, and the
// unlayered rules that Tailwind's layered utilities can't override.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = __dirname;
const css = readFileSync(join(here, "index.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--color-${name}: (#[0-9a-f]{6})`));
  if (!m) throw new Error(`no token ${name}`);
  return m[1]!;
};
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((c, i) => c * alpha + under[i]! * (1 - alpha)) as Rgb;
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const SURFACES = ["bg", "surface", "surface-2", "surface-3"].map((s) => rgb(token(s)));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });

describe("contrast", () => {
  it("keeps every text token at 4.5:1 on every surface", () => {
    for (const t of ["text", "muted", "faint", "accent", "warn", "danger"]) {
      for (const s of SURFACES) expect(ratio(rgb(token(t)), s), t).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a grade's text at 4.5:1 on its tint, on every surface", () => {
    const tags: [string, string, number][] = [
      ["accent", "accent", 0.2],
      ["accent", "accent", 0.1],
      ["warn", "warn", 0.15],
      ["danger-soft", "danger", 0.15],
      ["danger-soft", "danger", 0.25],
    ];
    for (const [text, tint, alpha] of tags) {
      for (const s of SURFACES) expect(ratio(rgb(token(text)), over(rgb(token(tint)), alpha, s)), `${text} on ${tint}/${alpha}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps an error bar's text at 4.5:1 on the page and a panel, where those bars sit", () => {
    for (const s of SURFACES.slice(0, 2)) expect(ratio(rgb(token("danger")), over(rgb(token("danger")), 0.1, s))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives a field's edge 3:1 on every surface, and a pressed mark more", () => {
    for (const s of SURFACES) {
      expect(ratio(rgb(token("control")), s)).toBeGreaterThanOrEqual(3);
      expect(ratio(rgb(token("accent")), s)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the stylesheet", () => {
  it("doesn't claim a light theme it hasn't got", () => {
    expect(css).not.toMatch(/light theme/i);
    expect(css).toMatch(/color-scheme: dark/);
  });

  it("marks a pressed control and a field's state with more than a shade", () => {
    expect(css).toMatch(/\[aria-pressed="true"\],\s*\[role="radio"\]\[aria-checked="true"\] \{\s*text-decoration: underline/);
    expect(css).toMatch(/\[aria-invalid="true"\] \{\s*border-color: var\(--color-danger\)/);
  });

  it("puts the ring inside anything that clips, ahead of Tailwind's layers", () => {
    const rule = css.indexOf(".segmented :focus-visible");
    expect(rule).toBeGreaterThan(-1);
    expect(css.slice(rule)).toMatch(/^\.segmented :focus-visible \{\s*outline-offset: -2px/);
    // (no @layer around it: a layered rule would lose to the plain :focus-visible)
    expect(css).not.toMatch(/@layer/);
    const clipping = sources(join(here, "..")).flatMap((f) => readFileSync(f, "utf8").match(/"[^"\n]*inline-flex overflow-hidden[^"\n]*"/g) ?? []);
    expect(clipping.length).toBeGreaterThan(0);
    for (const c of clipping) expect(c).toContain("segmented");
  });

  it("uses only tokens that exist for surfaces", () => {
    const used = sources(join(here, "..")).flatMap((f) => readFileSync(f, "utf8").match(/\bbg-surface-\d/g) ?? []);
    for (const u of new Set(used)) expect(css, u).toContain(`--color-${u.slice(3)}:`);
  });
});
