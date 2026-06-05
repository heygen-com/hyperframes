/**
 * `HyperframesRenderStack` — aws-cdk-lib L2 construct that emits the same
 * topology as `examples/aws-lambda/template.yaml`.
 *
 * Adopters who embed HyperFrames inside their own CDK app can extend this
 * construct or compose alongside it; the construct exposes its `.bucket`,
 * `.renderFunction`, and `.stateMachine` properties so additional
 * resources (alarms, dashboards, SNS topics) can be wired without
 * re-deriving the ARNs from a stack export.
 *
 * `aws-cdk-lib` and `constructs` are **peerDependencies**. The package
 * still type-checks (and the snapshot test still runs) because they're
 * also `devDependencies`, but adopters who only consume the SDK side of
 * `@hyperframes/aws-lambda` don't pull the CDK tree at runtime.
 *
 * Drift from the SAM template is guarded by the snapshot test
 * (`HyperframesRenderStack.snapshot.test.ts`), which diffs the synthed
 * CloudFormation against the SAM-rendered CloudFormation modulo
 * normalisation.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

/** Construction-time props for {@link HyperframesRenderStack}. */
export interface HyperframesRenderStackProps {
  /** Name prefix applied to function / state-machine / alarm names. Default `"hyperframes"`. */
  projectName?: string;
  /** Lambda memory in MB. Allowed: 2048..10240 in 1024 steps. Default 10240. */
  lambdaMemoryMb?: 2048 | 3072 | 4096 | 5120 | 6144 | 7168 | 8192 | 9216 | 10240;
  /** Per-invocation Lambda timeout. Default 900 (15 min, Lambda hard cap). */
  lambdaTimeoutSec?: number;
  /** Lambda reserved concurrency cap. `undefined` = unreserved (account default). */
  reservedConcurrency?: number;
  /** Which Chrome runtime was bundled into the handler ZIP. Default `"sparticuz"`. */
  chromeSource?: "sparticuz" | "chrome-headless-shell";
  /** Threshold for the runaway-invocations alarm. Default 1000 invocations/hour. */
  chunkInvocationAlarmThreshold?: number;
  /**
   * Absolute path to the handler ZIP produced by
   * `bun run --cwd packages/aws-lambda build:zip`. Defaults to the
   * package-relative path the build script writes to. Adopters who
   * deploy the published handler ZIP set this explicitly.
   */
  handlerZipPath?: string;
  /** S3 bucket retention policy on stack delete. Default RETAIN. */
  bucketRemovalPolicy?: RemovalPolicy;
}

const DEFAULT_MEMORY_MB = 10240;
const DEFAULT_TIMEOUT_SEC = 900;
const DEFAULT_CHROME_SOURCE = "sparticuz";
const DEFAULT_ALARM_THRESHOLD = 1000;

