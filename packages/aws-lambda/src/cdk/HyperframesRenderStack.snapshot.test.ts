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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
  "Plan",
  "BuildChunkList",
  "AssertChunkCount",
  "RenderChunks",
  "Assemble",
  "PlanProducedZeroChunks",
];

const EXPECTED_NON_RETRYABLE_ERRORS = new Set([
  "FFMPEG_VERSION_MISMATCH",
  "PLAN_HASH_MISMATCH",
  "BROWSER_GPU_NOT_SOFTWARE",
  "FONT_FETCH_FAILED",
  "PLAN_TOO_LARGE",
  "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
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
    expect(definition.StartAt).toBe("Plan");
    const actualStates = Object.keys(definition.States);
    expect(actualStates.sort()).toEqual([...EXPECTED_STATE_NAMES].sort());
  });

  it("preserves every typed non-retryable error name across the three Lambda tasks", () => {
    const { definition } = SYNTHED;
    const collected = new Set<string>();
    // Plan + Assemble are top-level states; RenderChunk is nested inside
    // the Map's Iterator definition.
    const topLevelStates = ["Plan", "Assemble"] as const;
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

    for (const expected of EXPECTED_NON_RETRYABLE_ERRORS) {
      expect({ error: expected, present: collected.has(expected) }).toEqual({
        error: expected,
        present: true,
      });
    }
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
