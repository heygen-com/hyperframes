import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordInManifest, writtenAssets } from "./media-record.mjs";

const RESOLVE = join(import.meta.dirname, "../../../../../packages/cli/src/media-use/resolve.mjs");
const noBgm = { bgm: null, bgmFields: { bgm_pending: false } };

// Stands in for `npx hyperframes media-use resolve ...` by running the CLI's resolve script directly.
function runResolve(cmd, args, opts) {
  assert.equal(cmd, "npx");
  assert.deepEqual(args.slice(0, 3), ["hyperframes", "media-use", "resolve"]);
  const env = { ...process.env, DO_NOT_TRACK: "1" };
  const r = spawnSync(process.execPath, [RESOLVE, ...args.slice(3)], { ...opts, env });
  return Promise.resolve({ status: r.status });
}

test("a voice run leaves a manifest entry marked generated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-record-"));
  try {
    mkdirSync(join(dir, "assets/voice"), { recursive: true });
    writeFileSync(join(dir, "assets/voice/01.wav"), "fake wav");
    const assets = writtenAssets({
      only: new Set(["tts"]),
      lines: [{ id: "01", text: "Welcome to the launch" }],
      voices: [{ id: "01", path: "assets/voice/01.wav" }],
      sfx: [],
      ...noBgm,
    });

    assert.deepEqual(await recordInManifest(dir, assets, runResolve), []);

    const records = readFileSync(join(dir, ".media/manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map(({ path, type, source, description }) => ({ path, type, source, description })),
      [
        {
          path: "assets/voice/01.wav",
          type: "voice",
          source: "generated",
          description: "Welcome to the launch",
        },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("music and sound effects are marked by where they came from", () => {
  const assets = writtenAssets({
    only: new Set(["bgm", "sfx"]),
    lines: [],
    voices: [{ id: "01", path: "assets/voice/01.wav" }],
    bgm: { path: "assets/bgm/track.mp3", query: "calm" },
    bgmFields: { bgm_pending: false, bgm_mode: "retrieve" },
    sfx: [
      { file: "assets/sfx/whoosh.mp3", name: "whoosh", source: "local" },
      { file: "assets/sfx/whoosh.mp3", name: "whoosh", source: "local" },
      { file: "assets/sfx/glass.mp3", name: "glass", source: "heygen" },
    ],
  });

  assert.deepEqual(
    assets.map(({ path, source }) => [path, source]),
    [
      ["assets/bgm/track.mp3", "search"],
      ["assets/sfx/whoosh.mp3", "bundled"],
      ["assets/sfx/glass.mp3", "search"],
    ],
  );
});

test("music still being generated is left for wait-bgm to record", () => {
  const assets = writtenAssets({
    only: new Set(["bgm"]),
    lines: [],
    voices: [],
    sfx: [],
    bgm: { path: "assets/bgm/track.wav" },
    bgmFields: { bgm_pending: true, bgm_mode: "generate" },
  });

  assert.deepEqual(assets, []);
});

test("a file media-use could not record becomes an anomaly, not a failure", async () => {
  const anomalies = await recordInManifest(
    "/nowhere",
    [{ path: "assets/voice/01.wav", type: "voice", source: "generated" }],
    async () => ({ status: -1 }),
  );

  assert.deepEqual(anomalies, [
    "assets/voice/01.wav: not recorded in the media manifest (exit -1)",
  ]);
});
