/**
 * `hyperframes cloud render` — orchestrate a cloud-rendered HyperFrames
 * composition end-to-end:
 *
 *   1. Resolve the project (or reuse a pre-uploaded `--asset-id` /
 *      `--url`).
 *   2. Zip the project (reuses `createPublishArchive` so the
 *      file-ignore set matches the existing `publish` command exactly).
 *   3. Upload the zip via the direct-to-S3 flow: `POST /v3/assets/
 *      direct-uploads` returns a presigned URL, we PUT the zip bytes
 *      to it, then `POST /v3/assets/{asset_id}/complete` finalizes.
 *      Cap: 200 MB. See `../../cloud/upload.ts` for the three-step
 *      contract. (The legacy `POST /v3/assets` proxy path was 32 MB.)
 *   4. Submit the render via `POST /v3/hyperframes/renders` with a
 *      `project: {type:"asset_id", asset_id}` shape.
 *   5. If `--no-wait`: print the `render_id` and exit immediately.
 *      Otherwise poll `GET /v3/hyperframes/renders/{id}` every
 *      `--poll-interval` (default 10s, max 60min). `--callback-url`
 *      can be combined with either mode: the webhook always fires when
 *      the server-side render terminates, independent of whether the
 *      CLI is still polling.
 *   6. On `completed`: stream the signed `video_url` to disk.
 *   7. On `failed`: print `failure_message` and exit 1.
 *
 * Auth comes from the existing `cli/src/auth/` chain via `cloud/auth.ts`.
 * The cloud HTTP client (`cloud/_gen/client.ts`) is generated from
 * `experiment-framework/openapi/external-api.json`; never hand-edit it.
 */

import { defineCommand } from "citty";

import {
  detectAspectRatioFromHtml,
  type AspectRatioDetection,
} from "../../cloud/detectAspectRatio.js";
import { c } from "../../ui/colors.js";
import { errorBox, formatBytes, formatDuration } from "../../ui/format.js";
import { resolveProject, type ProjectDir } from "../../utils/project.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import {
  buildPublishFileMap,
  type PublishArchiveResult,
  zipPublishFileMap,
} from "../../utils/publishProject.js";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../../utils/variables.js";
import { withMeta } from "../../utils/updateCheck.js";
import type { Example } from "../_examples.js";

import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  PollTimeoutError,
  createCloudClient,
  downloadToFile,
  pollUntilTerminal,
} from "../../cloud/index.js";
import { reportApiError } from "../../cloud/errors.js";
import { parseEnumFlag, parseIntFlag, parseNumericFlag } from "../../cloud/parsing.js";
import { uploadZipViaDirectUpload } from "../../cloud/upload.js";
import { colorStatus } from "../../cloud/statusColor.js";
import type {
  CreateHyperframesRenderRequest,
  HyperframesCloudClient,
  HyperframesRenderDetail,
} from "../../cloud/index.js";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const VALID_QUALITY = ["draft", "standard", "high"] as const;
const VALID_FORMAT = ["mp4", "webm", "mov"] as const;
const VALID_RESOLUTION = ["1080p", "4k"] as const;
const VALID_ASPECT_RATIO = ["16:9", "9:16", "1:1"] as const;
// Mirrors the binary-byte max_bytes contract used by direct asset uploads.
const DIRECT_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024;
const ARCHIVE_DIAGNOSTIC_THRESHOLD_BYTES = 150 * 1024 * 1024;
const LARGEST_FILE_COUNT = 10;

const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };

