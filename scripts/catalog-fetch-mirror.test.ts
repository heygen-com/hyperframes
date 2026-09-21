import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installFetchMirror } from "./catalog-fetch-mirror.ts";

/** Runs `run` against a fresh record-mode mirror stubbed to answer every fetch with
 * `bodyBytes` bytes of `contentType`. `run` calls `mirror.finish()` itself if it needs
 * the written index; `fetch` and the temp dir are always restored/cleaned up after. */
async function withRecordMirror(
  contentType: string,
  bodyBytes: number,
  run: (dir: string, mirror: ReturnType<typeof installFetchMirror>) => Promise<void> | void,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "catalog-mirror-record-"));
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(bodyBytes), {
      status: 200,
      headers: { "content-type": contentType },
    })) as typeof fetch;
  const mirror = installFetchMirror(dir, "record");
  try {
    await run(dir, mirror);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true });
  }
}

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

test("record writes an allowed, small response to disk and indexes it", async () => {
  await withRecordMirror("text/css; charset=utf-8", 12, async (dir, mirror) => {
    const response = await fetch("https://cdn.example/a.css");
    assert.equal(response.status, 200);
    mirror.assertNoMisses();
    mirror.finish();
    const files = readdirSync(dir).filter((f) => f.endsWith(".bin"));
    assert.equal(files.length, 1);
    const [file] = files;
    assert.ok(file);
    assert.equal(readFileSync(join(dir, file)).length, 12);
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
    assert.equal(index["https://cdn.example/a.css"].file, file);
  });
});

/** A refused fetch reports as a miss and writes nothing, whatever the reason. */
async function assertRefused(
  url: string,
  dir: string,
  mirror: ReturnType<typeof installFetchMirror>,
  message: RegExp,
): Promise<void> {
  await fetch(url);
  assert.throws(() => mirror.assertNoMisses(), message);
  mirror.finish();
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.endsWith(".bin")),
    [],
  );
}

test("record refuses a content-type the generator does not expect", async () => {
  await withRecordMirror("application/octet-stream", 12, (dir, mirror) =>
    assertRefused(
      "https://cdn.example/a.bin",
      dir,
      mirror,
      /content-type application\/octet-stream is not mirrored/,
    ),
  );
});

test("record refuses a body over the mirror's size cap", async () => {
  await withRecordMirror("text/css", 8 * 1024 * 1024 + 1, (dir, mirror) =>
    assertRefused(
      "https://cdn.example/huge.css",
      dir,
      mirror,
      /exceeds the 8388608-byte mirror cap/,
    ),
  );
});
