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
  /** keys the hash an account is found by; a secret, so a copy of the table can't be tested against a list of addresses */
  EMAIL_HMAC_KEY: string;
  RESEND_API_KEY: string;
  /** https://www.michael-han.com: requests from anywhere else are refused */
  SITE_ORIGIN: string;
  /** Lizard <...@michael-han.com>, an address on the domain Resend has verified */
  MAIL_FROM: string;
}
