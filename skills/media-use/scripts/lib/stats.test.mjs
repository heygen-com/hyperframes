import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStats } from "./stats.mjs";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "mu-stats-"));
  const home = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  process.env.HOME = home;
  return { root, home, projectDir };
}

function restoreEnv(saved) {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

function seedManifest(dir, records) {
  mkdirSync(join(dir, ".media"), { recursive: true });
  writeFileSync(
    join(dir, ".media/manifest.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("buildStats aggregates resolves, misses, providers, sources, and reuse", () => {
  const savedEnv = { ...process.env };
  const { root, home, projectDir } = sandbox();
  try {
    seedManifest(projectDir, [
      {
        id: "bgm_001",
        type: "bgm",
        source: "search",
        ts: isoDaysAgo(0),
        provenance: { provider: "heygen.audio.sounds", prompt: "upbeat", via: "url" },
      },
      {
        id: "image_001",
        type: "image",
        _source: "reused-explicit",
        timestamp: isoDaysAgo(0),
        provenance: { provider: "local", reused_by: "agent" },
      },
      {
        id: "bgm_002",
        type: "bgm",
        source: "generated",
        provenance: { provider: "codex" },
      },
    ]);
    const cachedFile = join(home, ".media/mu-v1-cache/asset.wav");
    mkdirSync(join(cachedFile, ".."), { recursive: true });
    writeFileSync(cachedFile, "12345");
    seedManifest(home, [
      {
        id: "bgm_009",
        type: "bgm",
        reusable: true,
        cached_path: cachedFile,
        provenance: { provider: "heygen.audio.sounds", reused_by: "agent" },
      },
    ]);
    writeFileSync(
      join(home, ".media/misses.jsonl"),
      JSON.stringify({
        ts: isoDaysAgo(0),
        type: "bgm",
        intent: "dark cinematic riser",
      }) + "\n",
      { flag: "a" },
    );

    const stats = buildStats({ projectDir });
    assert.equal(stats.total_resolves, 3);
    assert.deepEqual(stats.by_type, { bgm: 2, image: 1 });
    assert.deepEqual(stats.by_source, { search: 1, "reused-explicit": 1, generated: 1 });
    assert.equal(stats.by_provider["heygen.audio.sounds"], 1);
    assert.equal(stats.by_via.url, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hit_rate, 0.75);
    assert.deepEqual(stats.top_missed_intents.bgm[0], {
      intent: "dark cinematic riser",
      count: 1,
    });
    assert.equal(stats.global_cache_assets, 1);
    assert.equal(stats.global_cache_disk_bytes, 5);
    assert.equal(stats.cross_project_reuse, 1);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStats returns a zeroed report when nothing exists", () => {
  const savedEnv = { ...process.env };
  const { root, projectDir } = sandbox();
  try {
    const stats = buildStats({ projectDir });
    assert.equal(stats.total_resolves, 0);
    assert.deepEqual(stats.by_type, {});
    assert.deepEqual(stats.by_source, {});
    assert.deepEqual(stats.by_provider, {});
    assert.deepEqual(stats.by_via, {});
    assert.equal(stats.misses, 0);
    assert.equal(stats.hit_rate, null);
    assert.deepEqual(stats.top_missed_intents, {});
    assert.equal(stats.global_cache_assets, 0);
    assert.equal(stats.global_cache_disk_bytes, 0);
    assert.equal(stats.cross_project_reuse, 0);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStats returns JSON-safe output", () => {
  const savedEnv = { ...process.env };
  const { root, projectDir } = sandbox();
  try {
    const stats = buildStats({ projectDir });
    assert.deepEqual(JSON.parse(JSON.stringify(stats)), stats);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStats applies days window to timestamped records and misses", () => {
  const savedEnv = { ...process.env };
  const { root, home, projectDir } = sandbox();
  try {
    seedManifest(projectDir, [
      { id: "bgm_old", type: "bgm", ts: isoDaysAgo(100), provenance: { provider: "old" } },
      { id: "bgm_new", type: "bgm", ts: isoDaysAgo(1), provenance: { provider: "new" } },
      { id: "image_untimed", type: "image", provenance: { provider: "none" } },
    ]);
    mkdirSync(join(home, ".media"), { recursive: true });
    writeFileSync(
      join(home, ".media/misses.jsonl"),
      [
        JSON.stringify({ ts: isoDaysAgo(100), type: "bgm", intent: "old miss" }),
        JSON.stringify({ ts: isoDaysAgo(1), type: "bgm", intent: "new miss" }),
      ].join("\n"),
    );

    const stats = buildStats({ projectDir, days: 7 });
    assert.equal(stats.total_resolves, 2);
    assert.deepEqual(stats.by_type, { bgm: 1, image: 1 });
    assert.equal(stats.misses, 1);
    assert.equal(stats.top_missed_intents.bgm[0].intent, "new miss");
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});
