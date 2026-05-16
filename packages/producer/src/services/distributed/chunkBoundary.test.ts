/**
 * Per-adapter chunk-boundary contract: rendering the same composition at
 * chunkSize=N (single chunk, no seams) vs chunkSize=N/4 (four chunks, three
 * seams at frames 15, 30, 45) MUST produce byte-identical *frames*. Anything
 * weaker means the worker's seek-determinism leaks across chunk boundaries.
 *
 * Output is png-sequence rather than mp4 because mp4 bitstreams encode
 * keyframe placement directly: chunkSize=60 emits 1 IDR; chunkSize=15 emits
 * 4 IDRs at frames 0/15/30/45. Those are legitimately different bytes even
 * when the captured pixels are identical. The png-sequence assemble path
 * merges chunk frame directories with no re-encode, so per-frame byte
 * equality is exactly pixel equality.
 *
 * For each first-party adapter (GSAP, Anime.js, Three.js, Lottie, CSS,
 * WAAPI), `tests/distributed/<adapter>-boundary/src/index.html` is a
 * 60-frame composition that drives the adapter through its registered seek
 * hook. The fixtures intentionally lack a `meta.json` so they're invisible
 * to the regression harness; this test owns them. On hosts whose
 * chrome-headless-shell can't render (no SwiftShader / missing GL stack),
 * each subtest soft-skips and the Docker harness covers the contract.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_CHROME_FAILURE_PATTERNS } from "./__test_utils__/hostChromeFailures.js";
import { assemble } from "./assemble.js";
import { plan } from "./plan.js";
import { renderChunk } from "./renderChunk.js";

// Per-adapter fixture directories under `packages/producer/tests/distributed/`.
// Each must hold `src/index.html`; this test owns the planning + render +
// assemble pipeline so no `output/` baseline is required.
const ADAPTERS = ["gsap", "anime", "three", "lottie", "css", "waapi"] as const;

// Every adapter fixture is a 2-second composition at 30fps. Pin the absolute
// count so a regression that produces fewer frames in both runs (e.g. a
// probe stage that reads duration as 0s) doesn't pass vacuously.
const EXPECTED_FRAME_COUNT = 60;

let runRoot: string;
let testsDistributedDir: string;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-chunk-boundary-test-"));
  // `__dirname`-equivalent in ESM.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // packages/producer/src/services/distributed/ → packages/producer/tests/distributed/
  testsDistributedDir = resolve(moduleDir, "..", "..", "..", "tests", "distributed");
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

async function planAndAssemble(input: {
  projectDir: string;
  workDir: string;
  chunkSize: number;
}): Promise<string> {
  const planDir = join(input.workDir, "plan");
  const chunksDir = join(input.workDir, "chunks");
  const outputPath = join(input.workDir, "frames");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(chunksDir, { recursive: true });

  const planResult = await plan(
    input.projectDir,
    {
      fps: 30,
      width: 320,
      height: 180,
      // png-sequence: every chunk emits a directory of PNGs and assemble()
      // merges them with no re-encode. Byte equality at the file level is
      // pixel equality. mp4 would muddy this because chunkSize directly
      // affects keyframe placement in the bitstream.
      format: "png-sequence",
      chunkSize: input.chunkSize,
      // anime.js's IIFE bundle embeds `font-family: ui-monospace, monospace`
      // as a string literal inside its JS, which `validateNoSystemFonts`'s
      // document-wide regex false-positives. These fixtures display no text,
      // so disabling the check (the documented escape hatch on this flag) is
      // safe.
      rejectOnSystemFonts: false,
    },
    planDir,
  );

  const chunkPaths: string[] = [];
  for (let i = 0; i < planResult.chunkCount; i++) {
    // png-sequence chunks are directories, not files.
    const chunkPath = join(chunksDir, `chunk-${String(i).padStart(4, "0")}`);
    await renderChunk(planDir, i, chunkPath);
    chunkPaths.push(chunkPath);
  }

  const audioPath = join(planDir, "audio.aac");
  const audioForAssemble = existsSync(audioPath) ? audioPath : null;
  await assemble(planDir, chunkPaths, audioForAssemble, outputPath);
  return outputPath;
}

describe("per-adapter chunk-boundary byte equality", () => {
  // Two renders × ~5s each × cold-Chrome × six adapters can run long on the
  // CI host. Per-adapter timeout keeps each `it()` failure local rather
  // than smearing a single slow adapter across the suite cap.
  const TIMEOUT_MS = 240_000;

  for (const adapter of ADAPTERS) {
    it(
      `${adapter}: chunkSize=60 (N=1) vs chunkSize=15 (N=4) produces byte-identical frames`,
      async () => {
        const fixtureDir = join(testsDistributedDir, `${adapter}-boundary`);
        if (!existsSync(join(fixtureDir, "src", "index.html"))) {
          throw new Error(
            `[chunkBoundary.test] missing fixture src for adapter ${adapter}: ${fixtureDir}/src/index.html`,
          );
        }
        const projectDir = join(fixtureDir, "src");

        const workOne = join(runRoot, `${adapter}-n1`);
        const workFour = join(runRoot, `${adapter}-n4`);
        mkdirSync(workOne, { recursive: true });
        mkdirSync(workFour, { recursive: true });

        // Soft-skip when host Chrome can't render. Wrap *both* renders —
        // cold-Chrome / SwiftShader flakes happen on the second render
        // as readily as the first, and a hard-fail on the N=4 path would
        // diverge from the rest of the harness's soft-skip convention.
        const runRender = async (workDir: string, chunkSize: number): Promise<string | null> => {
          try {
            return await planAndAssemble({ projectDir, workDir, chunkSize });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (HOST_CHROME_FAILURE_PATTERNS.test(message)) {
              console.warn(
                `[chunkBoundary.test] skipping ${adapter} — host Chrome can't render. ` +
                  "Docker harness covers the contract. Diagnostic:",
                message.slice(0, 240),
              );
              return null;
            }
            throw err;
          }
        };
        const outOne = await runRender(workOne, 60);
        if (outOne === null) return;
        const outFour = await runRender(workFour, 15);
        if (outFour === null) return;

        // Per-frame byte equality across the two frames directories. A
        // boundary regression in the adapter's seek-determinism would
        // show up as one or more frames differing at the seam offsets
        // (frames 15/30/45 — the chunk transitions in the N=4 run).
        const framesOne = readdirSync(outOne)
          .filter((n) => n.toLowerCase().endsWith(".png"))
          .sort();
        const framesFour = readdirSync(outFour)
          .filter((n) => n.toLowerCase().endsWith(".png"))
          .sort();
        // Pin the absolute count, not just equality between the two runs.
        // Otherwise a regression that truncates BOTH renders identically
        // (e.g. a probe stage that misreads duration as 0s) would pass
        // vacuously — `0 === 0` is true.
        expect(framesOne.length).toBe(EXPECTED_FRAME_COUNT);
        expect(framesFour.length).toBe(EXPECTED_FRAME_COUNT);
        expect(framesOne).toEqual(framesFour);
        for (let i = 0; i < framesOne.length; i++) {
          const frameName = framesOne[i];
          if (frameName === undefined) continue;
          const a = readFileSync(join(outOne, frameName));
          const b = readFileSync(join(outFour, frameName));
          if (a.byteLength !== b.byteLength || !a.equals(b)) {
            throw new Error(
              `${adapter}: frame ${frameName} differs between N=1 and N=4 ` +
                `(a=${a.byteLength}B, b=${b.byteLength}B)`,
            );
          }
        }
      },
      TIMEOUT_MS,
    );
  }

  it("expected fixture directories exist", () => {
    // Cheap sanity check so a `bun test` filter that excludes the
    // per-adapter `it()` blocks still verifies the fixture layout.
    const present = readdirSync(testsDistributedDir).filter((name) => name.endsWith("-boundary"));
    for (const adapter of ADAPTERS) {
      expect(present).toContain(`${adapter}-boundary`);
    }
  });
});
