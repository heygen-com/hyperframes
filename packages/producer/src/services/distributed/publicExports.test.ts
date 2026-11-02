import { describe, expect, it } from "bun:test";
import * as distributedSubpath from "../../distributed.js";
import * as producerIndex from "../../index.js";

const REMOVED_PLAN_V1_EXPORTS = [
  "plan",
  "PLAN_TOO_LARGE",
  "PlanTooLargeError",
  "CURRENT_PLAN_PROTOCOL",
  "DISTRIBUTED_RENDER_CAPABILITIES",
  "getDistributedRenderCapabilities",
  "PLAN_ARTIFACT_LAYOUT",
  "PLAN_HASH_SCHEMA",
  "PLAN_PROTOCOL_V1",
  "PLAN_SCHEMA_VERSION",
  "readPlanProtocol",
  "readPlanProtocolV1",
  "createPlanV2FromV1",
  "publishPlanV2FromV1",
] as const;

describe("distributed public exports", () => {
  it("exposes Plan v2 as the only distributed plan transport", () => {
    for (const name of REMOVED_PLAN_V1_EXPORTS) {
      expect(name in distributedSubpath).toBe(false);
      expect(name in producerIndex).toBe(false);
    }

    expect(distributedSubpath.PLAN_PROTOCOL_V2).toEqual({
      schemaVersion: 2,
      artifactLayout: "content-addressed-plan-v2",
      hashSchema: "hyperframes-plan-manifest-hash-v2",
    });
    expect(typeof distributedSubpath.planV2).toBe("function");
    expect(typeof distributedSubpath.planV2WithPublisher).toBe("function");
    expect(typeof distributedSubpath.createPlanV2FromExecutionPlan).toBe("function");
    expect(typeof distributedSubpath.publishPlanV2FromExecutionPlan).toBe("function");
    expect(typeof distributedSubpath.renderChunkV2).toBe("function");
    expect(typeof distributedSubpath.assembleV2).toBe("function");
  });

  it("keeps execution primitives used after Plan v2 materialization", () => {
    expect(typeof distributedSubpath.renderChunk).toBe("function");
    expect(typeof distributedSubpath.assemble).toBe("function");
    expect(typeof distributedSubpath.materializePlanV2Target).toBe("function");
    expect(typeof distributedSubpath.readPlanV2Manifest).toBe("function");
  });

  it("keeps the in-process renderer public surface unchanged", () => {
    expect(typeof producerIndex.executeRenderJob).toBe("function");
    expect(typeof producerIndex.createRenderJob).toBe("function");
    expect(typeof producerIndex.createCaptureSession).toBe("function");
    expect(typeof producerIndex.createFileServer).toBe("function");
  });
});
