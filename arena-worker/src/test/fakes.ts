// Stand-ins for the Durable Object runtime, for the tests on Node: storage in a Map, hibernatable sockets that record
// what they're sent, an Object namespace that keeps one instance per name, and a seeded randomness so a test can deal
// the cards it wants. Nothing here is used outside the tests.
import type { Conn, ConnMeta } from "../room";
import { freshMeta } from "../room";
import type { Random } from "../rng";
import type { ServerMessage, TableView } from "../../../web/src/features/arena/protocol";

export class FakeStorage implements DoStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  writes = 0;
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.writes++;
    this.data.set(key, structuredClone(value));
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
    this.alarm = null;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
  async setAlarm(at: number): Promise<void> {
    this.alarm = at;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** A server-side hibernatable socket: what it's sent, its attachment, and whether it's been closed. */
export class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  closedWith: { code: number; reason: string } | null = null;
  private attachment: unknown = null;
  send(text: string) {
    if (this.readyState !== 1) throw new Error("closed");
    this.sent.push(text);
  }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
  }
  serializeAttachment(v: unknown) {
    this.attachment = structuredClone(v);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  /** everything sent, parsed */
  messages(): ServerMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ServerMessage);
  }
  last(): TableView {
    const v = this.messages().filter((m): m is TableView => m.t === "state");
    return v[v.length - 1]!;
  }
}

export class FakeState implements DoState {
  storage = new FakeStorage();
  sockets: FakeSocket[] = [];
  pending: Promise<unknown> = Promise.resolve();
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const p = fn();
    this.pending = p;
    return p;
  }
  acceptWebSocket(ws: WebSocket): void {
    this.sockets.push(ws as unknown as FakeSocket);
  }
  getWebSockets(): WebSocket[] {
    return this.sockets.filter((s) => s.readyState !== 3) as unknown as WebSocket[];
  }
  setWebSocketAutoResponse(): void {}
}

/** The runtime's WebSocketPair, on Node: [client, server]. */
export function installWebSocketPair(): void {
  (globalThis as Record<string, unknown>).WebSocketPair = class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  };
}

/** A Room connection in memory (room.test.ts). */
export class FakeConn implements Conn {
  sock = new FakeSocket();
  private m: ConnMeta;
  constructor(now = 0) {
    this.m = freshMeta(now);
  }
  send(text: string) {
    this.sock.send(text);
  }
  close(code: number, reason: string) {
    this.sock.close(code, reason);
  }
  meta() {
    return { ...this.m };
  }
  setMeta(m: ConnMeta) {
    this.m = { ...m };
  }
  get open() {
    return this.sock.readyState === 1;
  }
}

/** Randomness from a seed (xorshift), so a test's deck is the same every run: not for anything real. */
export function seededRandom(seed = 1): Random {
  let x = seed >>> 0 || 1;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      bytes[i] = x & 0xff;
    }
  };
}

/** Randomness that makes `shuffled` return `deck` (its first cards; the rest follow in DECK order). Fisher-Yates from the
 * top swaps position i with below(i+1): this feeds, for each i, the draw that brings the wanted card there. */
export function riggedRandom(top: readonly string[], full: readonly string[]): Random {
  const want = [...top, ...full.filter((c) => !top.includes(c))];
  // simulate the shuffle, choosing each j so that deck[i] ends up as want[i]
  const deck = [...full];
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.indexOf(want[i]!);
    draws.push(j);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  let k = 0;
  let other = 0;
  return (bytes) => {
    // (a token's or an id's bytes: different each time, and no draw of the shuffle used up)
    if (bytes.length !== 4) {
      other++;
      for (let i = 0; i < bytes.length; i++) bytes[i] = (other * 31 + i * 7) & 0xff;
      return;
    }
    const j = draws[k++ % draws.length]!;
    bytes[0] = (j >>> 24) & 0xff;
    bytes[1] = (j >>> 16) & 0xff;
    bytes[2] = (j >>> 8) & 0xff;
    bytes[3] = j & 0xff;
    for (let i = 4; i < bytes.length; i++) bytes[i] = 0;
  };
}
