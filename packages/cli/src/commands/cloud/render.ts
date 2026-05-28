/**
 * `hyperframes cloud render` — orchestrate a cloud-rendered HyperFrames
 * composition end-to-end:
 *
 *   1. Resolve the project (or reuse a pre-uploaded `--asset-id` /
 *      `--url`).
 *   2. Zip the project (reuses `createPublishArchive` so the
 *      file-ignore set matches the existing `publish` command exactly).
 *   3. Upload the zip via `POST /v3/assets` (multipart) — the server
 *      branches on the detected `application/zip` MIME.
 *   4. Submit the render via `POST /v3/hyperframes/renders` with a
 *      `project: {type:"asset_id", asset_id}` shape.
 *   5. If `--no-wait` or `--callback-url`: return the render_id and
 *      exit. Otherwise poll `GET /v3/hyperframes/renders/{id}` every
 *      `--poll-interval` (default 10s, max 60min).
 *   6. On `completed`: stream the signed `video_url` to disk.
 *   7. On `failed`: print `failure_message` and exit 1.
 *
 * Auth comes from the existing `cli/src/auth/` chain via `cloud/auth.ts`.
 * The cloud HTTP client (`cloud/_gen/client.ts`) is generated from
 * `experiment-framework/openapi/external-api.json`; never hand-edit it.
 */

import { defineCommand } from "citty";
import { mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

import { c } from "../../ui/colors.js";
import { errorBox, formatBytes, formatDuration } from "../../ui/format.js";
import { resolveProject } from "../../utils/project.js";
import { createPublishArchive } from "../../utils/publishProject.js";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../../utils/variables.js";
import type { Example } from "../_examples.js";

import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  HyperframesApiError,
  PollTimeoutError,
  createCloudClient,
  downloadToFile,
  pollUntilTerminal,
} from "../../cloud/index.js";
import { colorStatus } from "../../cloud/statusColor.js";
import type {
  CreateHyperframesRenderRequest,
  HyperframesCloudClient,
  HyperframesRenderDetail,
} from "../../cloud/index.js";

const VALID_QUALITY = new Set(["draft", "standard", "high"]);
const VALID_FORMAT = new Set(["mp4", "webm", "mov"]);
const VALID_RESOLUTION = new Set([
  "landscape",
  "portrait",
  "landscape-4k",
  "portrait-4k",
  "square",
  "square-4k",
]);

const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };

// Surface the most-common API error codes with actionable hints.
// Anything not listed here falls through to a generic "API error" box.
const ERROR_CODE_HINTS: Record<string, string> = {
  hyperframes_project_invalid:
    "The uploaded zip didn't validate. Confirm it contains index.html at the root (or matches --composition), and that all referenced assets are present.",
  hyperframes_project_too_large:
    "The zip exceeded the 32 MB limit. Trim large media (or pre-host them and reference by URL), then try again.",
  hyperframes_render_not_found:
    "The render_id no longer exists — either soft-deleted or never created.",
  invalid_parameter:
    "Check the listed parameter against `hyperframes cloud render --help` for the accepted values.",
};

export const examples: Example[] = [
  ["Render the current directory in the cloud", "hyperframes cloud render"],
  [
    "Pick a specific composition + output path",
    "hyperframes cloud render . --composition compositions/intro.html -o ./renders/intro.mp4",
  ],
  ["Higher quality, 60fps", "hyperframes cloud render --quality high --fps 60"],
  [
    "Fire-and-forget via webhook",
    "hyperframes cloud render --callback-url https://example.com/hook --no-wait",
  ],
  [
    "Override variables (parametrized render)",
    'hyperframes cloud render --variables \'{"title":"Q4 Recap","theme":"dark"}\'',
  ],
  ["Re-render an already-uploaded zip", "hyperframes cloud render --asset-id asst_abc123"],
];