export const examples: Example[] = [
  ["Render the current directory in the cloud", "hyperframes cloud render"],
  ["Inspect archive size without uploading", "hyperframes cloud render --dry-run"],
  [
    "Pick a specific composition + output path",
    "hyperframes cloud render . --composition compositions/intro.html -o ./renders/intro.mp4",
  ],
  ["Higher quality, 60fps", "hyperframes cloud render --quality high --fps 60"],
  [
    "Submit and exit; webhook fires when the render terminates",
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
      description: "Resolution tier: 1080p | 4k (default: 1080p; 4k is billed at 1.5x)",
    },
    "aspect-ratio": {
      type: "string",
      description: "Aspect ratio: 16:9 | 9:16 | 1:1 (default: 16:9)",
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
      description:
        "HTTPS webhook fired when the render terminates. Fires regardless of whether the CLI is still polling — combine with --no-wait for true fire-and-forget.",
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
    // Citty parses `--no-FOO` as `--FOO=false`. A flag literally named
    // "no-wait" gets routed as `args.wait=false`, leaving
    // `args["no-wait"]` undefined and the early-return for
    // fire-and-forget mode unreachable. Named the arg `wait` so the
    // user-facing `--no-wait` flag works via citty's negation; the
    // run() body checks `if (!args.wait)`.
    wait: {
      type: "boolean",
      description:
        "Poll until completion and download the video (default: true). Pass `--no-wait` for fire-and-forget — submits and exits with the render_id.",
      default: true,
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
    "dry-run": {
      type: "boolean",
      description: "Build and inspect the project zip without authenticating or uploading",
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
    const fps = parseIntFlag(args.fps, { flag: "--fps", min: 1, max: 240 });
    const quality = parseEnumFlag(args.quality, VALID_QUALITY, { flag: "--quality" });
    const format = parseEnumFlag(args.format, VALID_FORMAT, { flag: "--format" });
    const resolution = parseEnumFlag(args.resolution, VALID_RESOLUTION, {
      flag: "--resolution",
    });
    const explicitAspectRatio = parseEnumFlag(args["aspect-ratio"], VALID_ASPECT_RATIO, {
      flag: "--aspect-ratio",
    });
    const pollIntervalMs = parsePollIntervalMs(args["poll-interval"]);
    const maxWaitMs = parseMaxWaitMs(args["max-wait"]);
    validateIdempotencyKey(args["idempotency-key"]);

    // Project resolution runs BEFORE variables resolution so a user
    // passing conflicting inputs (`dir + --asset-id`) sees the
    // structural error before any variable parsing errors.
    const project = resolveProjectInput({
      dir: args.dir,
      assetId: args["asset-id"],
      url: args.url,
    });
    validateDryRunSource(project, args["dry-run"] ?? false);

    // 4k supersampling runs through the alpha-incompatible screenshot path;
    // reject the combination client-side instead of failing mid-render.
    validateResolutionFormatCombo(resolution, format);

    // Aspect ratio is derived from the composition's authored dimensions: for
    // a local dir we parse the entry HTML and auto-detect, so the user rarely
    // needs --aspect-ratio at all. When they DO pass it, we validate it
    // matches the composition (the renderer can't reshape, only supersample to
    // a matching ratio) and fail fast on a mismatch. This also fails fast when
    // the --composition entry file is missing, rather than uploading a zip the
    // render rejects with a generic server-side error.
    const aspectRatio = resolveAspectRatioForSubmit(
      project,
      args.composition,
      explicitAspectRatio,
      asJson,
    );

    if (args["dry-run"]) {
      if (project.kind !== "dir") throw new Error("Dry-run project must be a local directory");
      reportDryRun(prepareLocalArchive(project, args.composition, asJson), asJson);
      return;
    }

    const variables = resolveVariablesAndValidateIfLocal(
      args.variables,
      args["variables-file"],
      args["strict-variables"] ?? false,
      project,
    );

    const client = await createCloudClient();
    const preparedArchive =
      project.kind === "dir" ? prepareLocalArchive(project, args.composition, asJson) : undefined;

    const upload = await maybeUploadProject(
      client,
      project,
      preparedArchive,
      asJson,
      args["idempotency-key"],
    );
    const submitted = await submitRender(client, {
      projectInput: upload.projectInput,
      fps,
      quality,
      format,
      resolution,
      aspectRatio,
      composition: args.composition,
      variables,
      title: args.title,
      callbackUrl: args["callback-url"],
      callbackId: args["callback-id"],
      idempotencyKey: args["idempotency-key"],
    });

    const renderId = submitted.render_id;
    if (!args.wait) {
      if (asJson) {
        console.log(
          JSON.stringify(
            withMeta({ render: { render_id: renderId, status: "queued" as const } }),
            null,
            2,
          ),
        );
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
    const downloadResult = await streamVideo(detail.video_url, outputPath, asJson);

    if (asJson) {
      console.log(
        JSON.stringify(
          withMeta({
            render: detail,
            output_path: outputPath,
            bytes_written: downloadResult.bytes,
          }),
          null,
          2,
        ),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Argument parsing — defers to cloud/parsing.ts for strict validators
// ---------------------------------------------------------------------------

function parsePollIntervalMs(raw: string | undefined): number {
  const n = parseNumericFlag(raw, { flag: "--poll-interval", min: 1 });
  return n === undefined ? DEFAULT_POLL_INTERVAL_MS : Math.round(n * 1000);
}

function parseMaxWaitMs(raw: string | undefined): number {
  const n = parseNumericFlag(raw, { flag: "--max-wait", min: 0.0001 });
  return n === undefined ? DEFAULT_MAX_WAIT_MS : Math.round(n * 60_000);
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_:.-]{1,255}$/;

function validateIdempotencyKey(key: string | undefined): void {
  if (key === undefined) return;
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    errorBox("Invalid --idempotency-key", `Got "${key}". Must be 1-255 chars from [A-Za-z0-9_:.-]`);
    process.exit(1);
  }
}

export function validateDryRunSource(source: ProjectInputSource, dryRun: boolean): void {
  if (!dryRun || source.kind === "dir") return;
  errorBox(
    "Invalid --dry-run input",
    "--dry-run inspects a local project directory and cannot be combined with --asset-id or --url.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Project resolution (dir | asset-id | url) — exactly one source
// ---------------------------------------------------------------------------

export interface ProjectInputSource {
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
  // Count every source the user explicitly supplied. The positional
  // `dir` defaults to `undefined` when omitted (not to "."), so we
  // can detect "user actually typed something" vs. "default to cwd".
  const explicit = {
    dir: opts.dir !== undefined && opts.dir !== "",
    assetId: opts.assetId !== undefined && opts.assetId !== "",
    url: opts.url !== undefined && opts.url !== "",
  };
  const count = Number(explicit.dir) + Number(explicit.assetId) + Number(explicit.url);
  if (count > 1) {
    errorBox("Conflicting inputs", "Pass only one of: project dir, --asset-id, --url.");
    process.exit(1);
  }
  if (explicit.assetId) return { kind: "asset_id", assetId: opts.assetId };
  if (explicit.url) return { kind: "url", url: opts.url };
  return { kind: "dir", dir: opts.dir ?? "." };
}

/**
 * Resolve the aspect ratio for the submit body, validating local inputs.
 *
 * Aspect ratio is a property of the composition (its `data-width`/
 * `data-height`), not an independent render knob — the pipeline supersamples
 * to a *matching* ratio and can't reshape. So for a local dir we auto-detect
 * from the entry HTML and the user rarely needs `--aspect-ratio`. Behaviour:
 *
 *   - Local dir, no explicit flag → auto-detect and log the result.
 *   - Local dir, explicit flag that conflicts with the detected dims → hard
 *     error (the render would otherwise fail or silently ignore the request).
 *   - Local dir with a missing `--composition` entry → hard error before
 *     upload, instead of a generic server-side render failure.
 *   - `--asset-id` / `--url` → the zip isn't on disk; trust an explicit flag,
 *     otherwise let the server default (16:9) apply.
 *
 * Logs are suppressed in `--json` mode so machine output stays clean.
 */
// fallow-ignore-next-line complexity
export function resolveAspectRatioForSubmit(
  project: ProjectInputSource,
  compositionArg: string | undefined,
  explicit: "16:9" | "9:16" | "1:1" | undefined,
  asJson: boolean,
): "16:9" | "9:16" | "1:1" | undefined {
  if (project.kind !== "dir") {
    if (!explicit) {
      const reason = project.kind === "asset_id" ? "--asset-id" : "--url";
      logDetection(asJson, `Auto-detect skipped (project is ${reason})`);
    }
    return explicit;
  }

  const dir = project.dir ?? ".";
  const entryRelative = compositionArg ?? "index.html";
  const entryPath = resolvePath(dir, entryRelative);

  if (!existsSync(entryPath)) {
    errorBox(
      "Composition not found",
      `Entry file "${entryRelative}" does not exist in ${dir}.`,
      "Pass --composition with a path that exists inside the project, or omit it to use index.html.",
    );
    process.exit(1);
  }

  const detection = detectAspectRatioFromHtml(entryPath);

  if (explicit) {
    // The renderer matches the composition's authored aspect ratio — it can't
    // reshape. Both a `matched` ratio that differs from `explicit` AND a
    // `no-match` (dims are known but the ratio isn't 16:9/9:16/1:1, so it can
    // never equal the requested supported ratio) are definite conflicts.
    // Other kinds (no-dims / no-root-div / invalid-dims / read-error) leave the
    // ratio unknown, so we can't prove a conflict and forward the explicit value.
    const conflictDetail =
      detection.kind === "matched" && detection.aspectRatio !== explicit
        ? `${detection.width}×${detection.height} → ${detection.aspectRatio}`
        : detection.kind === "no-match"
          ? `${detection.width}×${detection.height}, ratio ${detection.ratio.toFixed(2)} — not a supported ratio`
          : undefined;
    if (conflictDetail) {
      errorBox(
        "Aspect ratio mismatch",
        `--aspect-ratio ${explicit} doesn't match the composition (${conflictDetail}).`,
        "The renderer matches the composition's authored aspect ratio — it can't reshape it. Drop --aspect-ratio (it's auto-detected) or re-author the composition at the target ratio.",
      );
      process.exit(1);
    }
    return explicit;
  }

  logDetection(asJson, summarizeDetection(detection, entryRelative));
  return detection.kind === "matched" ? detection.aspectRatio : undefined;
}

/**
 * 4k output is produced by supersampling through the screenshot capture path,
 * which doesn't support an alpha channel. webm/mov carry alpha, so the
 * combination can't be satisfied — reject it before upload.
 */
export function validateResolutionFormatCombo(
  resolution: "1080p" | "4k" | undefined,
  format: "mp4" | "webm" | "mov" | undefined,
): void {
  if (resolution === "4k" && (format === "webm" || format === "mov")) {
    errorBox(
      "Unsupported combination",
      `--resolution 4k cannot be combined with --format ${format}.`,
      "The alpha (webm/mov) capture path doesn't support 4k supersampling. Render 4k as mp4, or render alpha at composition resolution.",
    );
    process.exit(1);
  }
}

const ASPECT_FALLBACK_HINT =
  "server will default aspect_ratio to 16:9. Pass --aspect-ratio to override.";

function logDetection(asJson: boolean, message: string): void {
  if (asJson) return;
  // `matched` is the only branch with its own affirmative phrasing; the
  // rest share the fallback hint to keep the user oriented after a miss.
  const suffix = message.startsWith("Detected aspect ratio") ? "" : `; ${ASPECT_FALLBACK_HINT}`;
  console.log(c.dim(`   ${message}${suffix}`));
}

// fallow-ignore-next-line complexity
function summarizeDetection(detection: AspectRatioDetection, entryRelative: string): string {
  switch (detection.kind) {
    case "matched":
      return `Detected aspect ratio: ${detection.aspectRatio} (from ${entryRelative} dims ${detection.width}×${detection.height})`;
    case "no-root-div":
      return `No <div data-composition-id> found in ${entryRelative}`;
    case "no-dims":
      return `${entryRelative} root composition has no data-width / data-height`;
    case "invalid-dims":
      return `${entryRelative} root has invalid dims (${detection.width}×${detection.height})`;
    case "no-match":
      return `${entryRelative} dims ${detection.width}×${detection.height} (ratio ${detection.ratio.toFixed(2)}) don't match 16:9, 9:16, or 1:1`;
    case "read-error":
      return `Couldn't read ${entryRelative} for aspect-ratio detection (${detection.error})`;
  }
}

function resolveVariablesAndValidateIfLocal(
  inline: string | undefined,
  filePath: string | undefined,
  strict: boolean,
  source: ProjectInputSource,
): Record<string, unknown> | undefined {
  const variables = resolveVariablesArg(inline, filePath);
  if (!variables || Object.keys(variables).length === 0) return variables;
  // Only validate against the local composition when we actually have
  // a local project on disk. For --asset-id / --url paths the schema
  // lives on the server side, so we send the variables as-is and let
  // the API surface any mismatch via `hyperframes_project_invalid`.
  if (source.kind !== "dir") return variables;
  // `resolveProject` calls process.exit on a missing/invalid dir, so
  // there's no need to wrap this in try/catch — if it returns, the
  // index.html is present. The earlier impl had a dead try/catch.
  const { indexPath } = resolveProject(source.dir);
  const issues = validateVariablesAgainstProject(indexPath, variables);
  reportVariableIssues(issues, { strict, quiet: false });
  return variables;
}

// ---------------------------------------------------------------------------
// Upload step (only when project is a local dir)
// ---------------------------------------------------------------------------

interface UploadResult {
  projectInput: CreateHyperframesRenderRequest["project"];
}

interface ArchiveFileSummary {
  path: string;
  size_bytes: number;
}

interface PreparedLocalArchive {
  project: ProjectDir;
  archive: PublishArchiveResult;
  largestFiles: ArchiveFileSummary[];
}

function summarizeLargestFiles(fileMap: Map<string, Buffer>): ArchiveFileSummary[] {
  return [...fileMap.entries()]
    .map(([path, content]) => ({ path, size_bytes: content.byteLength }))
    .sort((a, b) => b.size_bytes - a.size_bytes || a.path.localeCompare(b.path))
    .slice(0, LARGEST_FILE_COUNT);
}

function prepareLocalArchive(
  source: ProjectInputSource,
  composition: string | undefined,
  asJson: boolean,
): PreparedLocalArchive {
  const project = resolveProject(source.dir);
  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Zipping ${c.accent(project.name)}`);
  }

  try {
    const fileMap = buildPublishFileMap(project.dir);
    const entryPath = relative(
      project.dir,
      resolvePath(project.dir, composition ?? "index.html"),
    ).replaceAll("\\", "/");
    if (!fileMap.has(entryPath)) {
      throw new Error(
        `Composition "${composition ?? "index.html"}" is excluded from the archive. Check .hyperframesignore.`,
      );
    }
    const archive = zipPublishFileMap(fileMap);
    if (!asJson) {
      console.log(
        c.dim(`   ${archive.fileCount} files · ${formatBytes(archive.buffer.byteLength)}`),
      );
    }
    const prepared = { project, archive, largestFiles: summarizeLargestFiles(fileMap) };
    if (!asJson && archive.buffer.byteLength >= ARCHIVE_DIAGNOSTIC_THRESHOLD_BYTES) {
      reportLargestFiles(prepared);
    }
    return prepared;
  } catch (err) {
    const msg = normalizeErrorMessage(err);
    errorBox("Zip failed", msg, "Check the project and .hyperframesignore for missing files.");
    process.exit(1);
  }
}

function reportLargestFiles(prepared: PreparedLocalArchive): void {
  console.log(c.dim("   Largest included files:"));
  for (const file of prepared.largestFiles) {
    console.log(c.dim(`   ${formatBytes(file.size_bytes).padStart(9)}  ${file.path}`));
  }
  console.log(c.dim("   Exclude verified-unneeded files with .hyperframesignore."));
}

function reportDryRun(prepared: PreparedLocalArchive, asJson: boolean): void {
  const sizeBytes = prepared.archive.buffer.byteLength;
  if (asJson) {
    console.log(
      JSON.stringify(
        withMeta({
          archive: {
            project: prepared.project.name,
            file_count: prepared.archive.fileCount,
            size_bytes: sizeBytes,
            upload_limit_bytes: DIRECT_UPLOAD_LIMIT_BYTES,
            exceeds_upload_limit: sizeBytes > DIRECT_UPLOAD_LIMIT_BYTES,
            largest_files: prepared.largestFiles,
          },
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (sizeBytes < ARCHIVE_DIAGNOSTIC_THRESHOLD_BYTES) reportLargestFiles(prepared);
  console.log("");
  console.log(`${c.success("✓")}  Dry run complete — nothing uploaded`);
  if (sizeBytes > DIRECT_UPLOAD_LIMIT_BYTES) {
    console.log(c.warn(`   Archive exceeds the 200 MB direct-upload limit.`));
  }
}

// fallow-ignore-next-line complexity
async function maybeUploadProject(
  client: HyperframesCloudClient,
  source: ProjectInputSource,
  preparedArchive: PreparedLocalArchive | undefined,
  asJson: boolean,
  idempotencyKey: string | undefined,
): Promise<UploadResult> {
  if (source.kind === "asset_id") {
    return { projectInput: { type: "asset_id", asset_id: source.assetId! } };
  }
  if (source.kind === "url") {
    return { projectInput: { type: "url", url: source.url! } };
  }

  if (!preparedArchive) throw new Error("Local project archive was not prepared");
  const { project, archive } = preparedArchive;

  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Uploading (direct-to-S3)`);
  }
  const uploadStart = Date.now();
  let uploaded;
  try {
    uploaded = await uploadZipViaDirectUpload({
      client,
      bytes: archive.buffer,
      filename: `${project.name}.zip`,
      idempotencyKey,
      onProgress: !asJson
        ? (ev) => {
            if (ev.phase === "initialize") {
              console.log(c.dim(`   initializing…`));
            } else if (ev.phase === "upload" && ev.percent === 0) {
              console.log(c.dim(`   uploading to S3…`));
            } else if (ev.phase === "complete") {
              console.log(c.dim(`   finalizing…`));
            }
          }
        : undefined,
    });
  } catch (err) {
    reportApiError("Upload failed", err);
  }
  if (!asJson) {
    console.log(
      c.dim(
        `   asset_id: ${c.accent(uploaded.asset_id)} · ${formatDuration(Date.now() - uploadStart)}`,
      ),
    );
  }
  return { projectInput: { type: "asset_id", asset_id: uploaded.asset_id } };
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
  aspectRatio: CreateHyperframesRenderRequest["aspect_ratio"] | undefined;
  composition: string | undefined;
  variables: Record<string, unknown> | undefined;
  title: string | undefined;
  callbackUrl: string | undefined;
  callbackId: string | undefined;
  idempotencyKey: string | undefined;
}

async function submitRender(
  client: HyperframesCloudClient,
  opts: SubmitOptions,
): Promise<{ render_id: string }> {
  const body = buildRenderBody(opts);
  try {
    return await client.createRender({ body, idempotencyKey: opts.idempotencyKey });
  } catch (err) {
    reportApiError("Submit failed", err);
  }
}

// fallow-ignore-next-line complexity
function buildRenderBody(opts: SubmitOptions): CreateHyperframesRenderRequest {
  const body: CreateHyperframesRenderRequest = { project: opts.projectInput };
  if (opts.fps !== undefined) body.fps = opts.fps;
  if (opts.quality !== undefined) body.quality = opts.quality;
  if (opts.format !== undefined) body.format = opts.format;
  if (opts.resolution !== undefined) body.resolution = opts.resolution;
  if (opts.aspectRatio !== undefined) body.aspect_ratio = opts.aspectRatio;
  if (opts.composition !== undefined) body.composition = opts.composition;
  if (opts.variables !== undefined) body.variables = opts.variables;
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.callbackUrl !== undefined) body.callback_url = opts.callbackUrl;
  if (opts.callbackId !== undefined) body.callback_id = opts.callbackId;
  return body;
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
  // ANSI carriage-return redraws only make sense on a TTY. CI logs and
  // file redirects get one append per status change instead, and JSON
  // mode stays silent altogether.
  const interactive = !asJson && process.stdout.isTTY === true;
  let lastStatus = "";
  try {
    return await pollUntilTerminal(client, renderId, {
      intervalMs: poll.intervalMs,
      maxWaitMs: poll.maxWaitMs,
      // fallow-ignore-next-line complexity
      onTick: (detail, elapsedMs) => {
        if (asJson) return;
        if (interactive) {
          if (detail.status === lastStatus) {
            process.stdout.write(`\r\x1b[2K  ${formatTickLine(detail, elapsedMs)}`);
          } else {
            if (lastStatus) process.stdout.write("\n");
            process.stdout.write(`  ${formatTickLine(detail, elapsedMs)}`);
            lastStatus = detail.status;
          }
        } else if (detail.status !== lastStatus) {
          // Non-TTY: one line per status transition, no carriage returns.
          console.log(`  ${formatTickLine(detail, elapsedMs)}`);
          lastStatus = detail.status;
        }
      },
    });
  } catch (err) {
    if (!asJson && lastStatus && interactive) process.stdout.write("\n");
    if (err instanceof PollTimeoutError) {
      errorBox(
        "Poll timed out",
        err.message,
        `The render may still complete. Resume with: hyperframes cloud get ${renderId}`,
      );
      process.exit(1);
    }
    return reportApiError("API error during poll", err, {
      suggestion: `The render may still be running. Resume with: hyperframes cloud get ${renderId}`,
    });
  } finally {
    if (!asJson && lastStatus && interactive) process.stdout.write("\n");
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
    console.log(JSON.stringify(withMeta({ render: detail }), null, 2));
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
async function streamVideo(
  url: string,
  destPath: string,
  asJson: boolean,
): Promise<{ bytes: number }> {
  // `downloadToFile` already creates the parent directory and cleans
  // up the partial file on error — no pre-mkdir needed here.
  if (!asJson) {
    console.log("");
    console.log(`${c.accent("◆")}  Downloading to ${c.accent(destPath)}`);
  }
  try {
    const result = await downloadToFile(url, destPath);
    if (!asJson) {
      console.log(c.dim(`   ${formatBytes(result.bytes)} written`));
    }
    return { bytes: result.bytes };
  } catch (err) {
    const message = normalizeErrorMessage(err);
    errorBox(
      "Download failed",
      message,
      "The presigned URL is short-lived; re-fetch with `hyperframes cloud get`.",
    );
    process.exit(1);
  }
}
