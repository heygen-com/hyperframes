import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listTypes, getProviders } from "./registry.mjs";
import { CAPABILITIES, listModels } from "./local-models.mjs";

// Capstone: media-use must actually OWN each hyperframes media weakness. This
// test enforces the weakness→owner matrix in references/meta.md so a claim can't rot — if
// a capability's entrypoint disappears, this fails.

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("weakness: audio-only → media-use resolves image + icon", () => {
  for (const t of ["image", "icon"]) {
    assert.ok(getProviders(t).length > 0, `no provider for ${t}`);
  }
});

test("weakness: no third-party brand logos → media-use resolves logo", () => {
  assert.ok(listTypes().includes("logo"), "logo type missing");
  assert.ok(getProviders("logo").length >= 4, "logo cascade incomplete");
});

test("weakness: no voice/audio gen → media-use exposes voice + the audio engine", () => {
  assert.ok(listTypes().includes("voice"), "voice type missing");
  assert.ok(getProviders("voice").length > 0, "no enabled voice provider (Bin approved)");
  assert.ok(existsSync(join(SKILL, "audio", "scripts", "audio.mjs")), "audio engine missing");
});

test("weakness: scattered audio engine → consolidated under media-use (hyperframes-media gone)", () => {
  assert.ok(existsSync(join(SKILL, "audio", "scripts", "lib", "tts.mjs")), "tts engine missing");
  assert.ok(
    existsSync(join(SKILL, "audio", "assets", "sfx", "manifest.json")),
    "bundled SFX missing",
  );
});

test("weakness: no media-ops → ops guidance reference exists", () => {
  assert.ok(existsSync(join(SKILL, "references", "operations.md")), "operations.md missing");
});

test("weakness: no transcript-driven cutting → cut compiler entrypoints exist", async () => {
  assert.ok(existsSync(join(SKILL, "scripts", "transcript-cut.mjs")), "transcript-cut missing");
  assert.ok(existsSync(join(SKILL, "scripts", "lib", "cutlist.mjs")), "cutlist lib missing");
  const cutlist = await import("./cutlist.mjs");
  assert.equal(typeof cutlist.compileCutList, "function");
});

test("weakness: whisper.cpp is weak → better local ASR (Parakeet) entrypoint exists", async () => {
  assert.ok(existsSync(join(SKILL, "scripts", "transcribe.mjs")), "transcribe.mjs missing");
  const pw = await import("./parakeet-words.mjs");
  assert.equal(typeof pw.mergeTokensToWords, "function", "token->word merge missing");
  const lm = await import("./local-models.mjs");
  const asr = lm.listModels("asr");
  const parakeet = asr.find((m) => m.id === "parakeet-mlx");
  assert.ok(parakeet && parakeet.rank === 0, "Parakeet must be the rank-0 preferred ASR");
});

test("weakness: no auto-duck/loudness → duck compiler and recipes exist", async () => {
  assert.ok(existsSync(join(SKILL, "scripts", "audio-duck.mjs")), "audio-duck missing");
  assert.ok(existsSync(join(SKILL, "scripts", "lib", "duck.mjs")), "duck lib missing");
  assert.ok(existsSync(join(SKILL, "references", "operations.md")), "operations.md missing");
  const duck = await import("./duck.mjs");
  assert.equal(typeof duck.speechSpans, "function");
  assert.equal(typeof duck.duckKeyframes, "function");
});

test("weakness: no cross-project memory → global cache + ingest entrypoints exist", async () => {
  const cache = await import("./cache.mjs");
  assert.equal(typeof cache.cachePut, "function");
  assert.equal(typeof cache.promote, "function");
  assert.equal(typeof cache.globalMediaDir, "function");
  const freeze = await import("./freeze.mjs");
  assert.equal(typeof freeze.isDirectMediaUrl, "function", "ingest URL guard missing");
});

// Wenbo (06-29): heygen free-usage is the default; local models are the opt-out
// fallback ("if user no, then local"). We still assert the fallback table is
// populated so the opt-out path stays real.
test("weakness: weak local defaults → local models exist as the opt-out fallback (tts/asr/upscale)", () => {
  for (const cap of ["tts", "asr", "upscale"]) {
    assert.ok(CAPABILITIES.includes(cap), `capability ${cap} missing`);
    assert.ok(listModels(cap).length > 0, `no local models for ${cap}`);
  }
});

test("weakness: no image generation → local mflux (RAM-graded) + codex upsell", async () => {
  const ps = getProviders("image");
  assert.ok(
    ps.some((p) => p.name === "mflux.local" && typeof p.generate === "function"),
    "local image gen missing",
  );
  assert.ok(
    ps.some((p) => p.name === "codex.image_gen" && typeof p.generate === "function"),
    "codex image upsell missing",
  );
  const lm = await import("./local-models.mjs");
  assert.ok(lm.CAPABILITIES.includes("imagegen"), "imagegen capability missing");
  assert.ok(lm.listModels("imagegen").length >= 3, "imagegen RAM ladder too small");
  assert.equal(typeof lm.describeModelLadder, "function", "agent-facing ladder missing");
});

test("weakness: no video generation → local videogen ladder + heygen avatar upsell", async () => {
  const lm = await import("./local-models.mjs");
  assert.ok(lm.CAPABILITIES.includes("videogen"), "videogen capability missing");
  assert.ok(lm.listModels("videogen").length >= 2, "videogen ladder too small");
  const ops = existsSync(join(SKILL, "references", "operations.md"));
  assert.ok(ops, "operations.md (avatar-upsell recipe) missing");
});

test("every resolve type has at least one enabled provider", () => {
  for (const t of listTypes()) {
    assert.ok(getProviders(t).length > 0, `type ${t} has no enabled provider`);
  }
});
