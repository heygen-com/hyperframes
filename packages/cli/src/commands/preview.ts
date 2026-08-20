import { setCommandExitCode, requestCliExit } from "../utils/commandResult.js";
// fallow-ignore-file code-duplication
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
  ["Force an attached preview in a non-interactive shell", "hyperframes preview --foreground"],
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
  [
    "Disable auto-proxying of browser-hostile video codecs (HEVC, ProRes, AV1)",
    "hyperframes preview --no-proxy",
  ],
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
  activeServerOnPort,
  findPortAndServe,
  scanActiveServers,
  killActiveServers,
  type FindPortResult,
} from "../server/portUtils.js";
import { killOrphanedProcesses, killProcessTree } from "../utils/orphanCleanup.js";
import { resolveProject, resolveProjectOrThrow } from "../utils/project.js";
import { resolveAutoProxy } from "../utils/projectConfig.js";
import { studioProxyEnv } from "../utils/studioProxyEnv.js";
import {
  listBackgroundPreviewStatuses,
  readBackgroundPreviewStatus,
  startBackgroundPreview,
  stopBackgroundPreview,
} from "./previewLifecycle.js";
import {
  lifecycleFailurePayload,
  lifecyclePayload,
  writeLifecycleJson,
  type PreviewLifecycleOperation,
  type PreviewLifecyclePayload,
  type PreviewLifecycleSession,
} from "./previewLifecycleOutput.js";
import { resolveLocalBrowserGpuMode, type BrowserGpuMode } from "../browser/gpuPolicy.js";

interface BrowserLaunchOptions {
  noOpen?: boolean;
  browserPath?: string;
  userDataDir?: string;
  remoteDebuggingPort?: number;
  browserNoGpu?: boolean;
}

interface StudioLaunchOptions extends BrowserLaunchOptions {
  projectName?: string;
  autoProxy?: boolean;
  browserGpuMode?: BrowserGpuMode;
  port?: number;
  json?: boolean;
}

interface EmbeddedStudioOptions extends StudioLaunchOptions {
  forceNew?: boolean;
  autoProxy?: boolean;
}

