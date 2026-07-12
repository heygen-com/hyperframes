import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __anonymousIdForTest, __resetTelemetryForTest, optedOut, track } from "./telemetry.mjs";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "mu-telemetry-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  return { root, home };
}

function restoreEnv(saved) {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

function withoutTelemetryOptOut() {
  for (const k of ["DO_NOT_TRACK", "HYPERFRAMES_NO_TELEMETRY", "CI", "NODE_ENV"])
    delete process.env[k];
}

function parseFetchBodies(calls) {
  return calls.flatMap((call) => JSON.parse(call.options.body).batch);
}

test("optedOut respects DO_NOT_TRACK / HYPERFRAMES_NO_TELEMETRY / CI", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["DO_NOT_TRACK", "HYPERFRAMES_NO_TELEMETRY", "CI", "NODE_ENV"])
      delete process.env[k];
    assert.equal(optedOut(), false, "default: tracking allowed");
    process.env.DO_NOT_TRACK = "1";
    assert.equal(optedOut(), true, "DO_NOT_TRACK opts out");
    delete process.env.DO_NOT_TRACK;
    process.env.HYPERFRAMES_NO_TELEMETRY = "1";
    assert.equal(optedOut(), true, "HYPERFRAMES_NO_TELEMETRY opts out");
    delete process.env.HYPERFRAMES_NO_TELEMETRY;
    process.env.CI = "true";
    assert.equal(optedOut(), true, "CI opts out");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("track is a no-op (no network, resolves) when opted out", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const { root, home } = sandbox();
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true };
  };
  process.env.DO_NOT_TRACK = "1";
  try {
    // must resolve immediately without throwing or hitting the network
    await track("media_use_resolve", { type: "bgm", source: "search" });
    assert.equal(calls.length, 0);
    assert.equal(existsSync(join(home, ".hyperframes/config.json")), false);
    assert.equal(existsSync(join(home, ".media/telemetry-notice-shown")), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("anonymous id uses the shared hyperframes config", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    withoutTelemetryOptOut();
    mkdirSync(join(home, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(home, ".hyperframes/config.json"),
      JSON.stringify({ anonymousId: "shared-install-id", keep: true }),
    );
    mkdirSync(join(home, ".media"), { recursive: true });
    writeFileSync(join(home, ".media/anon-id"), "old-media-id");

    assert.equal(__anonymousIdForTest(), "shared-install-id");
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("anonymous id seeds missing config once and reuses it", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    withoutTelemetryOptOut();
    const first = __anonymousIdForTest();
    const configPath = join(home, ".hyperframes/config.json");
    assert.ok(existsSync(configPath));
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const second = __anonymousIdForTest();
    assert.equal(second, first);
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).anonymousId, first);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("anonymous id adopts a legacy ~/.media/anon-id on upgrade (persona continuity)", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    withoutTelemetryOptOut();
    mkdirSync(join(home, ".media"), { recursive: true });
    writeFileSync(join(home, ".media/anon-id"), "legacy-media-id");
    // no ~/.hyperframes/config.json yet — the old media-use-only id must carry over
    assert.equal(__anonymousIdForTest(), "legacy-media-id");
    // and it is persisted into the shared config so CLI/studio see the same id
    assert.equal(
      JSON.parse(readFileSync(join(home, ".hyperframes/config.json"), "utf8")).anonymousId,
      "legacy-media-id",
    );
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("track identifies a signed-in HeyGen account once and still sends events", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const { root, home } = sandbox();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };
  try {
    withoutTelemetryOptOut();
    mkdirSync(join(home, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(home, ".hyperframes/config.json"),
      JSON.stringify({ anonymousId: "anon-1" }),
    );
    mkdirSync(join(home, ".heygen"), { recursive: true });
    writeFileSync(
      join(home, ".heygen/credentials"),
      JSON.stringify({ user: { email: "alice@example.com", username: "alice" } }),
    );

    await track("media_use_resolve", { type: "bgm", source: "search" });
    await track("media_use_resolve", { type: "image", source: "generated" });

    const batch = parseFetchBodies(calls);
    const identify = batch.filter((item) => item.event === "$identify");
    assert.equal(identify.length, 1);
    assert.equal(identify[0].distinct_id, "alice@example.com");
    assert.equal(identify[0].properties.$anon_distinct_id, "anon-1");
    assert.equal(batch.filter((item) => item.event === "media_use_resolve").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("track identifies with a lowercased email regardless of stored casing", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const { root, home } = sandbox();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };
  try {
    withoutTelemetryOptOut();
    mkdirSync(join(home, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(home, ".hyperframes/config.json"),
      JSON.stringify({ anonymousId: "anon-3" }),
    );
    mkdirSync(join(home, ".heygen"), { recursive: true });
    writeFileSync(
      join(home, ".heygen/credentials"),
      JSON.stringify({ user: { email: "Alice@Example.com", username: "alice" } }),
    );

    await track("media_use_resolve", { type: "bgm", source: "search" });

    const batch = parseFetchBodies(calls);
    const identify = batch.filter((item) => item.event === "$identify");
    assert.equal(identify.length, 1);
    // Lowercased so this joins with heygen-cli's own identify call regardless
    // of the account's stored email casing -- otherwise the same person could
    // split into two PostHog profiles by email case alone.
    assert.equal(identify[0].distinct_id, "alice@example.com");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("track does not identify when signed out", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const { root, home } = sandbox();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };
  try {
    withoutTelemetryOptOut();
    mkdirSync(join(home, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(home, ".hyperframes/config.json"),
      JSON.stringify({ anonymousId: "anon-2" }),
    );

    await track("media_use_resolve", { type: "bgm", source: "search" });

    const batch = parseFetchBodies(calls);
    assert.equal(
      batch.some((item) => item.event === "$identify"),
      false,
    );
    assert.equal(batch[0].event, "media_use_resolve");
    assert.equal(batch[0].distinct_id, "anon-2");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("first run notice prints to stderr once and never stdout", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const { root, home } = sandbox();
  const stderr = [];
  const stdout = [];
  globalThis.fetch = async () => ({ ok: true });
  console.error = (...args) => stderr.push(args.join(" "));
  console.log = (...args) => stdout.push(args.join(" "));
  try {
    withoutTelemetryOptOut();
    await track("media_use_resolve", { type: "bgm" });
    await track("media_use_resolve", { type: "sfx" });

    assert.equal(stderr.length, 1);
    assert.match(stderr[0], /media-use sends usage telemetry/);
    assert.equal(stdout.length, 0);
    // notice-shown lives in the shared config (config.telemetryNoticeShown), so
    // the CLI and media-use show it once per person — not a media-use-only marker.
    assert.equal(
      JSON.parse(readFileSync(join(home, ".hyperframes/config.json"), "utf8")).telemetryNoticeShown,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("warns once on stderr when MEDIA_USE_TELEMETRY_HOST is set outside a test/CI context", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const { root } = sandbox();
  const stderr = [];
  globalThis.fetch = async () => ({ ok: true });
  console.error = (...args) => stderr.push(args.join(" "));
  try {
    // No opt-out, no CI/NODE_ENV signal — mirrors a real user's shell where
    // this test-only var leaked in by accident and tracking is not disabled.
    withoutTelemetryOptOut();
    process.env.MEDIA_USE_TELEMETRY_HOST = "http://127.0.0.1:1"; // nothing listens; irrelevant here
    await track("media_use_resolve", { type: "bgm" });
    await track("media_use_resolve", { type: "bgm" });

    const warnings = stderr.filter((line) => line.includes("MEDIA_USE_TELEMETRY_HOST"));
    assert.equal(warnings.length, 1, "expected exactly one warning across repeated calls");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("does not warn when MEDIA_USE_TELEMETRY_HOST is set the way the U7 interception test sets it", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const { root } = sandbox();
  const stderr = [];
  globalThis.fetch = async () => ({ ok: true });
  console.error = (...args) => stderr.push(args.join(" "));
  try {
    withoutTelemetryOptOut();
    // Same env shape resolve.test.mjs's U7 test uses to allow tracking through:
    // DO_NOT_TRACK=0, CI unset/empty, NODE_ENV=test.
    process.env.DO_NOT_TRACK = "0";
    process.env.CI = "";
    process.env.NODE_ENV = "test";
    process.env.MEDIA_USE_TELEMETRY_HOST = "http://127.0.0.1:1";
    await track("media_use_resolve", { type: "bgm" });

    assert.equal(
      stderr.some((line) => line.includes("MEDIA_USE_TELEMETRY_HOST")),
      false,
      "the U7 test's own use of the override must not print a spurious warning",
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});

test("read-only telemetry state degrades without throwing", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const { root, home } = sandbox();
  globalThis.fetch = async () => ({ ok: true });
  try {
    withoutTelemetryOptOut();
    writeFileSync(join(home, ".hyperframes"), "not a directory");
    writeFileSync(join(home, ".media"), "not a directory");
    await track("media_use_resolve", { type: "bgm" });
  } finally {
    globalThis.fetch = originalFetch;
    try {
      chmodSync(join(home, ".hyperframes"), 0o600);
    } catch {
      // best effort for cleanup on platforms with different chmod behavior
    }
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
    __resetTelemetryForTest();
  }
});
