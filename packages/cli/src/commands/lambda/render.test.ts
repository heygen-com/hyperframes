/**
 * Boundary tests for the wire config emitted by `hyperframes lambda render`.
 * Pins that the aspect-agnostic resolution flag survives all the way into
 * `SerializableDistributedRenderConfig`, which is what the Lambda worker's
 * compile stage reads before remapping `landscape` → `portrait` for an
 * aspect-agnostic alias like `--output-resolution 1080p`.
 *
 * See `../cloudrun.test.ts` for the parseOutputResolution counterpart and
 * `../render.test.ts` for the local-CLI preflight guardrails.
 */

import { describe, expect, it } from "vitest";
import { buildLambdaRenderConfig, type RenderArgs } from "./render.js";

const BASE_ARGS: RenderArgs = {
  projectDir: "/tmp/hf-project",
  stackName: "hf-test",
  fps: 30,
  width: 1080,
  height: 1920,
  format: "mp4",
  json: false,
  wait: false,
  waitIntervalMs: 5000,
};

describe("buildLambdaRenderConfig — aspect-agnostic wire threading", () => {
  it("threads outputResolutionAspectAgnostic=true through for portrait 1080p", () => {
    // The exact bug shape: portrait 1080×1920 comp + `--output-resolution 1080p`.
    // Before the fix, the aspect-agnostic flag never reached the wire, so
    // the Lambda worker saw the explicit `landscape` preset and rejected
    // the portrait comp — reproducing the local-CLI regression on the
    // distributed path.
    const config = buildLambdaRenderConfig(
      { ...BASE_ARGS, outputResolution: "landscape", outputResolutionAspectAgnostic: true },
      undefined,
    );
    expect(config.outputResolution).toBe("landscape");
    expect(config.outputResolutionAspectAgnostic).toBe(true);
  });

  it("keeps the aspect-agnostic key absent when the flag is a canonical preset", () => {
    // Sparse-wire invariant: only forward `true`; canonical presets stay
    // strict and don't need the compile-stage remap.
    const config = buildLambdaRenderConfig(
      { ...BASE_ARGS, outputResolution: "portrait-4k" },
      undefined,
    );
    expect(config.outputResolution).toBe("portrait-4k");
    expect(config.outputResolutionAspectAgnostic).toBeUndefined();
  });

  it("carries variables verbatim through the wire config", () => {
    const config = buildLambdaRenderConfig(BASE_ARGS, { alice: "hello" });
    expect(config.variables).toEqual({ alice: "hello" });
  });
});