type StudioChildProcess = ChildProcessByStdio<null, Readable, Readable>;
interface StudioSignalTarget {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}
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
  meta: {
    name: "preview",
    description: "Start the studio for previewing compositions",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    port: {
      type: "string",
      description: "Port to run the preview server on",
      default: "3002",
    },
    "force-new": {
      type: "boolean",
      description: "Start a new server even if one is already running for this project",
      default: false,
    },
    background: {
      type: "boolean",
      description: "Start a preview that remains running after the command exits",
      default: false,
    },
    foreground: {
      type: "boolean",
      description: "Keep preview attached even when the shell is non-interactive",
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
      description: "Output selection, context, or managed lifecycle state as JSON",
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
    "browser-gpu": {
      type: "boolean",
      description:
        "Use hardware GPU for Studio thumbnails and frame capture; pass --no-browser-gpu for deterministic SwiftShader (default: auto-detect)",
      default: undefined,
    },
    proxy: {
      type: "boolean",
      description:
        "Auto-transcode browser-hostile video codecs (HEVC, ProRes, AV1) to a cached authoring proxy for preview (default: on; overrides hyperframes.json's media.autoProxy)",
      negativeDescription: "Disable auto-proxying of browser-hostile video codecs",
    },
  },
  async run({ args }) {
    const launchModeError = previewLaunchModeError({
      background: Boolean(args.background),
      foreground: Boolean(args.foreground),
      forceNew: Boolean(args["force-new"]),
      status: Boolean(args.status),
      stop: Boolean(args.stop),
      list: Boolean(args.list),
      killAll: Boolean(args["kill-all"]),
    });
    if (launchModeError) {
      if (args.json) {
        writeLifecycleJson(
          lifecycleFailurePayload(
            args.status
              ? "status"
              : args.stop
                ? "stop"
                : args.list
                  ? "list"
                  : args["kill-all"]
                    ? "kill-all"
                    : "start",
            "conflicting-lifecycle-flags",
            launchModeError,
          ),
        );
      } else {
        clack.log.error(launchModeError);
      }
      setCommandExitCode(1);
      return;
    }

    const portError = previewPortError(args.port);
    if (portError) {
      reportPreviewFailure(
        Boolean(args.json),
        args.status
          ? "status"
          : args.stop
            ? "stop"
            : args.list
              ? "list"
              : args["kill-all"]
                ? "kill-all"
                : "start",
        "preview-validation-failed",
        portError,
      );
      return;
    }

    const browserGpuMode = resolveLocalBrowserGpuMode(args["browser-gpu"] as boolean | undefined);
    if (args["browser-gpu"] === true) process.env.PRODUCER_BROWSER_GPU_MODE = "hardware";
    if (args["browser-gpu"] === false) process.env.PRODUCER_BROWSER_GPU_MODE = "software";
    const startPort = parseInt(args.port ?? "3002", 10);
    const preferredContextPort = hasExplicitPreviewPort(process.argv) ? startPort : undefined;

    if (args.status || args.stop) {
      try {
        const project = args.json ? resolveProjectOrThrow(args.dir) : resolveProject(args.dir);
        if (args.stop) {
          const stopped = await stopBackgroundPreview(project.dir, startPort);
          if (args.json) {
            writeLifecycleJson(
              lifecyclePayload(
                "stop",
                stopped
                  ? { state: "stopped", projectDir: project.dir }
                  : { state: "not-running", projectDir: project.dir },
              ),
            );
          } else {
            console.log(
              stopped
                ? `\n  ${c.success("Stopped background preview")} ${c.dim(project.dir)}\n`
                : `\n  ${c.dim("No background preview is running for")} ${project.dir}\n`,
            );
          }
          return;
        }
        const status = await readBackgroundPreviewStatus(project.dir, startPort);
        if (!status) {
          if (args.json) {
            writeLifecycleJson(
              lifecyclePayload("status", {
                state: "not-running",
                projectDir: project.dir,
              }),
            );
          } else {
            console.log(`\n  ${c.dim("No background preview is running for")} ${project.dir}\n`);
          }
          return;
        }
        if (args.json) {
          writeLifecycleJson(
            lifecyclePayload(
              "status",
              previewLifecycleSession({
                state: "running",
                mode: "background",
                projectName: project.name,
                projectDir: project.dir,
                port: status.port,
                pid: status.pid,
                logPath: status.logPath,
              }),
            ),
          );
          return;
        }
        printStudioSummary(project.name, previewBaseUrl(status.port), project.dir, {
          details: [`Background preview running (PID ${status.pid}).`, `Log: ${status.logPath}`],
        });
        return;
      } catch (error) {
        reportPreviewFailure(
          Boolean(args.json),
          args.stop ? "stop" : "status",
          args.stop ? "preview-stop-failed" : "preview-status-failed",
          errorMessage(error),
        );
        return;
      }
    }

    // --list: scan and display active servers
    if (args.list) {
      await handlePreviewList(startPort, Boolean(args.json));
      return;
    }

    // --kill-all: kill all active servers
    if (args["kill-all"]) {
      await handlePreviewKillAll(startPort, Boolean(args.json));
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

    const rawArg = args.dir;
    const isImplicitCwd = !rawArg || rawArg === "." || rawArg === "./";
    let project;
    try {
      project = args.json ? resolveProjectOrThrow(rawArg) : resolveProject(rawArg);
    } catch (error) {
      reportPreviewFailure(
        Boolean(args.json),
        "start",
        "preview-start-failed",
        errorMessage(error),
      );
      return;
    }
    const dir = project.dir;
    const projectName = isImplicitCwd ? basename(process.env.PWD ?? dir) : project.name;

    // Lint before starting — surface issues for the agent to fix.
    const lintResult = await lintProject(dir);
    if (!args.json && (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0)) {
      console.log();
      for (const line of formatLintFindings(lintResult)) console.log(line);
      console.log();
    }

    // Validation: --user-data-dir requires --browser-path
    if (args["user-data-dir"] && !args["browser-path"]) {
      reportPreviewFailure(
        Boolean(args.json),
        "start",
        "preview-validation-failed",
        "--user-data-dir requires --browser-path",
      );
      return;
    }
    // Validation: --remote-debugging-port deps
    const depsError = validateRemoteDebuggingPortDeps({
      browserPath: args["browser-path"] as string | undefined,
      userDataDir: args["user-data-dir"] as string | undefined,
      remoteDebuggingPort: args["remote-debugging-port"] as string | undefined,
    });
    if (depsError) {
      reportPreviewFailure(Boolean(args.json), "start", "preview-validation-failed", depsError);
      return;
    }

    const noOpen = !args.open;
    const browserPath = args["browser-path"] as string | undefined;
    const browserNoGpu = !!args["browser-no-gpu"];
    if (browserNoGpu && !browserPath) {
      reportPreviewFailure(
        Boolean(args.json),
        "start",
        "preview-validation-failed",
        "--browser-no-gpu requires --browser-path (the system default browser cannot receive Chromium flags — use --no-open on GPU-unstable hosts)",
      );
      return;
    }
    const userDataDir = args["user-data-dir"] as string | undefined;
    let remoteDebuggingPort: number | undefined;
    try {
      remoteDebuggingPort = parseRemoteDebuggingPort(
        args["remote-debugging-port"] as string | undefined,
      );
    } catch (err) {
      reportPreviewFailure(
        Boolean(args.json),
        "start",
        "preview-validation-failed",
        (err as Error).message,
      );
      return;
    }
    // Resolve once so embedded, monorepo-dev, and locally installed Studio
    // modes all receive identical --proxy/--no-proxy + config semantics.
    const autoProxy = resolveAutoProxy(dir, args.proxy as boolean | undefined);

    // Kill orphaned chrome-headless-shell processes from previous crashed
    // sessions. Deliberately last: this reaches outside the process and kills
    // other people's PIDs, so it must not run for an invocation that turns out
    // to be a validation error and never starts anything.
    const orphansKilled = killOrphanedProcesses();
    if (orphansKilled > 0 && !args.json) {
      console.log(
        `  ${c.dim(`Cleaned up ${orphansKilled} orphaned process${orphansKilled === 1 ? "" : "es"} from a previous session.`)}`,
      );
    }

    const launchMode = previewLaunchMode({
      background: Boolean(args.background),
      foreground: Boolean(args.foreground),
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      devMode: isDevMode(),
      localStudio: hasLocalStudio(dir),
    });

    if (launchMode === "background") {
      let background;
      try {
        background = await startBackgroundPreview(dir, startPort, {
          forceNew: Boolean(args["force-new"]),
          // A bare launch promises same-project reuse, regardless of the mode
          // the existing managed server resolved earlier. Only an explicit
          // --browser-gpu/--no-browser-gpu request authorizes replacement.
          browserGpuMode: args["browser-gpu"] === undefined ? undefined : browserGpuMode,
        });
      } catch (error) {
        const message = errorMessage(error);
        if (args.json) {
          writeLifecycleJson(lifecycleFailurePayload("start", "preview-start-failed", message));
        } else {
          clack.log.error(message);
        }
        setCommandExitCode(1);
        return;
      }
      const url = `http://localhost:${background.port}`;
      if (args.json) {
        writeLifecycleJson(
          lifecyclePayload(
            "start",
            previewLifecycleSession({
              state: background.type,
              mode: "background",
              projectName,
              projectDir: dir,
              port: background.port,
              pid: background.pid,
              ...(background.logPath ? { logPath: background.logPath } : {}),
            }),
          ),
        );
      } else {
        clack.intro(c.bold("hyperframes preview"));
        printStudioSummary(projectName, url, dir, {
          details: [
            background.type === "reused"
              ? "Reusing the background server already running for this project."
              : `Running in the background. Log: ${background.logPath}`,
            "Changes reload automatically in the studio.",
          ],
          footer: `Stop with: hyperframes preview ${JSON.stringify(dir)} --stop`,
        });
      }
      openStudioBrowser(url, projectName, dir, {
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
      });
      return;
    }

    if (launchMode === "dev") {
      return runDevMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
        autoProxy,
        browserGpuMode,
        port: startPort,
        json: Boolean(args.json),
      });
    }

    // If @hyperframes/studio is installed locally, use Vite for full HMR
    if (launchMode === "local") {
      return runLocalStudioMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
        browserNoGpu,
        autoProxy,
        browserGpuMode,
        port: startPort,
        json: Boolean(args.json),
      });
    }

    const forceNew = !!args["force-new"];
    return runEmbeddedMode(dir, startPort, {
      projectName,
      forceNew,
      autoProxy,
      noOpen,
      browserPath,
      userDataDir,
      remoteDebuggingPort,
      browserNoGpu,
      browserGpuMode,
      json: Boolean(args.json),
    });
  },
});

