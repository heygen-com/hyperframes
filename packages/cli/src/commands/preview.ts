import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { spawn } from "node:child_process";

export const examples: Example[] = [
  ["Preview the current project", "hyperframes preview"],
  ["Preview a specific project directory", "hyperframes preview ./my-video"],
  ["Use a custom port", "hyperframes preview --port 8080"],
  ["Force a new server even if one is already running", "hyperframes preview --force-new"],
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
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import {
  findPortAndServe,
  scanActiveServers,
  killActiveServers,
  type FindPortResult,
} from "../server/portUtils.js";

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

    const rawArg = args.dir;
    const dir = resolve(rawArg ?? ".");

    // Compute display name: preserve symlink/CWD name when user runs "hyperframes preview ."
    const isImplicitCwd = !rawArg || rawArg === "." || rawArg === "./";
    const projectName = isImplicitCwd ? basename(process.env.PWD ?? dir) : basename(dir);

    // Lint before starting — surface issues for the agent to fix.
    // preview.ts doesn't use resolveProject() because it needs to proceed even without index.html.
    const indexPath = join(dir, "index.html");
    if (existsSync(indexPath)) {
      const project = { dir, name: projectName, indexPath };
      const lintResult = lintProject(project);
      if (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0) {
        console.log();
        for (const line of formatLintFindings(lintResult)) console.log(line);
        console.log();
      }
    }

    if (isDevMode()) {
      return runDevMode(dir, projectName);
    }

    // If @hyperframes/studio is installed locally, use Vite for full HMR
    if (hasLocalStudio(dir)) {
      return runLocalStudioMode(dir, projectName);
    }

    const forceNew = !!args["force-new"];
    return runEmbeddedMode(dir, startPort, projectName, forceNew);
  },
});

/**
 * Dev mode: spawn pnpm studio from the monorepo (existing behavior).
 */
async function runDevMode(dir: string, projectName?: string): Promise<void> {
  // Find monorepo root by navigating from packages/cli/src/commands/
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..", "..");

  // Symlink project into the studio's data directory
  const projectsDir = join(repoRoot, "packages", "studio", "data", "projects");
  const pName = projectName ?? basename(dir);
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
  const child = spawn("pnpm", ["exec", "vite"], {
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

      const urlToOpen = `${frontendUrl}#project/${pName}`;
      import("open").then((mod) => mod.default(urlToOpen)).catch(() => {});

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

  // Wait for child to exit. Ctrl+C sends SIGINT to the entire process group,
  // so the child (Vite) receives it directly — no need to intercept or forward.
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
async function runLocalStudioMode(dir: string, projectName?: string): Promise<void> {
  const req = createRequire(join(dir, "package.json"));
  const studioPkgPath = dirname(req.resolve("@hyperframes/studio/package.json"));
  const pName = projectName ?? basename(dir);

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

  const child = spawn("npx", ["vite"], {
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
      import("open").then((mod) => mod.default(`${url}#project/${pName}`)).catch(() => {});
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
  projectName?: string,
  forceNew = false,
): Promise<void> {
  const { createStudioServer } = await import("../server/studioServer.js");

  const pName = projectName ?? basename(dir);
  const { app } = createStudioServer({ projectDir: dir, projectName: pName });

  clack.intro(c.bold("hyperframes preview"));
  const s = clack.spinner();
  s.start("Starting studio...");

  let result: FindPortResult;
  try {
    result = await findPortAndServe(app.fetch, startPort, dir, forceNew);
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
    import("open").then((mod) => mod.default(`${url}#project/${pName}`)).catch(() => {});
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
  import("open").then((mod) => mod.default(`${url}#project/${pName}`)).catch(() => {});

  // Block until the process is killed. Ctrl+C (SIGINT) uses Node's default
  // behavior — exit immediately. The OS reclaims the port and file handles.
  return new Promise<void>(() => {});
}
