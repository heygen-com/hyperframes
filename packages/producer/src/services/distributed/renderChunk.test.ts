/**
 * Unit tests for `services/distributed/renderChunk.ts`.
 *
 * The byte-identical-retry contract is the load-bearing
 * test here: rendering the same `(planDir, chunkIndex)` twice must produce
 * a byte-identical output file. Without this, Temporal/Step-Functions
 * retries can't safely overwrite a partial chunk — and the entire
 * fan-out activity has to fall back to "renderer doesn't retry".
 *
 * The test:
 *   1. Spins a fresh planDir via `plan()` (cheap: the fixture sets
 *      `data-duration` so the probe stage never launches a browser).
 *   2. Renders chunk 0 into two distinct temp paths via `renderChunk()`.
 *   3. Asserts file bytes match exactly.
 *
 * Skipped (with a clear log message) when Chrome-headless-shell isn't
 * available on the host — CI runs the real check inside `Dockerfile.test`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_CHROME_FAILURE_PATTERNS } from "./__test_utils__/hostChromeFailures.js";
import { plan } from "./plan.js";
import {
  CHUNK_INDEX_OUT_OF_RANGE,
  MISSING_PLAN_ARTIFACT,
  MISSING_RUNTIME_ENV_SNAPSHOT,
  PLAN_HASH_MISMATCH,
  renderChunk,
  RenderChunkValidationError,
  resolveLockedVp9CpuUsed,
  resolvePresetForLockedEncoder,
} from "./renderChunk.js";

// Tiny fixture: 5 frames at 30fps. Captures finish in a few seconds on the
// CI host, and 5 frames is enough to stress the chunk-boundary IDR + GOP
// encoder args without grinding the test suite.
const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>renderChunk fixture</title></head>
<body style="margin:0;background:#000;color:#fff;font:32px sans-serif">
  <div data-composition-id="root" data-width="160" data-height="120" data-duration="0.16667">
    <p style="padding:1rem">chunk fixture</p>
  </div>
</body>
</html>`;

let runRoot: string;
let projectDir: string;
let planDir: string;
let hasChrome = false;

beforeAll(async () => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-renderchunk-test-"));
  projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");

  // Smoke-test whether chrome-headless-shell on this host can actually
  // render a frame. Many dev/CI hosts ship a chrome-headless-shell whose
  // GL stack can't initialize (`gl_factory.cc` errors out on
  // `--use-gl=swiftshader`), which makes the BeginFrame capture loop
  // hang for the full protocolTimeout. Detect that up front and soft-skip
  // the byte-identical test; the Docker harness is where the determinism
  // contract is exercised.
  try {
    const { createCaptureSession, initializeSession, closeCaptureSession } =
      await import("@hyperframes/engine");
    const { createFileServer } = await import("../fileServer.js");
    const smokeDir = join(runRoot, "smoke");
    mkdirSync(join(smokeDir, "compiled"), { recursive: true });
    writeFileSync(join(smokeDir, "compiled", "index.html"), FIXTURE_HTML, "utf-8");
    const fs = await createFileServer({
      projectDir: join(smokeDir, "compiled"),
      compiledDir: join(smokeDir, "compiled"),
      port: 0,
    });
    try {
      const framesDir = join(smokeDir, "frames");
      mkdirSync(framesDir, { recursive: true });
      const session = await createCaptureSession(
        fs.url,
        framesDir,
        {
          width: 160,
          height: 120,
          fps: { num: 30, den: 1 },
          format: "jpeg",
          quality: 80,
        },
        null,
        { browserGpuMode: "software" } as Parameters<typeof createCaptureSession>[4],
      );
      try {
        // Wrap initializeSession in a short timeout — beginFrame failures
        // hang for protocolTimeout (5 min) by default.
        const initPromise = initializeSession(session);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("smoke init timed out")), 15_000),
        );
        await Promise.race([initPromise, timeoutPromise]);
        hasChrome = true;
      } finally {
        await closeCaptureSession(session).catch(() => {});
      }
    } finally {
      fs.close();
    }
  } catch (err) {
    console.warn(
      "[renderChunk.test] chrome-headless-shell smoke test failed — byte-identical retry test will soft-skip. ",
      "Diagnostic:",
      (err instanceof Error ? err.message : String(err)).slice(0, 240),
    );
    hasChrome = false;
  }

  if (!hasChrome) return;

  // Plan once for all chunk tests. The planDir is sufficiently small that
  // re-creating it per test would just slow things down.
  //
  // Format is `png-sequence` (not `mp4`) so the chunk capture path runs in
  // screenshot mode rather than BeginFrame. Most chrome-headless-shell
  // builds (including the one this dev box ships) can render in
  // screenshot mode without GL initialization, while BeginFrame requires
  // a working SwiftShader + Vulkan stack that some hosts lack. The
  // byte-identical-retry contract is the same in either capture
  // mode, so the test still pins the determinism axis — and the Docker
  // harness exercises both modes against a full chrome-headless-shell
  // build inside `Dockerfile.test`.
  planDir = join(runRoot, "plan");
  mkdirSync(planDir, { recursive: true });
  await plan(projectDir, { fps: 30, width: 160, height: 120, format: "png-sequence" }, planDir);
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

describe("renderChunk()", () => {
  // 60s ceiling absorbs Chrome cold-start + 5-frame capture + ffmpeg encode
  // on slower CI workers.
  const TIMEOUT_MS = 60_000;

  it(
    "produces a byte-identical chunk on a second invocation (byte-identical-retry contract)",
    async () => {
      if (!hasChrome) {
        // Soft skip — Docker harness covers the real assertion.
        console.warn(
          "[renderChunk.test] skipping byte-identical retry test — chrome-headless-shell not available on this host",
        );
        return;
      }

      // chrome-headless-shell on some hosts cannot navigate to `chrome://gpu`
      // (the URL returns an empty HTML document, and Puppeteer surfaces the
      // network probe as `net::ERR_FAILED`). The byte-identical assertion
      // needs a real renderChunk pass, which requires `assertSwiftShader`
      // to succeed. On hosts where that probe is unsupported, we soft-skip
      // and rely on the Docker harness — the same code path is exercised
      // there against an image where chrome://gpu works.
      const outA = join(runRoot, "chunk-a");
      const outB = join(runRoot, "chunk-b");
      let a, b;
      try {
        a = await renderChunk(planDir, 0, outA);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
          console.warn(
            "[renderChunk.test] skipping byte-identical retry test — host Chrome stack can't render. ",
            "Docker harness covers the determinism contract. Diagnostic:",
            message.slice(0, 240),
          );
          return;
        }
        throw err;
      }
      b = await renderChunk(planDir, 0, outB);

      // png-sequence chunks produce a directory of frames, not a single file.
      expect(a.outputKind).toBe("frame-dir");
      expect(b.outputKind).toBe("frame-dir");
      expect(a.framesEncoded).toBeGreaterThan(0);
      expect(b.framesEncoded).toBe(a.framesEncoded);

      // The sha256 fingerprint must match (byte-identical-retry contract).
      // For frame-dir output the fingerprint hashes the sorted list of
      // `(name, sha256)` pairs, so two byte-identical chunks have the same
      // fingerprint without us having to compare each PNG separately.
      expect(a.sha256).toBe(b.sha256);

      // Stage perf split: the timers must be populated and bounded by the
      // chunk's total wall time (they partition `durationMs` alongside
      // validation/file-server/hash overhead).
      expect(a.planHashMs).toBeGreaterThanOrEqual(0);
      expect(a.sessionBootMs).toBeGreaterThanOrEqual(0);
      expect(a.captureStageMs).toBeGreaterThan(0);
      expect(a.encodeStageMs).toBeGreaterThan(0);
      expect(a.workers).toBeGreaterThanOrEqual(1);
      expect(a.captureStageMs + a.encodeStageMs).toBeLessThanOrEqual(a.durationMs);
      const perf = JSON.parse(readFileSync(a.perfPath, "utf-8"));
      for (const key of [
        "planHashMs",
        "sessionBootMs",
        "captureStageMs",
        "encodeStageMs",
        "workers",
      ]) {
        expect(typeof perf[key]).toBe("number");
      }
    },
    TIMEOUT_MS,
  );

  it(
    "rejects an out-of-range chunkIndex with CHUNK_INDEX_OUT_OF_RANGE",
    async () => {
      if (!hasChrome) return;
      const out = join(runRoot, "chunk-oob");
      let caught: unknown;
      try {
        // OOB validation runs BEFORE Chrome init, so this works regardless
        // of chrome://gpu support on the host.
        await renderChunk(planDir, 999, out);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RenderChunkValidationError);
      expect((caught as RenderChunkValidationError).code).toBe(CHUNK_INDEX_OUT_OF_RANGE);
      expect((caught as Error).message).toContain("out of range");
    },
    TIMEOUT_MS,
  );

  it(
    "rejects a planDir missing plan.json with MISSING_PLAN_ARTIFACT",
    async () => {
      const emptyDir = join(runRoot, "empty-plan-dir");
      mkdirSync(emptyDir, { recursive: true });
      const out = join(runRoot, "chunk-empty");
      let caught: unknown;
      try {
        await renderChunk(emptyDir, 0, out);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RenderChunkValidationError);
      expect((caught as RenderChunkValidationError).code).toBe(MISSING_PLAN_ARTIFACT);
      expect((caught as Error).message).toContain("planDir is missing");
    },
    TIMEOUT_MS,
  );

  it(
    "rejects a planDir with a tampered planHash (PLAN_HASH_MISMATCH)",
    async () => {
      if (!hasChrome) return;
      // Clone the existing valid planDir, then corrupt its planHash by
      // editing plan.json so the on-disk fingerprint no longer matches
      // the stored value.
      const corruptedDir = mkdtempSync(join(runRoot, "plan-corrupted-"));
      const { cpSync } = await import("node:fs");
      cpSync(planDir, corruptedDir, { recursive: true });
      const planJsonPath = join(corruptedDir, "plan.json");
      const planJson = JSON.parse(readFileSync(planJsonPath, "utf-8")) as Record<string, unknown>;
      planJson.planHash = "0".repeat(64);
      writeFileSync(planJsonPath, JSON.stringify(planJson, null, 2), "utf-8");

      const out = join(runRoot, "chunk-tampered");
      let caught: unknown;
      try {
        await renderChunk(corruptedDir, 0, out);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RenderChunkValidationError);
      expect((caught as RenderChunkValidationError).code).toBe(PLAN_HASH_MISMATCH);
      expect((caught as Error).message).toMatch(/fingerprint|planHash/i);
    },
    TIMEOUT_MS,
  );

  it(
    "rejects a planDir whose encoder.json is missing runtimeEnv",
    async () => {
      if (!hasChrome) return;
      const noEnvDir = mkdtempSync(join(runRoot, "plan-no-env-"));
      const { cpSync } = await import("node:fs");
      cpSync(planDir, noEnvDir, { recursive: true });
      const encoderJsonPath = join(noEnvDir, "meta", "encoder.json");
      const encoder = JSON.parse(readFileSync(encoderJsonPath, "utf-8")) as Record<string, unknown>;
      delete encoder.runtimeEnv;
      writeFileSync(encoderJsonPath, JSON.stringify(encoder), "utf-8");

      const out = join(runRoot, "chunk-no-env");
      let caught: unknown;
      try {
        await renderChunk(noEnvDir, 0, out);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RenderChunkValidationError);
      // Tampering the encoder.json also breaks planHash, so either code
      // is acceptable — both indicate a planDir the worker correctly
      // refused to render. The missing-runtimeEnv path fires when the
      // encoder JSON happens to remain hash-valid (e.g. controller bug),
      // the hash-mismatch path fires when it doesn't.
      const code = (caught as RenderChunkValidationError).code;
      expect([MISSING_RUNTIME_ENV_SNAPSHOT, PLAN_HASH_MISMATCH]).toContain(code);
    },
    TIMEOUT_MS,
  );
});

describe("renderChunk() — variables threading", () => {
  // 60s ceiling absorbs Chrome cold-start + 5-frame capture + ffmpeg encode
  // on slower CI workers.
  const TIMEOUT_MS = 60_000;

  // Fixture whose pixels depend on `window.__hfVariables.color`. Read the
  // variables on `DOMContentLoaded` and write the color onto a fullscreen
  // element. Two plans with different `variables.color` MUST produce
  // different chunk fingerprints — proves the controller's snapshotted
  // variables reach the chunk worker's page.
  const VARIABLES_FIXTURE_HTML = `<!doctype html>
<html data-composition-variables='{"color":"string"}'>
<head><meta charset="utf-8"><title>renderChunk variables fixture</title></head>
<body style="margin:0">
  <div data-composition-id="root" data-width="160" data-height="120" data-duration="0.16667">
    <div id="paint" style="width:160px;height:120px;background:#000"></div>
  </div>
  <script>
    (function () {
      var v = (window.__hfVariables && window.__hfVariables.color) || "#000";
      var el = document.getElementById("paint");
      if (el) el.style.background = v;
    })();
  </script>
</body>
</html>`;

  it(
    "chunks rendered with different variables produce different output fingerprints",
    async () => {
      if (!hasChrome) {
        // Soft skip — Docker harness covers the real assertion.
        console.warn(
          "[renderChunk.test] skipping variables-threading test — chrome-headless-shell not available on this host",
        );
        return;
      }

      const variablesProjectDir = join(runRoot, "project-variables");
      mkdirSync(variablesProjectDir, { recursive: true });
      writeFileSync(join(variablesProjectDir, "index.html"), VARIABLES_FIXTURE_HTML, "utf-8");

      const planDirRed = join(runRoot, "plan-variables-red");
      const planDirBlue = join(runRoot, "plan-variables-blue");
      mkdirSync(planDirRed, { recursive: true });
      mkdirSync(planDirBlue, { recursive: true });

      const baseConfig = {
        fps: 30 as const,
        width: 160,
        height: 120,
        format: "png-sequence" as const,
      };
      await plan(
        variablesProjectDir,
        { ...baseConfig, variables: { color: "#ff0000" } },
        planDirRed,
      );
      await plan(
        variablesProjectDir,
        { ...baseConfig, variables: { color: "#0000ff" } },
        planDirBlue,
      );

      const outRed = join(runRoot, "chunk-variables-red");
      const outBlue = join(runRoot, "chunk-variables-blue");

      let red, blue;
      try {
        red = await renderChunk(planDirRed, 0, outRed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
          console.warn(
            "[renderChunk.test] skipping variables-threading test — host Chrome stack can't render. ",
            "Docker harness covers the contract. Diagnostic:",
            message.slice(0, 240),
          );
          return;
        }
        throw err;
      }
      blue = await renderChunk(planDirBlue, 0, outBlue);

      expect(red.outputKind).toBe("frame-dir");
      expect(blue.outputKind).toBe("frame-dir");
      // Different variables.color → different rendered pixels → different
      // fingerprint. The byte-identical-retry contract from the dedicated
      // test above is what gives this assertion teeth: if variables
      // weren't actually reaching the page, both chunks would hash the
      // same #000 fallback.
      expect(red.sha256).not.toBe(blue.sha256);
    },
    TIMEOUT_MS,
  );
});

describe("resolvePresetForLockedEncoder", () => {
  // Tiny fast tests for the codec-override helper. No Chrome, no ffmpeg —
  // exists so a refactor that moves the override (e.g. into
  // `getEncoderPreset` itself) gets caught here before the heavyweight
  // Docker fixture is even run.
  it("flips codec from h264 to h265 when encoder is libx265-software", () => {
    const base = { preset: "medium", quality: 18, codec: "h264" as const, pixelFormat: "yuv420p" };
    const out = resolvePresetForLockedEncoder(base, "libx265-software");
    expect(out.codec).toBe("h265");
    expect(out.preset).toBe("medium");
    expect(out.quality).toBe(18);
    expect(out.pixelFormat).toBe("yuv420p");
  });

  it("leaves the preset unchanged for libx264-software", () => {
    const base = { preset: "medium", quality: 18, codec: "h264" as const, pixelFormat: "yuv420p" };
    const out = resolvePresetForLockedEncoder(base, "libx264-software");
    expect(out).toBe(base);
  });

  it("leaves the preset unchanged for prores-software", () => {
    const base = {
      preset: "4444",
      quality: 18,
      codec: "prores" as const,
      pixelFormat: "yuva444p10le",
    };
    const out = resolvePresetForLockedEncoder(base, "prores-software");
    expect(out).toBe(base);
  });

  it("leaves the preset unchanged for png-sequence", () => {
    const base = { preset: "medium", quality: 18, codec: "h264" as const, pixelFormat: "yuv420p" };
    const out = resolvePresetForLockedEncoder(base, "png-sequence");
    expect(out).toBe(base);
  });
});

describe("resolveLockedVp9CpuUsed", () => {
  it("uses the locked value for new VP9 planDirs", () => {
    expect(resolveLockedVp9CpuUsed({ encoder: "libvpx-vp9-software", vp9CpuUsed: 4 })).toBe(4);
  });

  it("preserves legacy distributed VP9 replay behavior when the field is absent", () => {
    expect(resolveLockedVp9CpuUsed({ encoder: "libvpx-vp9-software" })).toBe(2);
  });

  it("returns undefined for non-VP9 planDirs", () => {
    expect(resolveLockedVp9CpuUsed({ encoder: "libx264-software" })).toBeUndefined();
  });
});
