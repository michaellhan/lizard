// Counts in fixed windows, in D1, as a Worker has no memory between requests. It's a brake on sign-ins and on writes.
import { Refused } from "./http";
import type { Db } from "./env";

export const LIMITS = {
  signInIp: { max: 30, ms: 3600_000 },
  writes: { max: 60, ms: 60_000 },
} as const;

/** Counts this request against `key`, refusing it once the window's full. */
export async function spend(db: Db, key: string, { max, ms }: { max: number; ms: number }, now: number) {
  const row = await db
    .prepare(
      `INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate.window_start <= ?3 THEN 1 ELSE rate.count + 1 END,
         window_start = CASE WHEN rate.window_start <= ?3 THEN ?2 ELSE rate.window_start END
       RETURNING count`,
    )
    .bind(key, now, now - ms)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > max) throw new Refused(429, "slow_down");
}
