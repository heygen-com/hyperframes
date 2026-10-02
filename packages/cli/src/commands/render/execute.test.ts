import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderPlan } from "./plan.js";
import { renderOptionsFromPlan } from "./execute.js";

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
    rmSync(projectDir, { recursive: true, force: true });
  });

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
