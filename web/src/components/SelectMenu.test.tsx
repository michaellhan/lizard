import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectMenu } from "./SelectMenu";

function Picker({ onPick }: { onPick?: (v: string) => void }) {
  const [v, setV] = useState("b");
  return (
    <>
      <select
        aria-label="Street"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          onPick?.(e.target.value);
        }}
      >
        <option value="a">Flop</option>
        <option value="b">Turn</option>
        <optgroup label="Later">
          <option value="c" disabled>
            River
          </option>
          <option value="d">Showdown</option>
        </optgroup>
      </select>
      <button>elsewhere</button>
      <SelectMenu />
    </>
  );
}

afterEach(cleanup);

/** An option of the open menu (the select's own options have the role too). */
const opt = (name: RegExp) => within(screen.getByRole("listbox")).getByRole("option", { name });

describe("SelectMenu", () => {
  it("opens its own list on a press, marks the current choice, and writes a pick back as a change", () => {
    const picks: string[] = [];
    render(<Picker onPick={(v) => picks.push(v)} />);
    const sel = screen.getByRole("combobox", { name: "Street" });
    fireEvent.mouseDown(sel);
    const list = screen.getByRole("listbox", { name: "Street" });
    expect(sel).toHaveAttribute("aria-expanded", "true");
    expect(sel).toHaveAttribute("aria-controls", list.id);
    expect(opt(/Turn/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(opt(/River/)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(opt(/River/));
    expect(picks).toEqual([]);
    fireEvent.click(opt(/Flop/));
    expect(picks).toEqual(["a"]);
    expect(sel).toHaveValue("a");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sel).not.toHaveAttribute("aria-expanded");
  });

  it("works from the keyboard: opens, skips what can't be chosen, types ahead, and closes on Escape", () => {
    const picks: string[] = [];
    render(<Picker onPick={(v) => picks.push(v)} />);
    const sel = screen.getByRole("combobox", { name: "Street" });
    sel.focus();
    fireEvent.keyDown(sel, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(sel.getAttribute("aria-activedescendant")).toBe(opt(/Turn/).id);
    fireEvent.keyDown(sel, { key: "ArrowDown" });
    expect(sel.getAttribute("aria-activedescendant")).toBe(opt(/Showdown/).id);
    fireEvent.keyDown(sel, { key: "Enter" });
    expect(picks).toEqual(["d"]);
    fireEvent.keyDown(sel, { key: " " });
    fireEvent.keyDown(sel, { key: "f" });
    expect(sel.getAttribute("aria-activedescendant")).toBe(opt(/Flop/).id);
    fireEvent.keyDown(sel, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(picks).toEqual(["d"]);
  });

  it("closes on a press elsewhere, and leaves a touch to the phone's own picker", () => {
    render(<Picker />);
    const sel = screen.getByRole("combobox", { name: "Street" });
    fireEvent.mouseDown(sel);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true }), { pointerType: "touch" }));
    });
    fireEvent.mouseDown(sel);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
