import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderPlan, type RenderCommandArgs } from "./plan.js";
import { presentRenderPlan } from "./present.js";

describe("presentRenderPlan", () => {
  let projectDir: string;
  let printed: string[];

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-present-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="30"></main>',
    );
    printed = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      printed.push(String(line ?? ""));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function settingsLine(args: Omit<RenderCommandArgs, "dir">): Promise<string | undefined> {
    await presentRenderPlan(createRenderPlan({ dir: projectDir, workers: "2", ...args }));
    return printed.find((line) => line.includes("2 workers"));
  }

  it.each([
    [{}, "looks (CRF 16)"],
    [{ quality: "draft" }, "draft"],
    [{ quality: "standard" }, "standard"],
    [{ quality: "delivery" }, "delivery"],
    [{ crf: "20" }, "looks (CRF 20)"],
    [{ "video-bitrate": "10M" }, "looks (10M)"],
  ])("names the quality it encodes with for %o", async (args, label) => {
    expect(await settingsLine(args)).toContain(`30fps · ${label} · 2 workers`);
  });
});
