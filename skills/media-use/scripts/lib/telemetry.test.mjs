import { strict as assert } from "node:assert";
import { test } from "node:test";
import { optedOut, track } from "./telemetry.mjs";

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
  const saved = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = "1";
  try {
    // must resolve immediately without throwing or hitting the network
    await track("media_use_resolve", { type: "bgm", source: "search" });
  } finally {
    if (saved === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = saved;
  }
});
