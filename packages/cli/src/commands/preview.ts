import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export const examples: Example[] = [
  ["Preview the current project", "hyperframes preview"],
  ["Print the current Studio selection as JSON", "hyperframes preview --selection --json"],
  ["Print current Studio context as JSON", "hyperframes preview --context --json"],
  ["Preview a specific project directory", "hyperframes preview ./my-video"],
  ["Use a custom port", "hyperframes preview --port 8080"],
  ["Force a new server even if one is already running", "hyperframes preview --force-new"],
  ["Keep preview running after this command exits", "hyperframes preview --background"],
  ["Show the background preview for this project", "hyperframes preview --status"],
  ["Stop the background preview for this project", "hyperframes preview --stop"],
  ["Start without opening the browser", "hyperframes preview --no-open"],
  ["Open with a specific browser", "hyperframes preview --browser-path /usr/bin/chromium"],
  [
    "Open with CDP enabled (requires browser path + isolated profile)",
    "hyperframes preview --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile --remote-debugging-port 9222",
  ],
  ["List all active preview servers", "hyperframes preview --list"],
  ["Kill all active preview servers", "hyperframes preview --kill-all"],
];
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { parseStoryboard, STORYBOARD_FILENAME } from "@hyperframes/core/storyboard";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { isDevMode } from "../utils/env.js";
import { normalizeErrorMessage as errorMessage } from "../utils/errorMessage.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
import type { StudioSelectionSnapshot } from "@hyperframes/studio-server";
import {
  openBrowser,
  parseRemoteDebuggingPort,
  validateRemoteDebuggingPortDeps,
} from "../utils/openBrowser.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import {
  findPortAndServe,
  scanActiveServers,
  killActiveServers,
  type FindPortResult,
} from "../server/portUtils.js";
import { killOrphanedProcesses, killProcessTree } from "../utils/orphanCleanup.js";
import { resolveProject } from "../utils/project.js";
import {
  readBackgroundPreviewStatus,
  startBackgroundPreview,
  stopBackgroundPreview,
} from "./previewLifecycle.js";

interface BrowserLaunchOptions {
  noOpen?: boolean;
  browserPath?: string;
  userDataDir?: string;
  remoteDebuggingPort?: number;
  browserNoGpu?: boolean;
}

interface StudioLaunchOptions extends BrowserLaunchOptions {
  projectName?: string;
}

interface EmbeddedStudioOptions extends StudioLaunchOptions {
  forceNew?: boolean;
}

type StudioChildProcess = ChildProcessByStdio<null, Readable, Readable>;
type ContextField = "server" | "selection" | "lint" | "capabilities";
type CompactSelectionPayload = Pick<
  StudioSelectionSnapshot,
  | "schemaVersion"
  | "projectId"
  | "compositionPath"
  | "sourceFile"
  | "currentTime"
  | "target"
  | "label"
  | "tagName"
  | "boundingBox"
  | "textContent"
  | "thumbnailUrl"
>;

const DEFAULT_CONTEXT_FIELDS: ContextField[] = ["server", "selection", "lint", "capabilities"];

