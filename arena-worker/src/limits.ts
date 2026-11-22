// Rate limits in fixed windows, kept in a Durable Object (a Worker remembers nothing between requests): one Object per
// address, by a salted hash of it (an IPv6 address by its /64, which one household or phone can rotate within), and one
// for everyone. Making a table counts by the hour and the day and is stored; opening a connection counts by the minute in
// the Object's memory only (an evicted Object forgets a minute's count, which costs nothing worth a write per connection).
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { json, Refused } from "./http";

export interface Limit {
  max: number;
  ms: number;
}

export const LIMITS = {
  createIpHour: { max: 10, ms: 3_600_000 },
  createIpDay: { max: 40, ms: 86_400_000 },
  createAllDay: { max: 2000, ms: 86_400_000 },
  connectIpMinute: { max: 30, ms: 60_000 },
} as const satisfies Record<string, Limit>;

/** The address as it's counted: an IPv6 one by its first four groups (/64). */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return (
    groups
      .slice(0, 4)
      .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
      .join(":") + "::/64"
  );
}

export async function ipKey(ip: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lizard-arena:${ipBucket(ip)}`));
  return [...new Uint8Array(h).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Window {
  start: number;
  count: number;
}

/** What one counter Object does: count a request against each named window, all or none, and say how long to wait. */
export class Counters {
  private memory = new Map<string, Window>();
  constructor(private readonly storage: DoStorage | null) {}

  private async read(key: string, stored: boolean): Promise<Window | undefined> {
    return stored && this.storage ? await this.storage.get<Window>(`w:${key}`) : this.memory.get(key);
  }

  /** Counts one against every window, or none where any is full: then the seconds until it has room. */
  async spend(windows: { key: string; limit: Limit; stored: boolean }[], now: number): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
    const next: [string, Window, boolean][] = [];
    for (const { key, limit, stored } of windows) {
      const w = await this.read(key, stored);
      const cur = !w || w.start <= now - limit.ms ? { start: now, count: 0 } : w;
      if (cur.count + 1 > limit.max) return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.start + limit.ms - now) / 1000)) };
      next.push([key, { start: cur.start, count: cur.count + 1 }, stored]);
    }
    for (const [key, w, stored] of next) {
      if (stored && this.storage) await this.storage.put(`w:${key}`, w);
      else this.memory.set(key, w);
    }
    return { ok: true };
  }
}

/** The counter Object: POST {windows: [{key, max, ms, stored}]} answers {ok} or {ok: false, retryAfter}. */
export class ArenaLimits extends DurableObject<Env> {
  private counters: Counters;
  constructor(ctx: DoState, env: Env) {
    super(ctx, env);
    this.counters = new Counters(ctx.storage);
  }

  async fetch(req: Request): Promise<Response> {
    const body = (await req.json()) as { windows: { key: string; max: number; ms: number; stored: boolean }[] };
    const now = Date.now();
    const r = await this.counters.spend(
      body.windows.map((w) => ({ key: w.key, limit: { max: w.max, ms: w.ms }, stored: w.stored })),
      now,
    );
    // (stored windows are forgotten two days on, so an address seen once doesn't keep a row for ever)
    if (body.windows.some((w) => w.stored) && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 2 * 86_400_000);
    return json(r);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

async function spendAt(env: Env, name: string, windows: { key: string; limit: Limit; stored: boolean }[], scope: string): Promise<void> {
  const stub = env.LIMITS.get(env.LIMITS.idFromName(name));
  const res = await stub.fetch("https://limits/spend", {
    method: "POST",
    body: JSON.stringify({ windows: windows.map((w) => ({ key: w.key, max: w.limit.max, ms: w.limit.ms, stored: w.stored })) }),
  });
  const r = (await res.json()) as { ok: boolean; retryAfter?: number };
  if (!r.ok) throw new Refused(429, "slow_down", { scope, retryAfter: r.retryAfter ?? 60 });
}

/** Making a table: the address's hour and day, then everyone's day. */
export async function limitCreate(env: Env, ip: string): Promise<void> {
  const id = await ipKey(ip);
  await spendAt(env, `ip:${id}`, [
    { key: "create-hour", limit: LIMITS.createIpHour, stored: true },
    { key: "create-day", limit: LIMITS.createIpDay, stored: true },
  ], "ip");
  await spendAt(env, "all", [{ key: "create-day", limit: LIMITS.createAllDay, stored: true }], "global");
}

/** Opening a connection to a table: the address's minute. */
export async function limitConnect(env: Env, ip: string): Promise<void> {
  const id = await ipKey(ip);
  await spendAt(env, `ip:${id}`, [{ key: "connect-minute", limit: LIMITS.connectIpMinute, stored: false }], "ip");
}
