// What the Worker is given, and the small part of D1 it calls: named here so the tests can run the real schema on SQLite.
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Db {
  prepare(sql: string): Stmt;
  /** every statement or none */
  batch(stmts: Stmt[]): Promise<unknown>;
}
export interface Env {
  DB: Db;
  /** The Anthropic API key, a Worker secret the owner puts in (`npx wrangler@4 secret put ANTHROPIC_API_KEY`). Until it
   * exists every request is answered "not_configured". */
  ANTHROPIC_API_KEY?: string;
  /** https://www.michael-han.com: a request from anywhere else is refused (a soft signal: a non-browser client can forge it) */
  SITE_ORIGIN: string;
}
