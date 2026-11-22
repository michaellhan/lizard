// The small part of the Workers runtime this Worker uses, typed here rather than through @cloudflare/workers-types (whose
// globals clash with the DOM and WebWorker libraries the shared web/src code is checked against). The tests run on Node
// with "cloudflare:workers" pointed at a stand-in (src/test/cloudflare-workers.ts).

interface DoStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DoState {
  storage: DoStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  setWebSocketAutoResponse(pair?: unknown): void;
}

interface DoStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DoNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DoStub;
}

/** A hibernatable WebSocket's own state, kept across hibernation (at most 16 kB). */
interface WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

interface ResponseInit {
  webSocket?: WebSocket | null;
}

declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    protected ctx: DoState;
    protected env: Env;
    constructor(ctx: DoState, env: Env);
  }
}
