/**
 * Tests for the `forceScreenshot` snapshot contract in `runCompileStage`.
 *
 * `compileStage` is the single point in the in-process renderer that
 * resolves `cfg.forceScreenshot`. The decision folds three inputs:
 *
 *   1. `cfg.forceScreenshot` (whatever the caller passed in)
 *   2. `needsAlpha` (webm / mov / png-sequence require screenshot mode
 *      because BeginFrame doesn't preserve alpha on headless-shell)
 *   3. `compiled.renderModeHints.recommendScreenshot` (iframes or raw
 *      `requestAnimationFrame` in inline scripts)
 *
 * After this stage, the resolved value is frozen for the rest of the
 * pipeline — downstream capture stages consume it as an explicit
 * `forceScreenshot` parameter. These tests pin the freezing point: the
 * returned `result.forceScreenshot` must match `cfg.forceScreenshot`
 * the moment compile completes, regardless of which signal flipped it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EngineConfig } from "@hyperframes/engine";
import { runCompileStage, type CompileStageInput } from "./compileStage.js";
import type { RenderJob } from "../../renderOrchestrator.js";

const noopLog = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

function createCfg(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    chromeArgs: [],
    chromePath: undefined,
    captureCostMultiplier: 1,
    // fallow-ignore-next-line code-duplication
    format: "jpeg",
    jpegQuality: 80,
    concurrency: "auto",
    coresPerWorker: 2.5,
    minParallelFrames: 120,
    largeRenderThreshold: 1000,
    disableGpu: false,
    browserGpuMode: "software",
    enableBrowserPool: false,
    browserTimeout: 120000,
    protocolTimeout: 300000,
    forceScreenshot: false,
    enableChunkedEncode: false,
    chunkSizeFrames: 360,
    enableStreamingEncode: false,
    streamingEncodeMaxDurationSeconds: 240,
    ffmpegEncodeTimeout: 600000,
    ffmpegProcessTimeout: 300000,
    ffmpegStreamingTimeout: 600000,
    hdr: false,
    hdrAutoDetect: true,
    audioGain: 1,
    frameDataUriCacheLimit: 256,
    frameDataUriCacheBytesLimitMb: 1500,
    playerReadyTimeout: 45000,
    renderReadyTimeout: 15000,
    verifyRuntime: true,
    debug: false,
    ...overrides,
  };
}

function createJob(): RenderJob {
  return {
    id: "test-job",
    config: {
      fps: { num: 30, den: 1 },
      quality: "standard",
    },
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    createdAt: new Date(),
  };
}

const PLAIN_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1">
    <p>plain composition</p>
  </div>
</body>
</html>`;

// Contains an <iframe>, which triggers
// `detectRenderModeHints` → `recommendScreenshot: true`.
const IFRAME_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1">
    <iframe src="about:blank" data-start="0" data-end="1"></iframe>
  </div>
</body>
</html>`;

interface CompileFixture {
  workDir: string;
  htmlPath: string;
  cleanup: () => void;
}

function setupFixture(html: string): CompileFixture {
  const workDir = mkdtempSync(join(tmpdir(), "compile-stage-test-"));
  const projectDir = join(workDir, "project");
  mkdirSync(projectDir);
  const htmlPath = join(projectDir, "index.html");
  writeFileSync(htmlPath, html, "utf-8");
  return {
    workDir,
    htmlPath,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

async function runWith(
  fixture: CompileFixture,
  cfg: EngineConfig,
  needsAlpha: boolean,
): Promise<{ resolved: boolean; cfgPost: boolean }> {
  const projectDir = join(fixture.workDir, "project");
  const input: CompileStageInput = {
    projectDir,
    workDir: fixture.workDir,
    htmlPath: fixture.htmlPath,
    entryFile: "index.html",
    job: createJob(),
    cfg,
    needsAlpha,
    log: noopLog,
    assertNotAborted: () => {},
  };
  const result = await runCompileStage(input);
  return { resolved: result.forceScreenshot, cfgPost: cfg.forceScreenshot };
}

describe("runCompileStage — forceScreenshot snapshot", () => {
  let fixture: CompileFixture | null = null;

  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it("returns false when needsAlpha=false, no render-mode hints, and cfg starts false", async () => {
    fixture = setupFixture(PLAIN_HTML);
    const cfg = createCfg();
    const { resolved, cfgPost } = await runWith(fixture, cfg, false);
    expect(resolved).toBe(false);
    expect(cfgPost).toBe(false);
  });

  it("returns true when needsAlpha=true is the only signal", async () => {
    fixture = setupFixture(PLAIN_HTML);
    const cfg = createCfg();
    const { resolved, cfgPost } = await runWith(fixture, cfg, true);
    expect(resolved).toBe(true);
    expect(cfgPost).toBe(true);
  });

  it("returns true when the render-mode hint is the only signal (iframe)", async () => {
    fixture = setupFixture(IFRAME_HTML);
    const cfg = createCfg();
    const { resolved, cfgPost } = await runWith(fixture, cfg, false);
    expect(resolved).toBe(true);
    expect(cfgPost).toBe(true);
  });

  it("returns true when the caller's cfg already forced screenshot", async () => {
    fixture = setupFixture(PLAIN_HTML);
    const cfg = createCfg({ forceScreenshot: true });
    const { resolved, cfgPost } = await runWith(fixture, cfg, false);
    expect(resolved).toBe(true);
    expect(cfgPost).toBe(true);
  });

  it("returns the same value carried on cfg post-compile (single-write contract)", async () => {
    // Sweep every (cfg.forceScreenshot, needsAlpha, recommendScreenshot)
    // combination and assert the result is the OR of all three. The
    // capture stages downstream receive `result.forceScreenshot` and
    // must see the same value the engine would see via cfg — both
    // assertions together pin the contract.
    for (const html of [PLAIN_HTML, IFRAME_HTML]) {
      for (const initial of [false, true]) {
        for (const needsAlpha of [false, true]) {
          fixture = setupFixture(html);
          const cfg = createCfg({ forceScreenshot: initial });
          const { resolved, cfgPost } = await runWith(fixture, cfg, needsAlpha);
          const expected = initial || needsAlpha || html === IFRAME_HTML;
          expect(resolved).toBe(expected);
          // The returned snapshot must match the cfg value the stage
          // left behind — otherwise the engine and downstream stages
          // would disagree about capture mode.
          expect(resolved).toBe(cfgPost);
          fixture.cleanup();
          fixture = null;
        }
      }
    }
  });
});