export default defineCommand({
  meta: { name: "preview", description: "Start the studio for previewing compositions" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the preview server on", default: "3002" },
    "force-new": {
      type: "boolean",
      description: "Start a new server even if one is already running for this project",
      default: false,
    },
    background: {
      type: "boolean",
      description: "Start an embedded preview that remains running after the command exits",
      default: false,
    },
    status: {
      type: "boolean",
      description: "Show the background preview for this project and exit",
      default: false,
    },
    stop: {
      type: "boolean",
      description: "Stop the background preview for this project and exit",
      default: false,
    },
    list: {
      type: "boolean",
      description: "List all active preview servers and exit",
      default: false,
    },
    "kill-all": {
      type: "boolean",
      description: "Kill all active preview servers and exit",
      default: false,
    },
    open: {
      type: "boolean",
      default: true,
      description: "Open browser automatically",
    },
    selection: {
      type: "boolean",
      description: "Print the current element selected in a running Studio preview and exit",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output preview selection/context as JSON (only with --selection or --context)",
      default: false,
    },
    context: {
      type: "boolean",
      description:
        "Print the current agent-readable context from a running Studio preview and exit",
      default: false,
    },
    "context-fields": {
      type: "string",
      description:
        "Comma-separated context fields to include: server,selection,lint,capabilities (only with --context)",
    },
    "context-detail": {
      type: "string",
      description: "Context payload detail: compact or full (only with --context)",
      default: "compact",
    },
    "browser-path": {
      type: "string",
      description: "Path to the browser executable to open",
    },
    "user-data-dir": {
      type: "string",
      description: "Chromium-compatible user data directory (requires --browser-path)",
    },
    "remote-debugging-port": {
      type: "string",
      description: "Chromium remote debugging port (requires --browser-path and --user-data-dir)",
    },
    "browser-no-gpu": {
      type: "boolean",
      default: false,
      description:
        "Launch the opened browser with --disable-gpu (requires --browser-path). For hosts where hardware acceleration crashes the graphics driver (e.g. NVIDIA Xid resets); with the system default browser use --no-open instead.",
    },
  },
  async run({ args }) {
    const startPort = parseInt(args.port ?? "3002", 10);
    const preferredContextPort = hasExplicitPreviewPort(process.argv) ? startPort : undefined;

    if (args.status || args.stop) {
      const project = resolveProject(args.dir);
      if (args.stop) {
        const stopped = await stopBackgroundPreview(project.dir, startPort);
        console.log(
          stopped
            ? `\n  ${c.success("Stopped background preview")} ${c.dim(project.dir)}\n`
            : `\n  ${c.dim("No background preview is running for")} ${project.dir}\n`,
        );
        return;
      }
      const status = await readBackgroundPreviewStatus(project.dir, startPort);
      if (!status) {
        console.log(`\n  ${c.dim("No background preview is running for")} ${project.dir}\n`);
        return;
      }
      console.log(`\n  ${c.success("Background preview running")}`);
      console.log(
        `  ${c.accent(`http://localhost:${status.port}`)} ${c.dim(`(PID ${status.pid})`)}`,
      );
      console.log(`  ${c.dim(status.logPath)}\n`);
      return;
    }

    // --list: scan and display active servers
    if (args.list) {
      const servers = await scanActiveServers(startPort);
      if (servers.length === 0) {
        console.log("\n  No active preview servers found.\n");
        return;
      }
      console.log(`\n  ${c.bold("Active preview servers:")}\n`);
      for (const s of servers) {
        const pidStr = s.pid ? c.dim(` (PID ${s.pid})`) : "";
        console.log(
          `  ${c.accent(`Port ${s.port}`)}  ${s.projectName}  ${c.dim(s.projectDir)}${pidStr}`,
        );
      }
      console.log(`\n  ${servers.length} server${servers.length === 1 ? "" : "s"} running.\n`);
      return;
    }

    // --kill-all: kill all active servers
    if (args["kill-all"]) {
      const servers = await scanActiveServers(startPort);
      if (servers.length === 0) {
        console.log("\n  No active preview servers to kill.\n");
        return;
      }
      const killed = await killActiveServers(startPort);
      console.log(`\n  Killed ${killed} preview server${killed === 1 ? "" : "s"}.\n`);
      return;
    }

    if (args.context) {
      const project = resolveProject(args.dir);
      return printCurrentContext(project.dir, startPort, {
        json: Boolean(args.json),
        fields: args["context-fields"] as string | undefined,
        detail: args["context-detail"] as string | undefined,
        ...(preferredContextPort === undefined ? {} : { preferredPort: preferredContextPort }),
      });
    }

    if (args.selection) {
      const project = resolveProject(args.dir);
      return printCurrentSelection(
        project.dir,
        startPort,
        Boolean(args.json),
        preferredContextPort,
      );
    }

    // Kill orphaned chrome-headless-shell processes from previous crashed sessions.
    const orphansKilled = killOrphanedProcesses();
    if (orphansKilled > 0) {
      console.log(
        `  ${c.dim(`Cleaned up ${orphansKilled} orphaned process${orphansKilled === 1 ? "" : "es"} from a previous session.`)}`,
      );
    }

    const rawArg = args.dir;
    const isImplicitCwd = !rawArg || rawArg === "." || rawArg === "./";
    const project = resolveProject(rawArg);
    const dir = project.dir;
    const projectName = isImplicitCwd ? basename(process.env.PWD ?? dir) : project.name;

    // Lint before starting — surface issues for the agent to fix.
    const lintResult = await lintProject(dir);
    if (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0) {
      console.log();
      for (const line of formatLintFindings(lintResult)) console.log(line);
      console.log();
    }

    // Validation: --user-data-dir requires --browser-path
    if (args["user-data-dir"] && !args["browser-path"]) {
      clack.log.error("--user-data-dir requires --browser-path");
      process.exitCode = 1;
      return;
    }
    // Validation: --remote-debugging-port deps
    const depsError = validateRemoteDebuggingPortDeps({
      browserPath: args["browser-path"] as string | undefined,
      userDataDir: args["user-data-dir"] as string | undefined,
      remoteDebuggingPort: args["remote-debugging-port"] as string | undefined,
    });
    if (depsError) {
      clack.log.error(depsError);
      process.exitCode = 1;
      return;
    }

    const noOpen = !args.open;
    const browserPath = args["browser-path"] as string | undefined;
    const browserNoGpu = !!args["browser-no-gpu"];
    if (browserNoGpu && !browserPath) {
      clack.log.error(
        "--browser-no-gpu requires --browser-path (the system default browser cannot receive Chromium flags — use --no-open on GPU-unstable hosts)",
      );
      process.exitCode = 1;
      return;
    }
    const userDataDir = args["user-data-dir"] as string | undefined;
    let remoteDebuggingPort: number | undefined;
    try {
      remoteDebuggingPort = parseRemoteDebuggingPort(
        args["remote-debugging-port"] as string | undefined,
      );
    } catch (err) {
      clack.log.error((err as Error).message);
      process.exitCode = 1;
      return;
    }

    if (isDevMode()) {
      if (args.background) {
        clack.log.error("--background currently supports the embedded preview server only");
        process.exitCode = 1;
        return;
      }
      return runDevMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
      });
    }

    // If @hyperframes/studio is installed locally, use Vite for full HMR
    if (hasLocalStudio(dir)) {
      if (args.background) {
        clack.log.error("--background currently supports the embedded preview server only");
        process.exitCode = 1;
        return;
      }
      return runLocalStudioMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
      });
    }

    if (args.background) {
      let background;
      try {
        background = await startBackgroundPreview(dir, startPort, {
          forceNew: Boolean(args["force-new"]),
        });
      } catch (error) {
        clack.log.error(errorMessage(error));
        process.exitCode = 1;
        return;
      }
      const url = `http://localhost:${background.port}`;
      clack.intro(c.bold("hyperframes preview"));
      printStudioSummary(projectName, url, {
        details: [
          background.type === "reused"
            ? "Reusing the background server already running for this project."
            : `Running in the background. Log: ${background.logPath}`,
          "Changes reload automatically in the studio.",
        ],
        footer: `Stop with: hyperframes preview ${JSON.stringify(dir)} --stop`,
      });
      openStudioBrowser(url, projectName, dir, {
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
      });
      return;
    }

    const forceNew = !!args["force-new"];
    return runEmbeddedMode(dir, startPort, {
      projectName,
      forceNew,
      noOpen,
      browserPath,
      userDataDir,
      remoteDebuggingPort,
      browserNoGpu,
    });
  },
});

