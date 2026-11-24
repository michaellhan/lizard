import { describe, expect, it, vi } from "vitest";
import { hostedUrl, loadHosts, parseHosts } from "./hosts";
import { LibraryFiles } from "./files";
import type { LibrarySpotIndex } from "./catalog";

// (a build whose VITE_LIBRARY_HOSTS allows the bucket's origin)
vi.mock("@/config", async (orig) => ({ ...(await orig<typeof import("@/config")>()), LIBRARY_HOST_ORIGINS: ["https://lib.example.com"] }));

const R2 = "https://lib.example.com";
const FILE = { format: 1, hosts: { r2: `${R2}/lizard-library/` }, sets: { mw_utg_sb_bb: "r2", srp_btn_bb: "r2" } };

describe("hosts.json", () => {
  it("maps each moved set to its host's base, on an allowed origin only", () => {
    const h = parseHosts(FILE, [R2]);
    expect(h.get("mw_utg_sb_bb")).toBe(`${R2}/lizard-library/`);
    expect(h.size).toBe(2);
    // (an origin the page's CSP doesn't list: left to the library's own base)
    expect(parseHosts(FILE, ["https://other.example.com"]).size).toBe(0);
    expect(parseHosts(FILE, []).size).toBe(0);
  });

  it("refuses what isn't an https base ending in a slash, a host it doesn't define, or another format", () => {
    const bad = (hosts: Record<string, unknown>, sets: Record<string, unknown> = { a: "r2" }, format: unknown = 1) =>
      parseHosts({ format, hosts, sets }, [R2, "http://lib.example.com"]).size;
    expect(bad({ r2: "http://lib.example.com/x/" })).toBe(0);
    expect(bad({ r2: `${R2}/x` })).toBe(0);
    expect(bad({ r2: `${R2}/x/?q=1/` })).toBe(0);
    expect(bad({ r2: 7 })).toBe(0);
    expect(bad({ r2: `${R2}/x/` }, { a: "s3" })).toBe(0);
    expect(bad({ r2: `${R2}/x/` }, { a: "toString" })).toBe(0);
    expect(bad({ r2: `${R2}/x/` }, { a: "r2" }, 2)).toBe(0);
    expect(bad({ r2: `${R2}/x/` })).toBe(1);
    expect(parseHosts(null, [R2]).size).toBe(0);
    expect(parseHosts("x", [R2]).size).toBe(0);
  });

  it("serves a moved set's files from its host and the root files from the library's base", () => {
    const h = parseHosts(FILE, [R2]);
    expect(hostedUrl("/lizard-library/", h, "mw_utg_sb_bb/KcTd5h.bin?v=1")).toBe(`${R2}/lizard-library/mw_utg_sb_bb/KcTd5h.bin?v=1`);
    expect(hostedUrl("/lizard-library/", h, "srp_co_bb/report.json")).toBe("/lizard-library/srp_co_bb/report.json");
    expect(hostedUrl("/lizard-library/", h, "index.json")).toBe("/lizard-library/index.json");
    expect(hostedUrl("/lizard-library/", h, "mw_utg_sb_bb")).toBe("/lizard-library/mw_utg_sb_bb");
  });

  it("a library without hosts.json (or one that won't load) serves everything from its base", async () => {
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect((await loadHosts("/lib/", missing)).size).toBe(0);
    const broken = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect((await loadHosts("/lib/", broken)).size).toBe(0);
  });
});

describe("LibraryFiles and hosts", () => {
  const spot = (host?: string): LibrarySpotIndex => ({
    id: "mw_utg_sb_bb", label: "x", line: "UTG:r2.5", seats: ["SB", "BB", "UTG"], pot: 8, stack: 96,
    flops: { KcTd5h: "aaaaaaaaaa" }, ...(host ? { host } : {}),
  });

  it("reads hosts.json once, and only for a spot the index says is hosted elsewhere", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(String(u));
      if (String(u).endsWith("hosts.json")) return new Response(JSON.stringify(FILE));
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const files = new LibraryFiles("/lib/", fetchImpl);
    expect(await files.url("mw_utg_sb_bb/KcTd5h.bin")).toBe("/lib/mw_utg_sb_bb/KcTd5h.bin");
    expect(urls).toEqual([]);
    await expect(files.entry(spot(), "KcTd5h")).rejects.toThrow();
    expect(urls).toEqual(["/lib/mw_utg_sb_bb/KcTd5h.bin?v=aaaaaaaaaa"]);
    urls.length = 0;
    await expect(files.entry(spot("r2"), "KcTd5h")).rejects.toThrow();
    expect(await files.url("mw_utg_sb_bb/x.bin", "r2")).toBe(`${R2}/lizard-library/mw_utg_sb_bb/x.bin`);
    expect(await files.url("index.json", "r2")).toBe("/lib/index.json");
    expect(urls).toEqual(["/lib/hosts.json", `${R2}/lizard-library/mw_utg_sb_bb/KcTd5h.bin?v=aaaaaaaaaa`]);
  });
});
