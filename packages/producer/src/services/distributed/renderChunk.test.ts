// fallow-ignore-file code-duplication complexity
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
import { effectiveChunkFrames } from "./chunkWeights.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CaptureOptions,
  extractVideoFramesRange,
  VideoSourceExtractionError,
} from "@hyperframes/engine";
import { HOST_CHROME_FAILURE_PATTERNS } from "./__test_utils__/hostChromeFailures.js";
import { defaultLogger } from "../../logger.js";
import { RenderQualityError } from "../renderOrchestrator.js";
import { assemble } from "./assemble.js";
import { plan } from "./plan.js";
import { materializePlanV2Target, planV2, readPlanV2Manifest } from "./planV2.js";
import { resolvePlanAudioPath } from "./shared.js";
import {
  CHUNK_INDEX_OUT_OF_RANGE,
  distributedCaptureSessionDependencies,
  extractDeferredVideoFramesForChunk,
  interleavesCapture,
  MISSING_PLAN_ARTIFACT,
  MISSING_RUNTIME_ENV_SNAPSHOT,
  PLAN_HASH_MISMATCH,
  renderChunk,
  RenderChunkValidationError,
  resolveChunkCaptureWorkers,
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
  <div data-composition-id="root" data-no-timeline data-width="160" data-height="120" data-duration="0.16667">
    <p style="padding:1rem">chunk fixture</p>
  </div>
</body>
</html>`;

/** Serves one file with Range support and counts the bytes it sent. */
async function serveFileByRange(path: string) {
  const size = statSync(path).size;
  const served = { bytes: 0, requests: 0 };
  const server = createServer((req, res) => {
    served.requests++;
    const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    res.writeHead(match ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(match ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    const body = createReadStream(path, { start, end, highWaterMark: 16 * 1024 });
    body.on("data", (chunk) => (served.bytes += chunk.length));
    body.pipe(res);
    res.on("close", () => body.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/video.mp4`;
  return { url, size, served, close: () => server.close() };
}

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
}, 30_000);

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
      expect(a.encodeStageMs).toBeGreaterThanOrEqual(0);
      expect(a.workers).toBeGreaterThanOrEqual(1);
      expect(["beginframe", "screenshot", "drawelement"]).toContain(a.captureMode);
      expect(b.captureMode).toBe(a.captureMode);
      expect(a.captureStageMs + a.encodeStageMs).toBeLessThanOrEqual(a.durationMs);
      const perf = JSON.parse(readFileSync(a.perfPath, "utf-8"));
      expect(perf.captureMode).toBe(a.captureMode);
      for (const key of [
        "planHashMs",
        "sessionBootMs",
        "captureStageMs",
        "encodeStageMs",
        "videoExtractMs",
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
  <div data-composition-id="root" data-no-timeline data-width="160" data-height="120" data-duration="0.16667">
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

describe("renderChunk() — requiresWebGpu wiring", () => {
  const TIMEOUT_MS = 60_000;

  it(
    "passes requiresWebGpu into the real CaptureOptions renderChunk() builds",
    async () => {
      if (!hasChrome) {
        console.warn(
          "[renderChunk.test] skipping requiresWebGpu wiring test — chrome-headless-shell not available on this host",
        );
        return;
      }

      const declaringDir = join(runRoot, "project-webgpu-declaring");
      mkdirSync(declaringDir, { recursive: true });
      writeFileSync(
        join(declaringDir, "index.html"),
        FIXTURE_HTML.replace(
          'data-composition-id="root"',
          'data-composition-id="root" data-requires-webgpu',
        ),
        "utf-8",
      );
      const declaringPlanDir = join(runRoot, "plan-webgpu-declaring");
      mkdirSync(declaringPlanDir, { recursive: true });
      await plan(
        declaringDir,
        { fps: 30, width: 160, height: 120, format: "png-sequence" },
        declaringPlanDir,
      );

      // Spy on the real dependency seam renderChunk() calls through — this
      // observes the actual CaptureOptions object it builds, not a proxy
      // for it, so a regression to the wiring line fails this directly.
      const original = distributedCaptureSessionDependencies.createCaptureSession;
      let capturedOptions: CaptureOptions | undefined;
      distributedCaptureSessionDependencies.createCaptureSession = ((...args) => {
        capturedOptions = args[2];
        return original(...args);
      }) as typeof original;

      const out = join(runRoot, "chunk-webgpu-declaring");
      try {
        try {
          await renderChunk(declaringPlanDir, 0, out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!HOST_CHROME_FAILURE_PATTERNS.test(message)) throw err;
          console.warn(
            "[renderChunk.test] skipping requiresWebGpu wiring test — host Chrome stack can't render. Diagnostic:",
            message.slice(0, 240),
          );
          return;
        }
      } finally {
        distributedCaptureSessionDependencies.createCaptureSession = original;
      }

      expect(capturedOptions?.requiresWebGpu).toBe(true);
    },
    TIMEOUT_MS,
  );
});

describe("renderChunk() — script failure", () => {
  it("fails the chunk, as a local render fails, when the timeline script never loads", async () => {
    if (!hasChrome) {
      console.warn(
        "[renderChunk.test] skipping script-failure test — chrome-headless-shell not available on this host",
      );
      return;
    }

    const failingDir = join(runRoot, "project-missing-script");
    mkdirSync(failingDir, { recursive: true });
    writeFileSync(
      join(failingDir, "index.html"),
      FIXTURE_HTML.replace(" data-no-timeline", "").replace(
        "</body>",
        '<script src="missing-timeline.js"></script>\n</body>',
      ),
      "utf-8",
    );
    const failingPlanDir = join(runRoot, "plan-missing-script");
    mkdirSync(failingPlanDir, { recursive: true });
    await plan(
      failingDir,
      { fps: 30, width: 160, height: 120, format: "png-sequence" },
      failingPlanDir,
    );

    const error = await renderChunk(failingPlanDir, 0, join(runRoot, "chunk-missing-script")).then(
      () => null,
      (err: unknown) => err,
    );
    if (error instanceof Error && HOST_CHROME_FAILURE_PATTERNS.test(error.message)) {
      console.warn(
        "[renderChunk.test] skipping script-failure test — host Chrome stack can't render. Diagnostic:",
        error.message.slice(0, 240),
      );
      return;
    }
    expect(error).toBeInstanceOf(RenderQualityError);
    expect((error as Error).message).toContain("sub_timeline_script_failure");
  }, 60_000);
});

describe("renderChunk() — a video the chunk does not show", () => {
  it("renders the same without the video's file, with no media warning", async () => {
    if (!hasChrome) {
      console.warn(
        "[renderChunk.test] skipping unshown-video test — chrome-headless-shell not available on this host",
      );
      return;
    }

    const videoDir = join(runRoot, "project-two-videos");
    mkdirSync(videoDir, { recursive: true });
    for (const [name, seconds] of [
      ["short.mp4", 2],
      ["long.mp4", 3],
    ] as const) {
      const synth = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=64x36:r=30:d=${seconds}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        join(videoDir, name),
      ]);
      if (synth.status !== 0) throw new Error(synth.stderr.toString());
    }
    writeFileSync(
      join(videoDir, "index.html"),
      // Clips over a second long, so the planner defers them to the chunks.
      FIXTURE_HTML.replace('data-duration="0.16667"', 'data-duration="2.4"').replace(
        "</div>",
        '<video id="short" src="short.mp4" muted data-start="0" data-duration="1.2" style="position:absolute;left:0;top:0;width:64px"></video>' +
          '<video id="long" src="long.mp4" muted data-start="0" data-duration="2.4" style="position:absolute;right:0;bottom:0;width:64px"></video></div>',
      ),
      "utf-8",
    );
    const v2Dir = join(runRoot, "plan-two-videos");
    await planV2(
      videoDir,
      { fps: 30, width: 160, height: 120, format: "png-sequence", chunkSize: 36 },
      v2Dir,
    );
    const manifest = readPlanV2Manifest(v2Dir);
    expect(manifest.artifacts.find((a) => a.path === "compiled/short.mp4")?.chunks).toEqual([0]);

    const without = join(runRoot, "chunk1-without-short");
    const withShort = join(runRoot, "chunk1-with-short");
    materializePlanV2Target(v2Dir, { role: "chunk", chunkIndex: 1 }, without);
    cpSync(without, withShort, { recursive: true });
    copyFileSync(join(videoDir, "short.mp4"), join(withShort, "compiled", "short.mp4"));

    const warnings: unknown[] = [];
    const skipped: (readonly string[] | undefined)[] = [];
    const originalWarn = defaultLogger.warn;
    const originalCreate = distributedCaptureSessionDependencies.createCaptureSession;
    defaultLogger.warn = (message, meta) => {
      warnings.push(meta);
      originalWarn(message, meta);
    };
    distributedCaptureSessionDependencies.createCaptureSession = ((...args) => {
      skipped.push(args[2].skipReadinessVideoIds);
      return originalCreate(...args);
    }) as typeof originalCreate;
    let a, b;
    try {
      a = await renderChunk(without, 1, join(runRoot, "chunk1-out-without"));
      b = await renderChunk(withShort, 1, join(runRoot, "chunk1-out-with"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!HOST_CHROME_FAILURE_PATTERNS.test(message)) throw err;
      console.warn(
        "[renderChunk.test] skipping unshown-video test — host Chrome stack can't render. Diagnostic:",
        message.slice(0, 240),
      );
      return;
    } finally {
      defaultLogger.warn = originalWarn;
      distributedCaptureSessionDependencies.createCaptureSession = originalCreate;
    }

    expect(JSON.stringify(warnings)).not.toContain("media_load_failed");
    // Only the unshown video is skipped; the shown one keeps today's readiness wait.
    expect(new Set(skipped.map(String))).toEqual(new Set(["short"]));
    expect(a.sha256).toBe(b.sha256);

    // The shown video read by URL instead of from the plan renders the same chunk.
    const server = await serveFileByRange(join(videoDir, "long.mp4"));
    const viaUrl = join(runRoot, "chunk1-long-by-url");
    try {
      materializePlanV2Target(v2Dir, { role: "chunk", chunkIndex: 1 }, viaUrl, {
        remoteSources: { "compiled/long.mp4": server.url },
      });
      expect(existsSync(join(viaUrl, "compiled", "long.mp4"))).toBe(false);
      const byUrl = await renderChunk(viaUrl, 1, join(runRoot, "chunk1-out-by-url"));
      expect(server.served.requests).toBeGreaterThan(0);
      expect(byUrl.sha256).toBe(a.sha256);
    } finally {
      server.close();
    }
  }, 120_000);
});

describe("renderChunk() — a video shown smaller than its source", () => {
  it("measures the box each video is drawn in before extracting its frames", async () => {
    if (!hasChrome) {
      console.warn(
        "[renderChunk.test] skipping shown-size test — chrome-headless-shell not available",
      );
      return;
    }
    const projectDir = join(runRoot, "project-shown-size");
    mkdirSync(projectDir, { recursive: true });
    const synth = spawnSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=30:d=2"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", join(projectDir, "clip.mp4")],
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
    writeFileSync(
      join(projectDir, "index.html"),
      // Clips over a second long, so the planner defers them to the chunks.
      FIXTURE_HTML.replace('data-duration="0.16667"', 'data-duration="1.2"').replace(
        "</div>",
        '<video id="pip" src="clip.mp4" muted data-start="0" data-duration="1.2" style="position:absolute;right:0;bottom:0;width:32px;height:18px"></video>' +
          '<video id="full" src="clip.mp4" muted data-start="0" data-duration="1.2" style="position:absolute;left:0;top:0;width:128px;height:72px"></video></div>',
      ),
      "utf-8",
    );
    const planDir = join(runRoot, "plan-shown-size");
    await planV2(
      projectDir,
      { fps: 30, width: 160, height: 120, format: "png-sequence", chunkSize: 36 },
      planDir,
    );
    const chunkDir = join(runRoot, "chunk0-shown-size");
    materializePlanV2Target(planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);
    let result;
    try {
      result = await renderChunk(chunkDir, 0, join(runRoot, "chunk0-shown-size-out"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!HOST_CHROME_FAILURE_PATTERNS.test(message)) throw err;
      console.warn(
        "[renderChunk.test] skipping shown-size test — host Chrome stack can't render:",
        message.slice(0, 240),
      );
      return;
    }
    expect(JSON.parse(readFileSync(result.perfPath, "utf-8")).videoShownBoxes).toEqual({
      pip: { width: 32, height: 18 },
      full: { width: 128, height: 72 },
    });
  }, 120_000);
});

describe("renderChunk() — a video whose frames cannot be extracted", () => {
  it("fails with the extraction's own error while the capture browsers start", async () => {
    if (!hasChrome) {
      console.warn(
        "[renderChunk.test] skipping extraction-failure test — chrome-headless-shell not available",
      );
      return;
    }
    const projectDir = join(runRoot, "project-extract-fail");
    mkdirSync(projectDir, { recursive: true });
    const synth = spawnSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=30:d=2"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", join(projectDir, "clip.mp4")],
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
    writeFileSync(
      join(projectDir, "index.html"),
      // A clip over a second long, so the planner defers it to the chunks.
      FIXTURE_HTML.replace('data-duration="0.16667"', 'data-duration="1.2"').replace(
        "</div>",
        '<video id="clip" src="clip.mp4" muted data-start="0" data-duration="1.2" style="width:128px;height:72px"></video></div>',
      ),
      "utf-8",
    );
    const planDir = join(runRoot, "plan-extract-fail");
    await planV2(
      projectDir,
      { fps: 30, width: 160, height: 120, format: "png-sequence", chunkSize: 36 },
      planDir,
    );
    const chunkDir = join(runRoot, "chunk0-extract-fail");
    // The clip is read by URL, as cloud chunks read it, from a port nothing listens on.
    materializePlanV2Target(planDir, { role: "chunk", chunkIndex: 0 }, chunkDir, {
      remoteSources: { "compiled/clip.mp4": "http://127.0.0.1:1/clip.mp4" },
    });

    let caught: unknown;
    try {
      await renderChunk(chunkDir, 0, join(runRoot, "chunk0-extract-fail-out"));
    } catch (error) {
      caught = error;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
      console.warn(
        "[renderChunk.test] skipping extraction-failure test — host Chrome stack can't render:",
        message.slice(0, 240),
      );
      return;
    }
    // The extraction's own error, not the capture stage that waited on it.
    expect(caught).toBeInstanceOf(VideoSourceExtractionError);
  }, 120_000);
});