export class HyperframesRenderStack extends Construct {
  /** S3 bucket for plan tarballs, chunk outputs, and final renders. */
  readonly bucket: s3.Bucket;
  /** The single Lambda function dispatching plan / renderChunk / assemble. */
  readonly renderFunction: lambda.Function;
  /** The Step Functions state machine orchestrating the render. */
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: HyperframesRenderStackProps = {}) {
    super(scope, id);

    const projectName = props.projectName ?? "hyperframes";
    const memorySize = props.lambdaMemoryMb ?? DEFAULT_MEMORY_MB;
    const timeoutSec = props.lambdaTimeoutSec ?? DEFAULT_TIMEOUT_SEC;
    const chromeSource = props.chromeSource ?? DEFAULT_CHROME_SOURCE;
    const alarmThreshold = props.chunkInvocationAlarmThreshold ?? DEFAULT_ALARM_THRESHOLD;
    const handlerZipPath = props.handlerZipPath ?? defaultHandlerZipPath();

    this.bucket = new s3.Bucket(this, "RenderBucket", {
      removalPolicy: props.bucketRemovalPolicy ?? RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // `Suspended` is the cheapest mode that still satisfies KMS / replication
      // prerequisites callers can layer on later. Adopters who treat the final
      // mp4 as user-keepable can switch to `Enabled`.
      versioned: false,
      lifecycleRules: [
        {
          id: "ExpireIntermediates",
          enabled: true,
          prefix: "renders/",
          expiration: Duration.days(7),
        },
      ],
    });

    this.renderFunction = new lambda.Function(this, "RenderFunction", {
      functionName: `${projectName}-render`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(handlerZipPath),
      memorySize,
      timeout: Duration.seconds(timeoutSec),
      ephemeralStorageSize: Size.gibibytes(10),
      architecture: lambda.Architecture.X86_64,
      reservedConcurrentExecutions: props.reservedConcurrency,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        TMPDIR: "/tmp",
        HYPERFRAMES_LAMBDA_CHROME_SOURCE: chromeSource,
        HYPERFRAMES_RENDER_BUCKET: this.bucket.bucketName,
      },
    });

    // Scoped S3 perms only — explicitly NOT `CloudWatchLogsFullAccess`,
    // which would grant `logs:*` on `*` and overscope adopter accounts.
    // SAM's AWSLambdaBasicExecutionRole equivalent is included by the
    // default `new lambda.Function` execution role.
    this.bucket.grantReadWrite(this.renderFunction);

    const stateMachineLogGroup = new logs.LogGroup(this, "RenderStateMachineLogGroup", {
      logGroupName: `/aws/states/${projectName}-render`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const definition = this.buildStateMachineDefinition();

    this.stateMachine = new sfn.StateMachine(this, "RenderStateMachine", {
      stateMachineName: `${projectName}-render`,
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      timeout: Duration.hours(1),
      logs: {
        destination: stateMachineLogGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: false,
      },
    });

    this.renderFunction.grantInvoke(this.stateMachine);

    new cloudwatch.Alarm(this, "RenderChunkInvocationAlarm", {
      alarmName: `${projectName}-runaway-chunk-invocations`,
      alarmDescription:
        "Fires if RenderChunk Lambda invocations exceed the configured threshold in a 1-hour window.",
      metric: this.renderFunction.metricInvocations({
        period: Duration.hours(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: alarmThreshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "RenderFunctionErrorsAlarm", {
      alarmName: `${projectName}-render-function-errors`,
      alarmDescription: "Fires if the render Lambda reports any errors in a 5-minute window.",
      metric: this.renderFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "RenderStateMachineFailedAlarm", {
      alarmName: `${projectName}-render-state-machine-failed`,
      alarmDescription: "Fires when the render state machine reports a failed execution.",
      metric: this.stateMachine.metricFailed({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  /**
   * Build the state-machine chain. Kept in a single method so the SAM
   * template and this construct can be diffed shape-for-shape during
   * the snapshot test.
   */
  private buildStateMachineDefinition(): sfn.IChainable {
    // `ChromeBinaryUnavailableError` is non-retryable: a wedged warm
    // instance keeps returning the same falsy executablePath until the
    // env recycles, so retries just burn the 4× 15-min budget.
    const NON_RETRYABLE_PLAN = [
      "FFMPEG_VERSION_MISMATCH",
      "PLAN_HASH_MISMATCH",
      "S3_URI_NOT_ALLOWED",
      "BROWSER_GPU_NOT_SOFTWARE",
      "FONT_FETCH_FAILED",
      "PLAN_TOO_LARGE",
      "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
      "ChromeBinaryUnavailableError",
    ];
    const NON_RETRYABLE_CHUNK = [
      "FFMPEG_VERSION_MISMATCH",
      "PLAN_HASH_MISMATCH",
      "S3_URI_NOT_ALLOWED",
      "BROWSER_GPU_NOT_SOFTWARE",
      "ChromeBinaryUnavailableError",
    ];
    const NON_RETRYABLE_ASSEMBLE = [
      "FFMPEG_VERSION_MISMATCH",
      "PLAN_HASH_MISMATCH",
      "S3_URI_NOT_ALLOWED",
      "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
      "ChromeBinaryUnavailableError",
    ];

    const plan = new tasks.LambdaInvoke(this, "Plan", {
      lambdaFunction: this.renderFunction,
      payload: sfn.TaskInput.fromObject({
        Action: "plan",
        "ProjectS3Uri.$": "$.ProjectS3Uri",
        "PlanOutputS3Prefix.$": "$.PlanOutputS3Prefix",
        "Config.$": "$.Config",
      }),
      resultSelector: {
        "PlanS3Uri.$": "$.Payload.PlanS3Uri",
        "PlanHash.$": "$.Payload.PlanHash",
        "ChunkCount.$": "$.Payload.ChunkCount",
        "Format.$": "$.Payload.Format",
        "HasAudio.$": "$.Payload.HasAudio",
        "AudioS3Uri.$": "$.Payload.AudioS3Uri",
      },
      resultPath: "$.Plan",
    });
    plan.addRetry({
      errors: NON_RETRYABLE_PLAN,
      maxAttempts: 0,
    });
    plan.addRetry({
      errors: ["States.ALL"],
      interval: Duration.seconds(2),
      maxAttempts: 4,
      backoffRate: 2,
      maxDelay: Duration.seconds(60),
    });

    const buildChunkList = new sfn.Pass(this, "BuildChunkList", {
      parameters: {
        "ChunkIndexes.$": "States.ArrayRange(0, States.MathAdd($.Plan.ChunkCount, -1), 1)",
      },
      resultPath: "$.Iterator",
    });

    const planProducedZero = new sfn.Fail(this, "PlanProducedZeroChunks", {
      error: "PLAN_TOO_LARGE",
      cause: "Plan returned ChunkCount=0 — non-retryable producer-side invariant violation.",
    });

    const renderChunkTask = new tasks.LambdaInvoke(this, "RenderChunk", {
      lambdaFunction: this.renderFunction,
      payload: sfn.TaskInput.fromObject({
        Action: "renderChunk",
        "ChunkIndex.$": "$.ChunkIndex",
        "PlanS3Uri.$": "$.PlanS3Uri",
        "PlanHash.$": "$.PlanHash",
        "ChunkOutputS3Prefix.$": "$.ChunkOutputS3Prefix",
        "Format.$": "$.Format",
      }),
      resultSelector: {
        "ChunkS3Uri.$": "$.Payload.ChunkS3Uri",
        "ChunkIndex.$": "$.Payload.ChunkIndex",
        "Sha256.$": "$.Payload.Sha256",
      },
    });
    renderChunkTask.addRetry({
      errors: NON_RETRYABLE_CHUNK,
      maxAttempts: 0,
    });
    renderChunkTask.addRetry({
      errors: ["States.ALL"],
      interval: Duration.seconds(2),
      maxAttempts: 4,
      backoffRate: 2,
      maxDelay: Duration.seconds(60),
    });

    const renderChunks = new sfn.Map(this, "RenderChunks", {
      itemsPath: "$.Iterator.ChunkIndexes",
      itemSelector: {
        "ChunkIndex.$": "$$.Map.Item.Value",
        "PlanS3Uri.$": "$.Plan.PlanS3Uri",
        "PlanHash.$": "$.Plan.PlanHash",
        "ChunkOutputS3Prefix.$": "$.PlanOutputS3Prefix",
        "Format.$": "$.Plan.Format",
      },
      maxConcurrencyPath: "$.Plan.ChunkCount",
      resultPath: "$.Chunks",
    });
    renderChunks.itemProcessor(renderChunkTask);

    const assemble = new tasks.LambdaInvoke(this, "Assemble", {
      lambdaFunction: this.renderFunction,
      payload: sfn.TaskInput.fromObject({
        Action: "assemble",
        "PlanS3Uri.$": "$.Plan.PlanS3Uri",
        "ChunkS3Uris.$": "$.Chunks[*].ChunkS3Uri",
        "AudioS3Uri.$": "$.Plan.AudioS3Uri",
        "OutputS3Uri.$": "$.OutputS3Uri",
        "Format.$": "$.Plan.Format",
      }),
      resultSelector: {
        "OutputS3Uri.$": "$.Payload.OutputS3Uri",
        "FramesEncoded.$": "$.Payload.FramesEncoded",
        "FileSize.$": "$.Payload.FileSize",
      },
      resultPath: "$.Output",
    });
    assemble.addRetry({
      errors: NON_RETRYABLE_ASSEMBLE,
      maxAttempts: 0,
    });
    assemble.addRetry({
      errors: ["States.ALL"],
      interval: Duration.seconds(2),
      maxAttempts: 4,
      backoffRate: 2,
      maxDelay: Duration.seconds(60),
    });

    const assertChunkCount = new sfn.Choice(this, "AssertChunkCount")
      .when(sfn.Condition.numberGreaterThan("$.Plan.ChunkCount", 0), renderChunks.next(assemble))
      .otherwise(planProducedZero);

    return plan.next(buildChunkList).next(assertChunkCount);
  }
}

/**
 * Default location of the handler ZIP relative to this source file. Two
 * parents up = `packages/aws-lambda/`; the build script writes the ZIP
 * to `packages/aws-lambda/dist/handler.zip`. The package is published with
 * `main: "./src/index.ts"`, so this path resolves correctly both in the
 * source tree (during `bun test` / local CDK synth) and in a consumer's
 * `node_modules/@hyperframes/aws-lambda/` install.
 */
function defaultHandlerZipPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "dist", "handler.zip");
}
