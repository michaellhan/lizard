// The panel, with the service stood in for and the encryption real: it shows nothing until the service answers, the link's
// token goes from the address, a wrong passphrase unlocks nothing, and what can't be undone asks first.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, kvGet } from "@/data/db";
import { deriveKeys, makeCheck, newSalt } from "@/sync/crypto";

const service = vi.hoisted(() => ({
  up: true,
  signedIn: false,
  salt: null as string | null,
  check: null as string | null,
  calls: [] as string[],
}));

vi.mock("@/sync/api", async (real) => ({
  ...(await real<typeof import("@/sync/api")>()),
  syncAvailable: () => Promise.resolve(service.up),
  me: () => Promise.resolve({ signedIn: service.signedIn, salt: service.salt, check: service.check, bytes: 2 * 1024 * 1024, maxBytes: 250 * 1024 * 1024 }),
  startSignIn: (email: string) => (service.calls.push(`start ${email}`), Promise.resolve({})),
  finishSignIn: (token: string) => {
    service.calls.push(`finish ${token}`);
    service.signedIn = true;
    return Promise.resolve({});
  },
  signOut: () => {
    service.calls.push("signout");
    service.signedIn = false;
    return Promise.resolve({});
  },
  setKeys: (salt: string, check: string, reset?: boolean) => {
    service.calls.push(reset ? "reset" : "keys");
    Object.assign(service, { salt, check });
    return Promise.resolve({});
  },
  pull: () => Promise.resolve({ records: [], more: false }),
  push: () => Promise.resolve({ seq: 0, bytes: 0 }),
  deleteAccount: () => {
    service.calls.push("delete");
    Object.assign(service, { signedIn: false, salt: null, check: null });
    return Promise.resolve({});
  },
}));

const { default: SyncPanel } = await import("./SyncPanel");
const { lock } = await import("@/sync/session");

const PHRASE = "correct horse battery";

const userEvent = {
  type: async (el: HTMLElement, value: string) => void fireEvent.change(el, { target: { value } }),
  clear: async (el: HTMLElement) => void fireEvent.change(el, { target: { value: "" } }),
  click: async (el: HTMLElement) => void fireEvent.click(el),
};

beforeEach(async () => {
  await lock();
  await (await db())!.clear("kv");
  Object.assign(service, { up: true, signedIn: false, salt: null, check: null, calls: [] });
  history.replaceState(null, "", "/lizard/settings");
});

const withPhrase = async () => {
  const salt = newSalt();
  Object.assign(service, { signedIn: true, salt, check: await makeCheck(await deriveKeys(PHRASE, salt)) });
};

describe("the sync panel", () => {
  it("is nothing at all until the service answers", async () => {
    service.up = false;
    const { container } = render(<SyncPanel />);
    await act(() => Promise.resolve());
    expect(container).toBeEmptyDOMElement();
  });

  it("sends a sign-in link and says what it can't know", async () => {
    render(<SyncPanel />);
    await userEvent.type(await screen.findByLabelText("Email"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("If that address can sign in");
    expect(service.calls).toEqual(["start a@example.com"]);
  });

  it("spends the link's token and takes it from the address at once", async () => {
    history.replaceState(null, "", "/lizard/settings#sync-token=abc");
    render(<SyncPanel />);
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeDisabled();
    expect(location.hash).toBe("");
    expect(service.calls).toEqual(["finish abc"]);
  });

  it("takes a link pasted into a tab already on the page, where no page loads to find it", async () => {
    render(<SyncPanel />);
    await screen.findByLabelText("Email");
    history.replaceState(null, "", "/lizard/settings#sync-token=later");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeDisabled();
    expect(service.calls).toEqual(["finish later"]);
    expect(location.hash).toBe("");
  });

  it("won't take a passphrase too short or typed differently, and says a lost one can't be got back", async () => {
    service.signedIn = true;
    render(<SyncPanel />);
    const start = await screen.findByRole("button", { name: "Start syncing" });
    expect(screen.getByText(/If you lose it the synced copy is gone/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Passphrase/), "short");
    await userEvent.type(screen.getByLabelText("The same again"), "short");
    expect(start).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/^Passphrase/));
    await userEvent.type(screen.getByLabelText(/^Passphrase/), PHRASE);
    expect(screen.getByText(/don.t match/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("The same again"));
    await userEvent.type(screen.getByLabelText("The same again"), PHRASE);
    await userEvent.click(start);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Last synced at .*: 0 changed here, 0 sent\./));
    expect(service.calls).toEqual(["keys"]);
    // (not asked to stay: the keys stayed in memory)
    expect(await kvGet("syncKeys")).toBeNull();
    expect(localStorage.getItem("lizard-sync")).toBeNull();
  }, 30_000);

  it("unlocks only with the passphrase, and can stay unlocked", async () => {
    await withPhrase();
    render(<SyncPanel />);
    await userEvent.type(await screen.findByLabelText("Passphrase"), "not the passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't the passphrase");
    await userEvent.clear(screen.getByLabelText("Passphrase"));
    await userEvent.type(screen.getByLabelText("Passphrase"), PHRASE);
    await userEvent.click(screen.getByRole("checkbox", { name: "Stay unlocked on this device" }));
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(localStorage.getItem("lizard-sync")).toBe("1");
    expect(screen.getByText(/2\.0 MB of 250 MB used/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeInTheDocument();
    expect(localStorage.getItem("lizard-sync")).toBeNull();
    expect(await kvGet("syncKeys")).toBeNull();
  }, 30_000);

  it("starts a new synced copy for a lost passphrase only on asking, and only after the warning", async () => {
    await withPhrase();
    render(<SyncPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Lost the passphrase?" }));
    expect(screen.getByText(/replaces the synced copy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep the synced copy" }));
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeInTheDocument();
    expect(service.calls).toEqual([]);
  });

  it("deletes the account behind a second press, and signs out without touching what's here", async () => {
    await withPhrase();
    render(<SyncPanel />);
    await userEvent.type(await screen.findByLabelText("Passphrase"), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    expect(service.calls).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Delete the account and the synced copy" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(service.calls).toEqual(["delete"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull());
  }, 30_000);
});
