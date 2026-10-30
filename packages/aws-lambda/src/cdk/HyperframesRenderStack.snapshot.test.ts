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
import {
  CONTENT_STORE_PREFIX,
  CONTENT_STORE_REFRESH_AFTER_DAYS,
  CONTENT_STORE_RETENTION_DAYS,
} from "../contentStore.js";
import { SITE_MANIFEST_INVALID } from "../siteManifest.js";
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
  // a managed policy for the bucket grant and one for the Distributed Map children.
  "AWS::IAM::Role": 2,
  "AWS::IAM::Policy": 3,
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
  "RenderV2",
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
  "SITE_MANIFEST_INVALID",
]);

function doSynth(reservedConcurrency?: number): {
  template: Template;
  definition: { States: Record<string, unknown>; StartAt: string };
} {
  const zipDir = mkdtempSync(join(tmpdir(), "hf-cdk-snap-"));
  writeFileSync(join(zipDir, "handler.zip"), "fake zip bytes");
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new HyperframesRenderStack(stack, "Render", {
    handlerZipPath: join(zipDir, "handler.zip"),
    reservedConcurrency,
  });
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

  it("warms the render function before a v2 plan only on a stack with a video function, and a failed warm-up is caught", () => {
    const states = readSamDefinition().States;
    const warm = requireRecord(states.WarmRender, "WarmRender state");
    expect(sentPayload(warm)).toEqual({ Action: "warm" });
    expect(requireRecordProperty(warm, "Parameters", "parameters").InvocationType).toBe("Event");
    expect(warm.Next).toBe("PlanV2");
    expect(JSON.stringify(warm.Catch)).toContain('"Next":"PlanV2"');
    const choices = requireRecord(states.SelectPlanProtocol, "SelectPlanProtocol")
      .Choices as Record<string, unknown>[];
    const toWarm = choices.filter((choice) => choice.Next === "WarmRender");
    expect(toWarm).toHaveLength(1);
    expect(toWarm[0]).toEqual({
      Variable: "$.PlanProtocol",
      StringEquals: ["HasVideoFunction", "v2", "v2-without-video-function"],
      Next: "WarmRender",
    });
  });

  it("defaults omitted plan protocol to v2 and preserves the explicit v1 branch", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      const selection = requireRecord(
        definition.States.SelectPlanProtocol,
        "SelectPlanProtocol state",
      );
      expect(selection.Default).toBe("PlanV2");
      expect(JSON.stringify(selection)).toContain('"StringEquals":"v1"');
      expect(JSON.stringify(definition.States.Plan)).toContain('"PlanProtocol":"v1"');
    }
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
    collectNonRetryableErrors(getV2TaskStates(definition).RenderChunkV2, collected);

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

  it("lists the error the SDK checks for before rendering in every SAM and CDK plan task", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      for (const plan of [getV1TaskStates(definition).Plan, getV2TaskStates(definition).PlanV2]) {
        const errors = new Set<string>();
        collectNonRetryableErrors(plan, errors);
        expect(errors.has(SITE_MANIFEST_INVALID)).toBe(true);
      }
    }
  });

  it("keeps SAM and CDK terminal classifiers identical for every v2 Lambda task", () => {
    const cdkTasks = getV2TaskStates(SYNTHED.definition);
    const samTasks = getV2TaskStates(readSamDefinition());

    for (const taskName of ["PlanV2", "Audio", "RenderChunkV2", "AssembleV2"] as const) {
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

  it("renders v2 chunks beside the audio task and stitches both into AssembleV2, in CDK and SAM", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      const renderV2 = requireRecord(definition.States.RenderV2, "RenderV2 state");
      expect([renderV2.Type, renderV2.Next, renderV2.ResultPath]).toEqual([
        "Parallel",
        "AssembleV2",
        "$.Render",
      ]);
      expect(renderV2.ResultSelector).toEqual({
        "Chunks.$": "$[0].Chunks",
        "Audio.$": "$[1].Audio",
      });
      expect(sentPayload(renderV2Branch(definition, "Audio"))).toMatchObject({ Action: "audio" });
      // Only a plan that left its audio out runs the task; any other skips its Lambda.
      expect(renderV2Branch(definition, "AudioNeeded")).toMatchObject({
        Type: "Choice",
        Choices: [{ Variable: "$.Plan.SeparateAudio", BooleanEquals: true, Next: "Audio" }],
        Default: "NoAudio",
      });
      expect(renderV2Branch(definition, "NoAudio")).toMatchObject({
        Type: "Pass",
        Result: { HasAudio: false, AudioS3Uri: null },
        ResultPath: "$.Audio",
        End: true,
      });
      expect(requireRecord(definition.States.PlanV2, "PlanV2").ResultSelector).toMatchObject({
        "SeparateAudio.$": "$.Payload.SeparateAudio",
      });
      expect(sentPayload(definition.States.AssembleV2)).toMatchObject({
        "ChunkS3Uris.$": "$.Render.Chunks[*].ChunkS3Uri",
      });
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
      chunks: renderV2Branch(definition, "RenderChunksV2"),
      assemble: definition.States.AssembleV2,
    });
    expect(v1).toContain("PlanS3Uri");
    expect(v1).not.toContain("PlanV2ManifestS3Uri");
    expect(v2).toContain("PlanV2ManifestS3Uri");
    expect(v2).toContain("PlanV2ArtifactS3Prefix");
    expect(v2).not.toContain("PlanS3Uri");
  });

  it("keeps the SAM bucket lifecycle identical to CDK's, shared content on the transport's terms", () => {
    const cdkBucket = Object.values(SYNTHED.template.findResources("AWS::S3::Bucket"))[0] as {
      Properties: { LifecycleConfiguration: unknown };
    };
    const samBucket = requireRecordProperty(readSamResources(), "RenderBucket", "SAM RenderBucket");
    const samProperties = requireRecordProperty(samBucket, "Properties", "SAM bucket properties");
    expect(samProperties.LifecycleConfiguration).toEqual(
      cdkBucket.Properties.LifecycleConfiguration,
    );
    expect(CONTENT_STORE_REFRESH_AFTER_DAYS * 2).toBeLessThan(CONTENT_STORE_RETENTION_DAYS);
    expect(cdkBucket.Properties.LifecycleConfiguration).toMatchObject({
      Rules: expect.arrayContaining([
        expect.objectContaining({
          Prefix: `${CONTENT_STORE_PREFIX}/`,
          ExpirationInDays: CONTENT_STORE_RETENTION_DAYS,
        }),
      ]),
    });
  });

  it("sends the same payload from every Lambda task as the SAM template", () => {
    // CDK drops null-valued payload fields when it renders the definition (#5259), so compare
    // what each deployed task sends rather than the construct source.
    const cdkTasks = lambdaTasks(SYNTHED.definition.States);
    const { WarmRender: _warm, ...samTasks } = lambdaTasks(readSamDefinition().States);
    expect(Object.keys(cdkTasks).sort()).toEqual(Object.keys(samTasks).sort());
    expect(Object.keys(cdkTasks).length).toBeGreaterThanOrEqual(6);
    for (const [taskName, cdkTask] of Object.entries(cdkTasks)) {
      expect({ taskName, payload: sentPayload(cdkTask) }).toEqual({
        taskName,
        payload: sentPayload(samTasks[taskName]),
      });
    }
  });

  it("runs plan and renderChunk on the SAM template's optional arm64 video function", () => {
    // A chunk refuses a plan made with another ffmpeg build; warm-up, audio and assemble stay on x86.
    const targets = Object.values(lambdaTasks(readSamDefinition().States)).map((task) => ({
      action: sentPayload(task).Action,
      functionName: requireRecordProperty(requireRecord(task, "task"), "Parameters", "task params")
        .FunctionName,
    }));
    expect(new Set(targets.map((target) => target.action))).toEqual(
      new Set(["warm", "plan", "renderChunk", "audio", "assemble"]),
    );
    for (const { action, functionName } of targets) {
      expect({ action, functionName }).toEqual({
        action,
        functionName:
          action === "plan" || action === "renderChunk"
            ? ["HasVideoFunction", "VideoFunctionStack.Outputs.FunctionArn", "RenderFunction.Arn"]
            : "RenderFunction.Arn",
      });
    }
    const samRole = requireRecord(readSamResources().RenderStateMachineRole, "SAM role");
    const invoke = JSON.stringify(
      requireRecordProperty(samRole, "Properties", "SAM role properties").Policies,
    );
    expect(invoke).toContain(
      '["RenderFunction.Arn",["HasVideoFunction","VideoFunctionStack.Outputs.FunctionArn"',
    );
  });

  it("gives the nested arm64 video function every environment variable the render function gets", () => {
    const sam = readExampleTemplate("template.yaml");
    const render = [
      ...envNames(sam, "Globals", "Function", "Environment", "Variables"),
      ...envNames(sam, "Resources", "RenderFunction", "Properties", "Environment", "Variables"),
    ];
    const video = readExampleTemplate("video-function.yaml");
    expect(
      envNames(video, "Resources", "Function", "Properties", "Environment", "Variables").sort(),
    ).toEqual([...new Set(render)].sort());
  });

  it("lets the render function abort the multipart uploads its S3 stitch starts", () => {
    const cdkPolicies = JSON.stringify(SYNTHED.template.findResources("AWS::IAM::Policy"));
    expect(cdkPolicies).toContain("s3:Abort*");
    const samFunction = requireRecordProperty(readSamResources(), "RenderFunction", "SAM function");
    const samProperties = requireRecordProperty(
      samFunction,
      "Properties",
      "SAM function properties",
    );
    expect(JSON.stringify(samProperties.Policies)).toContain("s3:AbortMultipartUpload");
  });

  it("keeps same-named Lambda tasks in different branches apart", () => {
    const task = (format: string) => ({
      Type: "Task",
      Resource: "arn:aws:states:::lambda:invoke",
      Parameters: { Payload: { Action: "renderChunk", Format: format } },
    });
    const branch = (format: string) => ({
      StartAt: "RenderChunk",
      States: { RenderChunk: task(format) },
    });
    const tasks = lambdaTasks({
      Fan: { Type: "Parallel", Branches: [branch("mp4"), branch("webm")] },
    });
    expect(Object.keys(tasks).sort()).toEqual(["Fan/0/RenderChunk", "Fan/1/RenderChunk"]);
    expect(sentPayload(tasks["Fan/1/RenderChunk"]).Format).toBe("webm");
  });

  it("runs every chunk in a Distributed Map with STANDARD children in CDK and SAM", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      for (const name of ["RenderChunks", "RenderChunksV2"]) {
        const state =
          name === "RenderChunksV2" ? renderV2Branch(definition, name) : definition.States[name];
        const map = requireRecord(state, `${name} state`);
        const processor = requireRecordProperty(map, "ItemProcessor", `${name} processor`);
        expect({ name, config: processor.ProcessorConfig }).toEqual({
          name,
          config: { Mode: "DISTRIBUTED", ExecutionType: "STANDARD" },
        });
        expect(map.Label).toBe(name);
        expect(map.MaxConcurrencyPath).toBe("$.Plan.MaxChunkConcurrency");
        // Any failed chunk must still fail the render.
        expect(Object.keys(map).filter((key) => key.startsWith("ToleratedFailure"))).toEqual([]);
      }
    }
  });

  it("caps chunk fan-out at the concurrency the plan returns, in CDK and SAM", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      for (const name of ["Plan", "PlanV2"]) {
        const selector = requireRecordProperty(
          requireRecord(definition.States[name], `${name} state`),
          "ResultSelector",
          `${name} result selector`,
        );
        expect(selector["MaxChunkConcurrency.$"]).toBe("$.Payload.MaxChunkConcurrency");
      }
    }
  });

  it("tells the plan the reserved concurrency and lets it read the account's, in CDK and SAM", () => {
    const cdkFunction = (synthed: ReturnType<typeof doSynth>) =>
      Object.values(synthed.template.findResources("AWS::Lambda::Function"))[0] as {
        Properties: { Environment: { Variables: Record<string, unknown> } };
      };
    const reservedEnv = (synthed: ReturnType<typeof doSynth>) =>
      cdkFunction(synthed).Properties.Environment.Variables.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY;
    expect(reservedEnv(SYNTHED)).toBe("-1");
    expect(reservedEnv(doSynth(300))).toBe("300");
    const cdkActions = Object.values(SYNTHED.template.findResources("AWS::IAM::Policy"))
      .flatMap(policyStatements)
      .flatMap((statement) => statement.Action);
    expect(cdkActions).toContain("lambda:GetAccountSettings");

    const samFunction = requireRecordProperty(
      requireRecordProperty(readSamResources(), "RenderFunction", "SAM RenderFunction"),
      "Properties",
      "SAM function properties",
    ) as { Environment: { Variables: Record<string, unknown> }; Policies: unknown[] };
    // The YAML parser drops the !Ref tag and keeps its argument.
    expect(samFunction.Environment.Variables.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY).toBe(
      "ReservedConcurrency",
    );
    const samActions = samFunction.Policies.flatMap((policy) =>
      ((policy as { Statement?: Record<string, unknown>[] }).Statement ?? []).map((s) => s.Action),
    );
    expect(samActions).toContain("lambda:GetAccountSettings");
  }, 30000);

  it("lets assemble invoke exactly the stitch helper it names, in CDK and SAM", () => {
    const cdkFunction = Object.values(
      SYNTHED.template.findResources("AWS::Lambda::Function"),
    )[0] as {
      Properties: { Environment: { Variables: Record<string, unknown> } };
    };
    expect(cdkFunction.Properties.Environment.Variables.HYPERFRAMES_STITCH_FUNCTION).toBe(
      "hyperframes-render",
    );
    const cdkInvoke = Object.values(SYNTHED.template.findResources("AWS::IAM::Policy"))
      .flatMap(policyStatements)
      .filter((statement) => statement.Action === "lambda:InvokeFunction");
    expect(JSON.stringify(cdkInvoke.map((s) => s.Resource))).toContain(
      ":function:hyperframes-render",
    );

    const samFunction = requireRecordProperty(
      requireRecordProperty(readSamResources(), "RenderFunction", "SAM RenderFunction"),
      "Properties",
      "SAM function properties",
    ) as { Environment: { Variables: Record<string, unknown> }; Policies: unknown[] };
    // The YAML parser drops the !If and !Sub tags and keeps [condition, then, else].
    const [, withVideo, without] = samFunction.Environment.Variables
      .HYPERFRAMES_STITCH_FUNCTION as string[];
    expect([withVideo, without]).toEqual(["${ProjectName}-video", "${ProjectName}-render"]);
    const samInvoke = samFunction.Policies.flatMap(
      (policy) => (policy as { Statement?: Record<string, unknown>[] }).Statement ?? [],
    ).filter((statement) => statement.Action === "lambda:InvokeFunction");
    expect(samInvoke).toHaveLength(1);
    const [, grantWithVideo, grantWithout] = samInvoke[0]!.Resource as string[];
    expect(grantWithVideo!.endsWith(`:function:${withVideo}`)).toBe(true);
    expect(grantWithout!.endsWith(`:function:${without}`)).toBe(true);
  }, 30000);

  it("fails at once when a chunk cannot fit the worker timeout, in CDK and SAM", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      for (const name of ["Plan", "PlanV2"]) {
        const errors = new Set<string>();
        collectNonRetryableErrors(definition.States[name], errors);
        expect({ name, terminal: errors.has("CHUNK_EXCEEDS_WORKER_TIMEOUT") }).toEqual({
          name,
          terminal: true,
        });
      }
    }
  });

  it("gives Lambda throttles a minutes-long backoff ahead of the catch-all, in CDK and SAM", () => {
    for (const definition of [SYNTHED.definition, readSamDefinition()]) {
      for (const [taskName, task] of Object.entries(lambdaTasks(definition.States))) {
        if (taskName === "WarmRender") continue;
        expect({ taskName, ...throttleRetry(task) }).toEqual({
          taskName,
          beforeCatchAll: true,
          MaxAttempts: 10,
          JitterStrategy: "FULL",
        });
      }
    }
  });

  it("lets the state machine role start, describe and stop its own child executions", () => {
    const cdkActions = Object.values(SYNTHED.template.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policyStatements(policy).flatMap((statement) => [statement.Action].flat()),
    );
    const samRole = requireRecord(readSamResources().RenderStateMachineRole, "SAM role");
    const samPolicies = requireRecordProperty(samRole, "Properties", "SAM role properties")
      .Policies as Record<string, unknown>[];
    const samStatements = samPolicies.flatMap(
      (policy) =>
        requireRecordProperty(policy, "PolicyDocument", "SAM policy document").Statement as Record<
          string,
          unknown
        >[],
    );
    const samActions = samStatements.flatMap((statement) => [statement.Action].flat());
    for (const action of [
      "states:StartExecution",
      "states:DescribeExecution",
      "states:StopExecution",
    ]) {
      expect({
        action,
        cdk: cdkActions.includes(action),
        sam: samActions.includes(action),
      }).toEqual({
        action,
        cdk: true,
        sam: true,
      });
    }
    expect(samStatements.map((statement) => statement.Resource)).toContainEqual(
      "arn:${AWS::Partition}:states:${AWS::Region}:${AWS::AccountId}:stateMachine:${ProjectName}-render",
    );
  });

  it("takes the audio task's track in the synthesized CDK v2 assembly payload", () => {
    const state = requireRecord(SYNTHED.definition.States.AssembleV2, "AssembleV2 state");
    const parameters = requireRecordProperty(state, "Parameters", "AssembleV2 parameters");
    const payload = requireRecordProperty(parameters, "Payload", "AssembleV2 payload");

    expect(payload["AudioS3Uri.$"]).toBe("$.Render.Audio.AudioS3Uri");
    expect(Object.hasOwn(payload, "AudioS3Uri")).toBe(false);
    expect(payload.PlanProtocol).toBe("v2");
    expect(payload["PlanV2ManifestS3Uri.$"]).toBe("$.Plan.PlanV2ManifestS3Uri");
  });

  it("takes SAM v2 assembly audio from the audio task and keeps both v1 audio result paths", () => {
    const sam = readSamDefinition();
    const assemble = requireRecord(sam.States.AssembleV2, "SAM AssembleV2 state");
    const parameters = requireRecordProperty(assemble, "Parameters", "SAM AssembleV2 parameters");
    const payload = requireRecordProperty(parameters, "Payload", "SAM AssembleV2 payload");
    expect(payload["AudioS3Uri.$"]).toBe("$.Render.Audio.AudioS3Uri");

    for (const definition of [SYNTHED.definition, sam]) {
      const v1 = requireRecord(definition.States.Assemble, "Assemble state");
      const params = requireRecordProperty(v1, "Parameters", "Assemble parameters");
      const v1Payload = requireRecordProperty(params, "Payload", "Assemble payload");
      expect(v1Payload["AudioS3Uri.$"]).toBe("$.Plan.AudioS3Uri");
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

/** Where a task's throttle retrier sits and how hard it retries. */
function throttleRetry(task: unknown): Record<string, unknown> {
  const retriers = requireRecord(task, "task").Retry as Record<string, unknown>[];
  const errors = retriers.map((retrier) => (retrier.ErrorEquals as string[]).join());
  const at = errors.indexOf("Lambda.TooManyRequestsException");
  const { MaxAttempts, JitterStrategy } = retriers[at] ?? {};
  return {
    beforeCatchAll: at >= 0 && at < errors.indexOf("States.ALL"),
    MaxAttempts,
    JitterStrategy,
  };
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

const isLambdaTask = (state: Record<string, unknown>): boolean =>
  state.Type === "Task" && String(state.Resource).endsWith(":states:::lambda:invoke");

/** The state maps nested in a Map processor or Parallel branches, keyed by their path. */
function nestedStates(name: string, state: Record<string, unknown>): [string, unknown][] {
  const processor = isRecord(state.Iterator) ? state.Iterator : state.ItemProcessor;
  const branches: unknown[] = Array.isArray(state.Branches) ? state.Branches : [];
  const nested: [string, unknown][] = [
    [`${name}/`, isRecord(processor) && processor.States],
    ...branches.map((branch, i): [string, unknown] => [
      `${name}/${i}/`,
      isRecord(branch) && branch.States,
    ]),
  ];
  return nested.filter(([, states]) => isRecord(states));
}

/** Every Lambda-invoking task by its full state path, so same-named tasks in two branches stay apart. */
function lambdaTasks(states: Record<string, unknown>, path = ""): Record<string, unknown> {
  const records = Object.entries(states).filter(
    (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
  );
  return Object.assign(
    Object.fromEntries(
      records
        .filter(([, state]) => isLambdaTask(state))
        .map(([name, state]) => [path + name, state]),
    ),
    ...records.flatMap(([name, state]) =>
      nestedStates(path + name, state).map(([nestedPath, nested]) =>
        lambdaTasks(nested as Record<string, unknown>, nestedPath),
      ),
    ),
  );
}

/** A task's payload as Step Functions sends it: a `States.StringToJson('null')` field is a null. */
function sentPayload(state: unknown): Record<string, unknown> {
  const parameters = requireRecordProperty(
    requireRecord(state, "task state"),
    "Parameters",
    "task parameters",
  );
  const payload = requireRecordProperty(parameters, "Payload", "task payload");
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) =>
      key.endsWith(".$") && value === "States.StringToJson('null')"
        ? [key.slice(0, -2), null]
        : [key, value],
    ),
  );
}

/** The state named `name` in one of the v2 Parallel's branches. */
function renderV2Branch(definition: { States: Record<string, unknown> }, name: string): unknown {
  const renderV2 = requireRecord(definition.States.RenderV2, "RenderV2 state");
  const branches: unknown[] = Array.isArray(renderV2.Branches) ? renderV2.Branches : [];
  const found = branches
    .map((branch) => requireRecordProperty(requireRecord(branch, "branch"), "States", "states"))
    .find((states) => name in states);
  return requireRecord(found?.[name], `RenderV2 branch state ${name}`);
}

function getV2TaskStates(definition: {
  States: Record<string, unknown>;
}): Record<"PlanV2" | "Audio" | "RenderChunkV2" | "AssembleV2", unknown> {
  const renderChunksV2 = requireRecord(renderV2Branch(definition, "RenderChunksV2"), "map");
  const processor = isRecord(renderChunksV2.Iterator)
    ? renderChunksV2.Iterator
    : requireRecord(renderChunksV2.ItemProcessor, "RenderChunksV2 processor");
  const innerStates = requireRecord(processor.States, "RenderChunksV2 processor states");
  return {
    PlanV2: definition.States.PlanV2,
    Audio: renderV2Branch(definition, "Audio"),
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

function policyStatements(policy: unknown): Record<string, unknown>[] {
  const properties = requireRecordProperty(requireRecord(policy, "policy"), "Properties", "props");
  const document = requireRecordProperty(properties, "PolicyDocument", "policy document");
  return document.Statement as Record<string, unknown>[];
}

function readExampleTemplate(file: string): Record<string, unknown> {
  const source = readFileSync(
    new URL(`../../../../examples/aws-lambda/${file}`, import.meta.url),
    "utf8",
  );
  // CloudFormation intrinsic tags are irrelevant to classifier parity. The
  // YAML parser preserves their scalar values while this option suppresses
  // warnings for the intentionally unresolved `!Ref`/`!GetAtt` tags.
  const parsed: unknown = parseYaml(source, { logLevel: "silent" });
  return requireRecord(parsed, file);
}

function readSamResources(): Record<string, unknown> {
  return requireRecordProperty(readExampleTemplate("template.yaml"), "Resources", "SAM resources");
}

function envNames(root: Record<string, unknown>, ...path: string[]): string[] {
  const variables = path.reduce<Record<string, unknown>>(
    (node, key) => requireRecordProperty(node, key, key),
    root,
  );
  return Object.keys(variables);
}

function readSamDefinition(): { States: Record<string, unknown> } {
  const resources = readSamResources();
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
