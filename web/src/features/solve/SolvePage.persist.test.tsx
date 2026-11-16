// The Solve page keeps its setup: in the address as it's changed (so a reload or Back from Study finds it), and in this
// browser for each kind of game (so a bare /solve or /tournaments, as from the nav bar, opens on it); an address's own
// setup comes first, and a stored one that can't be read is the default 6-max 100bb table.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { SOLVE_SETUP_KEY, SolvePage } from "./SolvePage";

function Loc() {
  const l = useLocation();
  return <p data-testid="loc">{`${l.pathname}${l.search}`}</p>;
}
const open = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/solve" element={<SolvePage />} />
        <Route path="/tournaments" element={<SolvePage kind="tournament" />} />
        <Route path="*" element={null} />
      </Routes>
      <Loc />
    </MemoryRouter>,
  );
const query = () => new URLSearchParams(screen.getByTestId("loc").textContent!.split("?")[1] ?? "");
const players = () => screen.getByRole("combobox", { name: "Players" });
const stack = () => screen.getByRole("spinbutton", { name: "Table stack" });

afterEach(() => {
  for (const k of Object.values(SOLVE_SETUP_KEY)) localStorage.removeItem(k);
});

describe("SolvePage keeps its setup", () => {
  it("writes each change to the address, keeping what isn't the setup's", () => {
    open("/solve?p=6&s=100&from=study");
    fireEvent.change(players(), { target: { value: "3" } });
    fireEvent.change(stack(), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rake" }), { target: { value: "5" } });
    const q = query();
    expect(q.get("p")).toBe("3");
    expect(q.get("s")).toBe("40");
    expect(q.get("rake")).toBe("5");
    expect(q.get("from")).toBe("study");
    // cleared, it leaves the address too
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rake" }), { target: { value: "" } });
    expect(query().has("rake")).toBe(false);
  });

  it("opens a bare address on the setup last left here, each kind its own", () => {
    const first = open("/solve");
    expect(query().get("p")).toBe("6");
    fireEvent.change(players(), { target: { value: "2" } });
    fireEvent.change(stack(), { target: { value: "40" } });
    first.unmount();

    const again = open("/solve");
    expect(players()).toHaveValue("2");
    expect(stack()).toHaveValue(40);
    expect(query().get("p")).toBe("2");
    again.unmount();

    // a tournament keeps its own
    const tour = open("/tournaments");
    expect(players()).toHaveValue("6");
    expect(stack()).toHaveValue(100);
    fireEvent.change(stack(), { target: { value: "25" } });
    tour.unmount();
    open("/tournaments");
    expect(stack()).toHaveValue(25);
  });

  it("keeps a Study line in the address but not in the setup it remembers", () => {
    const first = open("/solve?p=2&s=100&pre=SB:r2.5,BB:c&b=Ks7d2c");
    expect(query().get("pre")).toBeTruthy();
    expect(query().get("b")).toBe("Ks7d2c");
    first.unmount();
    open("/solve");
    expect(players()).toHaveValue("2");
    expect(screen.getByText("Opens at the first decision.")).toBeInTheDocument();
  });

  it("puts an address's own setup before the remembered one", () => {
    const first = open("/solve");
    fireEvent.change(players(), { target: { value: "2" } });
    fireEvent.change(stack(), { target: { value: "40" } });
    first.unmount();
    open("/solve?p=9&s=150");
    expect(players()).toHaveValue("9");
    expect(stack()).toHaveValue(150);
  });

  it("opens on 6-max 100bb when what's stored can't be read", () => {
    localStorage.setItem(SOLVE_SETUP_KEY.cash, "not a setup at all");
    const first = open("/solve");
    expect(players()).toHaveValue("6");
    expect(stack()).toHaveValue(100);
    first.unmount();
    localStorage.setItem(SOLVE_SETUP_KEY.cash, "p=42&s=-3");
    open("/solve");
    expect(players()).toHaveValue("6");
    expect(stack()).toHaveValue(100);
  });
});
