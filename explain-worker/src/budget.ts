// The monthly spend cap, in D1. Before a call the worst case it could cost is reserved, in one statement that fails once the
// month's spend would pass the cap, so concurrent requests can't overshoot it; afterwards the reserve is settled to what the
// call's usage says it cost. Money is kept in nanodollars (1e-9 USD) as integers.
import type { Db } from "./env";
import { MAX_TOKENS } from "./prompt";

/** Owner's decision, 2026-11-17: a hard cap of $20 a month (UTC calendar months). */
export const MONTHLY_CAP_USD = 20;
export const CAP_NANO = MONTHLY_CAP_USD * 1e9;

/** Claude Haiku 5.5, per token in nanodollars: $0.10 / $0.50 per million input / output tokens for a prompt of 100K tokens
 * or fewer, $0.50 / $2.50 above (claude-api skill's model table, 2026-11-03). A prompt here is a few hundred tokens. */
export const PRICE = { input: 100, output: 500, longInput: 500, longOutput: 2500, longAbove: 100_000 } as const;

/** The most input one request can be: the body's 4 KB cap plus the fixed system prompt, at under a byte a token, rounded up. */
export const MAX_INPUT_TOKENS = 6000;
export const RESERVE_NANO = MAX_INPUT_TOKENS * PRICE.input + MAX_TOKENS * PRICE.output;

export function costNano(inputTokens: number, outputTokens: number): number {
  const long = inputTokens > PRICE.longAbove;
  return Math.ceil(inputTokens * (long ? PRICE.longInput : PRICE.input) + outputTokens * (long ? PRICE.longOutput : PRICE.output));
}

export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);

/** Seconds until the next UTC month starts. */
export function untilNextMonth(now: number): number {
  const d = new Date(now);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - now) / 1000));
}

/** Reserves `nano` against the month, or returns false when that would pass the cap. */
export async function reserve(db: Db, month: string, nano: number): Promise<boolean> {
  await db.prepare("INSERT INTO budget (month, spent_nano, requests) VALUES (?1, 0, 0) ON CONFLICT (month) DO NOTHING").bind(month).run();
  const row = await db
    .prepare("UPDATE budget SET spent_nano = spent_nano + ?2, requests = requests + 1 WHERE month = ?1 AND spent_nano + ?2 <= ?3 RETURNING spent_nano")
    .bind(month, nano, CAP_NANO)
    .first<{ spent_nano: number }>();
  return row !== null;
}

/** Moves the month's spend by `delta` (a call's real cost less its reserve, or the whole reserve back when nothing was billed). */
export async function settle(db: Db, month: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await db.prepare("UPDATE budget SET spent_nano = MAX(0, spent_nano + ?2) WHERE month = ?1").bind(month, delta).run();
}

/** Whether one more request fits this month: what the health check reports. */
export async function hasRoom(db: Db, month: string): Promise<boolean> {
  const row = await db.prepare("SELECT spent_nano FROM budget WHERE month = ?1").bind(month).first<{ spent_nano: number }>();
  return (row?.spent_nano ?? 0) + RESERVE_NANO <= CAP_NANO;
}