describe("renderChunk() — an alpha format at a larger output resolution", () => {
  it("supersamples a transparent composition and keeps its alpha", async () => {
    if (!hasChrome) {
      console.warn(
        "[renderChunk.test] skipping alpha supersample test — chrome-headless-shell not available",
      );
      return;
    }
    const projectDir = join(runRoot, "project-alpha-supersample");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:transparent">
  <div data-composition-id="root" data-no-timeline data-width="320" data-height="180" data-duration="0.1">
    <div style="position:absolute;left:80px;top:45px;width:160px;height:90px;background:#3a7"></div>
  </div></body></html>`,
      "utf-8",
    );
    const planDir = join(runRoot, "plan-alpha-supersample");
    await planV2(
      projectDir,
      {
        fps: 30,
        width: 320,
        height: 180,
        format: "mov",
        chunkSize: 30,
        outputResolution: "landscape",
      },
      planDir,
    );
    const chunkDir = join(runRoot, "chunk0-alpha-supersample");
    materializePlanV2Target(planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);
    const out = join(runRoot, "chunk0-alpha-supersample.mov");
    try {
      await renderChunk(chunkDir, 0, out);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!HOST_CHROME_FAILURE_PATTERNS.test(message)) throw err;
      console.warn(
        "[renderChunk.test] skipping alpha supersample test — host Chrome stack can't render:",
        message.slice(0, 240),
      );
      return;
    }
    const probe = spawnSync("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0"],
      ...["-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", "--", out],
    ]);
    expect(probe.stdout.toString().trim()).toMatch(/^1920,1080,yuva/);
    const frame = spawnSync(
      "ffmpeg",
      [
        ...["-v", "error", "-i", out, "-frames:v", "1"],
        ...["-vf", "format=rgba", "-f", "rawvideo", "-"],
      ],
      { maxBuffer: 1920 * 1080 * 4 },
    ).stdout;
    const alphaAt = (x: number, y: number) => frame[(y * 1920 + x) * 4 + 3];
    expect(alphaAt(10, 10)).toBe(0);
    expect(alphaAt(960, 540)).toBe(255);
  }, 120_000);
});

describe("renderChunk() — frameRange", () => {
  // A box sliding across the frame, so every frame differs and a misplaced,
  // dropped or repeated frame changes the assembled output.
  const ANIMATED_HTML = (duration: number, audio: boolean) => `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  @keyframes slide { from { transform: translateX(0px); } to { transform: translateX(120px); } }
  #box { position:absolute; top:40px; width:40px; height:40px; background:#f97316;
         animation: slide ${duration}s linear forwards; }
</style></head>
<body style="margin:0;background:#0f172a">
  <div data-composition-id="root" data-no-timeline data-width="160" data-height="120" data-duration="${duration}">
    <div id="box"></div>
    ${audio ? '<audio data-composition-audio src="tone.wav"></audio>' : ""}
  </div>
</body>
</html>`;

  function run(cmd: string, args: string[]): string {
    const result = spawnSync(cmd, args, { maxBuffer: 1 << 28, encoding: "latin1" });
    if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  }
  // Decoded video frame hashes in presentation order.
  const frameHashes = (path: string) =>
    run("ffmpeg", ["-nostdin", "-v", "error", "-i", path, "-map", "0:v", "-f", "framemd5", "-"])
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(",").at(-1)!.trim());
  const pcm = (path: string) =>
    run("ffmpeg", ["-nostdin", "-v", "error", "-i", path, "-map", "0:a", "-f", "s16le", "-"]);
  const videoPts = (path: string) =>
    run("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time"],
      ...["-of", "csv=p=0", "--", path],
    ])
      .split("\n")
      .filter(Boolean)
      .map((line) => Number.parseFloat(line))
      .sort((x, y) => x - y);
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const minPsnr = (a: string, b: string) => {
    const log = spawnSync(
      "ffmpeg",
      [
        ...["-nostdin", "-i", a, "-i", b, "-lavfi"],
        // Pair frames by index, not timestamp: webm's millisecond timestamps round differently.
        "[0:v]setpts=N/(30*TB)[a];[1:v]setpts=N/(30*TB)[b];[a][b]psnr=stats_file=-",
        ...["-f", "null", "-"],
      ],
      { maxBuffer: 1 << 28, encoding: "latin1" },
    ).stdout;
    const values = [...log.matchAll(/psnr_avg:(\S+)/g)].map((m) => Number(m[1]));
    return Math.min(...values.map((v) => (Number.isFinite(v) ? v : 100)));
  };

  async function renderOrSkip<T>(label: string, render: () => Promise<T>): Promise<T | null> {
    try {
      return await render();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!HOST_CHROME_FAILURE_PATTERNS.test(message)) throw err;
      console.warn(
        `[renderChunk.test] skipping ${label} — host Chrome stack can't render. Diagnostic:`,
        message.slice(0, 240),
      );
      return null;
    }
  }

  it("renders png-sequence halves that assemble into the whole chunk's frames", async () => {
    if (!hasChrome) return;
    const dir = join(runRoot, "frame-range-png");
    const project = join(dir, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "index.html"), ANIMATED_HTML(0.3, false), "utf-8");
    const planPng = join(dir, "plan");
    await plan(project, { fps: 30, width: 160, height: 120, format: "png-sequence" }, planPng);
    const [slice] = JSON.parse(readFileSync(join(planPng, "meta", "chunks.json"), "utf-8"));
    expect(slice).toMatchObject({ startFrame: 0, endFrame: 9 });

    const whole = await renderOrSkip("png frameRange test", () =>
      renderChunk(planPng, 0, join(dir, "whole")),
    );
    if (whole === null) return;
    const full = await renderChunk(planPng, 0, join(dir, "full"), {
      frameRange: { startFrame: 0, endFrame: 9 },
    });
    const first = await renderChunk(planPng, 0, join(dir, "part-a"), {
      frameRange: { startFrame: 0, endFrame: 4 },
    });
    const second = await renderChunk(planPng, 0, join(dir, "part-b"), {
      frameRange: { startFrame: 4, endFrame: 9 },
    });

    // The whole slice as an explicit range is today's output, byte for byte.
    expect(whole.frameRange).toEqual({ startFrame: 0, endFrame: 9 });
    expect(full.sha256).toBe(whole.sha256);
    expect([first.framesEncoded, second.framesEncoded]).toEqual([4, 5]);
    expect(second.frameRange).toEqual({ startFrame: 4, endFrame: 9 });
    expect(JSON.parse(readFileSync(second.perfPath, "utf-8"))).toMatchObject({
      startFrame: 4,
      endFrame: 9,
      framesEncoded: 5,
    });

    const fromWhole = join(dir, "out-whole");
    const fromParts = join(dir, "out-parts");
    await assemble(planPng, [whole.outputPath], null, fromWhole);
    const result = await assemble(
      planPng,
      [[first.outputPath, second.outputPath]],
      null,
      fromParts,
    );
    expect(result.framesEncoded).toBe(9);
    const names = readdirSync(fromWhole).sort();
    expect(readdirSync(fromParts).sort()).toEqual(names);
    for (const name of names) {
      expect(readFileSync(join(fromParts, name)).equals(readFileSync(join(fromWhole, name)))).toBe(
        true,
      );
    }
    // The animation moves, so equal frames above are not equal by accident.
    expect(new Set(names.map((name) => sha(join(fromWhole, name)))).size).toBe(names.length);
  }, 120_000);

  // Two chunks of 9 frames; chunk 0 also renders as [0, 4) + [4, 9).
  it.each([
    ["mp4, chunks carrying audio (stitched)", "mp4", true],
    ["mp4, audio muxed at assemble (joined)", "mp4", false],
    ["webm (joined)", "webm", false],
  ] as const)(
    "%s: halves assemble seamlessly into the whole chunk's frames and audio",
    async (label, format, chunksCarryAudio) => {
      if (!hasChrome) return;
      const dir = join(
        runRoot,
        `frame-range-${format}-${chunksCarryAudio ? "stitched" : "joined"}`,
      );
      const project = join(dir, "project");
      mkdirSync(project, { recursive: true });
      run("ffmpeg", [
        ...["-nostdin", "-v", "error", "-y", "-f", "lavfi"],
        ...["-i", "aevalsrc=0.3*sin(2*PI*440*t):s=48000:d=0.6", "-c:a", "pcm_s16le"],
        join(project, "tone.wav"),
      ]);
      writeFileSync(join(project, "index.html"), ANIMATED_HTML(0.6, true), "utf-8");
      const planEnc = join(dir, "plan");
      await plan(
        project,
        { fps: 30, width: 160, height: 120, format, chunkSize: 9 },
        planEnc,
        chunksCarryAudio ? { chunksCarryAudio: true } : {},
      );
      expect(JSON.parse(readFileSync(join(planEnc, "meta", "chunks.json"), "utf-8"))).toHaveLength(
        2,
      );

      const out = (name: string) => join(dir, `${name}.${format}`);
      const whole0 = await renderOrSkip(label, () => renderChunk(planEnc, 0, out("whole-0")));
      if (whole0 === null) return;
      const whole1 = await renderChunk(planEnc, 1, out("whole-1"));
      const first = await renderChunk(planEnc, 0, out("part-0a"), {
        frameRange: { startFrame: 0, endFrame: 4 },
      });
      const second = await renderChunk(planEnc, 0, out("part-0b"), {
        frameRange: { startFrame: 4, endFrame: 9 },
      });
      expect([first.framesEncoded, second.framesEncoded]).toEqual([4, 5]);
      // Each part starts on its own keyframe, as a chunk does.
      for (const part of [first, second]) {
        const keyframes = run("ffprobe", [
          ...["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=flags"],
          ...["-of", "csv=p=0", "--", part.outputPath],
        ]);
        expect(keyframes.trim().split("\n")[0]).toStartWith("K");
      }

      const audio = chunksCarryAudio ? null : resolvePlanAudioPath(planEnc);
      expect(chunksCarryAudio || audio !== null).toBe(true);
      const fromWhole = out("from-whole");
      const fromParts = out("from-parts");
      await assemble(planEnc, [whole0.outputPath, whole1.outputPath], audio, fromWhole);
      await assemble(
        planEnc,
        [[first.outputPath, second.outputPath], whole1.outputPath],
        audio,
        fromParts,
      );

      // Same frame count, and exactly the parts' own frames in order: nothing
      // dropped, repeated or reordered at the seams.
      const partFrames = [first, second, whole1].flatMap((r) => frameHashes(r.outputPath));
      expect(frameHashes(fromParts)).toEqual(partFrames);
      expect(frameHashes(fromParts)).toHaveLength(18);
      expect(frameHashes(fromWhole)).toHaveLength(18);
      // Frames keep their slot on the timeline: mp4 timestamps are exact; webm's
      // millisecond timebase truncates at every join, part seams as chunk seams.
      if (format === "mp4") expect(videoPts(fromParts)).toEqual(videoPts(fromWhole));
      videoPts(fromParts).forEach((pts, i) => expect(Math.abs(pts - i / 30)).toBeLessThan(0.002));
      // The parts are separate encodes, so compare their pixels to the whole's.
      expect(minPsnr(fromParts, fromWhole)).toBeGreaterThan(35);
      expect(pcm(fromParts) === pcm(fromWhole)).toBe(true);
    },
    180_000,
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

describe("interleavesCapture", () => {
  it("is off for a caller that does not ask, so CPU-billed callers get contiguous ranges", () => {
    expect(interleavesCapture(true, undefined)).toBe(false);
    expect(interleavesCapture(true, { maxCaptureWorkers: 4 })).toBe(false);
  });

  it("is on only when the caller asks and the encoder overlaps", () => {
    expect(interleavesCapture(true, { interleaveCapture: true })).toBe(true);
    expect(interleavesCapture(false, { interleaveCapture: true })).toBe(false);
  });
});

describe("resolveChunkCaptureWorkers", () => {
  it("keeps the machine-wide sizing when the runtime sets no budget", () => {
    expect(resolveChunkCaptureWorkers(121, 3, undefined)).toBe(3);
  });

  it("raises a chunk to the runtime's budget", () => {
    expect(resolveChunkCaptureWorkers(121, 3, 5)).toBe(5);
  });

  it("gives each browser at least 20 frames", () => {
    expect(resolveChunkCaptureWorkers(121, 3, 8)).toBe(6);
    expect(resolveChunkCaptureWorkers(99, 3, 5)).toBe(4);
  });

  it("never lowers the machine-wide sizing", () => {
    expect(resolveChunkCaptureWorkers(121, 3, 1)).toBe(3);
    expect(resolveChunkCaptureWorkers(30, 2, 5)).toBe(2);
  });

  it("gives a 28-frame chunk of 3.6x frames three browsers; a light 75-frame chunk is unchanged", () => {
    expect(resolveChunkCaptureWorkers(28, 1, 3)).toBe(1);
    expect(resolveChunkCaptureWorkers(effectiveChunkFrames(28, 3.6), 1, 3)).toBe(3);
    expect(resolveChunkCaptureWorkers(effectiveChunkFrames(75, undefined), 3, 3)).toBe(3);
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

describe("extractDeferredVideoFramesForChunk", () => {
  const frameSpan = (start: number, end: number) =>
    Array.from({ length: end - start }, (_, i) => start + i);
  const root = mkdtempSync(join(tmpdir(), "hf-deferred-chunk-"));
  const planDir = join(root, "plan");
  const range = {
    sourcePath: "video-sources/0.mp4",
    startTime: 1.5,
    durationSeconds: 2.5,
    format: "jpg" as const,
  };
  const metadata = {
    durationSeconds: 4,
    videoStreamDurationSeconds: 4,
    videoStreamStartSeconds: 0,
    width: 64,
    height: 36,
    fps: 30,
    videoCodec: "h264",
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace: null,
  };
  const planVideos = (loop: boolean) => ({
    videos: [
      { id: "clip", src: "clip.mp4", start: 0, end: 4, mediaStart: 1.5, loop, hasAudio: false },
    ],
    extracted: [
      {
        videoId: "clip",
        srcPath: "/planner/clip.mp4",
        framePattern: "frame_%05d.jpg",
        fps: 30,
        totalFrames: 75,
        metadata,
        deferredRange: range,
      },
    ],
  });

  beforeAll(() => {
    mkdirSync(join(planDir, "video-sources"), { recursive: true });
    const synth = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=64x36:r=30:d=4",
      "-c:v",
      "libx264",
      "-g",
      "60",
      "-pix_fmt",
      "yuv420p",
      join(planDir, range.sourcePath),
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts exactly the frames the chunk shows, identical to the planner's", async () => {
    const full = await extractVideoFramesRange(
      join(planDir, range.sourcePath),
      "clip",
      range.startTime,
      range.durationSeconds,
      { fps: 30, outputDir: join(root, "full"), format: "jpg" },
    );
    const [chunk] = await extractDeferredVideoFramesForChunk({
      planDir,
      planVideos: planVideos(false),
      frames: frameSpan(30, 45),
      fps: { num: 30, den: 1 },
      outputRoot: join(root, "chunk-1"),
      cfg: {},
    });

    expect([...chunk!.framePaths.keys()]).toEqual(Array.from({ length: 15 }, (_, i) => 30 + i));
    for (const [index, path] of chunk!.framePaths) {
      expect(readFileSync(path).equals(readFileSync(full.framePaths.get(index)!))).toBe(true);
    }
  });

  it("extracts a video's frames at the size it is shown in when given its box", async () => {
    const [chunk] = await extractDeferredVideoFramesForChunk({
      planDir,
      planVideos: planVideos(false),
      frames: frameSpan(30, 32),
      fps: { num: 30, den: 1 },
      outputRoot: join(root, "chunk-shown"),
      cfg: {},
      shownBoxes: new Map([["clip", { width: 16, height: 9 }]]),
    });
    const [frame] = chunk!.framePaths.values();
    const size = spawnSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      "--",
      frame!,
    ]);
    expect(size.stdout.toString().trim()).toBe("16,10");
  });

  // Lossless keeps the file large next to what one seek reads.
  const big = join(root, "big.mp4");
  const synthBig = () => {
    if (existsSync(big)) return;
    const synth = spawnSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=120"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-g", "30", big],
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
  };
  const bigVideos = () => {
    const videos = planVideos(false);
    const bigRange = {
      ...range,
      sourcePath: "compiled/big.mp4",
      startTime: 0,
      durationSeconds: 120,
    };
    videos.videos[0] = { ...videos.videos[0]!, end: 120, mediaStart: 0 };
    videos.extracted[0] = { ...videos.extracted[0]!, totalFrames: 3600, deferredRange: bigRange };
    return videos;
  };
  const extract = (outputRoot: string, remoteSources?: Record<string, string>) =>
    extractDeferredVideoFramesForChunk({
      planDir: root,
      planVideos: bigVideos(),
      frames: frameSpan(1800, 1815),
      fps: { num: 30, den: 1 },
      outputRoot,
      cfg: {},
      remoteSources,
    });

  it("reads a source by URL in byte ranges and extracts the same frames", async () => {
    synthBig();
    mkdirSync(join(root, "compiled"), { recursive: true });
    copyFileSync(big, join(root, "compiled", "big.mp4"));
    const server = await serveFileByRange(big);
    const logged: unknown[] = [];
    const originalInfo = defaultLogger.info;
    defaultLogger.info = (message, meta) => void logged.push({ message, ...meta });
    try {
      const [local] = await extract(join(root, "big-local"));
      rmSync(join(root, "compiled", "big.mp4"));
      const [remote] = await extract(join(root, "big-remote"), {
        "compiled/big.mp4": `${server.url}?X-Amz-Signature=secret`,
      });
      expect(logged).toEqual([
        {
          message: "[renderChunk] reading video by URL",
          path: "compiled/big.mp4",
          url: server.url,
        },
      ]);
      expect([...remote!.framePaths.keys()]).toEqual([...local!.framePaths.keys()]);
      for (const [index, path] of remote!.framePaths) {
        expect(readFileSync(path).equals(readFileSync(local!.framePaths.get(index)!))).toBe(true);
      }
      // What it sends past the seek is socket buffering (a few MB), not the file.
      expect(server.served.bytes).toBeLessThan(server.size / 3);
    } finally {
      defaultLogger.info = originalInfo;
      server.close();
    }
  }, 60_000);

  it("never surfaces a signed URL's query when ffmpeg fails", async () => {
    synthBig();
    // Echoes its arguments (long enough that the diagnostic's tail cut can land inside the URL),
    // then ends on the URL the way a real read failure does.
    const failingFfmpeg = join(root, "failing-ffmpeg");
    writeFileSync(
      failingFfmpeg,
      '#!/bin/sh\necho "cannot read: $*" >&2\n' +
        'for a in "$@"; do case $a in http*) echo "$a: Server returned 403 Forbidden" >&2;; esac; done\n' +
        "exit 1\n",
      { mode: 0o755 },
    );
    const server = await serveFileByRange(big);
    const originalFfmpeg = process.env.HYPERFRAMES_FFMPEG_PATH;
    process.env.HYPERFRAMES_FFMPEG_PATH = failingFfmpeg;
    try {
      const url = `${server.url}?X-Amz-Signature=supersecret`;
      const error = await extract(join(root, "big-failed"), { "compiled/big.mp4": url }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      const { message, stack } = error as Error;
      const text = JSON.stringify({ ...(error as object), message, stack });
      expect(text).toContain("/video.mp4?…");
      expect(text).not.toContain("supersecret");
    } finally {
      if (originalFfmpeg === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
      else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpeg;
      server.close();
    }
  }, 60_000);

  it("refuses a URL for a file no deferred video reads", async () => {
    await expect(
      extractDeferredVideoFramesForChunk({
        planDir,
        planVideos: planVideos(false),
        frames: frameSpan(0, 5),
        fps: { num: 30, den: 1 },
        outputRoot: join(root, "chunk-stray-url"),
        cfg: {},
        remoteSources: { "compiled/other.mp4": "http://127.0.0.1:1/other.mp4" },
      }),
    ).rejects.toMatchObject({ code: MISSING_PLAN_ARTIFACT });
  });

  it("extracts nothing for a chunk past the clip, and holds no frames", async () => {
    const [chunk] = await extractDeferredVideoFramesForChunk({
      planDir,
      planVideos: { ...planVideos(false), videos: [{ ...planVideos(false).videos[0]!, end: 1 }] },
      frames: frameSpan(60, 90),
      fps: { num: 30, den: 1 },
      outputRoot: join(root, "chunk-2"),
      cfg: {},
    });
    expect(chunk!.framePaths.size).toBe(0);
  });

  it("wraps a looping clip back to its first frames", async () => {
    const [chunk] = await extractDeferredVideoFramesForChunk({
      planDir,
      planVideos: planVideos(true),
      frames: frameSpan(70, 80),
      fps: { num: 30, den: 1 },
      outputRoot: join(root, "chunk-3"),
      cfg: {},
    });
    expect([...chunk!.framePaths.keys()].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 70, 71, 72, 73, 74,
    ]);
    expect(readdirSync(join(root, "chunk-3", "clip"))).toHaveLength(10);
  });

  it("fails closed when the plan lacks the source", async () => {
    const missing = { ...planVideos(false) };
    missing.extracted = [
      { ...missing.extracted[0]!, deferredRange: { ...range, sourcePath: "video-sources/9.mp4" } },
    ];
    let caught: unknown;
    try {
      await extractDeferredVideoFramesForChunk({
        planDir,
        planVideos: missing,
        frames: frameSpan(0, 5),
        fps: { num: 30, den: 1 },
        outputRoot: join(root, "chunk-missing"),
        cfg: {},
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RenderChunkValidationError);
    expect((caught as RenderChunkValidationError).code).toBe(MISSING_PLAN_ARTIFACT);
  });
});
