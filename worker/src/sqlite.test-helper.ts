// D1's calling shape over Node's SQLite, running the real schema. It isn't D1, so the first deployment still needs a live check.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db, Stmt } from "./env";

type Sqlite = { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown } } };

export function testDb(): Db {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite" as "fs") as unknown as Sqlite;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(join(__dirname, "../schema.sql"), "utf8"));
  const stmt = (sql: string, values: unknown[] = []): Stmt & { exec(): void } => ({
    bind: (...v) => stmt(sql, v),
    first: async <T>() => (raw.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...values) as T[] }),
    run: async () => raw.prepare(sql).run(...values),
    exec: () => void raw.prepare(sql).run(...values),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      raw.exec("BEGIN");
      try {
        for (const s of stmts) (s as ReturnType<typeof stmt>).exec();
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
