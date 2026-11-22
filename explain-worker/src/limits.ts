// Rate limits in fixed windows, in D1 (a Worker has no memory between requests): per IP and for everyone, each by the
// minute and by the day. They sit in front of the budget cap (budget.ts), which is the hard stop on cost; these keep one
// visitor from spending it and smooth bursts. The IP is kept only as a salted hash, and an IPv6 address by its /64, which
// one household or phone can rotate within.
import type { Db } from "./env";
import { Refused } from "./http";

export const LIMITS = {
  ipMinute: { max: 6, ms: 60_000 },
  ipDay: { max: 60, ms: 86_400_000 },
  allMinute: { max: 60, ms: 60_000 },
  allDay: { max: 2000, ms: 86_400_000 },
} as const;

type Limit = { max: number; ms: number };

/** The address as it's counted: an IPv6 one by its first four groups (/64). */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":") + "::/64";
}

export async function ipKey(ip: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lizard-explain:${ipBucket(ip)}`));
  return [...new Uint8Array(h).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Counts this request against `key`, refusing it once the window's full, with the seconds the window has left. */
async function spend(db: Db, key: string, { max, ms }: Limit, now: number, scope: string): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate.window_start <= ?3 THEN 1 ELSE rate.count + 1 END,
         window_start = CASE WHEN rate.window_start <= ?3 THEN ?2 ELSE rate.window_start END
       RETURNING count, window_start`,
    )
    .bind(key, now, now - ms)
    .first<{ count: number; window_start: number }>();
  if ((row?.count ?? 0) > max) throw new Refused(429, "slow_down", { scope, retryAfter: Math.max(1, Math.ceil(((row?.window_start ?? now) + ms - now) / 1000)) });
}

/** Every limit for this request, the visitor's first. */
export async function limit(db: Db, ip: string, now: number): Promise<void> {
  const id = await ipKey(ip);
  await spend(db, `ip-minute:${id}`, LIMITS.ipMinute, now, "ip");
  await spend(db, `ip-day:${id}`, LIMITS.ipDay, now, "ip");
  await spend(db, "all-minute", LIMITS.allMinute, now, "global");
  await spend(db, "all-day", LIMITS.allDay, now, "global");
}

/** Clears windows long past, so the table doesn't pile up. */
export const sweepRate = (db: Db, now: number) => db.prepare("DELETE FROM rate WHERE window_start <= ?").bind(now - 2 * 86_400_000).run();
