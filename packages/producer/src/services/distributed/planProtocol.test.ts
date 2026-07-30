// These protocol rejection cases intentionally repeat the arrange/assert shape
// so each malformed wire descriptor remains independently readable.
// fallow-ignore-file code-duplication

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "./assemble.js";
import {
  CURRENT_PLAN_PROTOCOL,
  DISTRIBUTED_RENDER_CAPABILITIES,
  getDistributedRenderCapabilities,
  PLAN_ARTIFACT_LAYOUT,
  PLAN_HASH_SCHEMA,
  PLAN_PROTOCOL_V1,
  PLAN_PROTOCOL_V2,
  PLAN_PROTOCOL_UNSUPPORTED,
  PLAN_SCHEMA_VERSION,
  PlanProtocolUnsupportedError,
  readPlanProtocol,
  type DistributedRenderCapabilities,
  type PlanProtocolConsumerCapabilities,
  type PlanProtocolDescriptor,
} from "./planProtocol.js";
import {
  CHUNK_INDEX_OUT_OF_RANGE,
  renderChunk,
  RenderChunkValidationError,
} from "./renderChunk.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function expectUnsupported(run: () => unknown): PlanProtocolUnsupportedError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PlanProtocolUnsupportedError);
  expect((caught as PlanProtocolUnsupportedError).code).toBe(PLAN_PROTOCOL_UNSUPPORTED);
  return caught as PlanProtocolUnsupportedError;
}

function createReaderPlan(options: {
  protocol?: unknown;
  includeProtocol?: boolean;
  malformedDownstreamArtifacts?: boolean;
  omitDownstreamArtifacts?: boolean;
}): string {
  const planDir = mkdtempSync(join(tmpdir(), "hf-plan-protocol-"));
  tempDirs.push(planDir);

  const planJson: Record<string, unknown> = {
    planHash: "fake",
    totalFrames: 1,
    hasAudio: false,
    dimensions: {
      fpsNum: 30,
      fpsDen: 1,
      width: 16,
      height: 16,
      format: "png-sequence",
    },
  };
  if (options.includeProtocol === true) {
    planJson.protocol = options.protocol;
  }

  writeFileSync(join(planDir, "plan.json"), JSON.stringify(planJson), "utf-8");
  if (options.omitDownstreamArtifacts === true) {
    return planDir;
  }

  mkdirSync(join(planDir, "meta"), { recursive: true });
  writeFileSync(
    join(planDir, "meta", "encoder.json"),
    options.malformedDownstreamArtifacts ? "{not-json" : "{}",
    "utf-8",
  );
  writeFileSync(
    join(planDir, "meta", "chunks.json"),
    options.malformedDownstreamArtifacts
      ? "{not-json"
      : JSON.stringify([{ index: 0, startFrame: 0, endFrame: 1 }]),
    "utf-8",
  );
  return planDir;
}

describe("readPlanProtocol()", () => {
  it("keeps the v1 descriptor byte-for-byte and identity-compatible", () => {
    expect(PLAN_PROTOCOL_V1).toBe(CURRENT_PLAN_PROTOCOL);
    expect(JSON.stringify(PLAN_PROTOCOL_V1)).toBe(
      '{"schemaVersion":1,"artifactLayout":"plan-dir-v1","hashSchema":"hyperframes-plan-hash-v1"}',
    );
  });

  it("treats an absent descriptor as legacy v1", () => {
    expect(readPlanProtocol({ planHash: "legacy" })).toBe(CURRENT_PLAN_PROTOCOL);
  });

  it("enforces whether a worker accepts descriptor-less legacy v1 plans", () => {
    const capabilities: PlanProtocolConsumerCapabilities = {
      accepts: [CURRENT_PLAN_PROTOCOL],
      acceptsLegacyV1WithoutDescriptor: false,
    };

    expectUnsupported(() => readPlanProtocol({ planHash: "legacy" }, capabilities));
  });

  it("enforces the worker's accepted protocol set", () => {
    const capabilities: PlanProtocolConsumerCapabilities = {
      accepts: [],
      acceptsLegacyV1WithoutDescriptor: true,
    };

    expectUnsupported(() => readPlanProtocol({ protocol: CURRENT_PLAN_PROTOCOL }, capabilities));
    expectUnsupported(() => readPlanProtocol({ planHash: "legacy" }, capabilities));
  });

  it("accepts the known v1 descriptor and ignores unknown optional fields", () => {
    expect(
      readPlanProtocol({
        protocol: {
          schemaVersion: PLAN_SCHEMA_VERSION,
          artifactLayout: PLAN_ARTIFACT_LAYOUT,
          hashSchema: PLAN_HASH_SCHEMA,
          producerBuildId: "optional-future-metadata",
        },
      }),
    ).toBe(CURRENT_PLAN_PROTOCOL);
  });

  it("accepts the explicit v2 descriptor", () => {
    expect(readPlanProtocol({ protocol: PLAN_PROTOCOL_V2 })).toBe(PLAN_PROTOCOL_V2);
  });

  it("rejects malformed and partial descriptors", () => {
    for (const protocol of [
      null,
      [],
      "v1",
      {},
      { schemaVersion: PLAN_SCHEMA_VERSION },
      {
        schemaVersion: PLAN_SCHEMA_VERSION,
        artifactLayout: PLAN_ARTIFACT_LAYOUT,
      },
    ]) {
      expectUnsupported(() => readPlanProtocol({ protocol }));
    }
  });

  it("rejects unknown schema, layout, and hash-schema values", () => {
    for (const protocol of [
      { ...CURRENT_PLAN_PROTOCOL, schemaVersion: 2 },
      { ...CURRENT_PLAN_PROTOCOL, artifactLayout: "plan-dir-v2" },
      { ...CURRENT_PLAN_PROTOCOL, hashSchema: "hyperframes-plan-hash-v2" },
    ]) {
      expectUnsupported(() => readPlanProtocol({ protocol }));
    }
  });

  it("keeps unsupported-protocol messages bounded and non-reflective", () => {
    const untrustedValue = "secret-".repeat(1_000);
    const error = expectUnsupported(() =>
      readPlanProtocol({
        protocol: { ...CURRENT_PLAN_PROTOCOL, hashSchema: untrustedValue },
      }),
    );

    expect(error.message).not.toContain("secret-");
    expect(error.message.length).toBeLessThan(200);
  });
});

