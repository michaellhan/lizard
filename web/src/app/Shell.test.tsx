import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import { describe, expect, it } from "vitest";
import { routeTitle } from "./routes";
import { Shell } from "./Shell";

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

  it("shows every page in the bar, no More menu, and a mark on the current page", () => {
    show("/study");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveClass("segmented");
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Study", "/study"],
      ["Practice", "/practice"],
      ["Analyze", "/analyze"],
      ["Solve", "/solve"],
      ["Progress", "/progress"],
      ["Reports", "/reports"],
      ["Ranges", "/ranges"],
      ["PLO", "/plo"],
    ]);
    expect(within(nav).queryByRole("button")).toBeNull();
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveClass("underline", "decoration-accent");
    // (Settings' gear in the bar at every width, a phone's too)
    expect(screen.getByRole("link", { name: "Settings" })).toHaveClass("inline-flex");
  });

  it("marks a section's entry on any of its pages", () => {
    show("/history");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "PLO" })).not.toHaveAttribute("aria-current");
    cleanup();
    show("/equity");
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "PLO" })).toHaveAttribute("aria-current", "page");
  });

  it("puts a section's pages in a row of tabs over each of them, the one you're on marked", () => {
    show("/saved");
    const tabs = screen.getByRole("navigation", { name: "Progress pages" });
    expect(within(tabs).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Review", "/progress"],
      ["History", "/history"],
      ["Saved", "/saved"],
    ]);
    expect(within(tabs).getByRole("link", { name: "Saved" })).toHaveAttribute("aria-current", "page");
  });

  it("reaches Engine and Library from Settings' tabs", () => {
    show("/settings");
    const tabs = screen.getByRole("navigation", { name: "Settings pages" });
    expect(within(tabs).getByRole("link", { name: "Engine" })).toHaveAttribute("href", "/engine");
    expect(within(tabs).getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
  });

  it("joins PLO's solve and equity, and draws no tabs on a page of no section", () => {
    show("/equity");
    expect(within(screen.getByRole("navigation", { name: "PLO pages" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Solve", "Equity"]);
    cleanup();
    show("/study");
    expect(screen.queryByRole("navigation", { name: /pages$/ })).toBeNull();
  });
});