export type PreviewLaunchMode = "background" | "dev" | "local" | "embedded";

export function previewLaunchMode(options: {
  background: boolean;
  foreground: boolean;
  interactive: boolean;
  devMode: boolean;
  localStudio: boolean;
}): PreviewLaunchMode {
  if (options.background) return "background";
  if (!options.foreground && !options.interactive) return "background";
  if (options.devMode) return "dev";
  return options.localStudio ? "local" : "embedded";
}

export function previewLaunchModeError(options: {
  background: boolean;
  foreground: boolean;
  forceNew?: boolean;
  status: boolean;
  stop: boolean;
  list: boolean;
  killAll: boolean;
}): string | null {
  if (options.background && options.foreground) {
    return "--background and --foreground cannot be used together";
  }
  const actionCount = [options.status, options.stop, options.list, options.killAll].filter(
    Boolean,
  ).length;
  if (actionCount > 1) {
    return "Only one of --status, --stop, --list, or --kill-all can be used at a time";
  }
  if (actionCount > 0 && (options.background || options.foreground || options.forceNew)) {
    return "Preview launch overrides cannot be combined with lifecycle actions";
  }
  return null;
}

export function previewPortError(port: string | undefined): string | null {
  const value = port ?? "3002";
  if (!/^\d+$/.test(value)) return "--port must be an integer between 1 and 65535";
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535 ? null : "--port must be an integer between 1 and 65535";
}

