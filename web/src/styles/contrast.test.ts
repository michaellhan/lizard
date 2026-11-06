/// <reference types="node" />
// The colors and rules the stylesheet owes accessibility: WCAG ratios worked out from the tokens themselves, and the
// unlayered rules that Tailwind's layered utilities can't override.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionColors, actionFills, actionTokens } from "@/components/actions";

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

describe("an action mix", () => {
  const ACTIONS = ["fold", "check", "bet1", "bet2", "bet3", "bet4", "allin"];
  const fill = (a: string) => {
    const m = css.match(new RegExp(`--fill-act-${a}: ([^;]+);`));
    if (!m) throw new Error(`no fill for ${a}`);
    return m[1]!;
  };
  /** what a fill lays over its colour, read the same whichever colour that is */
  const pattern = (a: string) => fill(a).replace(`var(--color-act-${a})`, "").replace(/,\s*$/, "").trim();
  const ink = (a: string) => pattern(a).match(/var\(--color-(\w+)\)/)?.[1];
  const color = (a: string) => rgb(token(`act-${a}`));
  const pairs = ACTIONS.flatMap((a, i) => ACTIONS.slice(i + 1).map((b) => [a, b] as const));
  const tooClose = pairs.filter(([a, b]) => ratio(color(a), color(b)) < 3);

  it("can't rest on colour: seven can't stand 3:1 apart on the surface, so most pairs don't", () => {
    expect(pairs).toHaveLength(21);
    expect(tooClose).toHaveLength(18);
    // the most colours 3:1 from each other and from the surface: each step takes 3:1 of what's left up to white
    const steps = Math.floor(Math.log(ratio([255, 255, 255], rgb(token("surface-2")))) / Math.log(3));
    expect(steps).toBeLessThan(ACTIONS.length);
    expect(steps).toBe(2);
  });

  it("gives every pair under 3:1 different patterns", () => {
    for (const [a, b] of tooClose) expect(pattern(a), `${a} and ${b}`).not.toBe(pattern(b));
  });

  it("leaves one action plain, and inks every other pattern 3:1 from its own colour", () => {
    expect(ACTIONS.filter((a) => !pattern(a))).toEqual(["check"]);
    for (const a of ACTIONS.filter((x) => pattern(x))) expect(ratio(rgb(token(ink(a)!)), color(a)), a).toBeGreaterThanOrEqual(3);
  });

  it("keeps a pattern readable in a 14px swatch: at least two repeats, in lines of a pixel or more, at 45 or 135 degrees", () => {
    for (const a of ACTIONS.filter((x) => pattern(x))) {
      const lines = [...pattern(a).matchAll(/repeating-linear-gradient\((\d+)deg, var\(--color-\w+\) 0 ([\d.]+)px, transparent [\d.]+px ([\d.]+)px\)/g)];
      const dots = pattern(a).match(/\/ ([\d.]+)px/);
      expect(lines.length || dots, a).toBeTruthy();
      for (const [, angle, width, period] of lines) {
        expect(["45", "135"], a).toContain(angle);
        expect(Number(width), a).toBeGreaterThanOrEqual(1);
        expect(Number(period), a).toBeLessThanOrEqual(7);
      }
      if (dots) expect(Number(dots[1]), a).toBeLessThanOrEqual(7);
    }
  });

  it("has every patterned fill fall back to its plain colour when Settings takes patterns off", () => {
    const off = css.match(/:root\[data-patterns="off"\] \{([^}]*)\}/)![1]!;
    for (const a of ACTIONS.filter((x) => pattern(x))) expect(off, a).toContain(`--fill-act-${a}: var(--color-act-${a});`);
  });

  it("gives a grid cell's label 4.5:1 on its plate over any colour or ink of a mix", () => {
    const m = /bg-bg\/(\d+)/.exec(readFileSync(join(here, "../components/RangeMatrix.tsx"), "utf8").match(/cell-label[^"]*/)![0]);
    const alpha = Number(m![1]) / 100;
    for (const under of [...ACTIONS.map(color), rgb(token("text")), rgb(token("surface-2"))]) {
      expect(ratio(rgb(token("text")), over(rgb(token("bg")), alpha, under))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("fills an action with the fill named for it, colour and fill alike, in a node of any shape", () => {
    const names = ["fold", "call", "raise 2.5", "raise 7", "all-in"];
    expect(actionTokens(names)).toEqual(["fold", "check", "bet1", "bet4", "allin"]);
    expect(actionColors(names)[2]).toBe("var(--color-act-bet1)");
    expect(actionFills(names)[2]).toBe("var(--fill-act-bet1)");
    for (const n of [["check", "bet 33%"], ["check", "bet 33%", "bet 50%", "bet 75%", "bet 100%", "bet 150%"], names]) {
      for (const t of actionTokens(n)) expect(css).toContain(`--fill-act-${t}:`);
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

  it("keeps data's colours, a cell's edge and the selected state under forced colors", () => {
    const block = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(block).toMatch(/\[style\*="--fill-act"\],\s*\.keep-colour \{\s*forced-color-adjust: none/);
    expect(block).toMatch(/\[role="gridcell"\] \{\s*outline: 1px solid ButtonBorder/);
    expect(block).toMatch(/\[role="gridcell"\]\[aria-selected="true"\]:not\(:focus-visible\),\s*\[role="tab"\]\[aria-selected="true"\]:not\(:focus-visible\) \{\s*outline: 3px solid Highlight/);
  });

  it("drops a phone's columns only where a table says so, and at the width of `sm`", () => {
    expect(css).toMatch(/@media \(max-width: 39\.99rem\) \{\s*\.phone-cols:not\(\[data-all\]\) \.phone-col \{\s*display: none/);
    const hiding = sources(join(here, "..")).flatMap((f) => readFileSync(f, "utf8").match(/"[^"\n]*hidden[^"\n]*sm:table-cell[^"\n]*"/g) ?? []);
    expect(hiding).toEqual([]);
    for (const f of sources(join(here, ".."))) {
      const s = readFileSync(f, "utf8");
      if (s.includes("phone-col ")) expect(s, f).toContain("<PhoneColumns");
    }
  });

  it("uses only tokens that exist for surfaces", () => {
    const used = sources(join(here, "..")).flatMap((f) => readFileSync(f, "utf8").match(/\bbg-surface-\d/g) ?? []);
    for (const u of new Set(used)) expect(css, u).toContain(`--color-${u.slice(3)}:`);
  });
});
