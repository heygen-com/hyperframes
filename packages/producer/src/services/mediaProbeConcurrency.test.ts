import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const probeTracker = vi.hoisted(() => {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  let releaseGate = () => {};
  let gate: Promise<void>;

  const reset = () => {
    active = 0;
    maxActive = 0;
    started = 0;
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
  };
  reset();

  return {
    reset,
    release: () => releaseGate(),
    run: async <T>(value: T): Promise<T> => {
      active += 1;
      started += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return value;
    },
    get maxActive() {
      return maxActive;
    },
    get started() {
      return started;
    },
  };
});

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    analyzeKeyframeIntervals: async () =>
      probeTracker.run({ isProblematic: false, maxIntervalSeconds: 0 }),
    probeMediaProfile: async () =>
      probeTracker.run({ hasVideoStream: true, hasAudioStream: true, visualKind: "moving" }),
  };
});

vi.mock("../utils/ffprobe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ffprobe.js")>();
  return {
    ...actual,
    extractMediaMetadata: async () => probeTracker.run({ durationSeconds: 1, isVFR: false }),
  };
});

import { compileForRender } from "./htmlCompiler.js";
import { preflightCompositionAssetMediaTypes } from "./assetMediaType.js";

describe("aggregate media-probe concurrency", () => {
  let projectDir: string | undefined;

  afterEach(() => {
    probeTracker.release();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = undefined;
  });

  it("caps overlapping compiler advisories and media-type preflight at four probes", async () => {
    probeTracker.reset();
    projectDir = mkdtempSync(join(tmpdir(), "hf-media-probe-concurrency-"));
    const mediaMarkup: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const src = `video-${index}.asset`;
      writeFileSync(join(projectDir, src), "fixture");
      mediaMarkup.push(
        `<video id="video-${index}" src="${src}" loop data-start="0" data-duration="1"></video>`,
      );
    }
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
          ${mediaMarkup.join("\n")}
        </div>
      </body></html>`,
    );

    const compiled = await compileForRender(projectDir, htmlPath, join(projectDir, "downloads"));
    const preflight = preflightCompositionAssetMediaTypes({
      projectDir,
      compiledDir: join(projectDir, "compiled"),
      composition: compiled,
    });

    // Let all fire-and-forget advisory calls and the preflight contend for the
    // shared limiter while their mocked probe bodies remain blocked.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(probeTracker.maxActive).toBe(4);

    probeTracker.release();
    await preflight;
    expect(probeTracker.started).toBe(18);
    expect(probeTracker.maxActive).toBe(4);
  });
});