export default defineCommand({
  meta: { name: "render", description: "Render a HyperFrames composition in the cloud" },
  args: {
    dir: { type: "positional", required: false, description: "Project directory (default: .)" },
    fps: { type: "string", description: "Frames per second (1-240). Default: 30." },
    quality: { type: "string", description: "draft | standard | high (default: standard)" },
    format: { type: "string", description: "mp4 | webm | mov (default: mp4)" },
    resolution: {
      type: "string",
      description:
        "Resolution preset: landscape | portrait | landscape-4k | portrait-4k | square | square-4k",
    },
    composition: {
      type: "string",
      alias: "c",
      description: "Entry HTML file inside the zip (default: index.html)",
    },
    variables: {
      type: "string",
      description:
        'Inline JSON object overriding data-composition-variables. Example: --variables \'{"title":"X"}\'',
    },
    "variables-file": {
      type: "string",
      description: "Path to a JSON file with variable values (alternative to --variables)",
    },
    "strict-variables": {
      type: "boolean",
      description: "Fail when --variables keys are undeclared or have the wrong type",
      default: false,
    },
    title: {
      type: "string",
      description: "Free-text label echoed back in detail responses",
    },
    "callback-url": {
      type: "string",
      description: "HTTPS webhook fired when the render terminates",
    },
    "callback-id": {
      type: "string",
      description: "Opaque tracking ID echoed in webhook payloads",
    },
    "asset-id": {
      type: "string",
      description:
        "Skip zip+upload and submit an already-uploaded composition. Mutually exclusive with --url and the project dir.",
    },
    url: {
      type: "string",
      description:
        "Public HTTPS URL of a composition zip. Mutually exclusive with --asset-id and the project dir.",
    },
    "no-wait": {
      type: "boolean",
      description: "Submit and exit; print the render_id to stdout",
      default: false,
    },
    output: {
      type: "string",
      alias: "o",
      description: "Destination path for the downloaded video (default: renders/<render_id>.<ext>)",
    },
    "poll-interval": {
      type: "string",
      description: `Poll cadence in seconds (default: ${DEFAULT_POLL_INTERVAL_MS / 1000})`,
    },
    "max-wait": {
      type: "string",
      description: `Max poll duration in minutes (default: ${DEFAULT_MAX_WAIT_MS / 60_000})`,
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON instead of human-friendly progress",
      default: false,
    },
    "idempotency-key": {
      type: "string",
      description: "Optional Idempotency-Key for safe retries (1-255 chars from [A-Za-z0-9_:.-])",
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const asJson = Boolean(args.json);
    const fps = parseFps(args.fps);
    const quality = parseQuality(args.quality);
    const format = parseFormat(args.format);
    const resolution = parseResolution(args.resolution);
    const pollIntervalMs = parsePollIntervalMs(args["poll-interval"]);
    const maxWaitMs = parseMaxWaitMs(args["max-wait"]);
    const variables = resolveVariablesAndValidateIfLocal(
      args.variables,
      args["variables-file"],
      args["strict-variables"] ?? false,
      args.dir,
      args["asset-id"],
      args.url,
    );

    const project = resolveProjectInput({
      dir: args.dir,
      assetId: args["asset-id"],
      url: args.url,
    });

    const client = await createCloudClient();

    const upload = await maybeUploadProject(client, project, asJson, args["idempotency-key"]);
    const submitted = await submitRender(client, {
      projectInput: upload.projectInput,
      fps,
      quality,
      format,
      resolution,
      composition: args.composition,
      variables,
      title: args.title,
      callbackUrl: args["callback-url"],
      callbackId: args["callback-id"],
      idempotencyKey: args["idempotency-key"],
    });

    const renderId = submitted.render_id;
    if (args["no-wait"]) {
      if (asJson) {
        console.log(JSON.stringify({ render_id: renderId, status: "queued" }, null, 2));
      } else {
        console.log("");
        console.log(`${c.success("✓")}  Submitted ${c.accent(renderId)}`);
        console.log(c.dim(`   Poll with: hyperframes cloud get ${renderId}`));
      }
      return;
    }

    if (!asJson) {
      console.log("");
      console.log(c.dim(`  Polling ${renderId} every ${pollIntervalMs / 1000}s …`));
    }

    const detail = await pollWithProgress(client, renderId, asJson, {
      intervalMs: pollIntervalMs,
      maxWaitMs,
    });

    if (detail.status === "failed") {
      handleFailedRender(detail, asJson);
    }

    if (!detail.video_url) {
      errorBox(
        "Render completed but returned no video_url",
        `render_id: ${renderId}. Try \`hyperframes cloud get ${renderId}\` to inspect raw fields.`,
      );
      process.exit(1);
    }

    const outputPath = resolveOutputPath(args.output, renderId, detail.format);
    await streamVideo(detail.video_url, outputPath, asJson);

    if (asJson) {
      console.log(JSON.stringify({ render: detail, output_path: outputPath }, null, 2));
    }
  },
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

// fallow-ignore-next-line complexity
function parseFps(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 240) {
    errorBox("Invalid --fps", `Got "${raw}". Must be an integer between 1 and 240.`);
    process.exit(1);
  }
  return n;
}

function parseQuality(raw: string | undefined): "draft" | "standard" | "high" | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_QUALITY.has(raw)) {
    errorBox("Invalid --quality", `Got "${raw}". Must be draft, standard, or high.`);
    process.exit(1);
  }
  return raw as "draft" | "standard" | "high";
}

