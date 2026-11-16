import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INPUTS, EQUITY_KEY, EquityPage, inputsFromParams, inputsToParams } from "./EquityPage";

// PLO equity keeps its inputs in the address and this browser, so leaving or reloading the page opens them as they were

// (the address as the router has it, on the page)
function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

const open = (entry = "/equity") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <EquityPage />
      <Where />
    </MemoryRouter>,
  );
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const query = () => new URLSearchParams(screen.getByTestId("where").textContent ?? "");

afterEach(() => {
  localStorage.removeItem(EQUITY_KEY);
});

describe("EquityPage keeps its inputs", () => {
  it("writes each edit to the address and this browser, and a bare address opens them again", async () => {
    const { unmount } = open();
    await waitFor(() => expect(query().getAll("p")).toEqual(DEFAULT_INPUTS.seats));
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    type("Player 3: hand or range", "AAxx, KKxx");
    type("Board", "2c7h9d");
    type("Dead cards", "Qs");
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "montecarlo" } });
    type("Monte Carlo runouts", "5000");
    type("Monte Carlo seed", "9");
    await waitFor(() => expect(query().get("seed")).toBe("9"));
    const q = query();
    expect(q.getAll("p")).toEqual([...DEFAULT_INPUTS.seats, "AAxx, KKxx"]);
    expect(q.get("board")).toBe("2c7h9d");
    expect(q.get("dead")).toBe("Qs");
    expect(q.get("mode")).toBe("montecarlo");
    expect(q.get("runs")).toBe("5000");
    expect(localStorage.getItem(EQUITY_KEY)).toBe(q.toString());
    unmount();

    open();
    expect(value("Player 3: hand or range")).toBe("AAxx, KKxx");
    expect(value("Board")).toBe("2c7h9d");
    expect(value("Dead cards")).toBe("Qs");
    expect(value("Method")).toBe("montecarlo");
    expect(value("Monte Carlo runouts")).toBe("5000");
    expect(value("Monte Carlo seed")).toBe("9");
    await waitFor(() => expect(query().get("board")).toBe("2c7h9d"));
  });

  it("takes the address over this browser's last inputs", () => {
    localStorage.setItem(EQUITY_KEY, inputsToParams({ ...DEFAULT_INPUTS, board: "AhKhQh", seed: 4 }).toString());
    open("/equity?p=KsKdQhQd&p=random&dead=2c");
    expect(value("Player 1: hand or range")).toBe("KsKdQhQd");
    expect(value("Player 2: hand or range")).toBe("random");
    expect(value("Board")).toBe("");
    expect(value("Dead cards")).toBe("2c");
    expect(value("Monte Carlo seed")).toBe("1");
  });

  it("opens the defaults on corrupt kept inputs", () => {
    localStorage.setItem(EQUITY_KEY, "p=only-one&mode=fast");
    open();
    expect(value("Player 1: hand or range")).toBe(DEFAULT_INPUTS.seats[0]);
    expect(value("Player 2: hand or range")).toBe(DEFAULT_INPUTS.seats[1]);
    expect(screen.queryByLabelText("Player 3: hand or range")).toBeNull();
    expect(value("Method")).toBe("auto");
  });

  it("validates what it reads: a bad method, runs or seed is the default's", () => {
    const x = inputsFromParams(new URLSearchParams("p=a&p=b&mode=fast&runs=-5&seed=1.5"))!;
    expect(x).toEqual({ ...DEFAULT_INPUTS, seats: ["a", "b"] });
    expect(inputsFromParams(new URLSearchParams("p=a"))).toBeNull();
    expect(inputsFromParams(new URLSearchParams(Array.from({ length: 10 }, () => "p=x").join("&")))).toBeNull();
    const round = { seats: ["AAxx,KKxx", "", "random"], board: "2c7h9d", dead: "Qs", mode: "exact" as const, runs: 7, seed: 0 };
    expect(inputsFromParams(inputsToParams(round))).toEqual(round);
  });
});
