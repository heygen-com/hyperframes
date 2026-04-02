import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { spawn } from "node:child_process";

export const examples: Example[] = [
  ["Preview the current project", "hyperframes preview"],
  ["Preview a specific project directory", "hyperframes preview ./my-video"],
  ["Use a custom port", "hyperframes preview --port 8080"],
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

/**
 * Try to start a server on the given port, auto-incrementing up to maxAttempts
 * times if the port is already in use. Returns the running server and actual port.
 *
 * Uses createAdaptorServer (no auto-listen) so we control the bind and can
 * retry on EADDRINUSE without TOCTOU races.
 */
async function serveWithPortFallback(
  fetch: Parameters<typeof import("@hono/node-server").serve>[0]["fetch"],
  startPort: number,
  maxAttempts = 10,
): Promise<{ server: import("@hono/node-server").ServerType; port: number }> {
  const { createAdaptorServer } = await import("@hono/node-server");

  const server = createAdaptorServer({ fetch });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;
    try {
      await new Promise<void>((resolveListener, rejectListener) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          server.removeListener("listening", onListening);
          rejectListener(err);
        };
        const onListening = (): void => {
          server.removeListener("error", onError);
          resolveListener();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port);
      });
      return { server, port };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        continue; // try next port
      }
      throw err; // unexpected error — don't swallow it
    }
  }

  const lastPort = startPort + maxAttempts - 1;
  throw new Error(
    `Ports ${startPort}–${lastPort} are all in use. Use --port to specify a different port.`,
  );
}

export default defineCommand({
  meta: { name: "preview", description: "Start the studio for previewing compositions" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the preview server on", default: "3002" },
  },
  async run({ args }) {
    const rawArg = args.dir;
    const dir = resolve(rawArg ?? ".");
    const startPort = parseInt(args.port ?? "3002", 10);

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

    return runEmbeddedMode(dir, startPort, projectName);
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

      const urlToOpen = `${frontendUrl}#/project/${pName}`;
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
 */
async function runEmbeddedMode(
  dir: string,
  startPort: number,
  projectName?: string,
): Promise<void> {
  const { createStudioServer } = await import("../server/studioServer.js");

  const pName = projectName ?? basename(dir);
  const { app } = createStudioServer({ projectDir: dir, projectName: pName });

  clack.intro(c.bold("hyperframes preview"));
  const s = clack.spinner();
  s.start("Starting studio...");

  let actualPort: number;
  try {
    ({ port: actualPort } = await serveWithPortFallback(app.fetch, startPort));
  } catch (err: unknown) {
    s.stop(c.error("Failed to start studio"));
    console.error();
    console.error(`  ${(err as Error).message}`);
    console.error();
    process.exitCode = 1;
    return;
  }

  const url = `http://localhost:${actualPort}`;
  s.stop(c.success("Studio running"));
  console.log();
  if (actualPort !== startPort) {
    console.log(`  ${c.warn(`Port ${startPort} is in use, using ${actualPort} instead`)}`);
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