// `host` is the loopback the server actually bound (Vite binds `[::1]`, embedded
// binds `127.0.0.1`); default to IPv4 for the embedded/legacy callers.
function previewBaseUrl(port: number, host = "127.0.0.1"): string {
  return `http://${host}:${port}`;
}

function absolutePreviewUrl(port: number, path: string, host = "127.0.0.1"): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${previewBaseUrl(port, host)}${path.startsWith("/") ? path : `/${path}`}`;
}

function hasExplicitPreviewPort(argv: string[]): boolean {
  return argv.some((arg) => arg === "--port" || arg.startsWith("--port="));
}

function printSelectionFailure(code: string, message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
  } else {
    clack.log.error(message);
  }
  process.exitCode = 1;
}

function previewServerPayload(server: {
  port: number;
  host?: string;
  projectName: string;
  projectDir: string;
}): {
  port: number;
  projectName: string;
  projectDir: string;
  url: string;
} {
  return {
    port: server.port,
    projectName: server.projectName,
    projectDir: server.projectDir,
    url: previewBaseUrl(server.port, server.host),
  };
}

function parseContextFields(value: string | undefined): ContextField[] {
  if (value === undefined) return DEFAULT_CONTEXT_FIELDS;
  if (!value.trim()) throw new Error("--context-fields cannot be empty");
  const allowed = new Set<ContextField>(DEFAULT_CONTEXT_FIELDS);
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  const invalid = fields.filter((field) => !allowed.has(field as ContextField));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown context field${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}`,
    );
  }
  return [...new Set(fields)] as ContextField[];
}