export function publicPreviewPid(
  serverPid: string | null | undefined,
  fallbackPid: number | null,
): number | null {
  const parsed = Number(serverPid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackPid;
}

function reportPreviewFailure(
  json: boolean,
  operation: PreviewLifecycleOperation,
  code: string,
  message: string,
): void {
  if (json) writeLifecycleJson(lifecycleFailurePayload(operation, code, message));
  else clack.log.error(message);
  setCommandExitCode(1);
}

interface PreviewActionDependencies {
  scan?: typeof scanActiveServers;
  listManaged?: typeof listBackgroundPreviewStatuses;
  stopManaged?: typeof stopBackgroundPreview;
  killScanned?: typeof killActiveServers;
}

export async function handlePreviewList(
  startPort: number,
  json: boolean,
  dependencies: PreviewActionDependencies = {},
): Promise<void> {
  try {
    const [scannedServers, managedSessions] = await Promise.all([
      (dependencies.scan ?? scanActiveServers)(startPort),
      (dependencies.listManaged ?? listBackgroundPreviewStatuses)(),
    ]);
    const managedKeys = new Set(
      managedSessions.map((session) => `${resolve(session.projectDir)}\0${session.port}`),
    );
    const servers = [
      ...managedSessions.map((session) => ({
        port: session.port,
        host: "127.0.0.1",
        projectName: basename(session.projectDir),
        projectDir: session.projectDir,
        version: "managed",
        pid: String(session.pid),
      })),
      ...scannedServers.filter(
        (server) => !managedKeys.has(`${resolve(server.projectDir)}\0${server.port}`),
      ),
    ];
    if (json) {
      writeLifecycleJson(
        lifecyclePayload("list", {
          state: "listed",
          sessions: servers.map((server) =>
            previewLifecycleSession({
              state: "running",
              mode: server.version === "managed" ? "background" : "unknown",
              projectName: server.projectName,
              projectDir: server.projectDir,
              port: server.port,
              pid: server.pid ? Number(server.pid) : null,
              host: server.host,
            }),
          ),
        }),
      );
      return;
    }
    if (servers.length === 0) {
      console.log("\n  No active preview servers found.\n");
      return;
    }
    console.log(`\n  ${c.bold("Active preview servers:")}\n`);
    for (const server of servers) {
      const pid = server.pid ? c.dim(` (PID ${server.pid})`) : "";
      console.log(
        `  ${c.accent(`Port ${server.port}`)}  ${server.projectName}  ${c.dim(server.projectDir)}${pid}`,
      );
    }
    console.log(`\n  ${servers.length} server${servers.length === 1 ? "" : "s"} running.\n`);
  } catch (error) {
    reportPreviewFailure(json, "list", "preview-list-failed", errorMessage(error));
  }
}

export async function handlePreviewKillAll(
  startPort: number,
  json: boolean,
  dependencies: PreviewActionDependencies = {},
): Promise<void> {
  try {
    const managedSessions = await (dependencies.listManaged ?? listBackgroundPreviewStatuses)();
    let killed = 0;
    // One unprovable record must not abandon the servers after it. A stop pass
    // collects per-record failures and keeps going; propagating the first one
    // left every later preview running AND unreported.
    const failures: string[] = [];
    for (const session of managedSessions) {
      try {
        if (
          await (dependencies.stopManaged ?? stopBackgroundPreview)(
            session.projectDir,
            session.port,
          )
        ) {
          killed++;
        }
      } catch (error) {
        failures.push(`${session.projectDir}: ${errorMessage(error)}`);
      }
    }
    const swept = await (dependencies.killScanned ?? killActiveServers)(startPort);
    killed += swept.killed;
    // Ports whose owner the OS could not confirm are skipped rather than
    // signalled; an agent reading this envelope needs to see that too, not just
    // a lower count.
    const unverified = swept.unverified;
    if (json) {
      writeLifecycleJson(
        lifecyclePayload("kill-all", {
          state: "killed-all",
          stopped: killed,
          ...(failures.length > 0 ? { failed: failures } : {}),
          ...(unverified.length > 0 ? { unverifiedPorts: unverified } : {}),
        }),
      );
    } else if (failures.length > 0 || unverified.length > 0) {
      console.log(`\n  Killed ${killed} preview server${killed === 1 ? "" : "s"}.`);
      for (const failure of failures) clack.log.warn(`Could not stop ${failure}`);
      if (unverified.length > 0) {
        const plural = unverified.length === 1 ? "" : "s";
        clack.log.warn(
          `Left ${unverified.length} server${plural} alone (port${plural} ` +
            `${unverified.join(", ")}): the OS could not confirm which process owns the ` +
            `socket, and the server's own claim is not proof. Install lsof, or stop it ` +
            `with its own preview --stop.`,
        );
      }
      console.log();
    } else if (killed === 0) {
      console.log("\n  No active preview servers to kill.\n");
    } else {
      console.log(`\n  Killed ${killed} preview server${killed === 1 ? "" : "s"}.\n`);
    }
  } catch (error) {
    reportPreviewFailure(json, "kill-all", "preview-kill-all-failed", errorMessage(error));
  }
}

export function previewViteArgs(port: number | undefined): string[] {
  return ["--host", "127.0.0.1", ...(port === undefined ? [] : ["--port", String(port)])];
}

// All preview modes bind the same IPv4 loopback so lifecycle probes and handed
// URLs agree on the reachable server.
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
  setCommandExitCode(1);
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
  options: {
    json: boolean;
    fields?: string;
    detail?: string;
    preferredPort?: number;
  },
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
              ? {
                  code: "selection-unavailable",
                  message: errorMessage(selectionResult.reason),
                }
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
              ? {
                  code: "lint-unavailable",
                  message: errorMessage(lintResult.reason),
                }
              : {
                  code: "lint-not-requested",
                  message: "Lint was not requested.",
                },
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
export function studioDeepLink(url: string, projectName: string, projectDir: string): string {
  return `${url}/${studioLandingSearch(projectDir)}#project/${encodeURIComponent(projectName)}`;
}

export function studioSummaryUrls(
  projectName: string,
  serverUrl: string,
  projectDir: string,
): { serverUrl: string; studioUrl: string } {
  return {
    serverUrl,
    studioUrl: studioDeepLink(serverUrl, projectName, projectDir),
  };
}

export function foregroundPreviewReadyPayload(
  projectName: string,
  serverUrl: string,
  projectDir: string,
  pid: number | null,
): PreviewLifecyclePayload {
  const port = Number(new URL(serverUrl).port);
  return lifecyclePayload(
    "start",
    previewLifecycleSession({
      state: "started",
      mode: "foreground",
      projectName,
      projectDir,
      port,
      pid,
    }),
  );
}

function previewLifecycleSession(options: {
  state: PreviewLifecycleSession["state"];
  mode: PreviewLifecycleSession["mode"];
  projectName: string;
  projectDir: string;
  port: number;
  pid: number | null;
  host?: string;
  logPath?: string;
}): PreviewLifecycleSession {
  const host = options.host ?? "127.0.0.1";
  const serverUrl = previewBaseUrl(options.port, host);
  return {
    state: options.state,
    mode: options.mode,
    projectName: options.projectName,
    projectDir: options.projectDir,
    host,
    port: options.port,
    pid: options.pid,
    serverUrl,
    studioUrl: studioDeepLink(serverUrl, options.projectName, options.projectDir),
    ready: true,
    ...(options.logPath ? { logPath: options.logPath } : {}),
  };
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
  serverUrl: string,
  projectDir: string,
  opts: { details?: string[]; footer?: string } = {},
): void {
  const urls = studioSummaryUrls(projectName, serverUrl, projectDir);
  console.log();
  console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
  console.log(`  ${c.dim("Studio")}    ${c.accent(urls.studioUrl)}`);
  console.log(`  ${c.dim("Server")}    ${c.accent(urls.serverUrl)}`);
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

export function waitForStudioChildClose(
  child: StudioChildProcess,
  signalTarget: StudioSignalTarget = process,
): Promise<void> {
  const shutdown = (): void => {
    if (child.pid) killProcessTree(child.pid);
  };
  signalTarget.once("SIGINT", shutdown);
  signalTarget.once("SIGTERM", shutdown);

  // A short-lived Vite child can exit before launch setup reaches this point.
  // ChildProcess does not replay lifecycle events to listeners attached later,
  // so waiting unconditionally would strand the preview wrapper forever.
  const closed =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolveClose) => {
          // `close` waits for stdio to close too. A Vite descendant can inherit
          // those pipes, so the wrapper must key its lifetime to process exit.
          child.once("exit", () => resolveClose());
        });

  return closed.finally(() => {
    // Signal listeners keep Bun's event loop alive even after Vite exits. Leaving
    // them registered makes `preview --stop` close the port but leak the wrapper.
    signalTarget.off("SIGINT", shutdown);
    signalTarget.off("SIGTERM", shutdown);
  });
}

