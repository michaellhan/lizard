// A table: two seats, the hand in play, the clocks, and what each connection is sent. It knows nothing of Durable Objects
// or sockets: a connection is anything with send and close and a little state of its own (the Durable Object's
// hibernatable WebSockets in table.ts; plain stand-ins in the tests and the browser test's server). Its whole state is
// one plain object, stored after every change, so the table survives the Object being evicted mid-hand.
//
// What it holds to: the server deals (rng.ts) and judges every move (game.ts); a seat is sent its own cards and never the
// other seat's before they're shown; a seat is held by a token only its page has (kept here as a hash), so the link alone
// can take a free seat but never someone else's; there are two seats and no spectators; and a connection that sends too
// much, too often or too big, is cut off.
import { BANK_REFILL, BANK_SECONDS, CLOSE, cleanName, IDLE_MS, MAX_MESSAGE, MESSAGE_RATE, NAME_MAX, ACTIONS, SEAT_TOKEN, type ArenaAction, type ClientMessage, type ErrorCode, type HandView, type ServerMessage, type TableRules, type TableView } from "../../web/src/features/arena/protocol";
import { behind, legal } from "../../web/src/poker/table";
import { act, deal, other, posOf, says, setupOf, simOf, timeOut, toActOf, type Hand, type Pos, type SeatNo } from "./game";
import { handHistory } from "./history";
import { randomHex, sha256, shuffled, type Random } from "./rng";

export interface SeatState {
  name: string;
  /** SHA-256 of the seat's token */
  tokenHash: string;
  /** time bank left, ms */
  bank: number;
  score: number;
  ready: boolean;
  /** asked to leave during a hand: it's played out by the clock and the seat freed after it */
  leaving?: boolean;
}

export interface TableState {
  v: 1;
  createdAt: number;
  lastActive: number;
  rules: TableRules;
  seats: [SeatState | null, SeatState | null];
  /** the small blind (button) of the next hand */
  button: SeatNo;
  handNo: number;
  hand: Hand | null;
  /** each seat's history of the last finished hand */
  histories: [string, string] | null;
}

/** What a connection carries with it (a hibernated socket keeps it as its attachment). */
export interface ConnMeta {
  seat: SeatNo | null;
  /** the rate window's start and the messages in it */
  win: number;
  count: number;
}

export interface Conn {
  send(text: string): void;
  close(code: number, reason: string): void;
  meta(): ConnMeta;
  setMeta(m: ConnMeta): void;
}

export const freshMeta = (now: number): ConnMeta => ({ seat: null, win: now, count: 0 });

/** At most this many connections at once: two seats, and room for each to reconnect before its old socket's gone. */
export const MAX_CONNS = 4;

export function newTable(rules: TableRules, now: number): TableState {
  return { v: 1, createdAt: now, lastActive: now, rules, seats: [null, null], button: 0, handNo: 0, hand: null, histories: null };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A message as a page may send it, or null. */
export function parseMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  if (m.t === "join") {
    if (typeof m.name !== "string" || m.name.length > NAME_MAX * 4) return null;
    if (m.token !== undefined && (typeof m.token !== "string" || !SEAT_TOKEN.test(m.token))) return null;
    return { t: "join", name: m.name, ...(typeof m.token === "string" ? { token: m.token } : {}) };
  }
  if (m.t === "act") {
    if (!Number.isInteger(m.n) || !ACTIONS.includes(m.action as ArenaAction)) return null;
    if (m.to !== undefined && !(typeof m.to === "number" && Number.isFinite(m.to) && m.to > 0 && m.to < 1e6)) return null;
    return { t: "act", n: m.n as number, action: m.action as ArenaAction, ...(m.to !== undefined ? { to: m.to as number } : {}) };
  }
  if (m.t === "next" || m.t === "leave") return { t: m.t };
  return null;
}

export class Room {
  constructor(
    public state: TableState | null,
    private readonly conns: () => Conn[],
    private readonly random: Random,
  ) {}

  private seated(): Conn[] {
    return this.conns().filter((c) => c.meta().seat !== null);
  }

  private connected(s: SeatNo, except?: Conn): boolean {
    return this.conns().some((c) => c !== except && c.meta().seat === s);
  }

  private names(): [string, string] {
    const s = this.state!.seats;
    return [s[0]?.name ?? "Seat 1", s[1]?.name ?? "Seat 2"];
  }

  /** When the seat to act runs out of time, its bank included; null when nobody's to act. */
  deadline(): number | null {
    const st = this.state;
    const h = st?.hand;
    if (!st || !h || h.result || h.turnFrom === null) return null;
    const s = toActOf(h);
    if (s === null) return null;
    const seat = st.seats[s];
    if (!seat || seat.leaving) return h.turnFrom;
    return h.turnFrom + st.rules.clock * 1000 + seat.bank;
  }

  /** When the Durable Object should next wake: a deadline, or the table's idle check. */
  nextAlarm(): number | null {
    if (!this.state) return null;
    const d = this.deadline();
    const idle = this.state.lastActive + IDLE_MS;
    return d === null ? idle : Math.min(d, idle);
  }