describe("getDistributedRenderCapabilities()", () => {
  it("reports explicit v1 and v2 support for every distributed role", () => {
    expect(getDistributedRenderCapabilities()).toBe(DISTRIBUTED_RENDER_CAPABILITIES);
    expect(DISTRIBUTED_RENDER_CAPABILITIES).toEqual({
      roles: {
        planner: {
          produces: [CURRENT_PLAN_PROTOCOL, PLAN_PROTOCOL_V2],
        },
        chunk: {
          accepts: [CURRENT_PLAN_PROTOCOL, PLAN_PROTOCOL_V2],
          acceptsLegacyV1WithoutDescriptor: true,
        },
        assembler: {
          accepts: [CURRENT_PLAN_PROTOCOL, PLAN_PROTOCOL_V2],
          acceptsLegacyV1WithoutDescriptor: true,
        },
      },
    });
  });

  it("can express a v2 planner with dual-version readers", () => {
    const futureV2: PlanProtocolDescriptor = {
      schemaVersion: 2,
      artifactLayout: "plan-dir-v2",
      hashSchema: "hyperframes-plan-hash-v2",
    };
    const rolloutCapabilities: DistributedRenderCapabilities = {
      roles: {
        planner: {
          produces: [futureV2],
        },
        chunk: {
          accepts: [CURRENT_PLAN_PROTOCOL, futureV2],
          acceptsLegacyV1WithoutDescriptor: true,
        },
        assembler: {
          accepts: [CURRENT_PLAN_PROTOCOL, futureV2],
          acceptsLegacyV1WithoutDescriptor: true,
        },
      },
    };

    expect(rolloutCapabilities.roles.planner.produces).toEqual([futureV2]);
    expect(rolloutCapabilities.roles.chunk.accepts).toEqual([CURRENT_PLAN_PROTOCOL, futureV2]);
    expect(rolloutCapabilities.roles.assembler.accepts).toEqual([CURRENT_PLAN_PROTOCOL, futureV2]);
  });
});

describe("distributed plan protocol readers", () => {
  it("renderChunk accepts a legacy plan without a descriptor", async () => {
    const planDir = createReaderPlan({});

    let caught: unknown;
    try {
      await renderChunk(planDir, 999, join(planDir, "unused-output"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderChunkValidationError);
    expect((caught as RenderChunkValidationError).code).toBe(CHUNK_INDEX_OUT_OF_RANGE);
  });

  it("assemble accepts a legacy plan without a descriptor", async () => {
    const planDir = createReaderPlan({});
    const missingChunk = join(planDir, "missing-chunk");

    await expect(
      assemble(planDir, [missingChunk], null, join(planDir, "unused-output")),
    ).rejects.toThrow("chunk path does not exist");
  });

  it("renderChunk rejects an unknown v2 protocol before requiring v1 artifacts", async () => {
    const planDir = createReaderPlan({
      includeProtocol: true,
      protocol: { ...CURRENT_PLAN_PROTOCOL, schemaVersion: 2 },
      omitDownstreamArtifacts: true,
    });

    let caught: unknown;
    try {
      await renderChunk(planDir, 0, join(planDir, "unused-output"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PlanProtocolUnsupportedError);
    expect((caught as PlanProtocolUnsupportedError).code).toBe(PLAN_PROTOCOL_UNSUPPORTED);
  });

  it("assemble rejects an unknown v2 protocol before requiring v1 artifacts", async () => {
    const planDir = createReaderPlan({
      includeProtocol: true,
      protocol: { ...CURRENT_PLAN_PROTOCOL, schemaVersion: 2 },
      omitDownstreamArtifacts: true,
    });

    let caught: unknown;
    try {
      await assemble(planDir, [], null, join(planDir, "unused-output"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PlanProtocolUnsupportedError);
    expect((caught as PlanProtocolUnsupportedError).code).toBe(PLAN_PROTOCOL_UNSUPPORTED);
  });

  it("legacy activities reject a recognized v2 root before v1 layout access", async () => {
    const planDir = createReaderPlan({
      includeProtocol: true,
      protocol: PLAN_PROTOCOL_V2,
      omitDownstreamArtifacts: true,
    });

    await expect(renderChunk(planDir, 0, join(planDir, "unused-output"))).rejects.toThrow(
      "must be materialized before v1 layout access",
    );
    await expect(assemble(planDir, [], null, join(planDir, "unused-output"))).rejects.toThrow(
      "must be materialized before v1 layout access",
    );
  });

  it("assemble rejects a partial protocol before parsing chunks", async () => {
    const planDir = createReaderPlan({
      includeProtocol: true,
      protocol: {
        schemaVersion: PLAN_SCHEMA_VERSION,
        artifactLayout: PLAN_ARTIFACT_LAYOUT,
      },
      malformedDownstreamArtifacts: true,
    });

    let caught: unknown;
    try {
      await assemble(planDir, [], null, join(planDir, "unused-output"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PlanProtocolUnsupportedError);
    expect((caught as PlanProtocolUnsupportedError).code).toBe(PLAN_PROTOCOL_UNSUPPORTED);
  });
});
