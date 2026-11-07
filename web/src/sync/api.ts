// Calls to the sync service, on the site's own origin. A failure is a SyncFailed with what to say; nothing here touches
// the data kept in this browser. The header is what the service asks of a write: a form on another site can't set it.
const BASE = "/lizard/api/";

export interface Me {
  signedIn: boolean;
  /** the account's row: it's new if the account was deleted and came back */
  account?: string;
  seq?: number;
  bytes?: number;
  maxBytes?: number;
}
export interface RemoteRecord {
  store: number;
  id: string;
  seq: number;
  body: string;
}
export type Outgoing = Omit<RemoteRecord, "seq">;

const WORDS: Record<string, string> = {
  slow_down: "Too many tries. Wait a while, then try again.",
  signed_out: "You're signed out of sync.",
  account_full: "The synced copy is full: delete some kept data to make room.",
};

export class SyncFailed extends Error {
  constructor(
    message: string,
    readonly code: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: { ...(method === "GET" ? {} : { "x-lizard": "1" }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new SyncFailed("Sync couldn't be reached. Everything here stays as it is.", "network", e);
  }
  const out = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !out) {
    const code = out?.error ?? "failed";
    throw new SyncFailed(WORDS[code] ?? "Sync failed. Everything here stays as it is.", code);
  }
  return out;
}

/** Whether the service is there at all: the page shows nothing of sync until it is. */
export const syncAvailable = () => fetch(`${BASE}health`).then((r) => r.ok && (r.headers.get("content-type") ?? "").includes("json")).catch(() => false);

export const me = () => call<Me>("GET", "me");
/** Where the browser goes to sign in: the service sends it on to Google, and Google sends it back to Settings. */
export const GOOGLE_SIGN_IN = `${BASE}auth/google`;
export const signOut = () => call("POST", "auth/signout", {});
export const pull = (since: number) => call<{ records: RemoteRecord[]; more: boolean }>("GET", `records?since=${since}`);
export const push = (records: Outgoing[]) => call<{ seq: number; bytes: number }>("POST", "records", { records });
export const deleteAccount = () => call("DELETE", "account");
