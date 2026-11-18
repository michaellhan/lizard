// The ante to the cent: the form takes it in cent steps and a stored or linked setup is read to the cent, since a part
// of a cent made chips at the table (eight antes of 0.125bb won as 0.04bb more than went in). At every ante the form
// takes, the chips going in are the chips paid out, hand after hand.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSetup } from "@/data/scenarios";
import { seatsOf } from "@/poker/seats";
import { noLines, settle, simulate, withMove } from "@/poker/table";
import { chipsAfter, finish, newHand, nextTable, phaseOf, setupOf, simOf, withVillain, type SessionOptions } from "./practice";
import { SetupForm } from "./SetupForm";

const C = (x: number) => Math.round(x * 100);
const OPTS: SessionOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

afterEach(cleanup);

describe("the ante", () => {
  it("is taken by the form to the cent only", () => {
    const start = vi.fn();
    render(<SetupForm players={8} stack={100} opts={OPTS} onEdit={() => {}} onStart={start} />);
    const ante = screen.getByRole("spinbutton", { name: "Ante" });
    expect(ante).toHaveAttribute("step", "0.01");
    fireEvent.change(ante, { target: { value: "0.125" } });
    expect(ante).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.change(ante, { target: { value: "0.13" } });
    expect(ante).toHaveAttribute("aria-invalid", "false");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.lastCall![2]).toMatchObject({ ante: 0.13 });
  });

  it("is read to the cent from a stored or linked setup", () => {
    expect(readSetup({ players: 8, stack: 100, opts: { ...OPTS, ante: 0.125 } })?.opts.ante).toBe(0.13);
    expect(readSetup({ players: 8, stack: 100, opts: { ...OPTS, ante: 0.333 } })?.opts.ante).toBe(0.33);
    expect(readSetup({ players: 8, stack: 100, opts: { ...OPTS, ante: 0.5 } })?.opts.ante).toBe(0.5);
  });

  it("keeps every chip at each ante the form takes", () => {
    for (const ante of [0.01, 0.07, 0.1, 0.12, 0.13, 0.33, 0.5, 1]) {
      for (const players of [2, 3, 6, 8, 9]) {
        const t = { players, stacks: Object.fromEntries(seatsOf(players).map((p) => [p, 100])), ante };
        let l = noLines();
        for (const p of seatsOf(players).filter((p) => p !== "BB")) l = withMove(l, "preflop", { pos: p, action: "fold" });
        const s = simulate(t, l, 0);
        const st = settle(t, s.invested, [...s.active], s.allin, [], () => []);
        const went = Object.values(s.invested).reduce((a, b) => a + C(b), 0);
        const paid = Object.values(st.pays).reduce((a, b) => a + C(b), 0);
        expect(paid, `${players} players, ante ${ante}`).toBe(went);
      }
    }
  });

  it("keeps the table's chips over a carried session", () => {
    const opts = { ante: 0.13, carry: true, seat: "moves" } as const;
    let h = newHand(8, 100, 0, 1, opts);
    const before = Object.values(setupOf(h).stacks).reduce((a, b) => a + C(b), 0);
    for (let i = 0; i < 50; i++) {
      let sim = simOf(h);
      while (phaseOf(h, sim).kind !== "over" && sim.toAct) {
        h = withVillain(h, { pos: sim.toAct, action: "fold" }, sim);
        sim = simOf(h);
      }
      h = { ...h, result: finish(h, sim) };
      h = newHand(8, 100, i + 1, i + 2, opts, nextTable(h, chipsAfter(h, sim)));
    }
    expect(Object.values(setupOf(h).stacks).reduce((a, b) => a + C(b), 0)).toBe(before);
  });
});
