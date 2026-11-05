// The turn report on the Reports page, on the fixture library through a stubbed fetch: it reads nothing until asked, says
// what it read, can be stopped and read further, counts failures, keeps what it read, and has its choices in the URL.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LibraryFiles } from "@/library/files";
import { libFile } from "@/test/library";
import { ReportsPage } from "./ReportsPage";
import { FLOP_KB } from "./turnReport";

type Gate = (path: string) => Promise<Response | null> | Response | null;
function stubFetch(gate: Gate = () => null) {
  const seen: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^lib\//, "").split("?")[0]!;
    seen.push(path);
    const r = await gate(path);
    init?.signal?.throwIfAborted();
    if (r) return r;
    try {
      return new Response(new Uint8Array(libFile(path)));
    } catch {
      return new Response("missing", { status: 404 });
    }
  }) as unknown as typeof fetch;
  return { fn, seen, turns: () => seen.filter((p) => p.endsWith(".turn.bin")) };
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.search}</p>;
}
const open = (q: string, fetchImpl: typeof fetch, turnSample?: number, files = new LibraryFiles("lib/", fetchImpl)) =>
  render(
    <MemoryRouter initialEntries={[`/reports?${q}`]}>
      <Routes>
        <Route path="/reports" element={<><ReportsPage files={files} turnSample={turnSample} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
// (the page's apostrophes are typographic)
const say = (s: string) => new RegExp(s.replace(/'/g, "['’]"));
const panel = async () => within(await screen.findByRole("region", { name: "Turn report" }));
const ask = async (name: RegExp | string) => fireEvent.click((await panel()).getByRole("button", { name }));
const table = async () => within(await (await panel()).findByRole("table"));

describe("the turn report", () => {
  it("says a spot with no stored turns has none, and offers nothing to read", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_co_bb", fn);
    const p = await panel();
    expect(p.getByText(say("stores no turn files, so there's no turn report for it"))).toBeInTheDocument();
    expect(p.queryByRole("button")).toBeNull();
    expect(turns()).toEqual([]);
  });

  it("says so on a 3-way spot too", async () => {
    const { fn } = stubFetch();
    open("spot=mw_btn_sb_bb", fn);
    expect((await panel()).getByText(/stores no turn files/)).toBeInTheDocument();
  });

  it("says when the texture has no stored turns", async () => {
    const { fn } = stubFetch();
    open("spot=3bp_bb_btn&suits=mono", fn);
    expect((await panel()).getByText(/No flop of this texture \(monotone\) has stored turns/)).toBeInTheDocument();
  });

  it("reads nothing until asked, and says what asking takes", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_btn_bb", fn, 3);
    const p = await panel();
    expect(p.getByText(new RegExp(`7 of 7 such flops have stored turns\\. Reading 3 of them takes two files a flop, up to about ${((3 * FLOP_KB) / 1000).toFixed(1)} MB\\.`))).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Read 3 flops" })).toBeInTheDocument();
    expect(p.queryByRole("table")).toBeNull();
    expect(turns()).toEqual([]);
  });

  it("shows a table by turn class with the sample, its provenance, the flops and combos behind each row", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_btn_bb", fn, 3);
    await ask("Read 3 flops");
    const t = await table();
    expect(t.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Turn card", "Strategy", "Check", "Bet 75%", "Margin", "Flops", "Combos"]);
    const p = await panel();
    await waitFor(() => expect(p.getByText(/Read 3 of 7 flops of this texture with stored turns, drawn evenly over them in an order set by seed 1, each flop counted by how many of the 22,100 it stands for\. Too few flops to put a margin on it yet\./)).toBeInTheDocument());
    expect(p.getByText(/^Stored turn from the flop library · srp_btn_bb · turn report over 3 of 7 flops with stored turns, seed 1, built in the page from their files · approximate$/)).toBeInTheDocument();
    const all = t.getByRole("row", { name: "All turns" });
    const cells = within(all).getAllByRole("cell").map((c) => c.textContent);
    expect(parseFloat(cells[1]!) + parseFloat(cells[2]!)).toBeCloseTo(100, 0);
    expect(cells[3]).toBe("too few");
    expect(cells[4]).toBe("3");
    expect(parseFloat(cells[5]!)).toBeGreaterThan(1);
    expect(t.getAllByRole("row").length).toBeGreaterThan(2);
    expect(turns()).toHaveLength(3);
    // a phone keeps the numbers, and the table's box takes the keyboard
    expect(p.getByText(/Hidden at this width: Strategy, Flops, Combos/)).toBeInTheDocument();
    expect(within(t.getByRole("row", { name: "All turns" })).getByRole("rowheader")).toHaveTextContent(/3 flops, \d+ combos/);
    expect(p.getByRole("region", { name: "Turn report table" })).toHaveAttribute("tabindex", "0");
    expect(p.getByText(say("Precomputed solutions, the library's"))).toBeInTheDocument();
    expect(p.getByText(say("It says nothing of the solves' own error"))).toBeInTheDocument();
  });

  it("reads further without reading a flop again, and has no margin once it has them all", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_btn_bb", fn, 4);
    await ask("Read 4 flops");
    await (await panel()).findByRole("button", { name: "Read 3 more" });
    expect(turns()).toHaveLength(4);
    await ask("Read 3 more");
    const p = await panel();
    await waitFor(() => expect(p.getByText(/Read all 7 flops of this texture with stored turns, so there's no sampling margin\./)).toBeInTheDocument());
    expect(turns()).toHaveLength(7);
    expect(new Set(turns()).size).toBe(7);
    expect(p.queryByRole("button", { name: /more/ })).toBeNull();
    expect(p.queryByRole("button", { name: "Another sample" })).toBeNull();
    const t = await table();
    expect(within(t.getByRole("row", { name: "All turns" })).getAllByRole("cell")[3]).toHaveTextContent("none");
  });

  it("keeps what it read for the page: going back to a texture reads no file, past what the file cache holds", async () => {
    const { fn } = stubFetch();
    const files = new LibraryFiles("lib/", fn);
    const turnFiles = vi.spyOn(files, "turns");
    open("spot=srp_btn_bb&suits=mono", fn, 2, files);
    await ask("Read 2 flops");
    await waitFor(() => expect(screen.getByText(/Read all 2 flops/)).toBeInTheDocument());
    expect(turnFiles).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Suits" }), { target: { value: "" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).not.toContain("suits"));
    fireEvent.change(screen.getByRole("combobox", { name: "Suits" }), { target: { value: "mono" } });
    await ask("Read 2 flops");
    await waitFor(() => expect(screen.getByText(/Read all 2 flops/)).toBeInTheDocument());
    expect(turnFiles).toHaveBeenCalledTimes(2);
  });

  it("takes only the chosen texture's flops", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_btn_bb&suits=mono", fn, 40);
    expect((await panel()).getByText(/2 of 2 such flops have stored turns/)).toBeInTheDocument();
    await ask("Read 2 flops");
    await waitFor(() => expect(screen.getByText(/Read all 2 flops/)).toBeInTheDocument());
    expect(turns().sort()).toEqual(["srp_btn_bb/9c8c7c.turn.bin", "srp_btn_bb/Ac8c6c.turn.bin"]);
    // (a monotone flop's turns: no flush-completing card is missing, and no pairing line is lost)
    expect((await table()).getByRole("row", { name: "Completes a flush" })).toBeInTheDocument();
  });

  it("says where a spot's stored turns cover part of the texture, and that the report is over those alone", async () => {
    const { fn } = stubFetch();
    open("spot=3bp_bb_btn", fn, 2);
    expect((await panel()).getByText(/2 of 3 such flops have stored turns, standing for \d+% of them by how often they come up, and the report is over those alone\./)).toBeInTheDocument();
  });

  it("counts a flop that fails, says it, goes on, and can try again", async () => {
    let broken = true;
    const { fn } = stubFetch((p) => (broken && p.endsWith("Ac4d3h.turn.bin") ? new Response("no", { status: 503 }) : null));
    open("spot=srp_btn_bb", fn, 7);
    await ask("Read 7 flops");
    const p = await panel();
    expect(await p.findByRole("alert")).toHaveTextContent("1 of 7 flops couldn’t be read and are left out: Ac4d3h (couldn't load srp_btn_bb/Ac4d3h.turn.bin (503)).");
    await waitFor(() => expect(p.getByText(/Read 6 of 7 flops.*1 flop couldn't be read and is left out\./)).toBeInTheDocument());
    broken = false;
    await ask("Read the 1 left");
    await waitFor(() => expect(p.getByText(/Read all 7 flops/)).toBeInTheDocument());
    expect(p.queryByRole("alert")).toBeNull();
  });

  it("shows progress, stops on Stop, says what it has is partial, and can carry on", async () => {
    const hold: (() => void)[] = [];
    const { fn, turns } = stubFetch(async (p) => {
      if (/\.(turn\.)?bin$/.test(p) && !/4c3c2d|3c2d2c/.test(p)) await new Promise<void>((r) => hold.push(r));
      return null;
    });
    open("spot=srp_btn_bb", fn, 7);
    await ask("Read 7 flops");
    const p = await panel();
    const bar = await p.findByRole("progressbar", { name: "Flops read" });
    expect(bar).toHaveAttribute("aria-valuemax", "7");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "2"));
    expect(p.getByText("Read 2 of 7 flops…")).toBeInTheDocument();
    expect(p.getByText(/Still reading: these are partial results\./)).toBeInTheDocument();
    expect(p.getByText(/· in progress$/)).toBeInTheDocument();
    const before = turns().length;
    p.getByRole("button", { name: "Stop" }).focus();
    fireEvent.click(p.getByRole("button", { name: "Stop" }));
    await act(async () => {
      hold.forEach((r) => r());
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(p.getByText(/Stopped early: these are partial results\./)).toBeInTheDocument());
    expect(p.getByRole("button", { name: "Read the 5 left" })).toHaveFocus();
    expect(p.getByText(/· partial, stopped before it finished$/)).toBeInTheDocument();
    expect(p.queryByRole("progressbar")).toBeNull();
    expect(p.queryByRole("alert")).toBeNull();
    expect(turns()).toHaveLength(before);
    expect(p.getByRole("button", { name: "Read the 5 left" })).toBeInTheDocument();
  });

  it("stopped before a flop comes back, says so and offers the start again, with the keyboard on it", async () => {
    const hold: (() => void)[] = [];
    const { fn, turns } = stubFetch(async (p) => {
      if (/\.(turn\.)?bin$/.test(p)) await new Promise<void>((r) => hold.push(r));
      return null;
    });
    open("spot=srp_btn_bb", fn, 7);
    await ask("Read 7 flops");
    const p = await panel();
    await waitFor(() => expect(turns().length).toBeGreaterThan(0));
    p.getByRole("button", { name: "Stop" }).focus();
    fireEvent.click(p.getByRole("button", { name: "Stop" }));
    await act(async () => {
      hold.forEach((r) => r());
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(p.getByText(say("Stopped before a flop came back, so there's nothing to show yet\\."))).toBeInTheDocument());
    expect(p.getByRole("button", { name: "Read 7 flops" })).toHaveFocus();
    expect(p.queryByRole("button", { name: /left$|more$/ })).toBeNull();
    expect(p.queryByRole("table")).toBeNull();
  });

  it("keeps the keyboard in the controls as a read starts, and through Another sample", async () => {
    const hold: (() => void)[] = [];
    const { fn } = stubFetch(async (p) => {
      if (/\.(turn\.)?bin$/.test(p)) await new Promise<void>((r) => hold.push(r));
      return null;
    });
    open("spot=srp_btn_bb", fn, 3);
    await screen.findByRole("button", { name: "Read 3 flops" });
    const read = screen.getByRole("button", { name: "Read 3 flops" });
    read.focus();
    fireEvent.click(read);
    await waitFor(async () => expect((await panel()).getByRole("button", { name: "Stop" })).toHaveFocus());
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        hold.splice(0).forEach((r) => r());
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const p = await panel();
    await waitFor(() => expect(p.getByRole("button", { name: "Read 3 more" })).toHaveFocus());
    p.getByRole("button", { name: "Another sample" }).focus();
    fireEvent.click(p.getByRole("button", { name: "Another sample" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("tseed=2"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Read 3 flops" })).toHaveFocus());
  });

  it("leaves the keyboard with what comes next when a read ends under it, and alone otherwise", async () => {
    const hold: (() => void)[] = [];
    const held = () => stubFetch(async (p) => {
      if (/\.(turn\.)?bin$/.test(p)) await new Promise<void>((r) => hold.push(r));
      return null;
    });
    const finish = async () => {
      for (let i = 0; i < 12; i++) {
        await act(async () => {
          hold.splice(0).forEach((r) => r());
          await new Promise((r) => setTimeout(r, 0));
        });
      }
    };
    const first = open("spot=srp_btn_bb", held().fn, 3);
    await ask("Read 3 flops");
    let p = await panel();
    p.getByRole("button", { name: "Stop" }).focus();
    await finish();
    await waitFor(() => expect(p.getByRole("button", { name: "Read 3 more" })).toHaveFocus());
    first.unmount();

    // every flop read: no button is left, and the table takes it
    const whole = open("spot=srp_btn_bb", held().fn, 7);
    await ask("Read 7 flops");
    p = await panel();
    p.getByRole("button", { name: "Stop" }).focus();
    await finish();
    await waitFor(() => expect(p.getByRole("region", { name: "Turn report table" })).toHaveFocus());
    whole.unmount();

    // focus somewhere else stays there
    open("spot=srp_btn_bb", held().fn, 3);
    await ask("Read 3 flops");
    p = await panel();
    const elsewhere = await screen.findByRole("combobox", { name: /spot/i }).catch(() => null);
    const stay = elsewhere ?? (screen.getAllByRole("button").find((b) => !p.queryAllByRole("button").includes(b)) as HTMLElement);
    stay.focus();
    await finish();
    await waitFor(() => expect(p.getByRole("button", { name: "Read 3 more" })).toBeInTheDocument());
    expect(stay).toHaveFocus();
  });

  it("changes line and decision from what's read, in the URL, reading nothing more", async () => {
    const { fn, seen } = stubFetch();
    open("spot=srp_btn_bb", fn, 7);
    await ask("Read 7 flops");
    await waitFor(async () => expect((await panel()).getByText(/Read all 7 flops/)).toBeInTheDocument());
    const p = await panel();
    const asked = seen.length;
    const line = p.getByRole("combobox", { name: "Flop line" }) as HTMLSelectElement;
    expect(line.value).toBe("check|check");
    expect(within(line).getAllByRole("option")[0]).toHaveTextContent(/^BB and BTN check \(\d+% of hand pairs\)$/);
    const before = within((await table()).getByRole("row", { name: "All turns" })).getAllByRole("cell")[1]!.textContent;
    fireEvent.change(line, { target: { value: "check|bet 75%|call" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("tline=check%7Cbet+75%25%7Ccall"));
    expect(line.value).toBe("check|bet 75%|call");
    expect(within((await table()).getByRole("row", { name: "All turns" })).getAllByRole("cell")[1]!.textContent).not.toBe(before);
    fireEvent.click(p.getByRole("button", { name: "BTN vs check" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("twho=after"));
    expect(p.getByRole("button", { name: "BTN vs check" })).toHaveAttribute("aria-pressed", "true");
    expect(within(p.getByRole("table")).getByText(/BTN after BB checks the turn after BB checks, BTN bets 75%, BB calls/)).toBeInTheDocument();
    expect(seen).toHaveLength(asked);
  });

  it("opens with a link's line, decision and seed, and draws another sample keeping what's read", async () => {
    const { fn, turns } = stubFetch();
    open("spot=srp_btn_bb&tline=check%7Cbet+75%25%7Ccall&twho=after&tseed=5", fn, 3);
    await ask("Read 3 flops");
    const p = await panel();
    await waitFor(() => expect(p.getByText(/an order set by seed 5/)).toBeInTheDocument());
    expect((p.getByRole("combobox", { name: "Flop line" }) as HTMLSelectElement).value).toBe("check|bet 75%|call");
    expect(p.getByRole("button", { name: "BTN vs check" })).toHaveAttribute("aria-pressed", "true");
    // (the seed is said from the first flop in; the button comes when the read is over)
    await p.findByRole("button", { name: "Another sample" });
    const read = turns().length;
    await ask("Another sample");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("tseed=6"));
    await ask("Read 3 flops");
    await waitFor(async () => expect((await panel()).getByText(/an order set by seed 6/)).toBeInTheDocument());
    // (a flop both samples hold isn't read again)
    expect(new Set(turns()).size).toBe(turns().length);
    expect(turns().length).toBeGreaterThanOrEqual(read);
  });

  it("doesn't read on after the page leaves", async () => {
    const hold: (() => void)[] = [];
    const { fn, turns } = stubFetch(async (p) => {
      if (p.endsWith(".turn.bin")) await new Promise<void>((r) => hold.push(r));
      return null;
    });
    const spy = vi.spyOn(console, "error");
    const { unmount } = open("spot=srp_btn_bb", fn, 7);
    await ask("Read 7 flops");
    await waitFor(() => expect(turns().length).toBeGreaterThan(0));
    const started = turns().length;
    unmount();
    await act(async () => {
      hold.forEach((r) => r());
      // (time for the flops in flight to decode and the next ones to start, had they not been stopped)
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(turns()).toHaveLength(started);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
