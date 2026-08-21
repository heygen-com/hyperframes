/**
 * Boundary test for the `hyperframes cloudrun render{,-batch}` wire config.
 * Pins that the aspect-agnostic flag reaches `SerializableDistributedRenderConfig`
 * so the Cloud Run worker's compile stage can remap `landscape` → `portrait`.
 *
 * The parse helper itself is covered at `../utils/parseOutputResolution.test.ts`;
 * we only re-check the entrypoint composition here.
 */

import { describe, expect, it } from "vitest";
import {
  buildRenderConfig,
  isMissingCloudRunAdapterError,
  missingCloudRunAdapterMessage,
} from "./cloudrun.js";

describe("cloudrun wire config — aspect-agnostic threading", () => {
  const baseArgs: Record<string, unknown> = {
    format: "mp4",
    codec: undefined,
    quality: undefined,
    "chunk-size": undefined,
    "max-parallel-chunks": undefined,
    "target-chunk-frames": undefined,
  };

  it("threads outputResolutionAspectAgnostic=true through the wire config for portrait 1080p", () => {
    // The exact bug shape: portrait comp + `--output-resolution 1080p`.
    // Before the fix, the alias signal never reached the wire; Cloud Run
    // then hit the same portrait rejection this PR set out to eliminate.
    const config = buildRenderConfig(
      { ...baseArgs, "output-resolution": "1080p" },
      30,
      1080,
      1920,
      undefined,
    );
    expect(config.outputResolution).toBe("landscape");
    expect(config.outputResolutionAspectAgnostic).toBe(true);
  });

  it("keeps the aspect-agnostic key absent when the flag is a canonical preset", () => {
    // Sparse-wire invariant: don't broadcast `false` for the common path —
    // the compile-stage remap only fires on `true`.
    const config = buildRenderConfig(
      { ...baseArgs, "output-resolution": "portrait-4k" },
      30,
      2160,
      3840,
      undefined,
    );
    expect(config.outputResolution).toBe("portrait-4k");
    expect(config).not.toHaveProperty("outputResolutionAspectAgnostic");
  });

  it("omits both resolution fields when --output-resolution is unset", () => {
    const config = buildRenderConfig(baseArgs, 30, 1920, 1080, undefined);
    expect(config).not.toHaveProperty("outputResolution");
    expect(config).not.toHaveProperty("outputResolutionAspectAgnostic");
  });

  it("preserves the surface-labeled strict-throw contract on unknown values", () => {
    // Sanity guard: the local delegate stays wired to the shared helper's
    // throw semantics rather than silently downgrading to undefined. Full
    // input-space coverage lives at `../utils/parseOutputResolution.test.ts`.
    expect(() =>
      buildRenderConfig({ "output-resolution": "8k" }, 30, 1920, 1080, undefined),
    ).toThrow(/\[cloudrun render\]/);
  });
});

describe("Cloud Run adapter preflight", () => {
  it("identifies only the missing adapter, not a missing transitive dependency", () => {
    const adapterError = Object.assign(
      new Error("Cannot find package '@hyperframes/gcp-cloud-run' imported from cli.js"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const transitiveError = Object.assign(new Error("Cannot find package 'google-auth-library'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    expect(isMissingCloudRunAdapterError(adapterError)).toBe(true);
    expect(isMissingCloudRunAdapterError(transitiveError)).toBe(false);
  });

  it("provides global and project-local install recovery commands", () => {
    const message = missingCloudRunAdapterMessage("deploy");
    expect(message).toContain("hyperframes cloudrun deploy");
    expect(message).toContain("npm install -g @hyperframes/gcp-cloud-run");
    expect(message).toContain("npm install @hyperframes/gcp-cloud-run");
  });
});