function contextIncludes(fields: ContextField[], field: ContextField): boolean {
  return fields.includes(field);
}

function addContextError(
  payload: Record<string, unknown>,
  field: ContextField,
  error: { code: string; message: string },
): void {
  payload.errors = {
    ...((payload.errors as Record<string, unknown> | undefined) ?? {}),
    [field]: error,
  };
}

async function printCurrentSelection(
  projectDir: string,
  startPort: number,
  json: boolean,
  preferredPort?: number,
): Promise<void> {
  const {
    AmbiguousPreviewServerError,
    PreviewServerPortMismatchError,
    fetchStudioSelection,
    findPreviewServerForProject,
  } = await import("../utils/studioSelectionClient.js");
  let server: Awaited<ReturnType<typeof findPreviewServerForProject>>;
  try {
    server = await findPreviewServerForProject(
      projectDir,
      startPort,
      undefined,
      undefined,
      preferredPort === undefined ? undefined : { preferredPort },
    );
  } catch (err) {
    if (err instanceof AmbiguousPreviewServerError) {
      printSelectionFailure("ambiguous-preview-server", err.message, json);
      return;
    }
    if (err instanceof PreviewServerPortMismatchError) {
      printSelectionFailure("preview-port-mismatch", err.message, json);
      return;
    }
    throw err;
  }
  if (!server) {
    printSelectionFailure(
      "preview-not-running",
      "No running Studio preview found for this project. Start one with: npx hyperframes preview",
      json,
    );
    return;
  }

  let response: Awaited<ReturnType<typeof fetchStudioSelection>>;
  try {
    response = await fetchStudioSelection(server);
  } catch (err) {
    printSelectionFailure("selection-unavailable", errorMessage(err), json);
    return;
  }

  if (!response.selection) {
    printSelectionFailure(
      "no-selection",
      "Studio is running, but no element is selected. Select an element in Studio and rerun this command.",
      json,
    );
    return;
  }

  const selection = {
    ...response.selection,
    thumbnailUrl: absolutePreviewUrl(server.port, response.selection.thumbnailUrl, server.host),
  };

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          server: previewServerPayload(server),
          selection,
          updatedAt: response.updatedAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${c.success("◇")}  ${c.accent(selection.label)} selected in Studio`);
  console.log(`  ${c.dim("Source")}    ${selection.sourceFile}`);
  console.log(
    `  ${c.dim("Target")}    ${selection.target.hfId ?? selection.target.id ?? selection.target.selector ?? "(none)"}`,
  );
  console.log(`  ${c.dim("Time")}      ${selection.currentTime.toFixed(3)}s`);
  console.log(`  ${c.dim("Thumbnail")} ${selection.thumbnailUrl}`);
  console.log();
  console.log(c.dim("Use --json for the full agent-readable selection payload."));
}

function countLintFindings(findings: Array<{ severity: string }>): {
  errors: number;
  warnings: number;
} {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  };
}

async function printCurrentContext(
  projectDir: string,
  startPort: number,
  options: { json: boolean; fields?: string; detail?: string; preferredPort?: number },
): Promise<void> {
  let fields: ContextField[];
  try {
    fields = parseContextFields(options.fields);
  } catch (err) {
    printSelectionFailure("invalid-context-fields", errorMessage(err), options.json);
    return;
  }
  const fullDetail = options.detail === "full";
  if (options.detail !== undefined && !["compact", "full"].includes(options.detail)) {
    printSelectionFailure(
      "invalid-context-detail",
      "--context-detail must be compact or full",
      options.json,
    );
    return;
  }

  const {
    AmbiguousPreviewServerError,
    PreviewServerPortMismatchError,
    fetchStudioLint,
    fetchStudioSelection,
    findPreviewServerForProject,
  } = await import("../utils/studioSelectionClient.js");
  let server: Awaited<ReturnType<typeof findPreviewServerForProject>>;
  try {
    server = await findPreviewServerForProject(
      projectDir,
      startPort,
      undefined,
      undefined,
      options.preferredPort === undefined ? undefined : { preferredPort: options.preferredPort },
    );
  } catch (err) {
    if (err instanceof AmbiguousPreviewServerError) {
      printSelectionFailure("ambiguous-preview-server", err.message, options.json);
      return;
    }
    if (err instanceof PreviewServerPortMismatchError) {
      printSelectionFailure("preview-port-mismatch", err.message, options.json);
      return;
    }
    throw err;
  }
  if (!server) {
    printSelectionFailure(
      "preview-not-running",
      "No running Studio preview found for this project. Start one with: npx hyperframes preview",
      options.json,
    );
    return;
  }

  const wantsSelection = contextIncludes(fields, "selection");
  const wantsLint = contextIncludes(fields, "lint");
  const [selectionResult, lintResult] = await Promise.allSettled([
    wantsSelection ? fetchStudioSelection(server) : Promise.resolve(null),
    wantsLint ? fetchStudioLint(server) : Promise.resolve(null),
  ]);

  const selection =
    selectionResult.status === "fulfilled" && selectionResult.value?.selection
      ? {
          ok: true as const,
          value: fullDetail
            ? {
                ...selectionResult.value.selection,
                thumbnailUrl: absolutePreviewUrl(
                  server.port,
                  selectionResult.value.selection.thumbnailUrl,
                ),
              }
            : compactSelectionPayload({
                ...selectionResult.value.selection,
                thumbnailUrl: absolutePreviewUrl(
                  server.port,
                  selectionResult.value.selection.thumbnailUrl,
                ),
              }),
          updatedAt: selectionResult.value.updatedAt,
        }
      : {
          ok: false as const,
          error:
            selectionResult.status === "rejected"
              ? { code: "selection-unavailable", message: errorMessage(selectionResult.reason) }
              : {
                  code: "no-selection",
                  message: "Studio is running, but no element is selected.",
                },
        };

  const lint =
    lintResult.status === "fulfilled" && lintResult.value
      ? {
          ok: true as const,
          summary: countLintFindings(lintResult.value.findings),
          findings: lintResult.value.findings,
        }
      : {
          ok: false as const,
          error:
            lintResult.status === "rejected"
              ? { code: "lint-unavailable", message: errorMessage(lintResult.reason) }
              : { code: "lint-not-requested", message: "Lint was not requested." },
        };

  const payload: Record<string, unknown> = { ok: true };
  if (contextIncludes(fields, "server")) payload.server = previewServerPayload(server);
  if (contextIncludes(fields, "selection")) {
    payload.selection = selection.ok ? selection.value : null;
    payload.selectionUpdatedAt = selection.ok ? selection.updatedAt : null;
    if (!selection.ok) addContextError(payload, "selection", selection.error);
  }
  if (contextIncludes(fields, "lint")) payload.lint = lint;
  if (contextIncludes(fields, "capabilities")) {
    payload.capabilities = {
      selection: true,
      lint: true,
      frame: false,
      visibleElements: false,
      lastAction: false,
    };
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`${c.success("◇")}  Studio context`);
  if (contextIncludes(fields, "server")) {
    console.log(`  ${c.dim("Project")}   ${server.projectName}`);
    console.log(`  ${c.dim("Studio")}    ${previewBaseUrl(server.port, server.host)}`);
  }
  if (contextIncludes(fields, "selection")) {
    if (selection.ok) {
      console.log(`  ${c.dim("Selection")} ${selection.value.label}`);
    } else {
      console.log(`  ${c.dim("Selection")} ${selection.error.message}`);
    }
  }
  if (contextIncludes(fields, "lint")) {
    if (lint.ok) {
      console.log(
        `  ${c.dim("Lint")}      ${lint.summary.errors} error(s), ${lint.summary.warnings} warning(s)`,
      );
    } else {
      console.log(`  ${c.dim("Lint")}      ${lint.error.message}`);
    }
  }
  console.log();
  console.log(c.dim("Use --json for the full agent-readable context payload."));
}

function compactSelectionPayload(selection: StudioSelectionSnapshot): CompactSelectionPayload {
  return {
    schemaVersion: selection.schemaVersion,
    projectId: selection.projectId,
    compositionPath: selection.compositionPath,
    sourceFile: selection.sourceFile,
    currentTime: selection.currentTime,
    target: selection.target,
    label: selection.label,
    tagName: selection.tagName,
    boundingBox: selection.boundingBox,
    textContent: selection.textContent,
    thumbnailUrl: selection.thumbnailUrl,
  };
}

// Land the browser on the Storyboard view while the project is still planning
// or sketching — the timeline only becomes the right landing once frames are
// animated (or the storyboard never tracked statuses at all, e.g. beat plans).
export function studioLandingSearch(projectDir: string): string {
  const storyboardPath = join(projectDir, STORYBOARD_FILENAME);
  if (!existsSync(storyboardPath)) return "";
  let frames;
  try {
    frames = parseStoryboard(readFileSync(storyboardPath, "utf8")).frames;
  } catch {
    return "";
  }
  // Sketch review in progress — the board is the review surface.
  if (frames.some((f) => f.status === "built")) return "?view=storyboard";
  // Pure planning stage: frames declare src paths but none are built yet.
  const srcs = frames
    .map((f) => f.src)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  const planning =
    frames.length > 0 &&
    frames.every((f) => f.status === "outline") &&
    srcs.length > 0 &&
    !srcs.some((s) => existsSync(join(projectDir, s)));
  return planning ? "?view=storyboard" : "";
}

// The full Studio URL to open or hand to the user: status-aware landing view
// plus the project hash route. `url` never carries a trailing slash (both the
// embedded server and the Vite `Local:` match strip it).
function studioDeepLink(url: string, projectName: string, projectDir: string): string {
  return `${url}/${studioLandingSearch(projectDir)}#project/${projectName}`;
}

