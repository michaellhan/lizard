// A test helper: an independent no-limit hold'em table in cents, written from the rules (TDA 2024) rather than from
// table.ts, for table.fuzz.test.ts to run in lockstep with it. A seat that has acted may raise again only where the
// raises since come to a full raise (TDA Rules 43-B, 49-A); a call is never more than the most an all-in opponent can
// be matched for; the uncalled part of a bet goes back; the pot is split by side pots, the rake taken on what was called.
import { orderPost, seatsOf } from "./seats";

export interface RefSetup {
  players: number;
  stacks: Readonly<Record<string, number>>; // bb
  ante?: number;
  straddle?: boolean;
  smallBlind?: number;
}

export class RefTable {
  readonly seats: readonly string[];
  readonly stack: Record<string, number> = {};
  /** chips in from closed streets (and antes) */
  readonly total: Record<string, number> = {};
  readonly bet: Record<string, number> = {};
  readonly folded = new Set<string>();
  street = 0;
  curBet = 0;
  /** the last full raise (or the big blind) */
  lastFull = 100;
  hasActed = new Set<string>();
  /** the bet when each seat last acted */
  facedAt: Record<string, number> = {};
  order: readonly string[];
  lastActor: string | null = null;
  over = false;
  waitingCard = false;
  raised = false;

  constructor(readonly s: RefSetup) {
    const C = (x: number) => Math.round(x * 100);
    this.seats = seatsOf(s.players);
    const straddler = s.straddle && s.players >= 3 ? this.seats[0]! : null;
    for (const p of this.seats) {
      this.stack[p] = C(s.stacks[p] ?? 0);
      this.total[p] = Math.min(C(s.ante ?? 0), this.stack[p]!);
      this.bet[p] = 0;
    }
    const post = (p: string, amt: number) => (this.bet[p] = Math.min(amt, this.stack[p]! - this.total[p]!));
    post("SB", C(s.smallBlind ?? 0.5));
    post("BB", 100);
    if (straddler) post(straddler, 200);
    this.curBet = straddler ? 200 : 100;
    this.lastFull = this.curBet;
    this.order = straddler ? [...this.seats.slice(1), straddler] : this.seats;
    this.checkClose();
  }

  rem(p: string): number {
    return this.stack[p]! - this.total[p]! - this.bet[p]!;
  }
  allin(p: string): boolean {
    return this.rem(p) <= 0;
  }
  live(): string[] {
    return this.seats.filter((p) => !this.folded.has(p));
  }
  actors(): string[] {
    return this.live().filter((p) => !this.allin(p));
  }
  /** the street total p's call comes to: the bet, or no more than the most an opponent has in where all are all-in */
  coverTo(p: string): number {
    const others = this.live().filter((q) => q !== p);
    if (!others.length || others.some((q) => !this.allin(q))) return this.curBet;
    return Math.min(this.curBet, Math.max(this.bet[p]!, ...others.map((q) => this.bet[q]!)));
  }
  needs(p: string): boolean {
    return !this.folded.has(p) && !this.allin(p) && (!this.hasActed.has(p) || this.bet[p]! < this.coverTo(p));
  }
  closedNow(): boolean {
    const live = this.live();
    if (live.length <= 1) return true;
    const actors = this.actors();
    if (actors.every((p) => !this.needs(p))) return true;
    if (actors.length === 1) {
      const a = actors[0]!;
      if (this.bet[a]! >= this.curBet) return true;
      // (before any raise, a lone player with chips who covers every live bet has nothing to call: a short blind)
      const top = Math.max(0, ...live.filter((p) => p !== a).map((p) => this.bet[p]!));
      if (this.street === 0 && !this.raised && this.bet[a]! >= top) return true;
    }
    return false;
  }
  checkClose(): void {
    if (this.over || !this.closedNow()) return;
    // the uncalled part goes back
    const sorted = [...this.seats].sort((a, b) => this.bet[b]! - this.bet[a]!);
    const top = sorted[0]!;
    const second = this.bet[sorted[1]!] ?? 0;
    if (this.bet[top]! > second) this.bet[top] = second;
    for (const p of this.seats) {
      this.total[p]! += this.bet[p]!;
      this.bet[p] = 0;
    }
    if (this.live().length <= 1 || this.street === 3) {
      this.over = true;
      return;
    }
    this.street++;
    this.curBet = 0;
    this.lastFull = 100;
    this.hasActed = new Set();
    this.facedAt = {};
    this.lastActor = null;
    this.raised = false;
    this.order = orderPost(this.s.players);
    this.waitingCard = true;
  }
  toAct(): string | null {
    if (this.over || this.waitingCard) return null;
    const N = this.order.length;
    const start = this.lastActor ? (this.order.indexOf(this.lastActor) + 1) % N : 0;
    for (let k = 0; k < N; k++) {
      const p = this.order[(start + k) % N]!;
      if (this.needs(p)) return p;
    }
    return null;
  }
  canRaise(p: string): boolean {
    if (!this.live().some((q) => q !== p && !this.allin(q))) return false;
    return !this.hasActed.has(p) || this.curBet - (this.facedAt[p] ?? 0) >= this.lastFull;
  }
  legal(): { toAct: string; toCall: number; canRaise: boolean; minTo: number; allInTo: number } | null {
    const p = this.toAct();
    if (!p) return null;
    const rem = this.rem(p);
    const allInTo = this.bet[p]! + rem;
    return { toAct: p, toCall: Math.max(0, Math.min(this.coverTo(p) - this.bet[p]!, rem)), canRaise: this.canRaise(p), minTo: Math.min(this.curBet + this.lastFull, allInTo), allInTo };
  }
  /** a move as table.ts records it: its kind and, for a bet or raise, the street total in cents */
  act(p: string, kind: string, to?: number): void {
    if (p !== this.toAct()) throw new Error(`${p} acts out of turn (to act: ${this.toAct()})`);
    const rem = this.rem(p);
    if (kind === "fold") this.folded.add(p);
    else if (kind === "check" || kind === "call") {
      this.bet[p] = this.bet[p]! + Math.max(0, Math.min(this.coverTo(p) - this.bet[p]!, rem));
      this.hasActed.add(p);
      this.facedAt[p] = this.curBet;
    } else {
      const x = kind === "all-in" ? this.bet[p]! + rem : Math.min(to!, this.bet[p]! + rem);
      if (x > this.curBet) {
        if (x - this.curBet >= this.lastFull) this.lastFull = x - this.curBet;
        this.curBet = x;
        this.raised = true;
      }
      this.bet[p] = x;
      this.hasActed.add(p);
      this.facedAt[p] = this.curBet;
    }
    this.lastActor = p;
    this.checkClose();
  }
  deal(): void {
    this.waitingCard = false;
    this.checkClose();
  }
}