function attachStudioReadyHandler(
  child: StudioChildProcess,
  spinner: ReturnType<typeof clack.spinner>,
  projectName: string,
  projectDir: string,
  options?: StudioLaunchOptions,
): void {
  let detected = false;

  async function handleOutput(data: Buffer): Promise<void> {
    const url = studioReadyUrl(data.toString());
    if (!url || detected) return;

    detected = true;
    if (options?.json) {
      const port = Number(new URL(url).port);
      const server = await activeServerOnPort(port);
      writeLifecycleJson(
        foregroundPreviewReadyPayload(
          projectName,
          url,
          projectDir,
          publicPreviewPid(server?.pid, child.pid ?? null),
        ),
      );
    } else {
      spinner.stop(c.success("Studio running"));
      printStudioSummary(projectName, url, projectDir, {
        footer: "Press Ctrl+C to stop",
      });
    }
    openStudioBrowser(url, projectName, projectDir, options);
    child.stdout.removeListener("data", handleOutput);
    child.stderr.removeListener("data", handleOutput);
  }

  child.stdout.on("data", (data) => void handleOutput(data));
  child.stderr.on("data", (data) => void handleOutput(data));
  child.on("error", (err) => {
    if (options?.json) {
      reportPreviewFailure(true, "start", "preview-start-failed", err.message);
    } else {
      spinner.stop(c.error("Failed to start studio"));
      console.error(c.dim(err.message));
    }
  });
}

