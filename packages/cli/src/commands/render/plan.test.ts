import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
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

  // GIF's Netscape frame-delay field is stored in centiseconds, so fps above
  // 30 rounds to visually-indistinguishable delay values. createRenderPlan
  // clamps and flags it so both the CLI console warning (present.ts) and
  // render telemetry (gif_fps_capped) can report the same decision.
  it("caps fps to 30 and flags it for --format gif above the ceiling", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.gif",
      format: "gif",
      fps: "60",
    });
    expect(plan.fps).toEqual({ num: 30, den: 1 });
    expect(plan.gifFpsCapped).toBe(true);
  });

  it("does not flag gifFpsCapped for gif fps at or below the ceiling", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.gif",
      format: "gif",
      fps: "24",
    });
    expect(plan.fps).toEqual({ num: 24, den: 1 });
    expect(plan.gifFpsCapped).toBe(false);
  });

  it("does not flag gifFpsCapped for non-gif formats regardless of fps", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.mp4",
      format: "mp4",
      fps: "60",
    });
    expect(plan.fps).toEqual({ num: 60, den: 1 });
    expect(plan.gifFpsCapped).toBe(false);
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

  it("maps looks to standard encode with CRF 16, and delivery to high", () => {
    expect(createRenderPlan({ dir: projectDir, quality: "looks" })).toMatchObject({
      quality: "standard",
      crf: 16,
    });
    expect(createRenderPlan({ dir: projectDir, quality: "delivery" })).toMatchObject({
      quality: "high",
      crf: undefined,
    });
    expect(createRenderPlan({ dir: projectDir })).toMatchObject({ quality: "standard", crf: 16 });
  });

  it("does not inject looks CRF when --crf or MOV is already set", () => {
    expect(createRenderPlan({ dir: projectDir, quality: "looks", crf: "20" }).crf).toBe(20);
    expect(
      createRenderPlan({ dir: projectDir, format: "mov", quality: "looks" }).crf,
    ).toBeUndefined();
  });

  it.each([
    ["--crf", { crf: "18" }],
    ["--video-bitrate", { "video-bitrate": "78M" }],
  ])("rejects unsupported %s rate control for ProRes MOV", (flag, encoderArgs) => {
    expect(() => createRenderPlan({ dir: projectDir, format: "mov", ...encoderArgs })).toThrow(
      CliUsageError,
    );
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(flag);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      "fixed alpha-preserving ProRes 4444",
    );
  });

  it("keeps MOV quality tiers on the fixed alpha-preserving profile", () => {
    const plan = createRenderPlan({ dir: projectDir, format: "mov", quality: "high" });

    expect(plan).toMatchObject({ format: "mov", quality: "high" });
    expect(plan.crf).toBeUndefined();
    expect(plan.videoBitrate).toBeUndefined();
  });

  it("plans HLS as directory output with the default segment length", () => {
    const plan = createRenderPlan({ dir: projectDir, format: "hls" });

    expect(plan.format).toBe("hls");
    expect(plan.hlsSegmentSeconds).toBe(4);
    // No extension: outputPath is the directory the playlists are written into.
    expect(plan.outputPath.startsWith(resolve("renders", plan.project.name))).toBe(true);
    expect(basename(plan.outputPath)).not.toContain(".");
  });

  it("carries an explicit --hls-segment-seconds and rejects a fractional one", () => {
    expect(
      createRenderPlan({ dir: projectDir, format: "hls", "hls-segment-seconds": "6" })
        .hlsSegmentSeconds,
    ).toBe(6);
    expect(() =>
      createRenderPlan({ dir: projectDir, format: "hls", "hls-segment-seconds": "2.5" }),
    ).toThrow(CliUsageError);
  });

  it("leaves hlsSegmentSeconds unset for other formats", () => {
    expect(
      createRenderPlan({ dir: projectDir, format: "mp4", "hls-segment-seconds": "6" })
        .hlsSegmentSeconds,
    ).toBeUndefined();
  });

  it.each([
    ["--hdr", { hdr: true }],
    ["--gpu", { gpu: true }],
  ])("rejects %s with HLS output", (flag, conflicting) => {
    expect(() => createRenderPlan({ dir: projectDir, format: "hls", ...conflicting })).toThrow(
      CliUsageError,
    );
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(flag);
  });

  it("keeps MP4 and WebM rate controls available", () => {
    expect(createRenderPlan({ dir: projectDir, format: "mp4", crf: "18" }).crf).toBe(18);
    expect(
      createRenderPlan({ dir: projectDir, format: "webm", "video-bitrate": "10M" }).videoBitrate,
    ).toBe("10M");
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
    expect(plan.authoringSkillSource).toBe("project-config");
    expect(plan.invalidAuthoringSkill).toBeUndefined();
  });

  it("lets an explicit --skill flag override the persisted project owner", () => {
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ authoringSkill: "product-launch-video" }),
    );
    const plan = createRenderPlan({ dir: projectDir, skill: "motion-graphics" });
    expect(plan.authoringSkill).toBe("motion-graphics");
    expect(plan.authoringSkillSource).toBe("flag");
  });

  it("reports no authoring skill source when neither a flag nor a project config resolved one", () => {
    const plan = createRenderPlan({ dir: projectDir });
    expect(plan.authoringSkill).toBeUndefined();
    expect(plan.authoringSkillSource).toBeUndefined();
  });

  describe("motion blur", () => {
    it("is absent unless the flag or the project config asks for it", () => {
      expect(createRenderPlan({ dir: projectDir }).motionBlur).toBeUndefined();
    });

    it("reads a bare --motion-blur as the engine's own defaults", () => {
      const plan = createRenderPlan({ dir: projectDir, "motion-blur": "" });
      expect(plan.motionBlur).toEqual({});
    });

    it("parses the angle:phase:samples micro-syntax", () => {
      const plan = createRenderPlan({ dir: projectDir, "motion-blur": "180:-90:16" });
      expect(plan.motionBlur).toEqual({
        shutterAngle: 180,
        shutterPhase: -90,
        samplesPerFrame: 16,
      });
    });

    // The whole point of the config key: the After Effects exporter writes the
    // comp's own shutter into hyperframes.json, so a later flag-less render of
    // that project blurs without the caller restating anything.
    it("falls back to the project's hyperframes.json render.motionBlur", () => {
      writeFileSync(
        join(projectDir, "hyperframes.json"),
        JSON.stringify({ render: { motionBlur: { shutterAngle: 720, shutterPhase: -360 } } }),
      );
      const plan = createRenderPlan({ dir: projectDir });
      expect(plan.motionBlur).toEqual({ shutterAngle: 720, shutterPhase: -360 });
    });

    it("lets an explicit flag override the project config field by field", () => {
      writeFileSync(
        join(projectDir, "hyperframes.json"),
        JSON.stringify({
          render: { motionBlur: { shutterAngle: 720, shutterPhase: -360, samplesPerFrame: 32 } },
        }),
      );
      const plan = createRenderPlan({ dir: projectDir, "motion-blur": "180:-90:16" });
      expect(plan.motionBlur).toEqual({
        shutterAngle: 180,
        shutterPhase: -90,
        samplesPerFrame: 16,
      });
    });

    // citty reports `--no-motion-blur` as the boolean false, which is a
    // deliberate opt-out and has to beat a config that turns the option on.
    it("lets --no-motion-blur switch off a project config that turned it on", () => {
      writeFileSync(
        join(projectDir, "hyperframes.json"),
        JSON.stringify({ render: { motionBlur: { shutterAngle: 720 } } }),
      );
      expect(
        createRenderPlan({ dir: projectDir, "motion-blur": false }).motionBlur,
      ).toBeUndefined();
    });

    // The opt-out travels separately from `motionBlur === undefined`, because a
    // Docker render forwards the option set it was given and the in-container
    // CLI re-reads the same hyperframes.json. Without a durable flag the
    // container's fallback would silently re-enable the blur.
    it("records --no-motion-blur as a durable opt-out alongside the absent option", () => {
      writeFileSync(
        join(projectDir, "hyperframes.json"),
        JSON.stringify({ render: { motionBlur: { shutterAngle: 720 } } }),
      );
      const plan = createRenderPlan({ dir: projectDir, "motion-blur": false });
      expect(plan.motionBlur).toBeUndefined();
      expect(plan.motionBlurOff).toBe(true);
      // A normal render (flag absent) leaves the opt-out off, so the project
      // config still applies.
      expect(createRenderPlan({ dir: projectDir }).motionBlurOff).toBe(false);
      expect(createRenderPlan({ dir: projectDir }).motionBlur).toEqual({ shutterAngle: 720 });
    });

    it("classifies a malformed flag value as a usage error", () => {
      expect(() => createRenderPlan({ dir: projectDir, "motion-blur": "./my-video" })).toThrow(
        CliUsageError,
      );
    });
  });

  it("preserves a malformed --skill value for telemetry without adopting it as authoringSkill", () => {
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ authoringSkill: "product-launch-video" }),
    );
    // Fails SKILL_SLUG (spaces, uppercase): normalizeSkillSlug rejects the shape,
    // not a registry of known skill names.
    const plan = createRenderPlan({ dir: projectDir, skill: "Not A Skill!" });
    expect(plan.invalidAuthoringSkill).toBe("Not A Skill!");
    // The invalid flag never wins attribution: the project's own config still does.
    expect(plan.authoringSkill).toBe("product-launch-video");
    expect(plan.authoringSkillSource).toBe("project-config");
  });

  describe("hfEnvOverrides", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const OVERRIDE_KEYS = [
      "HF_DE_VERIFY",
      "HF_TEST_ENV_INT",
      "HYPERFRAMES_ZZZ_TEST_OVERRIDE",
      "HYPERFRAMES_AAA_TEST_OVERRIDE",
      "HF_SHADER_WORKER_ENTRY",
    ];

    beforeEach(() => {
      for (const key of OVERRIDE_KEYS) savedEnv[key] = process.env[key];
    });

    afterEach(() => {
      for (const key of OVERRIDE_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it("reports an array (never absent) and never includes a key this test didn't set", () => {
      for (const key of OVERRIDE_KEYS) delete process.env[key];
      const plan = createRenderPlan({ dir: projectDir });
      expect(Array.isArray(plan.hfEnvOverrides)).toBe(true);
      for (const key of OVERRIDE_KEYS) expect(plan.hfEnvOverrides).not.toContain(key);
    });

    it("reports the sorted names (never values) of set HF_/HYPERFRAMES_ env vars", () => {
      process.env.HF_TEST_ENV_INT = "some-path-that-must-not-leak";
      process.env.HYPERFRAMES_ZZZ_TEST_OVERRIDE = "another-secret-looking-value";
      const plan = createRenderPlan({ dir: projectDir });
      expect(plan.hfEnvOverrides).toContain("HF_TEST_ENV_INT");
      expect(plan.hfEnvOverrides).toContain("HYPERFRAMES_ZZZ_TEST_OVERRIDE");
      expect(plan.hfEnvOverrides.join(" ")).not.toContain("some-path-that-must-not-leak");
      expect(plan.hfEnvOverrides.join(" ")).not.toContain("another-secret-looking-value");
    });

    it("sorts names rather than reporting them in process.env's insertion order", () => {
      process.env.HYPERFRAMES_ZZZ_TEST_OVERRIDE = "1";
      process.env.HYPERFRAMES_AAA_TEST_OVERRIDE = "1";
      const plan = createRenderPlan({ dir: projectDir });
      const indexOfAaa = plan.hfEnvOverrides.indexOf("HYPERFRAMES_AAA_TEST_OVERRIDE");
      const indexOfZzz = plan.hfEnvOverrides.indexOf("HYPERFRAMES_ZZZ_TEST_OVERRIDE");
      expect(indexOfAaa).toBeGreaterThanOrEqual(0);
      expect(indexOfAaa).toBeLessThan(indexOfZzz);
    });

    it("never reports the CLI's own shader-worker bootstrap key as an operator override", () => {
      // A real CLI run reaches this point with the key already set by cli.ts's bootstrap;
      // no test in this file goes through that bootstrap, so set it here.
      process.env.HF_SHADER_WORKER_ENTRY = "/some/dist/shaderTransitionWorker.js";
      const plan = createRenderPlan({ dir: projectDir });
      expect(plan.hfEnvOverrides).not.toContain("HF_SHADER_WORKER_ENTRY");
    });
  });
});
