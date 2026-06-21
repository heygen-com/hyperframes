import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { spawn } from "node:child_process";

export const examples: Example[] = [
  ["Preview the current project", "hyperframes preview"],
  ["Preview a specific project directory", "hyperframes preview ./my-video"],
  ["Use a custom port", "hyperframes preview --port 8080"],
  ["Force a new server even if one is already running", "hyperframes preview --force-new"],
  ["Start without opening the browser", "hyperframes preview --no-open"],
  ["Open with a specific browser", "hyperframes preview --browser-path /usr/bin/chromium"],
  [
    "Open with CDP enabled (requires browser path + isolated profile)",
    "hyperframes preview --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile --remote-debugging-port 9222",
  ],
  ["List all active preview servers", "hyperframes preview --list"],
  ["Kill all active preview servers", "hyperframes preview --kill-all"],
];
import { existsSync, lstatSync, symlinkSync, unlinkSync, readlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { isDevMode } from "../utils/env.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
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
  },
  async run({ args }) {
    const startPort = parseInt(args.port ?? "3002", 10);

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
    const indexPath = project.indexPath;
    const projectName = isImplicitCwd ? basename(process.env.PWD ?? dir) : project.name;

    // Lint before starting — surface issues for the agent to fix.
    const lintResult = await lintProject({ dir, name: projectName, indexPath });
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
      return runDevMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
      });
    }

    // If @hyperframes/studio is installed locally, use Vite for full HMR
    if (hasLocalStudio(dir)) {
      return runLocalStudioMode(dir, {
        projectName,
        noOpen,
        browserPath,
        userDataDir,
        remoteDebuggingPort,
      });
    }

    const forceNew = !!args["force-new"];
    return runEmbeddedMode(dir, startPort, {
      projectName,
      forceNew,
      noOpen,
      browserPath,
      userDataDir,
      remoteDebuggingPort,
    });
  },
});

/**
 * Dev mode: spawn the studio dev server from the monorepo.
 */
