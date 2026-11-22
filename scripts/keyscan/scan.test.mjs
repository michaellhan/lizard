// The build's secret check: what it catches, what it lets through, and that it reads a directory as postbuild.mjs gives it.
// The key-shaped strings here are made up at run time, so this file itself holds none.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keysIn, scanDir } from "./scan.mjs";

const fake = (prefix, n, ch = "x") => prefix + ch.repeat(n);

test("catches each kind of key, and the marks of a direct browser call", () => {
  assert.deepEqual(keysIn(`const k="${fake("sk-ant-api03-", 40)}"`), ["Anthropic API key"]);
  assert.deepEqual(keysIn(fake("sk-", 48, "A")), ["OpenAI-style secret key"]);
  assert.deepEqual(keysIn(fake("AKIA", 16, "Q")), ["AWS access key id"]);
  assert.deepEqual(keysIn(fake("ghp_", 36, "a")), ["GitHub token"]);
  assert.deepEqual(keysIn(fake("AIza", 35, "b")), ["Google API key"]);
  assert.deepEqual(keysIn(`-----BEGIN ${"PRIVATE"} KEY-----`), ["private key"]);
  assert.deepEqual(keysIn(`localStorage.getItem("gto-anthropic" + "-key")`.replace('" + "', "")), ["the classic app's stored Anthropic key"]);
  assert.deepEqual(keysIn(`{"anthropic-dangerous-direct-browser-access":"true"}`), ["a direct browser call to Anthropic"]);
});

test("lets ordinary code through", () => {
  assert.deepEqual(keysIn('fetch("/lizard/api/explain",{headers:{"x-lizard":"1"}}); const task="sk-learn"; const hash="a3f9"'), []);
});

test("reads every text file under a directory, and skips binaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "lizard-scan-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<p>fine</p>");
  writeFileSync(join(dir, "assets", "page.js"), `x="${fake("sk-ant-api03-", 30)}"`);
  writeFileSync(join(dir, "assets", "blob.wasm"), fake("sk-ant-api03-", 30));
  assert.deepEqual(scanDir(dir), [join("assets", "page.js") + ": Anthropic API key"]);
});
