/**
 * `renderToCloudRun` — start a distributed render against an already-deployed
 * Cloud Run service + Cloud Workflows definition and return a handle the
 * caller can poll with {@link getRenderProgress}.
 *
 * The function does *not* wait for the render to finish. Cloud Workflows
 * executions can run for hours; blocking the caller's process on the
 * execution is the wrong default. The returned `RenderHandle` carries
 * everything the progress / cost / download paths need.
 *
 * Wire order:
 *   1. Validate config (typed throw before any GCP call).
 *   2. `deploySite` if no `siteHandle` was provided.
 *   3. `CreateExecution` against the workflow with the argument shape the
 *      `packages/gcp-cloud-run/terraform/workflow.yaml` definition expects.
 *   4. Return handle. The GCS `outputKey` is deterministic from the
 *      client-generated `renderId` so the caller can predict the final
 *      object URL before the (server-assigned) execution id exists.
 *
 * Unlike Step Functions, Cloud Workflows assigns the execution id
 * server-side, so we cannot use it as the GCS prefix. We mint a `renderId`
 * (uuid) client-side, use it for every GCS path, and pass it into the
 * workflow argument; the server-assigned execution resource name is tracked
 * separately for polling.
 */

import { randomUUID } from "node:crypto";
import type { Storage } from "@google-cloud/storage";
import type { SerializableDistributedRenderConfig } from "../events.js";
import { formatExtension } from "../formatExtension.js";
import { formatGcsUri } from "../gcsTransport.js";
import { deploySite, type SiteHandle } from "./deploySite.js";
import { validateDistributedRenderConfig, validateWorkflowsInputSize } from "./validateConfig.js";

/**
 * Minimal surface of `@google-cloud/workflows`' `ExecutionsClient` that
 * this module needs. The real client satisfies this; tests inject a double.
 */
export interface ExecutionsClientLike {
  workflowPath(project: string, location: string, workflow: string): string;
  createExecution(req: {
    parent: string;
    execution: { argument: string };
  }): Promise<[{ name?: string | null; state?: string | null }, ...unknown[]]>;
}

/** Options for {@link renderToCloudRun}. */
export interface RenderToCloudRunOptions {
  /** Local project directory. Required when `siteHandle` is not supplied. */
  projectDir?: string;
  /** Re-use an existing `deploySite` upload (skips tar+GCS upload). */
  siteHandle?: SiteHandle;
  /** Validated `SerializableDistributedRenderConfig` (no logger / abortSignal). */
  config: SerializableDistributedRenderConfig;
  /** GCS bucket from the Terraform output (`render_bucket_name`). */
  bucketName: string;
  /** GCP project id hosting the workflow. */
  projectId: string;
  /** Workflow location, e.g. `us-central1`. */
  location: string;
  /** Workflow id from the Terraform output (`workflow_name`). */
  workflowId: string;
  /**
   * HTTPS URL of the deployed Cloud Run render service (Terraform output
   * `service_url`). The workflow POSTs every step (plan / renderChunk /
   * assemble) to this URL; passed as an execution argument so the workflow
   * definition stays free of hard-coded URLs.
   */
  serviceUrl: string;
  /**
   * Final output GCS key. Defaults to `renders/<renderId>/output.<ext>`
   * where `<ext>` is derived from `config.format`.
   */
  outputKey?: string;
  /**
   * Client-generated render id. Defaults to `hf-render-<uuid>`. Used as the
   * GCS key prefix and echoed into the workflow argument; not the same as
   * the server-assigned execution id.
   */
  renderId?: string;
  /** Test injection seam — production callers leave unset. */
  executions?: ExecutionsClientLike;
  /** Test injection seam — propagated to `deploySite` when applicable. */
  storage?: Storage;
}

/** Stable identifier + every URL/name the caller needs to follow the render. */
export interface RenderHandle {
  /** Client-generated render id; the GCS prefix everything lands under. */
  renderId: string;
  /** Server-assigned execution resource name; pass to {@link getRenderProgress}. */
  executionName: string;
  bucketName: string;
  workflowId: string;
  outputGcsUri: string;
  projectGcsUri: string;
  startedAt: string;
}