function openStudioBrowser(
  url: string,
  projectName: string,
  projectDir: string,
  options?: BrowserLaunchOptions,
): void {
  if (options?.noOpen) return;
  openBrowser(studioDeepLink(url, projectName, projectDir), {
    browserPath: options?.browserPath,
    userDataDir: options?.userDataDir,
    remoteDebuggingPort: options?.remoteDebuggingPort,
    disableGpu: options?.browserNoGpu,
  });
}

function printStudioSummary(
  projectName: string,
  url: string,
  opts: { details?: string[]; footer?: string } = {},
): void {
  console.log();
  console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
  console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
  console.log();
  for (const detail of opts.details ?? []) {
    console.log(`  ${c.dim(detail)}`);
  }
  if (opts.details?.length && opts.footer) console.log();
  if (opts.footer) console.log(`  ${c.dim(opts.footer)}`);
  console.log();
}

function linkProjectIntoStudioData(
  dir: string,
  projectsDir: string,
  projectName: string,
): { symlinkPath: string; createdSymlink: boolean } {
  const symlinkPath = join(projectsDir, projectName);
  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath)) {
      try {
        const stat = lstatSync(symlinkPath);
        if (stat.isSymbolicLink() && resolve(readlinkSync(symlinkPath)) !== resolve(dir)) {
          unlinkSync(symlinkPath);
        }
      } catch {
        // Real directories or unreadable paths are left untouched.
      }
    }
    if (!existsSync(symlinkPath)) {
      // Windows: "dir" symlinks need Developer Mode or elevation (EPERM otherwise);
      // NTFS junctions are unprivileged and keep the live write-back the studio needs.
      symlinkSync(dir, symlinkPath, process.platform === "win32" ? "junction" : "dir");
      createdSymlink = true;
    }
  }

  return { symlinkPath, createdSymlink };
}

