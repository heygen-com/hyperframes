/**
 * Unit tests for the public-export surface of the distributed primitives.
 *
 * Two import paths must work for adopters:
 *
 *   1. `import { plan, renderChunk, assemble } from "@hyperframes/producer"`
 *      — the canonical package entry. Includes the three activity functions
 *      and their result types.
 *
 *   2. `import { plan, renderChunk, assemble } from "@hyperframes/producer/distributed"`
 *      — the focused subpath, suitable for Lambda chunk-runner images that
 *      don't pull in the in-process renderer's transitive deps.
 *
 * These tests are surface-only: they assert the symbols exist and have the
 * expected shapes. The functional behaviour is covered by `plan.test.ts` /
 * `renderChunk.test.ts` / `assemble.test.ts`.
 *
 * We import via the workspace-relative `../../distributed.js` /
 * `../../index.js` paths rather than `"@hyperframes/producer"` because the
 * package resolver inside the workspace points back at `src/index.ts` —
 * either form exercises the same surface.
 */

import { describe, expect, it } from "bun:test";
import * as distributedSubpath from "../../distributed.js";
import * as producerIndex from "../../index.js";

describe("@hyperframes/producer/distributed (subpath)", () => {
  it("exports the three activity functions", () => {
    expect(typeof distributedSubpath.plan).toBe("function");
    expect(typeof distributedSubpath.renderChunk).toBe("function");
    expect(typeof distributedSubpath.assemble).toBe("function");
  });

  it("exports the chunking helpers + constants", () => {
    expect(typeof distributedSubpath.resolveChunkPlan).toBe("function");
    expect(typeof distributedSubpath.buildChunkSlices).toBe("function");
    expect(typeof distributedSubpath.measurePlanDirBytes).toBe("function");
    expect(distributedSubpath.DEFAULT_CHUNK_SIZE).toBe(240);
    expect(distributedSubpath.DEFAULT_MAX_PARALLEL_CHUNKS).toBe(16);
    expect(distributedSubpath.PLAN_DIR_SIZE_LIMIT_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  it("exports the non-retryable error codes + classes", () => {
    expect(distributedSubpath.PLAN_TOO_LARGE).toBe("PLAN_TOO_LARGE");
    expect(distributedSubpath.DISTRIBUTED_DURATION_OUT_OF_RANGE).toBe(
      "DISTRIBUTED_DURATION_OUT_OF_RANGE",
    );
    expect(distributedSubpath.MAX_DISTRIBUTED_DURATION_SECONDS).toBe(24 * 60 * 60);
    expect(distributedSubpath.FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED).toBe(
      "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
    );
    expect(distributedSubpath.FFMPEG_VERSION_MISMATCH).toBe("FFMPEG_VERSION_MISMATCH");
    expect(distributedSubpath.PLAN_HASH_MISMATCH).toBe("PLAN_HASH_MISMATCH");

    expect(typeof distributedSubpath.PlanTooLargeError).toBe("function");
    expect(typeof distributedSubpath.FormatNotSupportedInDistributedError).toBe("function");
    expect(typeof distributedSubpath.PlanValidationError).toBe("function");
    expect(typeof distributedSubpath.RenderChunkValidationError).toBe("function");
  });

  it("exports the input-validation helpers", () => {
    expect(typeof distributedSubpath.rejectUnsupportedDistributedFormat).toBe("function");
    expect(typeof distributedSubpath.applyRuntimeEnvSnapshot).toBe("function");
    expect(typeof distributedSubpath.readWebGlVendorInfoFromCanvas).toBe("function");
  });
});

describe("@hyperframes/producer (main entry)", () => {
  it("re-exports the three activity functions", () => {
    expect(typeof producerIndex.plan).toBe("function");
    expect(typeof producerIndex.renderChunk).toBe("function");
    expect(typeof producerIndex.assemble).toBe("function");
  });

  it("preserves the existing in-process exports (executeRenderJob unchanged)", () => {
    // The distributed primitives must NOT break the in-process surface;
    // spot-check the load-bearing exports the in-process callers rely on.
    expect(typeof producerIndex.executeRenderJob).toBe("function");
    expect(typeof producerIndex.createRenderJob).toBe("function");
    expect(typeof producerIndex.createCaptureSession).toBe("function");
    expect(typeof producerIndex.createFileServer).toBe("function");
  });
});