function parseFormat(raw: string | undefined): "mp4" | "webm" | "mov" | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_FORMAT.has(raw)) {
    errorBox("Invalid --format", `Got "${raw}". Must be mp4, webm, or mov.`);
    process.exit(1);
  }
  return raw as "mp4" | "webm" | "mov";
}

function parseResolution(
  raw: string | undefined,
): CreateHyperframesRenderRequest["resolution"] | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_RESOLUTION.has(raw)) {
    errorBox(
      "Invalid --resolution",
      `Got "${raw}". Must be one of: ${[...VALID_RESOLUTION].join(", ")}.`,
    );
    process.exit(1);
  }
  return raw as CreateHyperframesRenderRequest["resolution"];
}

function parsePollIntervalMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_POLL_INTERVAL_MS;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 1) {
    errorBox("Invalid --poll-interval", `Got "${raw}". Must be a positive number of seconds.`);
    process.exit(1);
  }
  return Math.round(n * 1000);
}

function parseMaxWaitMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_WAIT_MS;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    errorBox("Invalid --max-wait", `Got "${raw}". Must be a positive number of minutes.`);
    process.exit(1);
  }
  return Math.round(n * 60_000);
}

// ---------------------------------------------------------------------------
// Project resolution (dir | asset-id | url) — exactly one source
// ---------------------------------------------------------------------------

interface ProjectInputSource {
  kind: "dir" | "asset_id" | "url";
  dir?: string;
  assetId?: string;
  url?: string;
}

// fallow-ignore-next-line complexity
function resolveProjectInput(opts: {
  dir: string | undefined;
  assetId: string | undefined;
  url: string | undefined;
}): ProjectInputSource {
  const sources = [opts.assetId, opts.url].filter((v) => v !== undefined && v !== "");
  if (sources.length > 1) {
    errorBox("Conflicting inputs", "Pass only one of: project dir, --asset-id, --url.");
    process.exit(1);
  }
  if (opts.assetId) return { kind: "asset_id", assetId: opts.assetId };
  if (opts.url) return { kind: "url", url: opts.url };
  return { kind: "dir", dir: opts.dir ?? "." };
}

