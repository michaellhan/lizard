// A drill's miss reaches the kept mistakes, through the real panel on the fixture library, and can be asked again from
// that library: the same spot, the same stored answer.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { listMistakes } from "@/data/mistakes";
import { DrillsPanel } from "@/features/practice/DrillsPanel";
import { LibraryFiles } from "@/library/files";
import { seeded } from "@/poker/table";
import { libFile } from "@/test/library";
import { retried } from "./mistakes";
import { askLibrary } from "./retry";

const fakeFetch = (async (url: string) => {
  const path = String(url).replace(/^lib\//, "").split("?")[0]!;
  try {
    return new Response(new Uint8Array(libFile(path)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;
const lib = () => new LibraryFiles("lib/", fakeFetch);

beforeEach(async () => (await db())!.clear("mistakes"));

/** Picks the first option hand after hand till one isn't Best or Correct. */
async function missOne(q: string) {
  render(
    <MemoryRouter initialEntries={[`/practice?tab=drills&${q}`]}>
      <DrillsPanel files={lib()} rng={seeded(3)} />
    </MemoryRouter>,
  );
  for (let i = 0; i < 60; i++) {
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    const buttons = within(options).getAllByRole("button");
    fireEvent.click(buttons.at(-1)!);
    const verdict = within(screen.getByRole("region", { name: "Answer" })).getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/).textContent;
    if (verdict !== "Best" && verdict !== "Correct") return verdict;
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled());
  }
  throw new Error("no miss in 60 hands");
}

describe("a drill's miss", () => {
  it("is kept with the stored answer, and a retry reads the same answer back, like with like", async () => {
    const verdict = await missOne("spot=srp_btn_bb&view=oop");
    await waitFor(async () => expect((await listMistakes()).list).toHaveLength(1));
    const m = (await listMistakes()).list[0]!;
    expect(m).toMatchObject({ from: "drill", street: "flop", grade: { verdict, byEv: true }, provenance: { source: "library", librarySpot: "srp_btn_bb" }, ask: { via: "library", spot: "srp_btn_bb" } });
    expect(m.study).toBeTruthy();

    const a = await askLibrary(m.ask as Extract<typeof m.ask, { via: "library" }>, "quick", lib());
    expect(a.mix).toEqual(m.mix);
    const r = retried(m, a, m.grade.a, Date.now());
    expect(r.change).toEqual([]);
    expect(r.grade.verdict).toBe(verdict);
  });
});