/** What each seat wins, in cents: side pots by every live player's total, the rake on what was called (no flop, no
 * drop), shared by pot, odd cents to the first winner from the small blind. `better(a, b)` > 0 where a's hand wins. */
export function refPays(
  players: number,
  total: Readonly<Record<string, number>>,
  live: readonly string[],
  better: (a: string, b: string) => number,
  rakePct = 0,
  rakeCap = Infinity,
  raked = true,
): { pays: Record<string, number>; rake: number } {
  const seats = seatsOf(players);
  const post = orderPost(players);
  const T = seats.reduce((a, p) => a + (total[p] ?? 0), 0);
  const most = seats.map((p) => total[p] ?? 0).sort((a, b) => b - a);
  const called = T - ((most[0] ?? 0) - (most[1] ?? 0));
  const rake = raked && rakePct > 0 ? Math.min(Math.round((called * rakePct) / 100), rakeCap) : 0;
  const net = T - rake;
  const pays: Record<string, number> = {};
  if (live.length < 2) {
    if (live[0]) pays[live[0]] = net;
    return { pays, rake };
  }
  const levels = [...new Set(live.map((p) => total[p]!))].sort((a, b) => a - b);
  const pots: { amount: number; elig: string[] }[] = [];
  let prev = 0;
  for (const L of levels) {
    const amount = seats.reduce((a, p) => a + Math.min(total[p]!, L) - Math.min(total[p]!, prev), 0);
    if (amount > 0) pots.push({ amount, elig: live.filter((p) => total[p]! >= L) });
    prev = L;
  }
  const leftover = seats.reduce((a, p) => a + Math.max(0, total[p]! - prev), 0);
  if (leftover > 0) pots.push({ amount: leftover, elig: live.filter((p) => total[p]! >= prev) });
  const shares = pots.map((x) => Math.floor((x.amount * net) / T));
  shares[0]! += net - shares.reduce((a, b) => a + b, 0);
  pots.forEach((x, i) => {
    let best: string[] = [];
    for (const p of x.elig) {
      const c = best.length ? better(p, best[0]!) : 1;
      if (c > 0) best = [p];
      else if (c === 0) best.push(p);
    }
    best.sort((a, b) => post.indexOf(a) - post.indexOf(b));
    const share = Math.floor(shares[i]! / best.length);
    let odd = shares[i]! - share * best.length;
    for (const p of best) {
      pays[p] = (pays[p] ?? 0) + share + (odd > 0 ? 1 : 0);
      odd--;
    }
  });
  return { pays, rake };
}