// fallow-ignore-next-line complexity
function resolveVariablesAndValidateIfLocal(
  inline: string | undefined,
  filePath: string | undefined,
  strict: boolean,
  dirArg: string | undefined,
  assetId: string | undefined,
  url: string | undefined,
): Record<string, unknown> | undefined {
  const variables = resolveVariablesArg(inline, filePath);
  if (!variables || Object.keys(variables).length === 0) return variables;
  // Only validate against the local composition when we actually have
  // a local project on disk. For --asset-id / --url paths the schema
  // lives on the server side, so we send the variables as-is and let
  // the API surface any mismatch via `hyperframes_project_invalid`.
  if (assetId || url) return variables;
  try {
    const { indexPath } = resolveProject(dirArg);
    const issues = validateVariablesAgainstProject(indexPath, variables);
    reportVariableIssues(issues, { strict, quiet: false });
  } catch {
    // resolveProject errors are handled later in the main flow.
  }
  return variables;
}

// ---------------------------------------------------------------------------
// Upload step (only when project is a local dir)
// ---------------------------------------------------------------------------

interface UploadResult {
  projectInput: CreateHyperframesRenderRequest["project"];
}

// fallow-ignore-next-line complexity
async function maybeUploadProject(
  client: HyperframesCloudClient,
  source: ProjectInputSource,
  asJson: boolean,
  idempotencyKey: string | undefined,
): Promise<UploadResult> {
  if (source.kind === "asset_id") {
    return { projectInput: { type: "asset_id", asset_id: source.assetId! } };
  }
  if (source.kind === "url") {
    return { projectInput: { type: "url", url: source.url! } };
  }

  const project = resolveProject(source.dir);
  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Zipping ${c.accent(project.name)}`);
  }
  const archive = createPublishArchive(project.dir);
  if (!asJson) {
    console.log(c.dim(`   ${archive.fileCount} files · ${formatBytes(archive.buffer.byteLength)}`));
  }

  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Uploading to /v3/assets`);
  }
  const uploadStart = Date.now();
  const uploaded = await client
    .uploadAsset({
      file: archive.buffer,
      filename: `${project.name}.zip`,
      idempotencyKey,
    })
    .catch((err) => {
      throwUploadError(err);
    });
  if (!asJson) {
    console.log(
      c.dim(
        `   asset_id: ${c.accent(uploaded.asset_id)} · ${formatDuration(Date.now() - uploadStart)}`,
      ),
    );
  }
  return { projectInput: { type: "asset_id", asset_id: uploaded.asset_id } };
}

// fallow-ignore-next-line complexity
function throwUploadError(err: unknown): never {
  if (err instanceof HyperframesApiError) {
    if (err.code && ERROR_CODE_HINTS[err.code]) {
      errorBox(`Upload failed (HTTP ${err.status})`, err.message, ERROR_CODE_HINTS[err.code]);
    } else {
      errorBox(`Upload failed (HTTP ${err.status})`, err.message);
    }
    process.exit(1);
  }
  if (err instanceof Error) {
    errorBox("Upload failed", err.message);
    process.exit(1);
  }
  errorBox("Upload failed", String(err));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Submit step
// ---------------------------------------------------------------------------

interface SubmitOptions {
  projectInput: CreateHyperframesRenderRequest["project"];
  fps: number | undefined;
  quality: "draft" | "standard" | "high" | undefined;
  format: "mp4" | "webm" | "mov" | undefined;
  resolution: CreateHyperframesRenderRequest["resolution"] | undefined;
  composition: string | undefined;
  variables: Record<string, unknown> | undefined;
  title: string | undefined;
  callbackUrl: string | undefined;
  callbackId: string | undefined;
  idempotencyKey: string | undefined;
}

// fallow-ignore-next-line complexity
async function submitRender(
  client: HyperframesCloudClient,
  opts: SubmitOptions,
): Promise<{ render_id: string }> {
  const body: CreateHyperframesRenderRequest = { project: opts.projectInput };
  if (opts.fps !== undefined) body.fps = opts.fps;
  if (opts.quality !== undefined) body.quality = opts.quality;
  if (opts.format !== undefined) body.format = opts.format;
  if (opts.resolution !== undefined) body.resolution = opts.resolution;
  if (opts.composition !== undefined) body.composition = opts.composition;
  if (opts.variables !== undefined) body.variables = opts.variables;
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.callbackUrl !== undefined) body.callback_url = opts.callbackUrl;
  if (opts.callbackId !== undefined) body.callback_id = opts.callbackId;

  try {
    return await client.createRender({ body, idempotencyKey: opts.idempotencyKey });
  } catch (err) {
    throwSubmitError(err);
  }
}

