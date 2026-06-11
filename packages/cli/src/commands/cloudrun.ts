/**
 * `hyperframes cloudrun` — deploy + drive distributed renders on Google
 * Cloud Run + Cloud Workflows.
 *
 * The GCP counterpart to `hyperframes lambda`. Thin glue: argument parsing
 * + help here; the work lives in `@hyperframes/gcp-cloud-run/sdk`
 * (`deploySite` / `renderToCloudRun` / `getRenderProgress`) plus `terraform`
 * and `gcloud` for provisioning + the image build.
 *
 * Stack coordinates (bucket / service URL / workflow id) are captured by
 * `deploy` into a small state file under `~/.hyperframes/` so `render` and
 * `progress` don't need them re-passed every call.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import {
  type CanvasResolution,
  normalizeResolutionFlag,
  VALID_CANVAS_RESOLUTIONS,
} from "@hyperframes/core";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../utils/variables.js";

export const examples: Example[] = [
  ["Deploy the Cloud Run render stack", "hyperframes cloudrun deploy --project my-gcp-project"],
  [
    "Render a composition on the deployed stack",
    "hyperframes cloudrun render ./my-project --width 1920 --height 1080 --wait",
  ],
  [
    "Render a personalised template with variables",
    'hyperframes cloudrun render ./my-template --width 1920 --height 1080 --variables \'{"title":"Hello Alice"}\'',
  ],
  [
    "Supersample a 1080p composition to 4K",
    "hyperframes cloudrun render ./my-project --width 1920 --height 1080 --output-resolution 4k --wait",
  ],
  [
    "Batch-render N personalised videos from a JSONL file",
    "hyperframes cloudrun render-batch ./my-template --batch ./users.jsonl --width 1920 --height 1080 --max-concurrent 10",
  ],
  ["Check progress for a started render", "hyperframes cloudrun progress <executionName>"],
  [
    "Pre-upload a project so renders share the upload",
    "hyperframes cloudrun sites create ./my-project",
  ],
  ["Tear the stack down", "hyperframes cloudrun destroy --project my-gcp-project"],
];

const HELP = `
${c.bold("hyperframes cloudrun")} ${c.dim("<subcommand> [args]")}

Deploy + drive distributed video renders on Google Cloud Run + Workflows.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("deploy")}        ${c.dim("Build the image + apply the Terraform module (Cloud Run + Workflows + GCS)")}
  ${c.accent("sites create")}  ${c.dim("Tar + upload a project to GCS (reusable across renders)")}
  ${c.accent("render")}        ${c.dim("Start a distributed render (returns an execution name)")}
  ${c.accent("render-batch")}  ${c.dim("Fan out N personalised renders from a JSONL batch file")}
  ${c.accent("progress")}      ${c.dim("Print progress + cost for an in-flight or finished render")}
  ${c.accent("destroy")}       ${c.dim("Tear the stack down")}

${c.bold("FIRST RUN:")}
  ${c.accent("hyperframes cloudrun deploy --project my-gcp-project")}
  ${c.accent("hyperframes cloudrun render ./my-project --width 1920 --height 1080 --wait")}

${c.bold("REQUIREMENTS:")}
  • gcloud authenticated; the target project must have billing enabled
  • terraform (>= 1.5) and docker / Cloud Build access on PATH
`;

interface StackState {
  projectId: string;
  region: string;
  bucketName: string;
  serviceUrl: string;
  workflowId: string;
}

export default defineCommand({
  meta: { name: "cloudrun", description: "Deploy and drive renders on Google Cloud Run" },
  args: {
    subcommand: {
      type: "positional",
      required: false,
      description: "deploy | sites | render | render-batch | progress | destroy",
    },
    target: {
      type: "positional",
      required: false,
      description: "Subcommand positional (project dir, execution name, sites verb)",
    },
    extra: {
      type: "positional",
      required: false,
      description: "Extra positional (e.g. `sites create <projectDir>`)",
    },

    // Stack identity
    project: {
      type: "string",
      description: "GCP project id (required for deploy/destroy; cached after deploy)",
    },
    region: { type: "string", description: "GCP region (default: us-central1)" },
    image: {
      type: "string",
      description:
        "Container image for the render service (deploy). If unset, deploy builds it via Cloud Build.",
    },
    repo: {
      type: "string",
      description: "Artifact Registry repo for the built image (default: hyperframes)",
    },
    // Machine sizing / scaling (deploy). Omitted flags keep the Terraform
    // module defaults (4 vCPU / 16Gi / 100 instances / 3600s).
    cpu: { type: "string", description: "vCPU per Cloud Run instance: 1 | 2 | 4 | 8 (deploy)" },
    memory: { type: "string", description: "Memory per instance, e.g. 16Gi | 32Gi (deploy)" },
    "max-instances": {
      type: "string",
      description: "Max Cloud Run instances = render fan-out ceiling (deploy)",
    },
    timeout: {
      type: "string",
      description: "Per-request timeout in seconds, max 3600 (deploy)",
    },

    // sites / render
    "site-id": { type: "string", description: "Explicit site id (overrides content hash)" },
    width: { type: "string", description: "Render width in pixels" },
    height: { type: "string", description: "Render height in pixels" },
    fps: { type: "string", description: "Render fps (24 | 30 | 60)" },
    format: { type: "string", description: "mp4 | mov | png-sequence | webm (default: mp4)" },
    codec: { type: "string", description: "h264 | h265 (mp4 only)" },
    quality: { type: "string", description: "draft | standard | high" },
    "chunk-size": { type: "string", description: "Frames per chunk" },
    "max-parallel-chunks": { type: "string", description: "Max concurrent chunks" },
    "target-chunk-frames": {
      type: "string",
      description:
        "Cap per-chunk frames; auto-adds chunks (up to --max-parallel-chunks) to keep each under this. Ignored if --chunk-size is set.",
    },
    "output-resolution": {
      type: "string",
      description:
        "Output resolution preset that engages Chrome deviceScaleFactor supersampling (e.g. 4k, 1080p, landscape-4k). The composition's authored data-width/data-height is supersampled to the target without changing layout.",
    },
    variables: {
      type: "string",
      description:
        'JSON object of composition variable values, e.g. --variables \'{"title":"Hi"}\'',
    },
    "variables-file": { type: "string", description: "Path to a JSON file of variable values" },
    "strict-variables": {
      type: "boolean",
      description:
        "Fail the render if any --variables key is undeclared or mistyped vs the composition's data-composition-variables. Without it, mismatches are warnings.",
      default: false,
    },
    batch: {
      type: "string",
      description:
        'Path to a JSONL batch file for `render-batch`. Each line: {"outputKey":"...","variables":{...}}',
    },
    "max-concurrent": {
      type: "string",
      description: "Max in-flight executions for `render-batch` (default: 50).",
    },
    "dry-run": {
      type: "boolean",
      description:
        "For `render-batch`: parse the batch file and print the manifest without starting any execution.",
      default: false,
    },
    "render-id": {
      type: "string",
      description: "Client render id / GCS prefix (default: hf-render-<uuid>)",
    },
    "output-key": {
      type: "string",
      description: "Final output GCS key (default: renders/<renderId>/output.<ext>)",
    },
    wait: { type: "boolean", description: "Block until the render finishes" },
    "wait-interval-ms": {
      type: "string",
      description: "Poll cadence in ms when --wait is set (default: 5000)",
    },
    json: { type: "boolean", description: "Emit machine-readable JSON" },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const subcommand = args.subcommand as string | undefined;
    if (!subcommand) {
      console.log(HELP);
      return;
    }
    switch (subcommand) {
      case "deploy":
        return runDeploy(args);
      case "sites":
        return runSites(args);
      case "render":
        return runRender(args);
      case "render-batch":
        return runRenderBatch(args);
      case "progress":
        return runProgress(args);
      case "destroy":
        return runDestroy(args);
      default:
        console.error(`${c.error("Unknown subcommand:")} ${subcommand}\n${HELP}`);
        process.exit(1);
    }
  },
});

// ── State helpers ─────────────────────────────────────────────────────────

function stateDir(): string {
  return join(homedir(), ".hyperframes");
}
function statePath(): string {
  return join(stateDir(), "cloudrun-state.json");
}
function writeState(state: StackState): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}
function readState(args: Record<string, unknown>): StackState {
  const overrides = {
    projectId: args.project as string | undefined,
    region: args.region as string | undefined,
  };
  let base: Partial<StackState> = {};
  if (existsSync(statePath())) {
    try {
      base = JSON.parse(readFileSync(statePath(), "utf8")) as StackState;
    } catch {
      // ignore a corrupt state file; flags must supply the values.
    }
  }
  const merged: Partial<StackState> = { ...base, ...stripUndefined(overrides) };
  const missing = (
    ["projectId", "region", "bucketName", "serviceUrl", "workflowId"] as const
  ).filter((k) => !merged[k]);
  if (missing.length > 0) {
    console.error(
      `[cloudrun] missing stack coordinates: ${missing.join(", ")}. ` +
        `Run \`hyperframes cloudrun deploy --project <id>\` first, or pass them as flags.`,
    );
    process.exit(1);
  }
  return merged as StackState;
}
function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;
}

/** Resolve the Terraform module dir shipped with @hyperframes/gcp-cloud-run. */
function terraformDir(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@hyperframes/gcp-cloud-run/package.json");
  return join(dirname(pkgJson), "terraform");
}

