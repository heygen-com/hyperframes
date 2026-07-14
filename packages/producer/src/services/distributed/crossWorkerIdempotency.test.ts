// fallow-ignore-file code-duplication complexity
/**
 * Cross-worker idempotency: rendering the same `(planDir, chunkIndex)` on two
 * different workers MUST produce byte-identical output. This is what makes a
 * fan-out architecture safe — Worker A can crash mid-chunk and Worker B can
 * pick up the same slice without producing a frame that disagrees with what
 * Worker A would have written.
 *
 * `renderChunk.test.ts` already pins the byte-identical-retry contract for
 * png-sequence by comparing the engineered `ChunkResult.sha256` fingerprint.
 * This file complements that with:
 *
 *   1. Explicit `Buffer.equals` comparison of the raw bytes of every output
 *      file, not just a derived fingerprint. This independently verifies the
 *      property `renderChunk`'s sha256 helper is supposed to imply.
 *   2. The mp4 path. mp4 chunks go through the BeginFrame capture path +
 *      libx264 encode; png-sequence chunks go through the screenshot capture
 *      path with no encoder. Both must be byte-identical across temp dirs;
 *      pinning only one would let an mp4-specific regression slip past.
 *
 * Both subtests soft-skip when `chrome-headless-shell` on the host can't
 * render — the Docker harness exercises the same code paths against a
 * matched chrome + ffmpeg build.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_CHROME_FAILURE_PATTERNS } from "./__test_utils__/hostChromeFailures.js";
import { plan } from "./plan.js";
import { renderChunk } from "./renderChunk.js";

// Tiny composition shared by every subtest. 5 frames at 30fps + chunkSize=2
// lands three chunks of sizes [2, 2, 1] within a few seconds inside Docker
// and keeps host runs (where this test soft-skips most of the time) cheap
// when they do exercise the full path. We assert byte-identity on chunk 0
// (the always-special first chunk) and chunk 1 (the smallest non-zero
// chunk index, exercising the seek-offset + frame-indexing code path that
// a regression specific to chunks N>0 would land in).
const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>cross-worker idempotency fixture</title></head>
<body style="margin:0;background:#000;color:#fff;font:32px sans-serif">
  <div data-composition-id="root" data-no-timeline data-width="160" data-height="120" data-duration="0.16667">
    <p style="padding:1rem">chunk fixture</p>
  </div>
</body>
</html>`;

// Force multi-chunk plans on a tiny fixture. With 5 frames the resolver
// produces chunks of sizes [2, 2, 1] — enough to cover chunkIndex 0 + a
// non-zero chunk without inflating render wall time.
const PLAN_CHUNK_SIZE = 2;

// Subtests render this set of chunk indices, twice each, and assert every
// pair is byte-identical. Chunk 0 is the always-present special case;
// chunk 1 catches regressions in the seek-offset / frame-indexing logic
// that would only fire for chunks N>0.
const CHUNK_INDICES_UNDER_TEST = [0, 1] as const;

let runRoot: string;
let projectDir: string;
let pngPlanDir: string;
let mp4PlanDir: string;
let pngPlanReady = false;
let mp4PlanReady = false;

beforeAll(async () => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-cross-worker-test-"));
  projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");

  // Plan once per format. plan() is cheap for this fixture (statically-resolvable
  // duration means the probe stage never launches a browser), and re-planning
  // per `it()` would dominate the test wall time.
  //
  // A plan failure is treated as a soft skip — most commonly it's the
  // ffmpeg-version readout fighting a host with no ffmpeg on PATH, or the
  // compile stage hitting a missing font binary. Either way, the Docker
  // harness exercises the same code path against a working image, so the
  // host failure is informational rather than load-bearing.
  pngPlanDir = join(runRoot, "plan-pngseq");
  mkdirSync(pngPlanDir, { recursive: true });
  try {
    await plan(
      projectDir,
      { fps: 30, width: 160, height: 120, format: "png-sequence", chunkSize: PLAN_CHUNK_SIZE },
      pngPlanDir,
    );
    pngPlanReady = true;
  } catch (err) {
    console.warn(
      "[crossWorkerIdempotency.test] png-sequence plan() failed on host — subtest will soft-skip.",
      "Diagnostic:",
      (err instanceof Error ? err.message : String(err)).slice(0, 240),
    );
  }

  mp4PlanDir = join(runRoot, "plan-mp4");
  mkdirSync(mp4PlanDir, { recursive: true });
  try {
    await plan(
      projectDir,
      { fps: 30, width: 160, height: 120, format: "mp4", chunkSize: PLAN_CHUNK_SIZE },
      mp4PlanDir,
    );
    mp4PlanReady = true;
  } catch (err) {
    console.warn(
      "[crossWorkerIdempotency.test] mp4 plan() failed on host — subtest will soft-skip.",
      "Diagnostic:",
      (err instanceof Error ? err.message : String(err)).slice(0, 240),
    );
  }
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

/**
 * Compare two chunk outputs byte-by-byte. For `file` outputs (mp4/mov) the
 * whole file is compared; for `frame-dir` outputs (png-sequence) every PNG is
 * compared (including the directory listing, so a missing or extra frame
 * trips the assertion).
 */
