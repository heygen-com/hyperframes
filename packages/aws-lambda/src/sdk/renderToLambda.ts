/**
 * `renderToLambda` — start a distributed render against an already-deployed
 * SAM/CDK stack and return a handle the caller can poll with
 * {@link getRenderProgress}.
 *
 * The function does *not* wait for the render to finish. Step Functions
 * standard workflows can run for hours; blocking the caller's process on
 * the SFN execution is the wrong default. The returned `RenderHandle`
 * carries everything the progress / cost / download paths need.
 *
 * Wire order:
 *   1. Validate config (typed throw before any AWS call).
 *   2. `deploySite` if no `siteHandle` was provided.
 *   3. `StartExecution` against the state machine with the same input
 *      shape `examples/aws-lambda/scripts/smoke.sh` builds.
 *   4. Return handle. The S3 `outputKey` is deterministic from the
 *      execution name so the caller can predict the final object URL.
 */

import { randomUUID } from "node:crypto";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import type { S3Client } from "@aws-sdk/client-s3";
import type { SerializableDistributedRenderConfig } from "../events.js";
import { formatExtension } from "../formatExtension.js";
import { formatS3Uri } from "../s3Transport.js";
import { deploySite, type SiteHandle } from "./deploySite.js";
import {
  validateDistributedRenderConfig,
  validateStepFunctionsInputSize,
} from "./validateConfig.js";

/** Options for {@link renderToLambda}. */
export interface RenderToLambdaOptions {
  /** Local project directory. Required when `siteHandle` is not supplied. */
  projectDir?: string;
  /** Re-use an existing `deploySite` upload (skips tar+S3 PUT). */
  siteHandle?: SiteHandle;
  /** Validated `SerializableDistributedRenderConfig` (no logger / abortSignal). */
  config: SerializableDistributedRenderConfig;
  /** S3 bucket from the SAM stack output (`RenderBucketName`). */
  bucketName: string;
  /** State machine ARN from the SAM stack output (`RenderStateMachineArn`). */
  stateMachineArn: string;
  /** AWS region; defaults to the SDK default chain. */
  region?: string;
  /**
   * Final output S3 key. Defaults to `renders/<executionName>/output.<ext>`
   * where `<ext>` is derived from `config.format`.
   */
  outputKey?: string;
  /**
   * Step Functions execution name. Defaults to `hf-render-<uuid>`.
   * Used as `renderId` everywhere downstream (history queries, cost
   * accounting, predictable S3 key prefix).
   */
  executionName?: string;
  /** Test injection seam — production callers leave unset. */
  sfn?: SFNClient;
  /** Test injection seam — propagated to `deploySite` when applicable. */
  s3?: S3Client;
}

/** Stable identifier + every URL/ARN the caller needs to follow the render. */
export interface RenderHandle {
  /** Same as the Step Functions execution name. */
  renderId: string;
  /** Full execution ARN; pass to {@link getRenderProgress}. */
  executionArn: string;
  bucketName: string;
  stateMachineArn: string;
  outputS3Uri: string;
  projectS3Uri: string;
  startedAt: string;
}

// fallow-ignore-next-line complexity
export async function renderToLambda(opts: RenderToLambdaOptions): Promise<RenderHandle> {
  validateDistributedRenderConfig(opts.config);

  if (!opts.bucketName) {
    throw new Error("[renderToLambda] bucketName is required");
  }
  if (!opts.stateMachineArn) {
    throw new Error("[renderToLambda] stateMachineArn is required");
  }
  if (!opts.siteHandle && !opts.projectDir) {
    throw new Error("[renderToLambda] either siteHandle or projectDir must be supplied");
  }

  const executionName = opts.executionName ?? `hf-render-${randomUUID()}`;
  const ext = formatExtension(opts.config.format);
  const outputKey = opts.outputKey ?? `renders/${executionName}/output${ext}`;
  const planOutputS3Prefix = formatS3Uri({
    bucket: opts.bucketName,
    key: `renders/${executionName}/`,
  });
  const outputS3Uri = formatS3Uri({ bucket: opts.bucketName, key: outputKey });

  const site =
    opts.siteHandle ??
    (await deploySite({
      projectDir: opts.projectDir as string,
      bucketName: opts.bucketName,
      region: opts.region,
      s3: opts.s3,
    }));

  const input = {
    ProjectS3Uri: site.projectS3Uri,
    PlanOutputS3Prefix: planOutputS3Prefix,
    OutputS3Uri: outputS3Uri,
    Config: opts.config,
  };

  // Reject oversize input client-side. Step Functions Standard caps the
  // execution input at 256 KiB; without this check, the input bloat
  // (typically from `config.variables` containing inlined media) surfaces
  // as `States.DataLimitExceeded` 50 ms into the execution, far from the
  // caller's stack frame. Measured AFTER `deploySite` so the synthesised
  // `ProjectS3Uri` is counted (a few hundred bytes either way, but the
  // check should be against the actual wire payload).
  validateStepFunctionsInputSize(input);

  const sfn = opts.sfn ?? new SFNClient({ region: opts.region });
  const startedAt = new Date().toISOString();
  const response = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: opts.stateMachineArn,
      name: executionName,
      input: JSON.stringify(input),
    }),
  );

  if (!response.executionArn) {
    throw new Error("[renderToLambda] StartExecution returned no executionArn");
  }

  return {
    renderId: executionName,
    executionArn: response.executionArn,
    bucketName: opts.bucketName,
    stateMachineArn: opts.stateMachineArn,
    outputS3Uri,
    projectS3Uri: site.projectS3Uri,
    startedAt,
  };
}
