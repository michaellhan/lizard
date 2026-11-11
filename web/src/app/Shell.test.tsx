import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import { describe, expect, it } from "vitest";
import { routeTitle } from "./routes";
import { fitCount, Shell } from "./Shell";

function Query() {
  const [, setParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setParams({ a: "1" })}>
      Walk
    </button>
  );
}

function show(start = "/") {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<h1>Welcome</h1>} />
          <Route
            path="study"
            element={
              <>
                <h1>Study</h1>
                <Query />
              </>
            }
          />
          <Route path="saved" element={<p>No heading on this page</p>} />
          <Route path="*" element={<h1>Not found</h1>} />
        </Route>
      </Routes>
      <Link to="/study">to study</Link>
      <Link to="/saved">to saved</Link>
    </MemoryRouter>,
  );
}

const said = () => document.querySelector<HTMLElement>(`p[aria-live="polite"]`)!;

describe("Route changes", () => {
  it("titles a route by its label, and home and an unknown address too", () => {
    expect(routeTitle("/")).toBe("Lizard");
    expect(routeTitle("/study")).toBe("Study · Lizard");
    expect(routeTitle("/equity/")).toBe("PLO equity · Lizard");
    expect(routeTitle("/nothing")).toBe("Not found · Lizard");
  });

  it("sets the title on first load and takes no focus there", async () => {
    show("/study");
    await waitFor(() => expect(document.title).toBe("Study · Lizard"));
    expect(document.body).toHaveFocus();
    expect(said()).toHaveTextContent("");
  });

  it("moves focus to the new page's heading and says where it landed", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "to study" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Study" })).toHaveFocus());
    expect(document.title).toBe("Study · Lizard");
    expect(said()).toHaveTextContent("Study · Lizard");
  });

  it("falls back to <main> where the page has no heading", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "to saved" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("leaves focus alone when only the query changes (Study walking a line)", async () => {
    show("/study");
    const walk = screen.getByRole("button", { name: "Walk" });
    walk.focus();
    await act(async () => {
      fireEvent.click(walk);
    });
    expect(walk).toHaveFocus();
    expect(said()).toHaveTextContent("");
  });

  it("keeps the skip link's target focusable", () => {
    show();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("shows the four main pages, the rest under More, and a mark on the current page", () => {
    show("/study");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveClass("segmented");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Study", "Practice", "Analyze", "Solve"]);
    expect(screen.getByRole("link", { name: "Study" })).toHaveClass("underline", "decoration-accent");
    const more = within(nav).getByRole("button", { name: /More/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: /^Review/ })).toHaveAttribute("href", "/review");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("marks More while you're on one of its pages", () => {
    show("/library");
    expect(screen.getByRole("button", { name: /More/ })).toHaveClass("underline", "decoration-accent");
  });
});

describe("fitCount", () => {
  const widths = [60, 80, 75, 60, 70, 50, 70, 60, 75, 70, 100, 50, 90, 70];
  const all = widths.reduce((a, w) => a + w, 0) + 4 * (widths.length - 1);

  it("puts every page in the bar, with no More, where they all fit", () => {
    expect(fitCount(widths, 65, 4, all)).toBe(widths.length);
  });

  it("keeps room for More where they don't, and never drops a main page", () => {
    expect(fitCount(widths, 65, 4, all - 1)).toBeLessThan(widths.length);
    // 60 + 80 + 75 + 60 + 70 and the gaps between them is 361, and More takes 65 + 4 more
    expect(fitCount(widths, 65, 4, 430)).toBe(5);
    expect(fitCount(widths, 65, 4, 429)).toBe(4);
    expect(fitCount(widths, 65, 4, 100)).toBe(4);
  });
});
