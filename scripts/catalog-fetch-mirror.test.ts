import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installFetchMirror } from "./catalog-fetch-mirror.ts";

function mirrorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-mirror-test-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.bin"), "font-bytes");
  const entry = { status: 200, contentType: "font/woff2", file: "a.bin" };
  writeFileSync(join(dir, "index.json"), JSON.stringify({ "https://fonts.example/a": entry }));
  return dir;
}

test("replay serves a mirrored url and restores fetch on finish", async () => {
  const realFetch = globalThis.fetch;
  const dir = mirrorDir();
  const mirror = installFetchMirror(dir, "replay");
  const response = await fetch("https://fonts.example/a");
  assert.equal(await response.text(), "font-bytes");
  mirror.assertNoMisses();
  mirror.finish();
  assert.equal(globalThis.fetch, realFetch);
  rmSync(dir, { recursive: true });
});

test("an unmirrored fetch fails and is still reported after the caller swallows the error", async () => {
  const dir = mirrorDir();
  const mirror = installFetchMirror(dir, "replay");
  await fetch("https://fonts.example/other").catch(() => undefined);
  assert.throws(() => mirror.assertNoMisses(), /https:\/\/fonts\.example\/other/);
  mirror.finish();
  rmSync(dir, { recursive: true });
});
