// The page: the play-money notice, making a table (its link in the hash), joining one by its link, and the socket
// (a stand-in here) that seats you, reconnects with your token, and gives up on a table that's gone.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaPage } from "./ArenaPage";
import { backoff, createTable, idOf, shareLink, socketUrl } from "./client";
import { CLOSE, type ServerMessage, type TableView } from "./protocol";

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = "f".repeat(32);

/** A stand-in WebSocket: what the page sends, and the server's side to answer with. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    act(() => this.onopen?.());
  }
  say(m: ServerMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
  drop(code: number) {
    this.readyState = 3;
    act(() => this.onclose?.({ code }));
  }
}

const state = (o: Partial<TableView> = {}): TableView => ({
  t: "state",
  rules: { stack: 100, clock: 30 },
  you: 1,
  seats: [
    { name: "Ann", connected: true, ready: true, bank: 60_000, score: 0 },
    { name: "Bob", connected: true, ready: true, bank: 60_000, score: 0 },
  ],
  hand: null,
  now: Date.now(),
  ...o,
});

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  localStorage.clear();
  history.replaceState(null, "", "/arena");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const page = () =>
  render(
    <MemoryRouter>
      <ArenaPage />
    </MemoryRouter>,
  );

describe("Play a friend", () => {
  it("says it's play money only, and makes a table whose link is its id after the #", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: ID }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    page();
    expect(screen.getByText(/Play money, for practice only/)).toBeInTheDocument();
    expect(screen.getByText(/No real money, prizes or wagering of any kind/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Your name at the table" }), { target: { value: "Ann" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Stacks/ }), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a table" }));
    await waitFor(() => expect(location.hash).toBe(`#${ID}`));
    expect(fetch).toHaveBeenCalledWith("/api/arena/tables", expect.objectContaining({ method: "POST", body: JSON.stringify({ stack: 40, clock: 30 }) }));
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(`${location.origin}/arena#${ID}`);
    // it sits you down at once
    const s = FakeSocket.all[0]!;
    expect(s.url).toBe(`ws://${location.host}/api/arena/tables/${ID}/ws`);
    s.open();
    expect(s.sent).toEqual([{ t: "join", name: "Ann" }]);
  });

  it("joins by link, keeps the seat's token, and takes the seat back with it after a drop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    history.replaceState(null, "", `/arena#${ID}`);
    page();
    fireEvent.change(screen.getByRole("textbox", { name: "Your name at the table" }), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Sit down" }));
    const s = FakeSocket.all[0]!;
    s.open();
    expect(s.sent).toEqual([{ t: "join", name: "Bob" }]);
    s.say({ t: "seated", seat: 1, token: TOKEN });
    s.say(state());
    expect(screen.getByRole("listitem", { name: "Bob (you)" })).toBeInTheDocument();
    expect(localStorage.getItem(`arena.seat.${ID}`)).toBe(TOKEN);
    s.drop(1006);
    await act(() => vi.advanceTimersByTimeAsync(backoff(0)));
    const s2 = FakeSocket.all[1]!;
    s2.open();
    expect(s2.sent).toEqual([{ t: "join", name: "Bob", token: TOKEN }]);
  });

  it("gives up on a table that's gone, and offers a new one", () => {
    localStorage.setItem(`arena.seat.${ID}`, TOKEN);
    localStorage.setItem("arena.name", "Bob");
    history.replaceState(null, "", `/arena#${ID}`);
    page();
    // (a returning seat sits straight back down)
    const s = FakeSocket.all[0]!;
    s.open();
    expect(s.sent).toEqual([{ t: "join", name: "Bob", token: TOKEN }]);
    s.drop(CLOSE.expired);
    expect(screen.getByRole("alert")).toHaveTextContent(/closed after a while/);
    expect(localStorage.getItem(`arena.seat.${ID}`)).toBeNull();
    expect(FakeSocket.all).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Make a new table" }));
    expect(screen.getByRole("button", { name: "Make a table" })).toBeInTheDocument();
  });
});

describe("the arena client", () => {
  it("reads a table id only as 32 hex digits, and builds the link and socket address", () => {
    expect(idOf(`#${ID}`)).toBe(ID);
    expect(idOf(`#${ID.toUpperCase()}`)).toBe(ID);
    expect(idOf("#abc")).toBeNull();
    expect(idOf("")).toBeNull();
    expect(shareLink(ID, "https://www.michael-han.com")).toBe(`https://www.michael-han.com/arena#${ID}`);
    expect(socketUrl(ID, { protocol: "https:", host: "www.michael-han.com" })).toBe(`wss://www.michael-han.com/api/arena/tables/${ID}/ws`);
    expect([0, 1, 2, 10].map(backoff)).toEqual([500, 1000, 2000, 8000]);
  });

  it("says why a table couldn't be made", async () => {
    const answer = (status: number) => vi.fn(async () => new Response("{}", { status, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    expect(await createTable({ stack: 100, clock: 30 }, answer(429))).toEqual({ error: "slow_down", retryAfter: 30 });
    expect(await createTable({ stack: 100, clock: 30 }, answer(503))).toEqual({ error: "unavailable" });
    expect(await createTable({ stack: 100, clock: 30 }, answer(400))).toEqual({ error: "failed" });
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await createTable({ stack: 100, clock: 30 }, down)).toEqual({ error: "unavailable" });
  });
});