function run(cmd: string, cmdArgs: string[], opts: { cwd?: string } = {}): void {
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: opts.cwd });
  if (res.status !== 0) {
    throw new Error(`[cloudrun] \`${cmd} ${cmdArgs.join(" ")}\` exited with ${res.status}`);
  }
}
function capture(cmd: string, cmdArgs: string[], opts: { cwd?: string } = {}): string {
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8", cwd: opts.cwd });
  if (res.status !== 0) {
    throw new Error(`[cloudrun] \`${cmd} ${cmdArgs.join(" ")}\` failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

// ── deploy ──────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function runDeploy(args: Record<string, unknown>): void {
  const project = args.project as string | undefined;
  if (!project) {
    console.error("[cloudrun deploy] --project <gcp-project-id> is required.");
    process.exit(1);
  }
  const region = (args.region as string | undefined) ?? "us-central1";
  const repo = (args.repo as string | undefined) ?? "hyperframes";
  const tfDir = terraformDir();
  const repoRoot = findRepoRoot(tfDir);

  console.log(`→ Enabling required APIs on ${project}`);
  run("gcloud", [
    "services",
    "enable",
    "run.googleapis.com",
    "workflows.googleapis.com",
    "workflowexecutions.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "monitoring.googleapis.com",
    "--project",
    project,
  ]);

  let image = args.image as string | undefined;
  if (!image) {
    if (!repoRoot) {
      console.error(
        "[cloudrun deploy] --image is required when not running from a hyperframes checkout (no Dockerfile context found).",
      );
      process.exit(1);
    }
    // Ensure the Artifact Registry repo exists.
    const exists =
      spawnSync("gcloud", [
        "artifacts",
        "repositories",
        "describe",
        repo,
        "--location",
        region,
        "--project",
        project,
      ]).status === 0;
    if (!exists) {
      run("gcloud", [
        "artifacts",
        "repositories",
        "create",
        repo,
        "--repository-format",
        "docker",
        "--location",
        region,
        "--project",
        project,
      ]);
    }
    const tag = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    image = `${region}-docker.pkg.dev/${project}/${repo}/hyperframes-render:${tag}`;
    console.log(`→ Building + pushing ${image} via Cloud Build`);
    run("gcloud", [
      "builds",
      "submit",
      repoRoot,
      "--project",
      project,
      "--timeout",
      "3600s",
      "--config",
      writeCloudBuildConfig(image),
    ]);
  }

  console.log("→ terraform apply");
  run("terraform", ["init", "-input=false"], { cwd: tfDir });
  run(
    "terraform",
    ["apply", "-input=false", "-auto-approve", ...machineVars(args, project, region, image)],
    { cwd: tfDir },
  );

  const state: StackState = {
    projectId: project,
    region,
    bucketName: capture("terraform", ["output", "-raw", "render_bucket_name"], { cwd: tfDir }),
    serviceUrl: capture("terraform", ["output", "-raw", "service_url"], { cwd: tfDir }),
    workflowId: capture("terraform", ["output", "-raw", "workflow_name"], { cwd: tfDir }),
  };
  writeState(state);
  console.log(`${c.accent("✓ deployed.")} bucket=${state.bucketName} workflow=${state.workflowId}`);
  console.log(`  service=${state.serviceUrl}`);
  console.log(
    `  Next: ${c.accent("hyperframes cloudrun render ./my-project --width 1920 --height 1080 --wait")}`,
  );
}

/**
 * Build the `-var` list for `terraform apply`: always project/region/image,
 * plus any machine-sizing / scaling flags the caller supplied. Omitted flags
 * fall through to the Terraform module defaults (4 vCPU / 16Gi / 100 / 3600s).
 */
// fallow-ignore-next-line complexity
function machineVars(
  args: Record<string, unknown>,
  project: string,
  region: string,
  image: string,
): string[] {
  const vars = [
    "-var",
    `project_id=${project}`,
    "-var",
    `region=${region}`,
    "-var",
    `image=${image}`,
  ];
  const cpu = args.cpu as string | undefined;
  const memory = args.memory as string | undefined;
  const maxInstances = parsePositiveInt(args["max-instances"], "--max-instances");
  const timeout = parsePositiveInt(args.timeout, "--timeout");
  if (cpu) vars.push("-var", `cpu=${cpu}`);
  if (memory) vars.push("-var", `memory=${memory}`);
  if (maxInstances !== undefined) vars.push("-var", `max_instances=${maxInstances}`);
  if (timeout !== undefined) vars.push("-var", `request_timeout_seconds=${timeout}`);
  return vars;
}

/** Walk up from the terraform dir to find the repo root (the one with the Dockerfile context). */
function findRepoRoot(tfDir: string): string | null {
  // tfDir is <root>/packages/gcp-cloud-run/terraform
  const candidate = resolve(tfDir, "..", "..", "..");
  if (existsSync(join(candidate, "packages", "gcp-cloud-run", "Dockerfile"))) return candidate;
  return null;
}

function writeCloudBuildConfig(image: string): string {
  const cfgPath = join(stateDir(), "cloudrun-cloudbuild.yaml");
  mkdirSync(stateDir(), { recursive: true });
  // The build context (passed to `gcloud builds submit` as the repo root) is
  // referenced as "." inside the config; the Dockerfile path is relative to
  // that context.
  writeFileSync(
    cfgPath,
    [
      "steps:",
      "- name: gcr.io/cloud-builders/docker",
      `  args: ["build","-f","packages/gcp-cloud-run/Dockerfile","-t","${image}","."]`,
      `images: ["${image}"]`,
      "timeout: 3600s",
      "",
    ].join("\n"),
  );
  return cfgPath;
}

// ── sites create ──────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function runSites(args: Record<string, unknown>): Promise<void> {
  if (args.target !== "create") {
    console.error(
      `[cloudrun sites] unknown verb "${String(args.target)}". Only "create" is supported.`,
    );
    process.exit(1);
  }
  const projectDir = args.extra as string | undefined;
  if (!projectDir) {
    console.error("[cloudrun sites create] usage: hyperframes cloudrun sites create <projectDir>");
    process.exit(1);
  }
  const state = readState(args);
  const { deploySite } = await import("@hyperframes/gcp-cloud-run/sdk");
  const handle = await deploySite({
    projectDir: resolve(projectDir),
    bucketName: state.bucketName,
    siteId: args["site-id"] as string | undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(handle, null, 2));
  } else {
    console.log(
      `${handle.uploaded ? c.accent("✓ uploaded") : c.dim("• already present")} ` +
        `site=${handle.siteId} (${handle.bytes} bytes)\n  ${handle.projectGcsUri}`,
    );
  }
}

// ── render ──────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function runRender(args: Record<string, unknown>): Promise<void> {
  const projectDir = args.target as string | undefined;
  if (!projectDir) {
    console.error(
      "[cloudrun render] usage: hyperframes cloudrun render <projectDir> --width <px> --height <px>",
    );
    process.exit(1);
  }
  const width = parsePositiveInt(args.width, "--width");
  const height = parsePositiveInt(args.height, "--height");
  if (width === undefined || height === undefined) {
    console.error("[cloudrun render] --width and --height are required.");
    process.exit(1);
  }
  const fps = parseIntFlag(args.fps) ?? 30;
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    console.error(`[cloudrun render] --fps must be 24, 30, or 60; got ${fps}.`);
    process.exit(1);
  }
  const state = readState(args);
  const variables = resolveAndValidateVariables(args, resolve(projectDir));
  const config = buildRenderConfig(args, fps, width, height, variables);

  const { renderToCloudRun, getRenderProgress } = await import("@hyperframes/gcp-cloud-run/sdk");
  const handle = await renderToCloudRun({
    projectDir: resolve(projectDir),
    config: config as Parameters<typeof renderToCloudRun>[0]["config"],
    bucketName: state.bucketName,
    projectId: state.projectId,
    location: state.region,
    workflowId: state.workflowId,
    serviceUrl: state.serviceUrl,
    renderId: args["render-id"] as string | undefined,
    outputKey: args["output-key"] as string | undefined,
  } as Parameters<typeof renderToCloudRun>[0]);

  if (!args.wait) {
    if (args.json) console.log(JSON.stringify(handle, null, 2));
    else {
      console.log(`${c.accent("✓ render started")} renderId=${handle.renderId}`);
      console.log(`  output → ${handle.outputGcsUri}`);
      console.log(
        `  progress: ${c.accent(`hyperframes cloudrun progress ${handle.executionName}`)}`,
      );
    }
    return;
  }

  const intervalMs = parsePositiveInt(args["wait-interval-ms"], "--wait-interval-ms") ?? 5000;
  let progress = await getRenderProgress({ executionName: handle.executionName });
  while (progress.status === "running") {
    await new Promise((r) => setTimeout(r, intervalMs));
    progress = await getRenderProgress({ executionName: handle.executionName });
    if (!args.json) process.stdout.write(`\r  status=${progress.status} `);
  }
  if (!args.json) process.stdout.write("\n");
  if (args.json) {
    console.log(JSON.stringify(progress, null, 2));
  } else if (progress.status === "succeeded") {
    console.log(
      `${c.accent("✓ done.")} ${progress.outputFile?.gcsUri} (${progress.costs.displayCost})`,
    );
  } else {
    console.error(`${c.error("✗ render " + progress.status)}`);
    for (const e of progress.errors) console.error(`  ${e.state}: ${e.cause}`);
    process.exit(1);
  }
}

// ── progress ──────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function runProgress(args: Record<string, unknown>): Promise<void> {
  const executionName = args.target as string | undefined;
  if (!executionName) {
    console.error("[cloudrun progress] usage: hyperframes cloudrun progress <executionName>");
    process.exit(1);
  }
  const { getRenderProgress } = await import("@hyperframes/gcp-cloud-run/sdk");
  const progress = await getRenderProgress({ executionName });
  if (args.json) {
    console.log(JSON.stringify(progress, null, 2));
    return;
  }
  console.log(`status=${progress.status} progress=${(progress.overallProgress * 100).toFixed(0)}%`);
  if (progress.totalFrames)
    console.log(`frames=${progress.framesRendered}/${progress.totalFrames}`);
  if (progress.outputFile) console.log(`output=${progress.outputFile.gcsUri}`);
  console.log(`cost=${progress.costs.displayCost}`);
  for (const e of progress.errors) console.error(`  error ${e.state}: ${e.cause}`);
}

// ── render-batch ────────────────────────────────────────────────────────────

interface BatchEntry {
  outputKey: string;
  variables?: Record<string, unknown>;
}

const DEFAULT_BATCH_MAX_CONCURRENT = 50;

/**
 * Fan out N personalised renders of the same project from a JSONL batch file
 * (one `{ outputKey, variables }` per line). Deploys the site once, then
 * starts an execution per entry with a concurrency cap. `--dry-run` prints the
 * resolved manifest without starting anything. Mirrors `hyperframes lambda
 * render-batch`.
 */
// fallow-ignore-next-line complexity
async function runRenderBatch(args: Record<string, unknown>): Promise<void> {
  const projectDir = args.target as string | undefined;
  const batchPath = args.batch as string | undefined;
  if (!projectDir || !batchPath) {
    console.error(
      "[cloudrun render-batch] usage: hyperframes cloudrun render-batch <projectDir> --batch <file.jsonl> --width <px> --height <px>",
    );
    process.exit(1);
  }
  const width = parsePositiveInt(args.width, "--width");
  const height = parsePositiveInt(args.height, "--height");
  if (width === undefined || height === undefined) {
    console.error("[cloudrun render-batch] --width and --height are required.");
    process.exit(1);
  }
  const fps = parseIntFlag(args.fps) ?? 30;
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    console.error(`[cloudrun render-batch] --fps must be 24, 30, or 60; got ${fps}.`);
    process.exit(1);
  }
  if (!existsSync(resolve(batchPath))) {
    console.error(`[cloudrun render-batch] batch file not found: ${batchPath}`);
    process.exit(1);
  }
  const entries = parseBatchFile(resolve(batchPath));
  if (entries.length === 0) {
    console.error("[cloudrun render-batch] batch file has no entries.");
    process.exit(1);
  }

  const dryRun = Boolean(args["dry-run"]);
  if (dryRun) {
    const manifest = entries.map((e, i) => ({
      line: i + 1,
      outputKey: e.outputKey,
      status: "would-start",
    }));
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const state = readState(args);
  const maxConcurrent =
    parsePositiveInt(args["max-concurrent"], "--max-concurrent") ?? DEFAULT_BATCH_MAX_CONCURRENT;
  const { deploySite, renderToCloudRun } = await import("@hyperframes/gcp-cloud-run/sdk");

  // Upload the project once; every entry reuses the same content-addressed
  // site handle so the tar+upload cost is paid a single time.
  const siteHandle = await deploySite({
    projectDir: resolve(projectDir),
    bucketName: state.bucketName,
    siteId: args["site-id"] as string | undefined,
  });

  const results: Array<{ outputKey: string; executionName?: string; error?: string }> = [];
  // Start executions in fixed-size waves so we never exceed `maxConcurrent`
  // in-flight CreateExecution calls.
  for (let i = 0; i < entries.length; i += maxConcurrent) {
    const wave = entries.slice(i, i + maxConcurrent);
    const settled = await Promise.all(
      wave.map(async (entry) => {
        try {
          const config = buildRenderConfig(args, fps, width, height, entry.variables);
          const handle = await renderToCloudRun({
            siteHandle,
            config: config as Parameters<typeof renderToCloudRun>[0]["config"],
            bucketName: state.bucketName,
            projectId: state.projectId,
            location: state.region,
            workflowId: state.workflowId,
            serviceUrl: state.serviceUrl,
            outputKey: entry.outputKey,
          } as Parameters<typeof renderToCloudRun>[0]);
          return { outputKey: entry.outputKey, executionName: handle.executionName };
        } catch (err) {
          return {
            outputKey: entry.outputKey,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...settled);
  }

  const failed = results.filter((r) => r.error);
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(
      `${c.accent("✓ started")} ${results.length - failed.length}/${results.length} renders`,
    );
    for (const r of failed) console.error(`  ✗ ${r.outputKey}: ${r.error}`);
  }
  if (failed.length > 0) process.exit(1);
}

/** Parse a JSONL batch file into entries, exiting with a clear error on a bad line. */
function parseBatchFile(path: string): BatchEntry[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const entries: BatchEntry[] = [];
  // fallow-ignore-next-line complexity
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.error(`[cloudrun render-batch] line ${idx + 1}: not valid JSON`);
      process.exit(1);
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as BatchEntry).outputKey !== "string"
    ) {
      console.error(
        `[cloudrun render-batch] line ${idx + 1}: must be an object with a string "outputKey"`,
      );
      process.exit(1);
    }
    entries.push(parsed as BatchEntry);
  });
  return entries;
}

// ── destroy ──────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function runDestroy(args: Record<string, unknown>): void {
  const tfDir = terraformDir();
  const state = existsSync(statePath())
    ? (JSON.parse(readFileSync(statePath(), "utf8")) as Partial<StackState>)
    : {};
  const project = (args.project as string | undefined) ?? state.projectId;
  const region = (args.region as string | undefined) ?? state.region ?? "us-central1";
  const image = (args.image as string | undefined) ?? "unused:latest";
  if (!project) {
    console.error("[cloudrun destroy] --project is required (or deploy first to cache it).");
    process.exit(1);
  }
  const vars = [
    "-var",
    `project_id=${project}`,
    "-var",
    `region=${region}`,
    "-var",
    `image=${image}`,
    "-var",
    "bucket_force_destroy=true",
  ];
  console.log("→ terraform destroy");
  run("terraform", ["init", "-input=false"], { cwd: tfDir });
  // Apply `bucket_force_destroy=true` into state FIRST. Terraform reads a
  // bucket's force_destroy from prior state when emptying it during destroy,
  // so passing the var only at destroy time can't flip it — a destroy of a
  // bucket that still holds render artifacts would fail with "bucket not
  // empty". The quick apply updates the attribute, then destroy can sweep
  // the (scratch) bucket. Best-effort: if there's nothing to apply this
  // no-ops.
  try {
    run("terraform", ["apply", "-input=false", "-auto-approve", ...vars], { cwd: tfDir });
  } catch {
    // A failed pre-apply shouldn't block the destroy attempt below.
  }
  run("terraform", ["destroy", "-input=false", "-auto-approve", ...vars], { cwd: tfDir });
  console.log(`${c.accent("✓ destroyed.")}`);
}

// ── config + variables helpers (shared by render + render-batch) ────────────

/**
 * Build the serializable render config from CLI flags. `variables` is resolved
 * separately (it differs per batch entry). Mirrors the local `hyperframes
 * render` flag surface so the two stay consistent.
 */
function buildRenderConfig(
  args: Record<string, unknown>,
  fps: number,
  width: number,
  height: number,
  variables: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return stripUndefined({
    fps,
    width,
    height,
    format: parseFormat(args.format),
    codec: parseCodec(args.codec),
    quality: parseQuality(args.quality),
    chunkSize: parsePositiveInt(args["chunk-size"], "--chunk-size"),
    maxParallelChunks: parsePositiveInt(args["max-parallel-chunks"], "--max-parallel-chunks"),
    targetChunkFrames: parsePositiveInt(args["target-chunk-frames"], "--target-chunk-frames"),
    outputResolution: parseOutputResolution(args["output-resolution"]),
    variables,
  });
}

/**
 * Resolve --variables / --variables-file via the shared CLI parser (the same
 * one `hyperframes render` and `hyperframes lambda render` use), then validate
 * against the composition's `data-composition-variables` when an `index.html`
 * is on disk. `--strict-variables` turns mismatches into a hard failure.
 */
function resolveAndValidateVariables(
  args: Record<string, unknown>,
  projectDir: string,
): Record<string, unknown> | undefined {
  const variables = resolveVariablesArg(
    args.variables as string | undefined,
    args["variables-file"] as string | undefined,
  );
  if (variables && Object.keys(variables).length > 0) {
    const indexPath = join(projectDir, "index.html");
    if (existsSync(indexPath)) {
      const issues = validateVariablesAgainstProject(indexPath, variables);
      reportVariableIssues(issues, {
        strict: Boolean(args["strict-variables"]),
        quiet: Boolean(args.json),
      });
    }
  }
  return variables;
}

function parseOutputResolution(raw: unknown): CanvasResolution | undefined {
  if (raw == null || raw === "") return undefined;
  const normalized = normalizeResolutionFlag(String(raw));
  if (normalized) return normalized;
  throw new Error(
    `[cloudrun render] --output-resolution must be one of ${VALID_CANVAS_RESOLUTIONS.join("|")} ` +
      `(or an alias: 1080p, 4k, uhd, hd, …); got ${String(raw)}`,
  );
}

// ── parse helpers ─────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function parseIntFlag(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}
function parsePositiveInt(raw: unknown, flagName: string): number | undefined {
  const n = parseIntFlag(raw);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[cloudrun] ${flagName} must be a positive integer; got ${n}`);
  }
  return n;
}
// fallow-ignore-next-line complexity
function parseEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  errorPrefix: string,
  defaultValue: T | undefined,
): T | undefined {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const s = String(raw);
  if ((allowed as readonly string[]).includes(s)) return s as T;
  throw new Error(`${errorPrefix} must be ${allowed.join("|")}; got ${s}`);
}
const FORMATS = ["mp4", "mov", "png-sequence", "webm"] as const;
const CODECS = ["h264", "h265"] as const;
const QUALITIES = ["draft", "standard", "high"] as const;
const parseFormat = (raw: unknown): (typeof FORMATS)[number] =>
  parseEnum(raw, FORMATS, "[cloudrun render] --format", "mp4")!;
const parseCodec = (raw: unknown): (typeof CODECS)[number] | undefined =>
  parseEnum(raw, CODECS, "[cloudrun render] --codec", undefined);
const parseQuality = (raw: unknown): (typeof QUALITIES)[number] | undefined =>
  parseEnum(raw, QUALITIES, "[cloudrun render] --quality", undefined);
