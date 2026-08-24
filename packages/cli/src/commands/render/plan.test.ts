import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CliUsageError } from "../../utils/commandResult.js";
import { createRenderPlan } from "./plan.js";

describe("createRenderPlan", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-plan-"));
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

  it("resolves defaults once into a frozen execution plan", () => {
    const plan = createRenderPlan(
      { dir: projectDir, output: "result.mp4" },
      new Date("2026-07-10T12:34:56Z"),
    );

    expect(plan.fps).toEqual({ num: 24, den: 1 });
    expect(plan.outputPath).toBe(resolve("result.mp4"));
    expect(plan.hdrMode).toBe("auto");
    expect(plan.bestEffort).toBe(true);
    expect(plan.batchConcurrency).toBe(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.environment)).toBe(true);
  });

  // The catalog join reaches the render event through the plan, so a plan that
  // silently drops it would leave every render reporting no catalog items.
  it("resolves catalog usage from the project manifest and the render entry", () => {
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="24">' +
        '<div data-composition-src="compositions/kept.html" data-duration="2"></div></main>',
    );
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    // `<template>`-wrapped, as sub-compositions are actually authored: template
    // content is inert, so a DOM scan of these files would find nothing.
    for (const name of ["kept", "dropped"]) {
      writeFileSync(
        join(projectDir, "compositions", `${name}.html`),
        `<template id="${name}-template"><div data-composition-id="${name}" data-width="1920" data-height="1080"></div></template>`,
      );
    }
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({
        registry: "https://example.test",
        registryItems: [
          { name: "kept", type: "hyperframes:block", target: "compositions/kept.html" },
          { name: "dropped", type: "hyperframes:block", target: "compositions/dropped.html" },
        ],
      }),
    );

    const plan = createRenderPlan({ dir: projectDir, output: "result.mp4" });
    expect(plan.catalogUsage).toEqual({
      installed: ["dropped", "kept"],
      usedBlocks: ["kept"],
      manifestUnreadable: false,
    });
  });

  it("preserves an explicit strict-readiness opt-in", () => {
    const plan = createRenderPlan({ dir: projectDir, "best-effort": false });
    expect(plan.bestEffort).toBe(false);
  });

  it("preserves an aspect-agnostic resolution alias through the execution plan", () => {
    const plan = createRenderPlan({ dir: projectDir, resolution: "1080p" });
    expect(plan.outputResolution).toBe("landscape");
    expect(plan.outputResolutionAspectAgnostic).toBe(true);
    expect(plan.outputResolutionRaw).toBe("1080p");
  });

  it("classifies malformed command input as a usage error", () => {
    expect(() => createRenderPlan({ dir: projectDir, quality: "maximum" })).toThrow(CliUsageError);
  });

  it("rejects batch and single-render variables before execution", () => {
    expect(() =>
      createRenderPlan({ dir: projectDir, batch: "rows.json", variables: '{"name":"Ada"}' }),
    ).toThrow(CliUsageError);
  });

  it("keeps environment changes declarative until execution", () => {
    const previous = process.env.PRODUCER_LOW_MEMORY_MODE;
    delete process.env.PRODUCER_LOW_MEMORY_MODE;
    try {
      const plan = createRenderPlan({ dir: projectDir, "low-memory-mode": true });
      expect(plan.environment).toEqual({ PRODUCER_LOW_MEMORY_MODE: "true" });
      expect(process.env.PRODUCER_LOW_MEMORY_MODE).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PRODUCER_LOW_MEMORY_MODE;
      else process.env.PRODUCER_LOW_MEMORY_MODE = previous;
    }
  });

  it("resolves a relative frame-cache directory into the execution environment", () => {
    const plan = createRenderPlan({ dir: projectDir, "frames-cache-dir": "./frame-cache" });
    expect(plan.environment.HYPERFRAMES_EXTRACT_CACHE_DIR).toBe(resolve("./frame-cache"));
  });

  it("preserves frame-cache disable aliases for engine normalization", () => {
    const plan = createRenderPlan({ dir: projectDir, "frames-cache-dir": "OFF" });
    expect(plan.environment.HYPERFRAMES_EXTRACT_CACHE_DIR).toBe("OFF");
  });

  it("attributes a flag-less render to the skill persisted in hyperframes.json", () => {
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ authoringSkill: "product-launch-video" }),
    );
    const plan = createRenderPlan({ dir: projectDir });
    expect(plan.authoringSkill).toBe("product-launch-video");
  });

  it("lets an explicit --skill flag override the persisted project owner", () => {
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ authoringSkill: "product-launch-video" }),
    );
    const plan = createRenderPlan({ dir: projectDir, skill: "motion-graphics" });
    expect(plan.authoringSkill).toBe("motion-graphics");
  });
});
