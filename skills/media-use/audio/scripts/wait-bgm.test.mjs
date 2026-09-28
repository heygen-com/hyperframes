import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./wait-bgm.mjs", import.meta.url), "utf8");
const start = source.indexOf("function readTail(");
const end = source.indexOf("\nfunction detectFailure(", start);
function load(read) {
  return runInNewContext(`${source.slice(start, end)}; readTail`, {
    readFileSync: read,
    existsSync: () => true,
    statSync: () => {
      throw new Error("pathname stat must not precede log read");
    },
  });
}

test("reads a log once without a separate pathname check", () => {
  let calls = 0;
  const read = load((path, encoding) => {
    calls++;
    assert.equal(path, "renderer.log");
    assert.equal(encoding, "utf8");
    return "prefix\nRuntimeError: failed";
  });
  assert.equal(read("renderer.log", 20), "RuntimeError: failed");
  assert.equal(calls, 1);
});

test("preserves UTF-16 character tail boundaries and zero-length tails", () => {
  const txt = "🎵日本語".repeat(2000);
  const read = load(() => txt);
  assert.equal(read("log"), txt.slice(-6000));
  assert.equal(read("log", 0), "");
});

for (const code of ["ENOENT", "ENOTDIR"]) {
  test(`a log removed during polling is absent (${code})`, () => {
    const read = load(() => {
      throw Object.assign(new Error(code), { code });
    });
    assert.equal(read("log"), "");
  });
}

test("preserves unexpected read errors", () => {
  const error = Object.assign(new Error("denied"), { code: "EACCES" });
  assert.throws(
    () =>
      load(() => {
        throw error;
      })("log"),
    (caught) => caught === error,
  );
});

test("empty log path does not access the filesystem", () => {
  assert.equal(
    load(() => {
      throw new Error("unexpected read");
    })(""),
    "",
  );
});

test("records locally made music as generated once it is ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-wait-bgm-"));
  try {
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, "assets/bgm/track.wav"), "generated music");
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({
        bgm: { path: "assets/bgm/track.wav" },
        bgm_pending: true,
        bgm_provider: "musicgen",
        bgm_mode: "detached-single",
      }),
    );
    const script = new URL("./wait-bgm.mjs", import.meta.url).pathname;
    const args = ["--audio-meta", join(dir, "audio_meta.json"), "--hyperframes", dir];

    const run = spawnSync(process.execPath, [script, ...args, "--timeout-ms", "1000"], {
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr);
    const records = readFileSync(join(dir, ".media/manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map(({ path, type, source, provenance }) => [path, type, source, provenance.provider]),
      [["assets/bgm/track.wav", "bgm", "generated", "musicgen"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