async function runDevMode(
  dir: string,
  options?: {
    projectName?: string;
    noOpen?: boolean;
    browserPath?: string;
    userDataDir?: string;
    remoteDebuggingPort?: number;
  },
): Promise<void> {
  // Find monorepo root by navigating from packages/cli/src/commands/
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..", "..");

  // Symlink project into the studio's data directory
  const projectsDir = join(repoRoot, "packages", "studio", "data", "projects");
  const pName = options?.projectName ?? basename(dir);
  const symlinkPath = join(projectsDir, pName);

  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath)) {
      try {
        const stat = lstatSync(symlinkPath);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(symlinkPath);
          if (resolve(target) !== resolve(dir)) {
            unlinkSync(symlinkPath);
          }
        }
        // If it's a real directory, leave it alone
      } catch {
        // Not a symlink — don't touch it
      }
    }

    if (!existsSync(symlinkPath)) {
      symlinkSync(dir, symlinkPath, "dir");
      createdSymlink = true;
    }
  }

  clack.intro(c.bold("hyperframes preview"));

  const s = clack.spinner();
  s.start("Starting studio...");

  // Run the new consolidated studio (single Vite dev server with API plugin)
  const studioPkgDir = join(repoRoot, "packages", "studio");
  const child = spawn("bun", ["run", "dev"], {
    cwd: studioPkgDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let frontendUrl = "";

  function handleOutput(data: Buffer): void {
    const text = data.toString();

    // Detect Vite URL
    const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (localMatch && !frontendUrl) {
      frontendUrl = localMatch[1] ?? "";
      s.stop(c.success("Studio running"));
      console.log();
      console.log(`  ${c.dim("Project")}   ${c.accent(pName)}`);
      console.log(`  ${c.dim("Studio")}    ${c.accent(frontendUrl)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();

      if (!options?.noOpen) {
        const urlToOpen = `${frontendUrl}#project/${pName}`;
        openBrowser(urlToOpen, {
          browserPath: options?.browserPath,
          userDataDir: options?.userDataDir,
          remoteDebuggingPort: options?.remoteDebuggingPort,
        });
      }

      child.stdout?.removeListener("data", handleOutput);
      child.stderr?.removeListener("data", handleOutput);
    }
  }

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);

  // If child exits before we detect readiness, show what we have
  child.on("error", (err) => {
    s.stop(c.error("Failed to start studio"));
    console.error(c.dim(err.message));
  });

  if (createdSymlink) {
    process.on("exit", () => {
      try {
        if (existsSync(symlinkPath)) unlinkSync(symlinkPath);
      } catch {
        /* ignore */
      }
    });
  }

  // Kill the child's entire process tree on SIGTERM/SIGINT. Ctrl+C sends
  // SIGINT to the foreground process group (covers the common case), but
  // `kill <pid>` only targets this process — the child tree (Vite + Chrome)
  // would survive without explicit cleanup.
  // On Windows, killProcessTree is a no-op (pgrep/ps unavailable); Ctrl+C
  // propagates via the console process group instead.
  const shutdown = () => {
    if (child.pid) killProcessTree(child.pid);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return new Promise<void>((resolve) => {
    child.on("close", () => resolve());
  });
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
async function runLocalStudioMode(
  dir: string,
  options?: {
    projectName?: string;
    noOpen?: boolean;
    browserPath?: string;
    userDataDir?: string;
    remoteDebuggingPort?: number;
  },
): Promise<void> {
  const req = createRequire(join(dir, "package.json"));
  const studioPkgPath = dirname(req.resolve("@hyperframes/studio/package.json"));
  const pName = options?.projectName ?? basename(dir);

  // Symlink project into studio's data directory
  const projectsDir = join(studioPkgPath, "data", "projects");
  const symlinkPath = join(projectsDir, pName);
  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath) && lstatSync(symlinkPath).isSymbolicLink()) {
      if (resolve(readlinkSync(symlinkPath)) !== resolve(dir)) {
        unlinkSync(symlinkPath);
      }
    }
    if (!existsSync(symlinkPath)) {
      symlinkSync(dir, symlinkPath, "dir");
      createdSymlink = true;
    }
  }

  clack.intro(c.bold("hyperframes preview") + c.dim(" (local studio)"));
  const s = clack.spinner();
  s.start("Starting studio...");

  const viteCommand = buildNpxCommand(["vite"]);
  const child = spawn(viteCommand.command, viteCommand.args, {
    cwd: studioPkgPath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let detected = false;

  function handleOutput(data: Buffer): void {
    const text = data.toString();
    const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (localMatch && !detected) {
      detected = true;
      const url = localMatch[1] ?? "";
      s.stop(c.success("Studio running"));
      console.log();
      console.log(`  ${c.dim("Project")}   ${c.accent(pName)}`);
      console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();
      if (!options?.noOpen) {
        openBrowser(`${url}#project/${pName}`, {
          browserPath: options?.browserPath,
          userDataDir: options?.userDataDir,
          remoteDebuggingPort: options?.remoteDebuggingPort,
        });
      }
    }
  }

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);
  child.on("error", (err) => {
    s.stop(c.error("Failed to start studio"));
    console.error(c.dim(err.message));
  });

  if (createdSymlink) {
    process.on("exit", () => {
      try {
        if (existsSync(symlinkPath)) unlinkSync(symlinkPath);
      } catch {
        /* ignore */
      }
    });
  }

  // Same tree-kill handler as dev mode. No-op on Windows (see comment above).
  const shutdown = () => {
    if (child.pid) killProcessTree(child.pid);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return new Promise<void>((resolve) => {
    child.on("close", () => resolve());
  });
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
  options?: {
    projectName?: string;
    forceNew?: boolean;
    noOpen?: boolean;
    browserPath?: string;
    userDataDir?: string;
    remoteDebuggingPort?: number;
  },
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
    console.log();
    console.log(`  ${c.dim("Project")}   ${c.accent(pName)}`);
    console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
    console.log();
    console.log(
      `  ${c.dim("Reusing existing server. Use --force-new to start a fresh instance.")}`,
    );
    console.log();
    if (!options?.noOpen) {
      openBrowser(`${url}#project/${pName}`, {
        browserPath: options?.browserPath,
        userDataDir: options?.userDataDir,
        remoteDebuggingPort: options?.remoteDebuggingPort,
      });
    }
    return;
  }

  const url = `http://localhost:${result.port}`;
  s.stop(c.success("Studio running"));
  console.log();
  if (result.port !== startPort) {
    console.log(`  ${c.warn(`Port ${startPort} is in use, using ${result.port} instead`)}`);
    console.log();
  }
  console.log(`  ${c.dim("Project")}   ${c.accent(pName)}`);
  console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
  console.log();
  console.log(`  ${c.dim("Edit with your AI agent — it has HyperFrames skills installed.")}`);
  console.log(`  ${c.dim("Changes reload automatically in the studio.")}`);
  console.log();
  console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
  console.log();
  if (!options?.noOpen) {
    openBrowser(`${url}#project/${pName}`, {
      browserPath: options?.browserPath,
      userDataDir: options?.userDataDir,
      remoteDebuggingPort: options?.remoteDebuggingPort,
    });
  }

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
