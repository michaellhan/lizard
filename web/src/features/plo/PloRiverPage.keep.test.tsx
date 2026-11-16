import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STOP, pageFromParams, pageToParams, PLO_SPOT_KEY, PloRiverPage } from "./PloRiverPage";
import { DEFAULT_SPOT } from "./spot";

// /plo keeps its spot in the address and this browser, so leaving or reloading the page opens it as it was

// (the address as the router has it, on the page)
function Where() {
  return (
    <>
      <output data-testid="where">{useLocation().search}</output>
      <Link to="/plo">bare</Link>
      <Link to="/plo?board=AhKd2c&pot=6">a flop</Link>
    </>
  );
}

const open = (entry = "/plo") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PloRiverPage />
      <Where />
    </MemoryRouter>,
  );
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const query = () => new URLSearchParams(screen.getByTestId("where").textContent ?? "");

afterEach(() => {
  localStorage.removeItem(PLO_SPOT_KEY);
});

describe("PloRiverPage keeps its spot", () => {
  it("writes each edit to the address and this browser", async () => {
    const { unmount } = open();
    await waitFor(() => expect(query().get("board")).toBe(DEFAULT_SPOT.board));
    type("Board", "Js9s4d2h");
    type("OOP range", "AAxx");
    type("Pot", "35");
    type("Bet sizes", "33, 75");
    type("River bet sizes", "150");
    fireEvent.change(screen.getByLabelText("Raise cap"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText(/All-in where pot limit allows the whole stack, on the turn$/));
    type("Target exploitability", "0.5");
    type("Time budget", "30");
    await waitFor(() => expect(query().get("pot")).toBe("35"));
    const q = query();
    expect(q.get("board")).toBe("Js9s4d2h");
    expect(q.get("oop")).toBe("AAxx");
    expect(q.get("bets")).toBe("33,75");
    expect(q.get("cap")).toBe("1");
    expect(q.get("allin")).toBe("0");
    expect(q.get("rbets")).toBe("150");
    expect(q.get("target")).toBe("0.5");
    expect(q.get("secs")).toBe("30");
    expect(localStorage.getItem(PLO_SPOT_KEY)).toBe(q.toString());
    unmount();

    // a bare /plo opens the last spot
    open();
    expect(value("Board")).toBe("Js9s4d2h");
    expect(value("OOP range")).toBe("AAxx");
    expect(value("Pot")).toBe("35");
    expect(value("Bet sizes")).toBe("33, 75");
    expect(value("Raise cap")).toBe("1");
    expect((screen.getByLabelText(/All-in where pot limit allows the whole stack, on the turn$/) as HTMLInputElement).checked).toBe(false);
    expect(value("River bet sizes")).toBe("150");
    expect(value("Target exploitability")).toBe("0.5");
    expect(value("Time budget")).toBe("30");
    await waitFor(() => expect(query().get("board")).toBe("Js9s4d2h"));
  });

  it("follows a link to /plo while on it: a spot opens, a bare one keeps the form's", async () => {
    open();
    type("Pot", "44");
    await waitFor(() => expect(query().get("pot")).toBe("44"));
    fireEvent.click(screen.getByRole("link", { name: "bare" }));
    await waitFor(() => expect(query().get("pot")).toBe("44"));
    expect(value("Pot")).toBe("44");
    fireEvent.click(screen.getByRole("link", { name: "a flop" }));
    await waitFor(() => expect(value("Board")).toBe("AhKd2c"));
    expect(value("Pot")).toBe("6");
    await waitFor(() => expect(query().get("tbets")).toBe("75"));
  });

  it("takes the address over this browser's last spot", () => {
    localStorage.setItem(PLO_SPOT_KEY, pageToParams({ spot: { ...DEFAULT_SPOT, board: "Js9s4d", pot: "12" }, stop: DEFAULT_STOP }).toString());
    open("/plo?board=2c7d9hJsKd&pot=8&oop=QQxx&target=0.2");
    expect(value("Board")).toBe("2c7d9hJsKd");
    expect(value("Pot")).toBe("8");
    expect(value("OOP range")).toBe("QQxx");
    expect(value("IP range")).toBe(DEFAULT_SPOT.ip);
    expect(value("Target exploitability")).toBe("0.2");
  });

  it("opens the default on a corrupt or missing kept spot", async () => {
    localStorage.setItem(PLO_SPOT_KEY, "%%{not a spot");
    open();
    expect(value("Board")).toBe(DEFAULT_SPOT.board);
    expect(value("OOP range")).toBe(DEFAULT_SPOT.oop);
    expect(value("Target exploitability")).toBe(DEFAULT_STOP.target);
    // and keeps the default from then on
    await waitFor(() => expect(localStorage.getItem(PLO_SPOT_KEY)).toBe(pageToParams({ spot: DEFAULT_SPOT, stop: DEFAULT_STOP }).toString()));
  });

  it("reads a query through the spot's parser: clamps a cap, defaults a bad stopping rule", () => {
    const page = pageFromParams(new URLSearchParams("board=Js9s4d2h7c&bets=50&cap=99&target=abc&secs=-3"))!;
    expect(page.spot.sizes.cap).toBe(3);
    expect(page.stop).toEqual(DEFAULT_STOP);
    expect(pageFromParams(new URLSearchParams("pot=10"))).toBeNull();
    const round = { spot: { ...DEFAULT_SPOT, board: "Js9s4d" }, stop: { target: "0.3", seconds: "12" } };
    expect(pageFromParams(pageToParams(round))).toEqual(round);
  });
});