  /** The seat to act spent `now - turnFrom`: anything past its clock comes off its bank. */
  private spend(s: SeatNo, now: number): void {
    const st = this.state!;
    const seat = st.seats[s];
    const h = st.hand;
    if (!seat || !h || h.turnFrom === null) return;
    const over = now - h.turnFrom - st.rules.clock * 1000;
    if (over > 0) seat.bank = Math.max(0, seat.bank - over);
  }

  /** Plays every decision whose time is up (one that's left the table at once). True where anything changed. */
  tick(now: number): boolean {
    let changed = false;
    for (let guard = 0; guard < 20; guard++) {
      const d = this.deadline();
      const h = this.state?.hand;
      if (!h || d === null || now < d) break;
      const s = toActOf(h)!;
      this.state!.seats[s]!.bank = this.state!.seats[s]!.leaving ? this.state!.seats[s]!.bank : 0;
      timeOut(h, now);
      changed = true;
      if (h.result) this.finished(now);
    }
    return changed;
  }

  /** After a hand ends: scores, both histories, and a seat that asked to leave is freed. */
  private finished(_now: number): void {
    const st = this.state!;
    const h = st.hand!;
    const names = this.names();
    st.seats.forEach((seat, i) => {
      if (seat) seat.score = Math.round((seat.score + h.result!.net[i]!) * 100) / 100;
    });
    st.histories = [handHistory(h, 0, names, st.createdAt), handHistory(h, 1, names, st.createdAt)];
    st.seats.forEach((seat, i) => {
      if (seat?.leaving) st.seats[i] = null;
    });
  }

  /** Deals the next hand where both seats are here and have asked for it. */
  private maybeDeal(now: number): void {
    const st = this.state!;
    if (st.hand && !st.hand.result) return;
    const [a, b] = st.seats;
    if (!a || !b || !a.ready || !b.ready || !this.connected(0) || !this.connected(1)) return;
    const first = st.handNo === 0;
    st.handNo++;
    for (const seat of [a, b]) {
      seat.ready = false;
      if (!first) seat.bank = Math.min(BANK_SECONDS * 1000, seat.bank + BANK_REFILL * 1000);
    }
    st.hand = deal(st.handNo, st.button, st.rules.stack, shuffled(this.random), now);
    st.button = other(st.button);
    st.histories = null;
    if (st.hand.result) this.finished(now);
  }

  /** The table as seat `s` sees it. */
  view(s: SeatNo, now: number): TableView {
    const st = this.state!;
    const seats = st.seats.map((seat, i) =>
      seat ? { name: seat.name, connected: this.connected(i as SeatNo), ready: seat.ready, bank: seat.bank, score: seat.score } : null,
    ) as TableView["seats"];
    return { t: "state", rules: st.rules, you: s, seats, hand: st.hand ? this.handView(st.hand, s) : null, now };
  }

  private handView(h: Hand, s: SeatNo): HandView {
    const st = this.state!;
    const t = setupOf(h);
    const sim = simOf(h);
    const me = posOf(h, s);
    const them: Pos = me === "SB" ? "BB" : "SB";
    const toAct = toActOf(h);
    const lg = toAct === s ? legal(t, sim) : null;
    const d = this.deadline();
    const r = h.result;
    return {
      n: h.n,
      pos: { SB: h.seatOf.SB, BB: h.seatOf.BB },
      cards: h.hole[me],
      // (the one place the other seat's cards can leave the server: only once they're face up)
      theirs: h.reveal ? h.hole[them] : null,
      board: h.board.slice(0, h.shown),
      lines: h.lines as HandView["lines"],
      bets: { SB: sim.cur?.bets.SB ?? 0, BB: sim.cur?.bets.BB ?? 0 },
      behind: { SB: behind(t, sim, "SB"), BB: behind(t, sim, "BB") },
      pot: Math.round(sim.pot * 100) / 100,
      toAct,
      deadline: d,
      bankFrom: d === null || h.turnFrom === null ? null : h.turnFrom + st.rules.clock * 1000,
      legal: lg ? { toCall: lg.toCall, canRaise: lg.canRaise, minTo: lg.minTo, allInTo: lg.allInTo, curBet: sim.cur?.curBet ?? 0 } : null,
      result: r
        ? {
            net: r.net,
            winners: r.winners,
            says: says(h, this.names()),
            history: st.histories?.[s] ?? "",
            ...(r.timedOut !== undefined ? { timedOut: r.timedOut } : {}),
          }
        : null,
    };
  }

  /** Sends each seated connection its own view of the table. */
  broadcast(now: number): void {
    if (!this.state) return;
    for (const c of this.seated()) this.send(c, this.view(c.meta().seat!, now));
  }

  private send(c: Conn, m: ServerMessage): void {
    try {
      c.send(JSON.stringify(m));
    } catch {
      // (a socket closing as it's written to: its close handler tidies up)
    }
  }

  private refuse(c: Conn, code: ErrorCode): false {
    this.send(c, { t: "error", code });
    return false;
  }

