import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanTooLargeError, plan, type DistributedRenderConfig } from "./plan.js";
import { RenderSpanUnsupportedError, spanFrameRange, spanPlanConfig } from "./renderSpan.js";

describe("spanFrameRange", () => {
  it("is the frames the seconds cover, to the end when --end is absent", () => {
    expect(spanFrameRange(0.5, 1.5, 30, 90)).toEqual({ startFrame: 15, endFrame: 45 });
    expect(spanFrameRange(1, undefined, 30, 90)).toEqual({ startFrame: 30, endFrame: 90 });
  });

  it("stops at the last frame of the film", () => {
    expect(spanFrameRange(2, 9, 30, 90)).toEqual({ startFrame: 60, endFrame: 90 });
  });

  it("refuses a range with no frame, naming how long the film is", () => {
    expect(() => spanFrameRange(3, 4, 30, 90)).toThrow(RenderSpanUnsupportedError);
    expect(() => spanFrameRange(3, 4, 30, 90)).toThrow("90 frames at 30 fps (3s)");
  });
});

describe("spanPlanConfig", () => {
  const FIXTURE_HTML = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">hi</div>
</body></html>`;
  // A 1 KB cap stands in for the 2 GB Lambda cap: any plan is larger than it.
  const config: DistributedRenderConfig = {
    fps: 30,
    width: 320,
    height: 240,
    format: "mp4",
    planDirSizeLimitBytes: 1024,
  };
  let root: string;
  let projectDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-span-plan-cap-"));
    projectDir = mkdtempSync(join(root, "project-"));
    writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("plans a span past the Lambda plan cap, which a distributed plan stops at", async () => {
    let caught: unknown;
    try {
      await plan(projectDir, config, mkdtempSync(join(root, "distributed-")));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanTooLargeError);

    const planned = await plan(
      projectDir,
      spanPlanConfig(config),
      mkdtempSync(join(root, "span-")),
    );
    expect(planned.totalFrames).toBe(30);
  }, 30_000);

  it("keeps the rest of the config and lifts the font guards", () => {
    expect(spanPlanConfig({ ...config, rejectOnSystemFonts: true })).toMatchObject({
      fps: 30,
      width: 320,
      height: 240,
      format: "mp4",
      rejectOnSystemFonts: false,
      failClosedFontFetch: false,
      planDirSizeLimitBytes: Number.MAX_SAFE_INTEGER,
    });
  });
});