function throwSubmitError(err: unknown): never {
  if (err instanceof HyperframesApiError) {
    const hint = err.code ? ERROR_CODE_HINTS[err.code] : undefined;
    errorBox(`Submit failed (HTTP ${err.status})`, err.message, hint);
    process.exit(1);
  }
  if (err instanceof Error) {
    errorBox("Submit failed", err.message);
    process.exit(1);
  }
  errorBox("Submit failed", String(err));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Poll + progress
// ---------------------------------------------------------------------------

// fallow-ignore-next-line complexity
async function pollWithProgress(
  client: HyperframesCloudClient,
  renderId: string,
  asJson: boolean,
  poll: { intervalMs: number; maxWaitMs: number },
): Promise<HyperframesRenderDetail> {
  let lastStatus = "";
  try {
    return await pollUntilTerminal(client, renderId, {
      intervalMs: poll.intervalMs,
      maxWaitMs: poll.maxWaitMs,
      onTick: (detail, elapsedMs) => {
        if (asJson) return;
        if (detail.status === lastStatus) {
          process.stdout.write(`\r\x1b[2K  ${formatTickLine(detail, elapsedMs)}`);
        } else {
          if (lastStatus) process.stdout.write("\n");
          process.stdout.write(`  ${formatTickLine(detail, elapsedMs)}`);
          lastStatus = detail.status;
        }
      },
    });
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      if (!asJson) process.stdout.write("\n");
      errorBox(
        "Poll timed out",
        err.message,
        `The render may still complete. Resume with: hyperframes cloud get ${renderId}`,
      );
      process.exit(1);
    }
    if (err instanceof HyperframesApiError) {
      if (!asJson) process.stdout.write("\n");
      errorBox(
        `API error during poll (HTTP ${err.status})`,
        err.message,
        err.code ? `code: ${err.code}` : undefined,
      );
      process.exit(1);
    }
    if (err instanceof Error) {
      if (!asJson) process.stdout.write("\n");
      errorBox("Poll failed", err.message);
      process.exit(1);
    }
    throw err;
  } finally {
    if (!asJson && lastStatus) process.stdout.write("\n");
  }
}

function formatTickLine(detail: HyperframesRenderDetail, elapsedMs: number): string {
  const status = colorStatus(detail.status);
  return `${status}  ${c.dim(formatDuration(elapsedMs))}`;
}

// ---------------------------------------------------------------------------
// Terminal handlers
// ---------------------------------------------------------------------------

function handleFailedRender(detail: HyperframesRenderDetail, asJson: boolean): never {
  if (asJson) {
    console.log(JSON.stringify({ render: detail }, null, 2));
    process.exit(1);
  }
  errorBox(
    "Render failed",
    detail.failure_message ?? "(no failure_message returned)",
    `Inspect: hyperframes cloud get ${detail.render_id}`,
  );
  process.exit(1);
}

function resolveOutputPath(output: string | undefined, renderId: string, format: string): string {
  if (output) {
    return isAbsolute(output) ? output : resolvePath(process.cwd(), output);
  }
  const ext = FORMAT_EXT[format] ?? `.${format}`;
  return resolvePath(process.cwd(), "renders", `${renderId}${ext}`);
}

// fallow-ignore-next-line complexity
async function streamVideo(url: string, destPath: string, asJson: boolean): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Downloading to ${c.accent(destPath)}`);
  }
  try {
    const result = await downloadToFile(url, destPath);
    if (!asJson) {
      const stat = statSync(result.path);
      console.log(c.dim(`   ${formatBytes(stat.size)} written`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorBox(
      "Download failed",
      message,
      "The presigned URL is short-lived; re-fetch with `hyperframes cloud get`.",
    );
    process.exit(1);
  }
}
