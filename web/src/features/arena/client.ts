// The page's side of "Play a friend": making a table, the share link, and the table's socket (useArena), which reconnects
// on its own and takes the seat back with the token this browser was given for it. The server is the dealer and judge;
// this only sends what you ask and draws what comes back.
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_URL } from "@/config";
import { CLOSE, TABLE_ID, type ClientMessage, type ErrorCode, type ServerMessage, type TableRules, type TableView } from "./protocol";

/** The arena's address: the site's own /lizard/api/arena (VITE_ARENA_URL elsewhere, for local development). */
export const API: string = (import.meta.env.VITE_ARENA_URL as string | undefined) ?? `${BASE_URL}api/arena`;

/** The table's share link: its id after the #, which a browser never sends to any server (nor in a Referer). */
export const shareLink = (id: string, origin = location.origin) => `${origin}${BASE_URL}arena#${id}`;

/** The table id in a link's hash, or null. */
export function idOf(hash: string): string | null {
  const id = hash.replace(/^#/, "").trim().toLowerCase();
  return TABLE_ID.test(id) ? id : null;
}

export function socketUrl(id: string, loc: Pick<Location, "protocol" | "host"> = location): string {
  const base = /^https?:/.test(API) ? API.replace(/^http/, "ws") : `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${API}`;
  return `${base}/tables/${id}/ws`;
}

export type CreateError = "slow_down" | "unavailable" | "failed";

/** Makes a table: its id, or why not. */
export async function createTable(rules: TableRules, f: typeof fetch = fetch): Promise<{ id: string } | { error: CreateError; retryAfter?: number }> {
  try {
    const res = await f(`${API}/tables`, { method: "POST", headers: { "content-type": "application/json", "x-lizard": "1" }, body: JSON.stringify(rules) });
    if (res.status === 201) {
      const { id } = (await res.json()) as { id: string };
      if (TABLE_ID.test(id)) return { id };
      return { error: "failed" };
    }
    if (res.status === 429) return { error: "slow_down", retryAfter: Number(res.headers.get("retry-after")) || 60 };
    return { error: res.status === 404 || res.status >= 500 ? "unavailable" : "failed" };
  } catch {
    return { error: "unavailable" };
  }
}

// ---- what this browser remembers (each read and write may fail: a private window, storage blocked)

const SEAT_KEY = (id: string) => `arena.seat.${id}`;
const NAME_KEY = "arena.name";

export function savedToken(id: string): string | undefined {
  try {
    const t = localStorage.getItem(SEAT_KEY(id));
    return t && /^[0-9a-f]{32}$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}
function saveToken(id: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(SEAT_KEY(id), token);
    else localStorage.removeItem(SEAT_KEY(id));
  } catch {
    // (not remembered: a reload takes a free seat, if there is one)
  }
}
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // (asked again next time)
  }
}

// ---- the socket

/** Why a table's connection ended for good (no reconnecting after these). */
export type Ended = "expired" | "full" | "replaced" | "abuse" | "no_table" | "left";
const ENDED: Record<number, Ended> = {
  [CLOSE.expired]: "expired",
  [CLOSE.full]: "full",
  [CLOSE.replaced]: "replaced",
  [CLOSE.abuse]: "abuse",
  [CLOSE.noTable]: "no_table",
  [CLOSE.left]: "left",
};
export const ENDED_TEXT: Record<Ended, string> = {
  expired: "This table closed after a while with nothing played. Make a new one.",
  full: "Both seats at this table are taken.",
  replaced: "You opened this table somewhere else; it's playing there now.",
  abuse: "The server cut this connection off: too many or too large messages.",
  no_table: "This table doesn't exist or has expired. Make a new one.",
  left: "You left the table.",
};

export interface Arena {
  view: TableView | null;
  /** connecting the first time or again after a drop */
  status: "connecting" | "open" | "ended";
  ended: Ended | null;
  error: ErrorCode | null;
  /** the server's clock less this page's, ms */
  skew: number;
  send: (m: ClientMessage) => void;
}

/** Waits before the n-th reconnect, ms: 0.5s doubling to 8s. */
export const backoff = (n: number) => Math.min(8000, 500 * 2 ** n);

/** The table `id`'s connection, joined as `name` (null: not yet asked). */
export function useArena(id: string, name: string | null, Socket: typeof WebSocket = WebSocket): Arena {
  const [view, setView] = useState<TableView | null>(null);
  const [status, setStatus] = useState<Arena["status"]>("connecting");
  const [ended, setEnded] = useState<Ended | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [skew, setSkew] = useState(0);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (name === null) return;
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stop) return;
      setStatus("connecting");
      const s = new Socket(socketUrl(id));
      ws.current = s;
      s.onopen = () => {
        tries = 0;
        const token = savedToken(id);
        s.send(JSON.stringify({ t: "join", name, ...(token ? { token } : {}) } satisfies ClientMessage));
      };
      s.onmessage = (e: MessageEvent) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(String(e.data)) as ServerMessage;
        } catch {
          return;
        }
        if (m.t === "seated") {
          saveToken(id, m.token);
          setStatus("open");
        } else if (m.t === "state") {
          setView(m);
          setSkew(m.now - Date.now());
          setError(null);
          setStatus("open");
        } else if (m.t === "error") setError(m.code);
      };
      s.onclose = (e: CloseEvent) => {
        if (ws.current === s) ws.current = null;
        if (stop) return;
        const why = ENDED[e.code];
        if (why) {
          if (why === "left" || why === "expired" || why === "no_table") saveToken(id, null);
          setEnded(why);
          setStatus("ended");
          return;
        }
        timer = setTimeout(open, backoff(tries++));
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(timer);
      ws.current?.close(1000, "page closed");
      ws.current = null;
    };
  }, [id, name, Socket]);

  const send = useCallback((m: ClientMessage) => {
    const s = ws.current;
    if (s && s.readyState === 1) s.send(JSON.stringify(m));
  }, []);

  return { view, status, ended, error, skew, send };
}
