/**
 * Structural snapshot of {@link HyperframesRenderStack}.
 *
 * `toMatchSnapshot` is intentionally avoided here: bun's snapshot format
 * is brittle against the CloudFormation tokens CDK emits (random suffixes
 * on log group + role logical ids, asset hashes that change with the
 * handler ZIP). Instead we freeze:
 *
 *   - The count of each AWS::* resource type the synthed stack contains
 *     (catches accidental new resources, deletions, type swaps).
 *   - A frozen list of Step Functions state names in the parsed
 *     `DefinitionString`, in declaration order (catches state-machine
 *     topology drift).
 *   - The full set of state-machine retry/catch error names (catches
 *     accidental loss of typed non-retryable failure handling).
 *
 * Any intentional change to those properties should update this file in
 * the same commit — a reviewer reading the diff knows exactly what shifted
 * in the topology.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { parse as parseYaml } from "yaml";
import { HyperframesRenderStack } from "./HyperframesRenderStack.js";

// CDK synth + Template.fromStack is slow on cold start in CI (~5-8s on
// the first call). The default bun:test 5s timeout trips it on the
// first `it()` that calls `synth()`. Run synth once in `beforeAll`
// and reuse the result — each test is a few µs of pure assertions
// against the already-synthed template.
let SYNTHED: ReturnType<typeof doSynth>;

const EXPECTED_RESOURCE_COUNTS: Record<string, number> = {
  "AWS::Lambda::Function": 1,
  "AWS::S3::Bucket": 1,
  "AWS::StepFunctions::StateMachine": 1,
  "AWS::CloudWatch::Alarm": 3,
  "AWS::Logs::LogGroup": 1,
  // CDK emits IAM roles for both the function and the state machine, plus
  // a managed policy for the bucket grant.
  "AWS::IAM::Role": 2,
  "AWS::IAM::Policy": 2,
};

// Top-level state names emitted by ASL. The Map state's inner
// `RenderChunk` task lives nested under `RenderChunks.Iterator.States`,
// not at this level — we cover it separately in the contract test.
const EXPECTED_STATE_NAMES = [
  "SelectPlanProtocol",
  "Plan",
  "PlanV2",
  "BuildChunkList",
  "AssertChunkCount",
  "SelectWorkerProtocol",
  "RenderChunks",
  "RenderChunksV2",
  "Assemble",
  "AssembleV2",
  "PlanProducedZeroChunks",
  "UnsupportedPlanProtocol",
];

const EXPECTED_NON_RETRYABLE_ERRORS = new Set([
  "FFMPEG_VERSION_MISMATCH",
  "PLAN_HASH_MISMATCH",
  "S3_URI_NOT_ALLOWED",
  "BROWSER_GPU_NOT_SOFTWARE",
  "FONT_FETCH_FAILED",
  "PLAN_TOO_LARGE",
  "PlanTooLargeError",
  "PLAN_PROTOCOL_UNSUPPORTED",
  "PlanProtocolUnsupportedError",
  "PLAN_V2_INTEGRITY_UNRECOVERABLE",
  "VIDEO_SOURCE_UNRENDERABLE",
  "INVALID_VIDEO_METADATA",
  "NOT_MEDIA_PAYLOAD",
  "NotMediaPayloadError",
  "PlanV2IntegrityError",
  "PLAN_ARTIFACT_DIGEST_MISMATCH",
  "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
  "ChromeBinaryUnavailableError",
]);

function doSynth(): {
  template: Template;
  definition: { States: Record<string, unknown>; StartAt: string };
} {
  const zipDir = mkdtempSync(join(tmpdir(), "hf-cdk-snap-"));
  writeFileSync(join(zipDir, "handler.zip"), "fake zip bytes");
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new HyperframesRenderStack(stack, "Render", { handlerZipPath: join(zipDir, "handler.zip") });
  const template = Template.fromStack(stack);
  const stateMachine = Object.values(
    template.findResources("AWS::StepFunctions::StateMachine"),
  )[0] as {
    Properties: { DefinitionString: unknown };
  };
  const def = stateMachine.Properties.DefinitionString;
  // CDK emits a `Fn::Join` over interpolated ARN tokens; reduce it to
  // a definition string we can JSON.parse for inspection.
  let parsed: { States: Record<string, unknown>; StartAt: string };
  if (typeof def === "string") {
    parsed = JSON.parse(def);
  } else if (def && typeof def === "object" && "Fn::Join" in def) {
    const join = (def as { "Fn::Join": [string, unknown[]] })["Fn::Join"];
    const concatenated = join[1]
      .map((seg) => (typeof seg === "string" ? seg : "<<TOKEN>>"))
      .join("");
    parsed = JSON.parse(concatenated);
  } else {
    throw new Error(`Unexpected DefinitionString shape: ${JSON.stringify(def).slice(0, 200)}`);
  }
  return { template, definition: parsed };
}

describe("HyperframesRenderStack — snapshot", () => {
  // 30s is plenty: cold synth on the slowest CI runner has measured ~8s.
  beforeAll(() => {
    SYNTHED = doSynth();
  }, 30000);

  it("emits the expected set of AWS resource types in the expected counts", () => {
    const { template } = SYNTHED;
    const actual: Record<string, number> = {};
    const allResources = template.toJSON().Resources as Record<string, { Type: string }>;
    for (const res of Object.values(allResources)) {
      actual[res.Type] = (actual[res.Type] ?? 0) + 1;
    }
    // Only assert on the types we explicitly track so the assertion
    // failure highlights the drift, not the surrounding noise.
    for (const [type, expected] of Object.entries(EXPECTED_RESOURCE_COUNTS)) {
      expect({ type, count: actual[type] ?? 0 }).toEqual({ type, count: expected });
    }
    // And catch unexpected new resource types up front.
    const unexpected = Object.keys(actual).filter(
      (type) => EXPECTED_RESOURCE_COUNTS[type] === undefined,
    );
    expect(unexpected).toEqual([]);
  });

  it("declares the state machine with the expected state names", () => {
    const { definition } = SYNTHED;
    expect(definition.StartAt).toBe("SelectPlanProtocol");
    const actualStates = Object.keys(definition.States);
    expect(actualStates.sort()).toEqual([...EXPECTED_STATE_NAMES].sort());
  });

  it("preserves every typed non-retryable error name across the three Lambda tasks", () => {
    const { definition } = SYNTHED;
    const collected = new Set<string>();
    // Plan + Assemble are top-level states; RenderChunk is nested inside
    // the Map's Iterator definition.
    const topLevelStates = ["Plan", "PlanV2", "Assemble", "AssembleV2"] as const;
    for (const stateName of topLevelStates) {
      collectNonRetryableErrors(definition.States[stateName], collected);
    }
    const renderChunks = definition.States.RenderChunks as
      | {
          Iterator?: { States?: Record<string, unknown> };
          ItemProcessor?: { States?: Record<string, unknown> };
        }
      | undefined;
    const innerStates = renderChunks?.Iterator?.States ?? renderChunks?.ItemProcessor?.States ?? {};
    collectNonRetryableErrors(innerStates.RenderChunk, collected);
    const renderChunksV2 = definition.States.RenderChunksV2 as
      | {
          Iterator?: { States?: Record<string, unknown> };
          ItemProcessor?: { States?: Record<string, unknown> };
        }
      | undefined;
    const innerStatesV2 =
      renderChunksV2?.Iterator?.States ?? renderChunksV2?.ItemProcessor?.States ?? {};
    collectNonRetryableErrors(innerStatesV2.RenderChunkV2, collected);

    for (const expected of EXPECTED_NON_RETRYABLE_ERRORS) {
      expect({ error: expected, present: collected.has(expected) }).toEqual({
        error: expected,
        present: true,
      });
    }
    expect(collected.has("FONT_FETCH_UNAVAILABLE")).toBe(false);
  });

  it("classifies plan v2 integrity failures as terminal in every v2 Lambda task", () => {
    const v2TaskStates = Object.values(getV2TaskStates(SYNTHED.definition));

    for (const state of v2TaskStates) {
      const errors = new Set<string>();
      collectNonRetryableErrors(state, errors);
      expect(errors.has("PLAN_V2_INTEGRITY_UNRECOVERABLE")).toBe(true);
      expect(errors.has("PlanV2IntegrityError")).toBe(true);
    }
  });

  it("keeps SAM and CDK terminal classifiers identical for every v2 Lambda task", () => {
    const cdkTasks = getV2TaskStates(SYNTHED.definition);
    const samTasks = getV2TaskStates(readSamDefinition());

    for (const taskName of ["PlanV2", "RenderChunkV2", "AssembleV2"] as const) {
      const cdkErrors = new Set<string>();
      const samErrors = new Set<string>();
      collectNonRetryableErrors(cdkTasks[taskName], cdkErrors);
      collectNonRetryableErrors(samTasks[taskName], samErrors);
      expect({ taskName, errors: [...samErrors].sort() }).toEqual({
        taskName,
        errors: [...cdkErrors].sort(),
      });
    }
  });

  it("routes video failures consistently across SAM/CDK and both plan protocols", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      const v1 = getV1TaskStates(definition);
      const v2 = getV2TaskStates(definition);
      for (const planState of [v1.Plan, v2.PlanV2]) {
        const errors = new Set<string>();
        collectNonRetryableErrors(planState, errors);
        expect(errors.has("VIDEO_SOURCE_UNRENDERABLE")).toBe(true);
        expect(errors.has("INVALID_VIDEO_METADATA")).toBe(true);
        expect(errors.has("VIDEO_EXTRACTION_FAILED")).toBe(false);
      }
      for (const chunkState of [v1.RenderChunk, v2.RenderChunkV2]) {
        const errors = new Set<string>();
        collectNonRetryableErrors(chunkState, errors);
        expect(errors.has("INVALID_VIDEO_METADATA")).toBe(true);
      }
    }
  });

  it("keeps v1 and v2 locators disjoint across orchestration branches", () => {
    const { definition } = SYNTHED;
    const v1 = JSON.stringify({
      plan: definition.States.Plan,
      chunks: definition.States.RenderChunks,
      assemble: definition.States.Assemble,
    });
    const v2 = JSON.stringify({
      plan: definition.States.PlanV2,
      chunks: definition.States.RenderChunksV2,
      assemble: definition.States.AssembleV2,
    });
    expect(v1).toContain("PlanS3Uri");
    expect(v1).not.toContain("PlanV2ManifestS3Uri");
    expect(v2).toContain("PlanV2ManifestS3Uri");
    expect(v2).toContain("PlanV2ArtifactS3Prefix");
    expect(v2).not.toContain("PlanS3Uri");
  });
});

function collectNonRetryableErrors(state: unknown, out: Set<string>): void {
  const retries =
    (state as { Retry?: { ErrorEquals: string[]; MaxAttempts?: number }[] })?.Retry ?? [];
  for (const retry of retries) {
    if (retry.MaxAttempts === 0) {
      for (const err of retry.ErrorEquals) out.add(err);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireRecordProperty(
  record: Record<string, unknown>,
  property: string,
  label: string,
): Record<string, unknown> {
  return requireRecord(record[property], label);
}

function getV2TaskStates(definition: {
  States: Record<string, unknown>;
}): Record<"PlanV2" | "RenderChunkV2" | "AssembleV2", unknown> {
  const renderChunksV2 = requireRecord(definition.States.RenderChunksV2, "RenderChunksV2 state");
  const processor = isRecord(renderChunksV2.Iterator)
    ? renderChunksV2.Iterator
    : requireRecord(renderChunksV2.ItemProcessor, "RenderChunksV2 processor");
  const innerStates = requireRecord(processor.States, "RenderChunksV2 processor states");
  return {
    PlanV2: definition.States.PlanV2,
    RenderChunkV2: innerStates.RenderChunkV2,
    AssembleV2: definition.States.AssembleV2,
  };
}

function getV1TaskStates(definition: {
  States: Record<string, unknown>;
}): Record<"Plan" | "RenderChunk" | "Assemble", unknown> {
  const renderChunks = requireRecord(definition.States.RenderChunks, "RenderChunks state");
  const processor = isRecord(renderChunks.Iterator)
    ? renderChunks.Iterator
    : requireRecord(renderChunks.ItemProcessor, "RenderChunks processor");
  const innerStates = requireRecord(processor.States, "RenderChunks processor states");
  return {
    Plan: definition.States.Plan,
    RenderChunk: innerStates.RenderChunk,
    Assemble: definition.States.Assemble,
  };
}

function readSamDefinition(): { States: Record<string, unknown> } {
  const source = readFileSync(
    new URL("../../../../examples/aws-lambda/template.yaml", import.meta.url),
    "utf8",
  );
  // CloudFormation intrinsic tags are irrelevant to classifier parity. The
  // YAML parser preserves their scalar values while this option suppresses
  // warnings for the intentionally unresolved `!Ref`/`!GetAtt` tags.
  const parsed: unknown = parseYaml(source, { logLevel: "silent" });
  const root = requireRecord(parsed, "SAM template");
  const resources = requireRecordProperty(root, "Resources", "SAM resources");
  const stateMachine = requireRecordProperty(
    resources,
    "RenderStateMachine",
    "SAM RenderStateMachine",
  );
  const properties = requireRecordProperty(
    stateMachine,
    "Properties",
    "SAM state-machine properties",
  );
  const definition = requireRecordProperty(
    properties,
    "Definition",
    "SAM state-machine definition",
  );
  return {
    States: requireRecordProperty(definition, "States", "SAM state-machine states"),
  };
}
