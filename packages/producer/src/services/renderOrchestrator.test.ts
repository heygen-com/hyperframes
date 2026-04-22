import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EngineConfig } from "@hyperframes/engine";
import type { CompiledComposition } from "./htmlCompiler.js";

import {
  applyRenderModeHints,
  extractStandaloneEntryFromIndex,
  writeCompiledArtifacts,
} from "./renderOrchestrator.js";
import { toExternalAssetKey } from "../utils/paths.js";

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });
});

describe("writeCompiledArtifacts — external assets on Windows drive-letter paths (GH #321)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });

  function makeWorkDir(): string {
    const d = mkdtempSync(join(tmpdir(), "hf-orch-"));
    tempDirs.push(d);
    return d;
  }

  it("copies an external asset with a Windows-style drive-letter key into compileDir", () => {
    const workDir = makeWorkDir();
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "segment.wav");
    writeFileSync(srcFile, "fake wav bytes");

    const windowsStyleInput = "D:\\coder\\assets\\segment.wav";
    const key = toExternalAssetKey(windowsStyleInput);
    expect(key).toBe("hf-ext/D/coder/assets/segment.wav");

    const externalAssets = new Map<string, string>([[key, srcFile]]);
    const compiled = {
      html: "<!doctype html><html><body></body></html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const landed = join(workDir, "compiled", key);
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, "utf-8")).toBe("fake wav bytes");
  });

  it("rejects a maliciously crafted key that tries to escape compileDir", () => {
    const workDir = makeWorkDir();
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "evil.wav");
    writeFileSync(srcFile, "should never be copied");

    const externalAssets = new Map<string, string>([["hf-ext/../../etc/passwd", srcFile]]);
    const compiled = {
      html: "<!doctype html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const escapeTarget = join(workDir, "..", "..", "etc", "passwd");
    expect(existsSync(escapeTarget)).toBe(false);
  });
});

describe("applyRenderModeHints", () => {
  function createCompiledComposition(
    reasonCodes: Array<"iframe" | "requestAnimationFrame">,
  ): CompiledComposition {
    return {
      html: "<html></html>",
      subCompositions: new Map(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets: new Map(),
      width: 1920,
      height: 1080,
      staticDuration: 5,
      renderModeHints: {
        recommendScreenshot: reasonCodes.length > 0,
        reasons: reasonCodes.map((code) => ({
          code,
          message: `reason: ${code}`,
        })),
      },
    };
  }

  function createConfig(): EngineConfig {
    return {
      fps: 30,
      quality: "standard",
      format: "jpeg",
      jpegQuality: 80,
      concurrency: "auto",
      coresPerWorker: 2.5,
      minParallelFrames: 120,
      largeRenderThreshold: 1000,
      disableGpu: false,
      enableBrowserPool: false,
      browserTimeout: 120000,
      protocolTimeout: 300000,
      forceScreenshot: false,
      enableChunkedEncode: false,
      chunkSizeFrames: 360,
      enableStreamingEncode: false,
      ffmpegEncodeTimeout: 600000,
      ffmpegProcessTimeout: 300000,
      ffmpegStreamingTimeout: 600000,
      audioGain: 1,
      frameDataUriCacheLimit: 256,
      playerReadyTimeout: 45000,
      renderReadyTimeout: 15000,
      verifyRuntime: true,
      debug: false,
    };
  }

  it("forces screenshot mode when compatibility hints recommend it", () => {
    const cfg = createConfig();
    const compiled = createCompiledComposition(["iframe", "requestAnimationFrame"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

    expect(cfg.forceScreenshot).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does nothing when screenshot mode is already forced", () => {
    const cfg = createConfig();
    cfg.forceScreenshot = true;
    const compiled = createCompiledComposition(["iframe"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

    expect(log.warn).not.toHaveBeenCalled();
  });
});
