import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps the nav's ring inside its scroller, its fade until every item fits, and a mark on the current page", () => {
    show("/study");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveClass("segmented", "overflow-x-auto");
    expect(nav.className).toContain("xl:[mask-image:none]");
    expect(nav.className).not.toContain("lg:");
    expect(screen.getByRole("link", { name: "Study" })).toHaveClass("underline", "decoration-accent");
  });
});
