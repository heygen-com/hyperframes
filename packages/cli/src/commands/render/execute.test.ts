import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderPlan } from "./plan.js";
import { batchRowRenderOptions, executeRenderPlan, renderOptionsFromPlan } from "./execute.js";
import * as manager from "../../browser/manager.js";
import * as system from "../../telemetry/system.js";
import { buildDockerArgsForRender, wantsDesktopHint } from "../render.js";

describe("renderOptionsFromPlan", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-execute-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="24"></main>',
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it.each([
    ["explicit enabled", true, undefined, true],
    ["explicit disabled", false, undefined, false],
    ["omitted", undefined, undefined, undefined],
    ["environment fallback", undefined, "on", true],
    ["explicit flag precedence", false, "true", false],
  ] as const)(
    "carries %s low-memory configuration through single and batch Docker argv",
    (_label, flagValue, envValue, expected) => {
      vi.stubEnv("PRODUCER_LOW_MEMORY_MODE", envValue);
      const plan = createRenderPlan({
        dir: projectDir,
        docker: true,
        "low-memory-mode": flagValue,
      });

      const optionSets = [
        renderOptionsFromPlan(plan, undefined, undefined),
        batchRowRenderOptions(plan, undefined),
      ];
      for (const options of optionSets) {
        expect(options.lowMemoryMode).toBe(expected);
        const dockerArgs = buildDockerArgsForRender({
          projectDir,
          outputPath: join(projectDir, "out.mp4"),
          options,
          imageTag: "hyperframes-renderer:test",
          platform: "linux/amd64",
        });
        expect(dockerArgs.filter((arg) => arg.startsWith("PRODUCER_LOW_MEMORY_MODE="))).toEqual(
          expected === undefined ? [] : [`PRODUCER_LOW_MEMORY_MODE=${String(expected)}`],
        );
      }
    },
  );

  it.each([undefined, "off"] as const)(
    "preserves page motion blur %s for single and batch renders",
    (value) => {
      const plan = createRenderPlan({ dir: projectDir, "page-motion-blur": value });
      expect(renderOptionsFromPlan(plan, undefined, undefined).pageMotionBlur).toBe(value);
      expect(batchRowRenderOptions(plan, undefined).pageMotionBlur).toBe(value);
    },
  );

  it("carries the segmented resume flags from the plan into the render options", () => {
    // The hop that once dropped --resume / --keep-segments silently; the plan
    // -> options -> request -> config chain is otherwise only exercised by a
    // manual render gate.
    const off = renderOptionsFromPlan(createRenderPlan({ dir: projectDir }), undefined, undefined);
    expect(off.resumeSegments).toBe(false);
    expect(off.keepSegments).toBe(false);
    const on = renderOptionsFromPlan(
      createRenderPlan({ dir: projectDir, resume: true, "keep-segments": true }),
      "/usr/bin/chrome",
      { title: "x" },
    );
    expect(on.resumeSegments).toBe(true);
    expect(on.keepSegments).toBe(true);
    expect(on.browserPath).toBe("/usr/bin/chrome");
    expect(on.variables).toEqual({ title: "x" });
  });
});

describe("the desktop-app line after a render", () => {
  it("comes after every render but a batch row", () => {
    expect(wantsDesktopHint({})).toBe(true);
    expect(wantsDesktopHint({ desktopHint: false })).toBe(false);
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-batch-"));
    try {
      writeFileSync(join(projectDir, "index.html"), '<main data-composition-id="main"></main>');
      const row = batchRowRenderOptions(createRenderPlan({ dir: projectDir }), undefined);
      expect(wantsDesktopHint(row)).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("a render on a nearly full disk", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-disk-"));
    writeFileSync(join(projectDir, "index.html"), '<main data-composition-id="main"></main>');
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // A first render downloads its browser; on a disk that fills mid-unzip, unzip waits on a prompt forever.
  it.each([
    { freeMb: 400, downloads: false },
    { freeMb: 4096, downloads: true },
  ])(
    "checks the disk before getting the browser: $freeMb MB free",
    async ({ freeMb, downloads }) => {
      const sweep = vi.spyOn(manager, "sweepKilledInstalls").mockResolvedValue();
      const freeDisk = vi.spyOn(system, "getFreeDiskMb").mockReturnValue(freeMb);
      const ensureBrowser = vi
        .spyOn(manager, "ensureBrowser")
        .mockRejectedValue(new Error("offline"));
      const plan = createRenderPlan({ dir: projectDir, quiet: true });

      await expect(executeRenderPlan(plan, {} as never)).rejects.toThrow("Command failed");

      expect(ensureBrowser).toHaveBeenCalledTimes(downloads ? 1 : 0);
      expect(sweep.mock.invocationCallOrder[0]).toBeLessThan(
        freeDisk.mock.invocationCallOrder[0] ?? 0,
      );
      const said = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(said.includes("Low disk space")).toBe(!downloads);
    },
  );
});