export function studioReadyUrl(output: string): string | null {
  const localLine = output.split(/\r?\n/).find((line) => line.includes("Local:"));
  return localLine?.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/)?.[0] ?? null;
}

export function reportPreviewShutdown(json: boolean): void {
  if (json) return;
  console.log();
  console.log(`  ${c.dim("Shutting down studio...")}`);
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

  if (!options?.json) clack.intro(c.bold("hyperframes preview"));

  const s = clack.spinner();
  if (!options?.json) s.start("Starting studio...");

  // Run the new consolidated studio (single Vite dev server with API plugin)
  const studioPkgDir = join(repoRoot, "packages", "studio");
  const child = spawn("bun", ["run", "dev", "--", ...previewViteArgs(options?.port)], {
    cwd: studioPkgDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: studioProxyEnv(options?.autoProxy ?? true, process.env, {
      projectDir: dir,
      projectName: pName,
      browserGpuMode: options?.browserGpuMode,
    }),
  });

  attachStudioReadyHandler(child, s, pName, dir, options);
  removeSymlinkOnExit(createdSymlink, symlinkPath);

  // Kill the child's entire process tree on SIGTERM/SIGINT. Ctrl+C sends
  // SIGINT to the foreground process group (covers the common case), but
  // `kill <pid>` only targets this process — the child tree (Vite + Chrome)
  // would survive without explicit cleanup.
  // On Windows, killProcessTree delegates to taskkill /T so descendants are
  // reaped even when the console signal reaches only this wrapper — and it
  // always forces, so there is no grace period there, unlike the POSIX path.
  return waitForStudioChildClose(child);
}