// fallow-ignore-next-line complexity
export async function renderToCloudRun(opts: RenderToCloudRunOptions): Promise<RenderHandle> {
  validateDistributedRenderConfig(opts.config);

  if (!opts.bucketName) throw new Error("[renderToCloudRun] bucketName is required");
  if (!opts.projectId) throw new Error("[renderToCloudRun] projectId is required");
  if (!opts.location) throw new Error("[renderToCloudRun] location is required");
  if (!opts.workflowId) throw new Error("[renderToCloudRun] workflowId is required");
  if (!opts.serviceUrl) throw new Error("[renderToCloudRun] serviceUrl is required");
  if (!opts.siteHandle && !opts.projectDir) {
    throw new Error("[renderToCloudRun] either siteHandle or projectDir must be supplied");
  }

  const renderId = opts.renderId ?? `hf-render-${randomUUID()}`;
  // `renderId` is interpolated directly into GCS object keys
  // (`renders/<renderId>/…`). Reject anything that could escape that prefix
  // or build a malformed key — `..`, slashes, or other path metacharacters —
  // so a caller-supplied id can't collide with or overwrite another render's
  // artifacts elsewhere in the bucket.
  if (!/^[A-Za-z0-9._-]+$/.test(renderId) || renderId.includes("..")) {
    throw new Error(
      `[renderToCloudRun] renderId must match [A-Za-z0-9._-]+ and not contain "..": ${JSON.stringify(renderId)}`,
    );
  }
  const ext = formatExtension(opts.config.format);
  const outputKey = opts.outputKey ?? `renders/${renderId}/output${ext}`;
  const planOutputGcsPrefix = formatGcsUri({
    bucket: opts.bucketName,
    key: `renders/${renderId}/`,
  });
  const outputGcsUri = formatGcsUri({ bucket: opts.bucketName, key: outputKey });

  const site =
    opts.siteHandle ??
    (await deploySite({
      projectDir: opts.projectDir as string,
      bucketName: opts.bucketName,
      storage: opts.storage,
    }));

  const argument = {
    RenderId: renderId,
    ProjectGcsUri: site.projectGcsUri,
    PlanOutputGcsPrefix: planOutputGcsPrefix,
    OutputGcsUri: outputGcsUri,
    ServiceUrl: opts.serviceUrl,
    Config: opts.config,
  };

  // Reject oversize input client-side. Cloud Workflows caps the execution
  // argument at 512 KiB; without this check, input bloat (typically from
  // `config.variables` containing inlined media) surfaces as an opaque
  // server-side error after the execution starts, far from the caller's
  // stack frame.
  validateWorkflowsInputSize(argument);

  const executions = opts.executions ?? (await defaultExecutionsClient());
  const parent = executions.workflowPath(opts.projectId, opts.location, opts.workflowId);
  const startedAt = new Date().toISOString();
  const [execution] = await executions.createExecution({
    parent,
    execution: { argument: JSON.stringify(argument) },
  });

  if (!execution.name) {
    throw new Error("[renderToCloudRun] CreateExecution returned no execution name");
  }

  return {
    renderId,
    executionName: execution.name,
    bucketName: opts.bucketName,
    workflowId: opts.workflowId,
    outputGcsUri,
    projectGcsUri: site.projectGcsUri,
    startedAt,
  };
}

/**
 * Lazily import the real `@google-cloud/workflows` ExecutionsClient. Dynamic
 * so SDK consumers that only call `validateDistributedRenderConfig` (or
 * inject their own client) don't pay the import cost.
 */
async function defaultExecutionsClient(): Promise<ExecutionsClientLike> {
  const mod = await import("@google-cloud/workflows");
  const client = new mod.ExecutionsClient();
  return client as unknown as ExecutionsClientLike;
}