  /** One message from a connection. True where the table's state changed (to be stored, and everyone sent it). */
  async message(c: Conn, raw: string | ArrayBuffer, now: number): Promise<boolean> {
    if (!this.state) {
      this.refuse(c, "no_table");
      c.close(CLOSE.noTable, "no table");
      return false;
    }
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE) {
      c.close(CLOSE.abuse, "message too big");
      return false;
    }
    const meta = c.meta();
    if (now - meta.win >= MESSAGE_RATE.ms) {
      meta.win = now;
      meta.count = 0;
    }
    meta.count++;
    c.setMeta(meta);
    if (meta.count > 2 * MESSAGE_RATE.max) {
      c.close(CLOSE.abuse, "too many messages");
      return false;
    }
    if (meta.count > MESSAGE_RATE.max) return this.refuse(c, "slow_down");
    const m = parseMessage(raw);
    if (!m) return this.refuse(c, "bad_message");
    const ticked = this.tick(now);
    const handled = await this.handle(c, m, now);
    // (and after it: the move may hand the turn to a seat that's left, whose clock is already up)
    const changed = this.tick(now) || handled || ticked;
    if (changed) {
      this.state.lastActive = now;
      this.broadcast(now);
    }
    return changed;
  }

  private async handle(c: Conn, m: ClientMessage, now: number): Promise<boolean> {
    const st = this.state!;
    const meta = c.meta();
    if (m.t === "join") return this.join(c, m, now);
    const s = meta.seat;
    if (s === null || !st.seats[s]) return this.refuse(c, "not_seated");
    const seat = st.seats[s]!;
    if (m.t === "act") {
      const h = st.hand;
      if (!h || h.n !== m.n || h.result) return this.refuse(c, "stale");
      if (toActOf(h) !== s) return this.refuse(c, "not_your_turn");
      const at = now;
      this.spend(s, at);
      const r = act(h, s, m.to === undefined ? { action: m.action } : { action: m.action, to: m.to }, at);
      if (typeof r === "string") return this.refuse(c, r);
      if (h.result) this.finished(now);
      return true;
    }
    if (m.t === "next") {
      if (st.hand && !st.hand.result) return false;
      seat.ready = true;
      this.maybeDeal(now);
      return true;
    }
    // leave: between hands the seat is freed now; in a hand it's played out by the clock, then freed
    const h = st.hand;
    if (h && !h.result) {
      seat.leaving = true;
      this.tick(now);
    } else st.seats[s] = null;
    c.setMeta({ ...c.meta(), seat: null });
    c.close(CLOSE.left, "left");
    return true;
  }

  private async join(c: Conn, m: Extract<ClientMessage, { t: "join" }>, now: number): Promise<boolean> {
    const st = this.state!;
    const meta = c.meta();
    if (meta.seat !== null) return false;
    // a returning seat: its token, whatever name it sends
    if (m.token) {
      const hash = await sha256(m.token);
      const s = st.seats.findIndex((x) => x?.tokenHash === hash);
      if (s === 0 || s === 1) {
        const seat = st.seats[s]!;
        if (seat.leaving) delete seat.leaving;
        for (const old of this.conns()) if (old !== c && old.meta().seat === s) {
          old.setMeta({ ...old.meta(), seat: null });
          old.close(CLOSE.replaced, "opened elsewhere");
        }
        c.setMeta({ ...c.meta(), seat: s });
        this.send(c, { t: "seated", seat: s, token: m.token });
        this.maybeDeal(now);
        return true;
      }
    }
    const name0 = cleanName(m.name);
    if (!name0) return this.refuse(c, "bad_name");
    const free = st.seats.findIndex((x) => x === null);
    if (free !== 0 && free !== 1) {
      this.refuse(c, "full");
      c.close(CLOSE.full, "table full");
      return false;
    }
    const s = free as SeatNo;
    const otherName = st.seats[other(s)]?.name;
    // (two seats of one name would make a history that can't say who did what)
    const name = otherName?.toLowerCase() === name0.toLowerCase() ? `${name0.slice(0, NAME_MAX - 2)} 2` : name0;
    const token = randomHex(this.random);
    st.seats[s] = { name, tokenHash: await sha256(token), bank: BANK_SECONDS * 1000, score: 0, ready: st.handNo === 0 };
    c.setMeta({ ...c.meta(), seat: s });
    this.send(c, { t: "seated", seat: s, token });
    this.maybeDeal(now);
    return true;
  }

  /** A connection went away. True where anyone should be told (a seat's now shown as away). */
  closed(c: Conn): boolean {
    return c.meta().seat !== null;
  }

  /** The Durable Object's alarm: decisions out of time, and the table closed once it's been idle long enough.
   * Returns what to do with the stored state. */
  alarm(now: number): "save" | "expired" | "none" {
    if (!this.state) return "expired";
    if (now >= this.state.lastActive + IDLE_MS) {
      for (const c of this.conns()) c.close(CLOSE.expired, "table expired");
      this.state = null;
      return "expired";
    }
    if (this.tick(now)) {
      this.broadcast(now);
      return "save";
    }
    return "none";
  }
}