function removeSymlinkOnExit(createdSymlink: boolean, symlinkPath: string): void {
  if (!createdSymlink) return;
  process.on("exit", () => {
    try {
      if (existsSync(symlinkPath)) unlinkSync(symlinkPath);
    } catch {
      /* ignore */
    }
  });
}

function registerChildTreeShutdown(child: StudioChildProcess): void {
  const shutdown = (): void => {
    if (child.pid) killProcessTree(child.pid);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function waitForChildClose(child: StudioChildProcess): Promise<void> {
  return new Promise<void>((resolveClose) => {
    child.on("close", () => resolveClose());
  });
}

function attachStudioReadyHandler(
  child: StudioChildProcess,
  spinner: ReturnType<typeof clack.spinner>,
  projectName: string,
  projectDir: string,
  options?: BrowserLaunchOptions,
): void {
  let detected = false;

  function handleOutput(data: Buffer): void {
    const url = data.toString().match(/Local:\s+(http:\/\/localhost:\d+)/)?.[1];
    if (!url || detected) return;

    detected = true;
    spinner.stop(c.success("Studio running"));
    printStudioSummary(projectName, url, { footer: "Press Ctrl+C to stop" });
    openStudioBrowser(url, projectName, projectDir, options);
    child.stdout.removeListener("data", handleOutput);
    child.stderr.removeListener("data", handleOutput);
  }

  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);
  child.on("error", (err) => {
    spinner.stop(c.error("Failed to start studio"));
    console.error(c.dim(err.message));
  });
}

/**
 * Dev mode: spawn the studio dev server from the monorepo.
 */
async function runDevMode(dir: string, options?: StudioLaunchOptions): Promise<void> {
  // Find monorepo root by navigating from packages/cli/src/commands/
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..", "..");

  // Symlink project into the studio's data directory
  const projectsDir = join(repoRoot, "packages", "studio", "data", "projects");
  const pName = options?.projectName ?? basename(dir);
  const { symlinkPath, createdSymlink } = linkProjectIntoStudioData(dir, projectsDir, pName);

  clack.intro(c.bold("hyperframes preview"));

  const s = clack.spinner();
  s.start("Starting studio...");

  // Run the new consolidated studio (single Vite dev server with API plugin)
  const studioPkgDir = join(repoRoot, "packages", "studio");
  const child = spawn("bun", ["run", "dev"], {
    cwd: studioPkgDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  attachStudioReadyHandler(child, s, pName, dir, options);
  removeSymlinkOnExit(createdSymlink, symlinkPath);

  // Kill the child's entire process tree on SIGTERM/SIGINT. Ctrl+C sends
  // SIGINT to the foreground process group (covers the common case), but
  // `kill <pid>` only targets this process — the child tree (Vite + Chrome)
  // would survive without explicit cleanup.
  // On Windows, killProcessTree is a no-op (pgrep/ps unavailable); Ctrl+C
  // propagates via the console process group instead.
  registerChildTreeShutdown(child);
  return waitForChildClose(child);
}

/**
 * Check if @hyperframes/studio is installed locally in the project's node_modules.
 */
function hasLocalStudio(dir: string): boolean {
  try {
    const req = createRequire(join(dir, "package.json"));
    req.resolve("@hyperframes/studio/package.json");
    return true;
  } catch {
    return false;
  }
}

/**
 * Local studio mode: spawn Vite using a locally installed @hyperframes/studio.
 * Provides full Vite HMR and the complete studio experience.
 */
async function runLocalStudioMode(dir: string, options?: StudioLaunchOptions): Promise<void> {
  const req = createRequire(join(dir, "package.json"));
  const studioPkgPath = dirname(req.resolve("@hyperframes/studio/package.json"));
  const pName = options?.projectName ?? basename(dir);

  // Symlink project into studio's data directory
  const projectsDir = join(studioPkgPath, "data", "projects");
  const { symlinkPath, createdSymlink } = linkProjectIntoStudioData(dir, projectsDir, pName);

  clack.intro(c.bold("hyperframes preview") + c.dim(" (local studio)"));
  const s = clack.spinner();
  s.start("Starting studio...");

  const viteCommand = buildNpxCommand(["vite"]);
  const child = spawn(viteCommand.command, viteCommand.args, {
    cwd: studioPkgPath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  attachStudioReadyHandler(child, s, pName, dir, options);
  removeSymlinkOnExit(createdSymlink, symlinkPath);

  // Same tree-kill handler as dev mode. No-op on Windows (see comment above).
  registerChildTreeShutdown(child);
  return waitForChildClose(child);
}

/**
 * Embedded mode: serve the pre-built studio SPA with a standalone Hono server.
 * Works without any additional dependencies — the studio is bundled in dist/.
 *
 * If an existing HyperFrames server for the same project is detected,
 * reuses it instead of starting a new one (unless --force-new is set).
 */
async function runEmbeddedMode(
  dir: string,
  startPort: number,
  options?: EmbeddedStudioOptions,
): Promise<void> {
  const { createStudioServer, loadPreviewServerBuildSignature, resolveStudioBundle } =
    await import("../server/studioServer.js");

  const pName = options?.projectName ?? basename(dir);
  const studioBundle = resolveStudioBundle();

  clack.intro(c.bold("hyperframes preview"));
  const s = clack.spinner();
  s.start("Starting studio...");

  if (!studioBundle.available) {
    s.stop(c.error("Studio build missing"));
    console.error();
    console.error(`  ${c.dim("Could not find")} ${c.accent("index.html")} ${c.dim("in:")}`);
    for (const checkedPath of studioBundle.checkedPaths) {
      console.error(`  ${c.dim("-")} ${checkedPath}`);
    }
    console.error();
    console.error(`  ${c.dim("Rebuild the CLI package with")} ${c.accent("bun run build")}`);
    console.error();
    process.exitCode = 1;
    return;
  }

  const { app } = createStudioServer({ projectDir: dir, projectName: pName });
  const serverBuildSignature = await loadPreviewServerBuildSignature();

  let result: FindPortResult;
  try {
    result = await findPortAndServe(
      app.fetch,
      startPort,
      dir,
      !!options?.forceNew,
      serverBuildSignature,
    );
  } catch (err: unknown) {
    s.stop(c.error("Failed to start studio"));
    console.error();
    console.error(`  ${(err as Error).message}`);
    console.error();
    process.exitCode = 1;
    return;
  }

  if (result.type === "already-running") {
    const url = `http://localhost:${result.port}`;
    s.stop(c.success("Already running"));
    printStudioSummary(pName, url, {
      details: ["Reusing existing server. Use --force-new to start a fresh instance."],
    });
    openStudioBrowser(url, pName, dir, options);
    return;
  }

  const url = `http://localhost:${result.port}`;
  s.stop(c.success("Studio running"));
  console.log();
  if (result.port !== startPort) {
    console.log(`  ${c.warn(`Port ${startPort} is in use, using ${result.port} instead`)}`);
    console.log();
  }
  printStudioSummary(pName, url, {
    details: [
      "Edit with your AI agent — it has HyperFrames skills installed.",
      "Changes reload automatically in the studio.",
    ],
    footer: "Press Ctrl+C to stop",
  });
  openStudioBrowser(url, pName, dir, options);

  // Block until Ctrl+C. Node would normally exit on SIGINT, but the listening
  // HTTP server keeps handles open, so the event loop stays alive after the
  // signal handler fires. Close the server explicitly and resolve the promise
  // so `run()` returns cleanly instead of requiring a second Ctrl+C (or,
  // worse, the user force-killing the terminal).
  //
  // Windows wrinkle: Ctrl+C in some terminals (Git Bash / MSYS) doesn't reach
  // Node as a SIGINT at all — the process just sits there. Run a readline
  // interface on stdin so the keystroke is observed at the TTY layer and
  // re-emit it as SIGINT. No-op on platforms where the signal already arrives.
  let rl: import("node:readline").Interface | undefined;
  if (process.platform === "win32") {
    const readline = await import("node:readline");
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => {
      process.emit("SIGINT", "SIGINT");
    });
  }

  return new Promise<void>((resolveRun) => {
    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      rl?.close();
      console.log();
      console.log(`  ${c.dim("Shutting down studio...")}`);

      // Hard deadline: if cleanup hangs (e.g. dead Chrome never responds to
      // browser.close()), force exit. Armed before awaiting cleanup so it
      // can't be blocked by a stuck drainBrowserPool().
      setTimeout(() => process.exit(0), 3000).unref();

      // Kill ffmpeg first (sync, fast), then drain browsers (async, slower).
      const cleanup = async () => {
        const { closeThumbnailBrowser } = await import("../server/studioServer.js");
        const { drainBrowserPool, killTrackedProcesses } = await import("@hyperframes/engine");
        killTrackedProcesses();
        await closeThumbnailBrowser().catch(() => {});
        await drainBrowserPool().catch(() => {});
      };

      cleanup()
        .catch(() => {})
        .finally(() => {
          result.server.close(() => resolveRun());
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    // Last-resort cleanup for crash paths (unhandled exceptions/rejections)
    // that bypass the signal handlers. Eagerly resolve the sync killer so
    // the 'exit' handler (which is synchronous) can call it directly.
    import("@hyperframes/engine")
      .then(({ killTrackedProcesses }) => {
        process.once("exit", () => {
          if (!shuttingDown) killTrackedProcesses();
        });
      })
      .catch(() => {});
  });
}