/**
 * Whether the project's local @hyperframes/studio can actually be SERVED.
 *
 * Local mode runs `vite` with the studio package as its cwd, so it needs that
 * package's own `vite.config.ts` — which the published tarball does not carry
 * (`files: ["src", "dist"]`). Resolving the package alone therefore is not
 * enough: an npm-installed studio would send `preview` down a path that can
 * never come up, and since `--background` re-execs this same CLI, it would time
 * out after ten seconds instead of falling back. Fall back to embedded mode,
 * which serves the same studio and does work from a published install.
 */
function hasLocalStudio(dir: string): boolean {
  try {
    const req = createRequire(join(dir, "package.json"));
    const studioPkgPath = dirname(req.resolve("@hyperframes/studio/package.json"));
    return existsSync(join(studioPkgPath, "vite.config.ts"));
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

  if (!options?.json) clack.intro(c.bold("hyperframes preview") + c.dim(" (local studio)"));
  const s = clack.spinner();
  if (!options?.json) s.start("Starting studio...");

  const viteCommand = buildNpxCommand(["vite", ...previewViteArgs(options?.port)]);
  const child = spawn(viteCommand.command, viteCommand.args, {
    cwd: studioPkgPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: studioProxyEnv(options?.autoProxy ?? true, process.env, {
      projectDir: dir,
      projectName: pName,
      browserGpuMode: options?.browserGpuMode,
    }),
  });

  attachStudioReadyHandler(child, s, pName, dir, options);
  removeSymlinkOnExit(createdSymlink, symlinkPath);

  // Same cross-platform tree-kill handler as dev mode.
  return waitForStudioChildClose(child);
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

  if (!options?.json) clack.intro(c.bold("hyperframes preview"));
  const s = clack.spinner();
  if (!options?.json) s.start("Starting studio...");

  if (!studioBundle.available) {
    if (options?.json) {
      reportPreviewFailure(true, "start", "preview-start-failed", "Studio build missing");
    } else {
      s.stop(c.error("Studio build missing"));
      console.error();
      console.error(`  ${c.dim("Could not find")} ${c.accent("index.html")} ${c.dim("in:")}`);
      for (const checkedPath of studioBundle.checkedPaths) {
        console.error(`  ${c.dim("-")} ${checkedPath}`);
      }
      console.error();
      console.error(`  ${c.dim("Rebuild the CLI package with")} ${c.accent("bun run build")}`);
      console.error();
    }
    setCommandExitCode(1);
    return;
  }

  // Compute everything that may throw before acquiring the fs.watch handle.
  // Once createStudioServer returns, every subsequent exit path must close it.
  const serverBuildSignature = await loadPreviewServerBuildSignature();
  const { app, watcher } = createStudioServer({
    projectDir: dir,
    projectName: pName,
    autoProxy: options?.autoProxy,
    browserGpuMode: options?.browserGpuMode,
  });
  let result: FindPortResult;
  try {
    result = await findPortAndServe(
      app.fetch,
      startPort,
      dir,
      !!options?.forceNew,
      serverBuildSignature,
      undefined,
      options?.browserGpuMode,
    );
  } catch (err: unknown) {
    watcher.close();
    reportPreviewFailure(
      Boolean(options?.json),
      "start",
      "preview-start-failed",
      (err as Error).message,
    );
    return;
  }

  if (result.type === "already-running") {
    // createStudioServer acquires an fs.watch handle before port discovery.
    // Reuse owns no local server, so release that handle before returning or
    // the otherwise-finished CLI process remains alive indefinitely.
    watcher.close();
    const url = `http://localhost:${result.port}`;
    if (options?.json) {
      const server = await activeServerOnPort(result.port);
      writeLifecycleJson(
        lifecyclePayload(
          "start",
          previewLifecycleSession({
            state: "reused",
            mode: "foreground",
            projectName: pName,
            projectDir: dir,
            port: result.port,
            pid: publicPreviewPid(server?.pid, null),
          }),
        ),
      );
    } else {
      s.stop(c.success("Already running"));
      printStudioSummary(pName, url, dir, {
        details: ["Reusing existing server. Use --force-new to start a fresh instance."],
      });
    }
    openStudioBrowser(url, pName, dir, options);
    return;
  }

  const url = `http://localhost:${result.port}`;
  if (options?.json) {
    writeLifecycleJson(foregroundPreviewReadyPayload(pName, url, dir, process.pid));
  } else {
    s.stop(c.success("Studio running"));
    console.log();
    if (result.port !== startPort) {
      console.log(`  ${c.warn(`Port ${startPort} is in use, using ${result.port} instead`)}`);
      console.log();
    }
    printStudioSummary(pName, url, dir, {
      details: [
        "Edit with your AI agent — it has HyperFrames skills installed.",
        "Changes reload automatically in the studio.",
      ],
      footer: "Press Ctrl+C to stop",
    });
  }
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
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
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
      reportPreviewShutdown(Boolean(options?.json));

      // Hard deadline: if cleanup hangs (e.g. dead Chrome never responds to
      // browser.close()), force exit. Armed before awaiting cleanup so it
      // can't be blocked by a stuck drainBrowserPool().
      setTimeout(() => requestCliExit(0), 3000).unref();

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
          watcher.close();
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