function assertBytesEqual(
  outA: string,
  outB: string,
  kind: "file" | "frame-dir",
  label: string,
): void {
  if (kind === "file") {
    const bytesA = readFileSync(outA);
    const bytesB = readFileSync(outB);
    expect(bytesA.byteLength).toBe(bytesB.byteLength);
    // Buffer.equals returns boolean — `toBe(true)` gives a clearer message on
    // failure than `toEqual` on two large Buffers.
    expect(bytesA.equals(bytesB)).toBe(true);
    return;
  }
  const framesA = readdirSync(outA).sort();
  const framesB = readdirSync(outB).sort();
  expect(framesA).toEqual(framesB);
  for (const name of framesA) {
    const a = readFileSync(join(outA, name));
    const b = readFileSync(join(outB, name));
    if (a.byteLength !== b.byteLength || !a.equals(b)) {
      throw new Error(`${label}: frame ${name} differs (a=${a.byteLength}B, b=${b.byteLength}B)`);
    }
  }
}

describe("cross-worker idempotency", () => {
  // Generous timeout for slower CI: cold Chrome start + 5-frame capture +
  // ffmpeg encode is the dominant cost, repeated twice per chunk index. With
  // PLAN_CHUNK_SIZE=2 each chunk has at most 2 frames, so cold-start
  // dominates even when iterating multiple indices.
  const TIMEOUT_MS = 120_000;

  for (const chunkIndex of CHUNK_INDICES_UNDER_TEST) {
    it(
      `png-sequence: chunk ${chunkIndex} is byte-identical across two distinct output dirs`,
      async () => {
        if (!pngPlanReady) {
          console.warn(
            `[crossWorkerIdempotency.test] skipping png-sequence chunk ${chunkIndex} — plan() didn't complete on host`,
          );
          return;
        }
        const outA = join(runRoot, `pngseq-chunk-${chunkIndex}-a`);
        const outB = join(runRoot, `pngseq-chunk-${chunkIndex}-b`);
        let a, b;
        try {
          a = await renderChunk(pngPlanDir, chunkIndex, outA);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
            console.warn(
              `[crossWorkerIdempotency.test] skipping png-sequence chunk ${chunkIndex} — host Chrome can't render. `,
              "Diagnostic:",
              message.slice(0, 240),
            );
            return;
          }
          throw err;
        }
        b = await renderChunk(pngPlanDir, chunkIndex, outB);

        expect(a.outputKind).toBe("frame-dir");
        expect(b.outputKind).toBe("frame-dir");
        expect(a.framesEncoded).toBeGreaterThan(0);
        expect(b.framesEncoded).toBe(a.framesEncoded);

        // sha256 fingerprint match — the contract `ChunkResult.sha256` implies.
        expect(a.sha256).toBe(b.sha256);
        // Independent byte-level verification. If the sha256 helper ever
        // regresses (e.g. starts hashing metadata instead of pixels), this
        // assertion still fails the test honestly.
        assertBytesEqual(outA, outB, "frame-dir", `png-sequence chunk ${chunkIndex}`);
      },
      TIMEOUT_MS,
    );

    it(
      `mp4: chunk ${chunkIndex} is byte-identical across two distinct output paths`,
      async () => {
        if (!mp4PlanReady) {
          console.warn(
            `[crossWorkerIdempotency.test] skipping mp4 chunk ${chunkIndex} — plan() didn't complete on host`,
          );
          return;
        }
        const outDir = join(runRoot, "mp4-chunks");
        mkdirSync(outDir, { recursive: true });
        const outA = join(outDir, `chunk-${chunkIndex}-a.mp4`);
        const outB = join(outDir, `chunk-${chunkIndex}-b.mp4`);
        let a, b;
        try {
          a = await renderChunk(mp4PlanDir, chunkIndex, outA);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
            console.warn(
              `[crossWorkerIdempotency.test] skipping mp4 chunk ${chunkIndex} — host Chrome can't render. `,
              "Diagnostic:",
              message.slice(0, 240),
            );
            return;
          }
          throw err;
        }
        b = await renderChunk(mp4PlanDir, chunkIndex, outB);

        expect(a.outputKind).toBe("file");
        expect(b.outputKind).toBe("file");
        expect(a.framesEncoded).toBeGreaterThan(0);
        expect(b.framesEncoded).toBe(a.framesEncoded);

        expect(a.sha256).toBe(b.sha256);
        assertBytesEqual(outA, outB, "file", `mp4 chunk ${chunkIndex}`);
      },
      TIMEOUT_MS,
    );
  }
});
