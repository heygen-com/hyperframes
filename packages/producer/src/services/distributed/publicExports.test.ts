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
    expect(distributedSubpath.INVALID_VIDEO_METADATA).toBe("INVALID_VIDEO_METADATA");
    expect(distributedSubpath.PLAN_HASH_MISMATCH).toBe("PLAN_HASH_MISMATCH");
    expect(distributedSubpath.PLAN_V2_INTEGRITY_UNRECOVERABLE).toBe(
      "PLAN_V2_INTEGRITY_UNRECOVERABLE",
    );

    expect(typeof distributedSubpath.PlanTooLargeError).toBe("function");
    expect(typeof distributedSubpath.FormatNotSupportedInDistributedError).toBe("function");
    expect(typeof distributedSubpath.PlanValidationError).toBe("function");
    expect(typeof distributedSubpath.PlanV2IntegrityError).toBe("function");
    expect(typeof distributedSubpath.RenderChunkValidationError).toBe("function");
  });

  it("exports the input-validation helpers", () => {
    expect(typeof distributedSubpath.rejectUnsupportedDistributedFormat).toBe("function");
    expect(typeof distributedSubpath.applyRuntimeEnvSnapshot).toBe("function");
    expect(typeof distributedSubpath.readWebGlVendorInfoFromCanvas).toBe("function");
  });

  it("exports the plan protocol contract", () => {
    expect(distributedSubpath.PLAN_SCHEMA_VERSION).toBe(1);
    expect(distributedSubpath.PLAN_ARTIFACT_LAYOUT).toBe("plan-dir-v1");
    expect(distributedSubpath.PLAN_HASH_SCHEMA).toBe("hyperframes-plan-hash-v1");
    expect(distributedSubpath.PLAN_V2_SCHEMA_VERSION).toBe(2);
    expect(distributedSubpath.PLAN_V2_ARTIFACT_LAYOUT).toBe("content-addressed-plan-v2");
    expect(distributedSubpath.PLAN_V2_HASH_SCHEMA).toBe("hyperframes-plan-manifest-hash-v2");
    expect(distributedSubpath.PLAN_PROTOCOL_UNSUPPORTED).toBe("PLAN_PROTOCOL_UNSUPPORTED");
    expect(distributedSubpath.CURRENT_PLAN_PROTOCOL).toEqual({
      schemaVersion: 1,
      artifactLayout: "plan-dir-v1",
      hashSchema: "hyperframes-plan-hash-v1",
    });
    expect(distributedSubpath.DISTRIBUTED_RENDER_CAPABILITIES.roles).toEqual({
      planner: {
        produces: [distributedSubpath.CURRENT_PLAN_PROTOCOL, distributedSubpath.PLAN_PROTOCOL_V2],
      },
      chunk: {
        accepts: [distributedSubpath.CURRENT_PLAN_PROTOCOL, distributedSubpath.PLAN_PROTOCOL_V2],
        acceptsLegacyV1WithoutDescriptor: true,
      },
      assembler: {
        accepts: [distributedSubpath.CURRENT_PLAN_PROTOCOL, distributedSubpath.PLAN_PROTOCOL_V2],
        acceptsLegacyV1WithoutDescriptor: true,
      },
    });
    expect(typeof distributedSubpath.getDistributedRenderCapabilities).toBe("function");
    expect(typeof distributedSubpath.readPlanProtocol).toBe("function");
    expect(typeof distributedSubpath.planV2).toBe("function");
    expect(typeof distributedSubpath.planV2WithPublisher).toBe("function");
    expect(typeof distributedSubpath.publishPlanV2FromV1).toBe("function");
    expect(typeof distributedSubpath.LocalPlanV2ArtifactPublisher).toBe("function");
    expect(typeof distributedSubpath.renderChunkV2).toBe("function");
    expect(typeof distributedSubpath.assembleV2).toBe("function");
    expect(typeof distributedSubpath.readPlanV2Manifest).toBe("function");
    expect(typeof distributedSubpath.materializePlanV2Target).toBe("function");
    expect(typeof distributedSubpath.PlanProtocolUnsupportedError).toBe("function");
  });
});

describe("@hyperframes/producer (main entry)", () => {
  it("re-exports the three activity functions", () => {
    expect(typeof producerIndex.plan).toBe("function");
    expect(typeof producerIndex.renderChunk).toBe("function");
    expect(typeof producerIndex.assemble).toBe("function");
  });

  it("re-exports the plan protocol contract", () => {
    expect(producerIndex.CURRENT_PLAN_PROTOCOL).toBe(distributedSubpath.CURRENT_PLAN_PROTOCOL);
    expect(producerIndex.DISTRIBUTED_RENDER_CAPABILITIES).toBe(
      distributedSubpath.DISTRIBUTED_RENDER_CAPABILITIES,
    );
    expect(typeof producerIndex.getDistributedRenderCapabilities).toBe("function");
    expect(producerIndex.PLAN_PROTOCOL_UNSUPPORTED).toBe("PLAN_PROTOCOL_UNSUPPORTED");
    expect(producerIndex.PLAN_V2_INTEGRITY_UNRECOVERABLE).toBe("PLAN_V2_INTEGRITY_UNRECOVERABLE");
    expect(typeof producerIndex.readPlanProtocol).toBe("function");
    expect(typeof producerIndex.planV2WithPublisher).toBe("function");
    expect(typeof producerIndex.publishPlanV2FromV1).toBe("function");
    expect(typeof producerIndex.PlanV2IntegrityError).toBe("function");
    expect(typeof producerIndex.PlanProtocolUnsupportedError).toBe("function");
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
