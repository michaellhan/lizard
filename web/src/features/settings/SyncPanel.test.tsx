// The panel, with the service stood in for: it shows nothing until the service answers, what Google sent back goes from the
// address, signing in starts a sync with nothing more to do, what it costs in privacy is said before the button, and what
// can't be undone asks first.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/data/db";

const service = vi.hoisted(() => ({
  up: true,
  signedIn: false,
  calls: [] as string[],
}));

vi.mock("@/sync/api", async (real) => ({
  ...(await real<typeof import("@/sync/api")>()),
  syncAvailable: () => Promise.resolve(service.up),
  me: () => Promise.resolve(service.signedIn ? { signedIn: true, account: "row-1", bytes: 2 * 1024 * 1024, maxBytes: 250 * 1024 * 1024 } : { signedIn: false }),
  signOut: () => {
    service.calls.push("signout");
    service.signedIn = false;
    return Promise.resolve({});
  },
  pull: () => Promise.resolve({ records: [], more: false }),
  push: () => Promise.resolve({ seq: 0, bytes: 0 }),
  deleteAccount: () => {
    service.calls.push("delete");
    service.signedIn = false;
    return Promise.resolve({});
  },
}));

const { default: SyncPanel } = await import("./SyncPanel");
const { status } = await import("@/sync/session");

const click = (el: HTMLElement) => void fireEvent.click(el);

beforeEach(async () => {
  Object.assign(service, { up: true, signedIn: false, calls: [] });
  await status();
  await (await db())!.clear("kv");
  history.replaceState(null, "", "/lizard/settings");
});

describe("the sync panel", () => {
  it("is nothing at all until the service answers", async () => {
    service.up = false;
    const { container } = render(<SyncPanel />);
    await act(() => Promise.resolve());
    expect(container).toBeEmptyDOMElement();
  });

  it("signs in by plain link to the service, which sends the browser on to Google", async () => {
    render(<SyncPanel />);
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/lizard/api/auth/google");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([
    ["cancelled", "Sign-in was cancelled"],
    ["busy", "Too many sign-ins"],
    ["failed", "didn't finish"],
    ["anything else", "didn't finish"],
  ])("says what came back from Google (%s) and takes it from the address", async (why, words) => {
    history.replaceState(null, "", `/lizard/settings#sync-error=${why}`);
    render(<SyncPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
    expect(location.hash).toBe("");
    expect(location.pathname).toBe("/lizard/settings");
  });

  it("says who can read the synced copy before there's a button to press", async () => {
    render(<SyncPanel />);
    await screen.findByRole("link", { name: "Sign in with Google" });
    expect(screen.getByText(/aren't encrypted end to end, so the site's owner can read them/)).toBeInTheDocument();
    expect(screen.getByText(/Signing in starts it/)).toBeInTheDocument();
  });

  it("syncs as soon as it's signed in, with nothing to choose or type, and marks the browser to carry on", async () => {
    service.signedIn = true;
    render(<SyncPanel />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Last synced at .*: 0 changed here, 0 sent\./));
    expect(screen.getByText(/2\.0 MB of 250 MB used/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(localStorage.getItem("lizard-sync")).toBe("1");
  });

  it("signs out without touching what's here, and stops marking the browser", async () => {
    service.signedIn = true;
    render(<SyncPanel />);
    click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(service.calls).toEqual(["signout"]);
    expect(localStorage.getItem("lizard-sync")).toBeNull();
  });

  it("takes the mark off when the session has run out elsewhere", async () => {
    service.signedIn = true;
    await status();
    expect(localStorage.getItem("lizard-sync")).toBe("1");
    service.signedIn = false;
    render(<SyncPanel />);
    await screen.findByRole("link", { name: "Sign in with Google" });
    expect(localStorage.getItem("lizard-sync")).toBeNull();
  });

  it("deletes the account behind a second press, and says what the delete does and doesn't reach", async () => {
    service.signedIn = true;
    render(<SyncPanel />);
    expect(await screen.findByText(/restore points can hold a copy for up to 30 days/)).toBeInTheDocument();
    click(await screen.findByRole("button", { name: "Delete my account" }));
    expect(service.calls).toEqual([]);
    click(screen.getByRole("button", { name: "Delete the account and the synced copy" }));
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(service.calls).toEqual(["delete"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull());
  });
});
