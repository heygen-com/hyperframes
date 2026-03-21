import { defineCommand } from "citty";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  readlinkSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

/**
 * Check if a port is available by trying to listen on it briefly.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const { createServer } = require("node:net") as typeof import("node:net");
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return startPort; // fallback — let the server fail with a clear error
}

/**
 * Detect whether we're running from source (monorepo dev) or from the built bundle.
 * When running via tsx from source, the file is at cli/src/commands/dev.ts.
 * When running from the built bundle, the file is at cli/dist/cli.js.
 * We check the filename portion of the URL to avoid false positives from
 * directory names (e.g., /Users/someone/src/...).
 */
function isDevMode(): boolean {
  const url = new URL(import.meta.url);
  // In dev mode the file is a .ts source file; in production it's a bundled .js
  return url.pathname.endsWith(".ts");
}

export default defineCommand({
  meta: { name: "dev", description: "Start the studio for local development" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
  },
  async run({ args }) {
    const dir = resolve(args.dir ?? ".");

    if (isDevMode()) {
      return runDevMode(dir);
    }
    const port = await findAvailablePort(3002);
    return runEmbeddedMode(dir, port);
  },
});

/**
 * Dev mode: spawn pnpm studio from the monorepo (existing behavior).
 */
async function runDevMode(dir: string): Promise<void> {
  // Find monorepo root by navigating from packages/cli/src/commands/
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..", "..");

  // Symlink project into the studio's data directory
  const projectsDir = join(repoRoot, "packages", "studio", "data", "projects");
  const projectName = basename(dir);
  const symlinkPath = join(projectsDir, projectName);

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

  clack.intro(c.bold("hyperframes dev"));

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
      console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
      console.log(`  ${c.dim("Studio")}    ${c.accent(frontendUrl)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();

      const urlToOpen = `${frontendUrl}#/project/${projectName}`;
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

  function cleanup(): void {
    if (createdSymlink && existsSync(symlinkPath)) {
      try {
        unlinkSync(symlinkPath);
      } catch {
        /* ignore */
      }
    }
  }

  return new Promise<void>((resolvePromise) => {
    // Temporarily ignore SIGINT on the parent so Ctrl+C only kills the child.
    // The child gets SIGINT from the terminal's process group signal.
    // When the child exits, we clean up and resolve back to the caller.
    const noop = (): void => {};
    process.on("SIGINT", noop);

    child.on("close", () => {
      process.removeListener("SIGINT", noop);
      cleanup();
      resolvePromise();
    });
  });
}

/**
 * Embedded mode — not yet available.
 * TODO: Migrate to use @hyperframes/studio's built-in Vite server for published CLI.
 */
async function runEmbeddedMode(_dir: string, _port: number): Promise<void> {
  console.error(c.error("Embedded mode not yet available. Run from the monorepo root with: hyperframes dev <dir>"));
  process.exit(1);
}
