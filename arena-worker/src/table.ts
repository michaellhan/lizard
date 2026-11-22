// One table's Durable Object (SQLite-backed, which the Workers free plan allows). It holds the table's state (room.ts)
// in storage, written after every change, and its players' WebSockets through the hibernation API, so an idle table costs
// no running time: the Object sleeps between messages and wakes with its sockets and their attachments. One alarm at a
// time: the next decision's deadline, or the idle check that closes and forgets the table.
import { DurableObject } from "cloudflare:workers";
import type { TableRules } from "../../web/src/features/arena/protocol";
import type { Env } from "./env";
import { json } from "./http";
import { cryptoRandom, type Random } from "./rng";
import { freshMeta, MAX_CONNS, newTable, Room, type Conn, type ConnMeta, type TableState } from "./room";

const KEY = "table";

/** A hibernatable WebSocket as a Room connection: its meta is the socket's attachment. */
function connOf(ws: WebSocket): Conn {
  return {
    send: (text) => ws.send(text),
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        // (already closed)
      }
    },
    meta: () => (ws.deserializeAttachment() as ConnMeta | null) ?? freshMeta(Date.now()),
    setMeta: (m) => ws.serializeAttachment(m),
  };
}

export class ArenaTable extends DurableObject<Env> {
  private room!: Room;
  private alarmAt: number | null = null;
  /** sockets closing now, left out of everything sent */
  private gone = new Set<WebSocket>();
  /** a test's clock and randomness */
  protected now: () => number = () => Date.now();
  protected random: Random = cryptoRandom;

  constructor(ctx: DoState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const state = (await ctx.storage.get<TableState>(KEY)) ?? null;
      this.room = new Room(state, () => this.sockets().map(connOf), (b) => this.random(b));
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.gone.has(ws) && ws.readyState === 1);
  }

  /** Stores the state (or forgets the table) and moves the alarm to when it's next needed. */
  private async save(): Promise<void> {
    if (!this.room.state) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.alarmAt = null;
      return;
    }
    await this.ctx.storage.put(KEY, this.room.state);
    await this.syncAlarm();
  }

  private async syncAlarm(): Promise<void> {
    const next = this.room.nextAlarm();
    if (next !== this.alarmAt) {
      if (next === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(next);
      this.alarmAt = next;
    }
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/init" && req.method === "POST") {
      // (the id is 128 random bits, so a clash is a bug, not bad luck: refused rather than overwritten)
      if (this.room.state) return json({ error: "exists" }, 409);
      this.room.state = newTable((await req.json()) as TableRules, this.now());
      await this.save();
      return json({ ok: true }, 201);
    }
    if (path === "/ws") {
      // (an id nobody made, or a table that expired: no socket, and nothing stored)
      if (!this.room.state) return json({ error: "no_table" }, 404);
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "upgrade" }, 426);
      if (this.sockets().length >= MAX_CONNS) return json({ error: "full" }, 429);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(freshMeta(this.now()));
      return this.upgraded(client);
    }
    return json({ error: "not_found" }, 404);
  }

  /** The 101 answer that hands the page its socket (a test on Node, whose Response has no 101, stands in for it). */
  protected upgraded(client: WebSocket): Response {
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (await this.room.message(connOf(ws), message, this.now())) await this.save();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // (kept in `gone` for as long as this instance lives: the runtime may list a closing socket for a moment)
    this.gone.add(ws);
    const told = this.room.closed(connOf(ws));
    connOf(ws).close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, reason);
    if (told) this.room.broadcast(this.now());
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, "error");
  }

  async alarm(): Promise<void> {
    this.alarmAt = null;
    const what = this.room.alarm(this.now());
    if (what === "none") await this.syncAlarm();
    else await this.save();
  }
}
