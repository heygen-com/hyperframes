// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PuppeteerNode } from "puppeteer-core";
import {
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  BeginFrameRequiredError,
  drainBrowserPool,
} from "./browserManager.js";
import { createCaptureSession } from "./frameCapture.js";
import type { EngineConfig } from "../config.js";

describe.skipIf(process.platform !== "linux")("createCaptureSession with requireBeginFrame", () => {
  let dir: string;
  let chromePath: string;
  let launch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-require-beginframe-session-"));
    chromePath = join(dir, "chrome-headless-shell");
    writeFileSync(chromePath, "");
    launch = vi.fn();
    _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _setPuppeteerForTests(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  function create(config: Partial<EngineConfig>) {
    return createCaptureSession(
      "http://127.0.0.1:3000",
      join(dir, "frames"),
      { width: 320, height: 180, fps: { num: 30, den: 1 }, format: "jpeg", requiresWebGpu: false },
      null,
      { chromePath, browserGpuMode: "software", requireBeginFrame: true, ...config },
    );
  }

  it("refuses a session forced to screenshot capture before launching Chrome", async () => {
    const session = create({ forceScreenshot: true });

    await expect(session).rejects.toThrow(BeginFrameRequiredError);
    await expect(session).rejects.toThrow(/set to screenshot capture/);
    expect(launch).not.toHaveBeenCalled();
  });

  it("names the software GPU when that is what rules out BeginFrame", async () => {
    await expect(create({ forceScreenshot: false })).rejects.toThrow(
      /browser GPU resolved to software/,
    );
    expect(launch).not.toHaveBeenCalled();
  });
});
