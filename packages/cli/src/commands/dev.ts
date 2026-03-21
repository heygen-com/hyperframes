import { defineCommand } from "citty";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  readlinkSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { MIME_TYPES } from "../utils/mime.js";

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
  // Find monorepo root by navigating from cli/ package
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..");

  // Symlink project into studio's data directory so it appears in the project list
  const projectsDir = join(repoRoot, "studio", "backend", "data", "projects");
  const projectName = basename(dir);
  const symlinkPath = join(projectsDir, projectName);

  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath)) {
      try {
        const target = readlinkSync(symlinkPath);
        if (resolve(target) !== dir) {
          unlinkSync(symlinkPath);
        }
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

  // Pipe child output so we can parse it and show clean output
  const child = spawn("pnpm", ["studio"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let backendReady = false;
  let frontendUrl = "";

  function handleOutput(data: Buffer): void {
    const text = data.toString();

    // Detect backend ready
    if (!backendReady && text.includes("Studio backend running")) {
      backendReady = true;
    }

    // Detect frontend URL (Vite may pick a different port)
    const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (localMatch) {
      frontendUrl = localMatch[1] ?? "";
    }

    // Once both are ready, show the clean output
    if (backendReady && frontendUrl) {
      s.stop(c.success("Studio running"));
      console.log();
      console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
      console.log(`  ${c.dim("Backend")}   ${c.accent("http://localhost:3002")}`);
      console.log(`  ${c.dim("Frontend")}  ${c.accent(frontendUrl)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();

      // Open browser — capture URL before clearing state
      const urlToOpen = `${frontendUrl}#/project/${projectName}`;
      import("open").then((mod) => mod.default(urlToOpen)).catch(() => {});

      // Stop listening — we don't need to parse anymore
      backendReady = false;
      frontendUrl = "";
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
 * Embedded mode: start an inline Hono server with the studio backend routes
 * and serve the pre-built frontend from dist/studio/.
 */
async function runEmbeddedMode(dir: string, port: number): Promise<void> {
  const projectName = basename(dir);

  // Resolve the studio frontend dist directory relative to the CLI bundle
  const thisFile = fileURLToPath(import.meta.url);
  const studioDir = join(dirname(thisFile), "studio");

  if (!existsSync(studioDir)) {
    console.error(
      c.error(
        `Studio frontend not found at ${studioDir}. Did you run 'pnpm build'?`,
      ),
    );
    process.exit(1);
  }

  // Set up data directories and env vars BEFORE importing the studio backend
  // routes, since the route modules read these env vars at initialization time.
  const dataDir = join(dirname(thisFile), "data", "projects");
  mkdirSync(dataDir, { recursive: true });
  process.env.STUDIO_DATA_DIR = dataDir;

  const rendersDir = join(dirname(thisFile), "data", "renders");
  mkdirSync(rendersDir, { recursive: true });
  process.env.STUDIO_RENDERS_DIR = rendersDir;

  // Import after env vars are set so the route modules pick up the correct paths
  const { serve } = await import("@hono/node-server");
  const { createEmbeddedApp } = await import(
    "@hyperframes/studio-backend/embedded"
  );

  // Symlink the project into the data directory
  const symlinkPath = join(dataDir, projectName);
  let createdSymlink = false;

  if (dir !== symlinkPath) {
    // Check if something already exists at the symlink path
    let needsCreate = true;
    try {
      const stat = lstatSync(symlinkPath);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(symlinkPath);
        if (resolve(target) === resolve(dir)) {
          needsCreate = false; // Already points to the right place
        } else {
          unlinkSync(symlinkPath); // Points elsewhere, replace it
        }
      }
      // If it's a real directory, leave it alone
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        needsCreate = false;
      }
    } catch {
      // Nothing at that path — good, we'll create it
    }

    if (needsCreate) {
      symlinkSync(dir, symlinkPath, "dir");
      createdSymlink = true;
    }
  }

  // Create the Hono app with all studio backend routes.
  // The factory uses the same Hono import as the routes, avoiding class
  // mismatches when tsup bundles multiple copies of the Hono module.
  const app = createEmbeddedApp();

  // port is passed as parameter from findAvailablePort()

  // Static file serving: use Hono's notFound handler for SPA fallback
  // and register explicit static asset routes.
  function serveStaticFile(urlPath: string): Response | null {
    const relativePath = urlPath.replace(/^\//, "");
    const filePath = resolve(studioDir, relativePath);
    if (!filePath.startsWith(resolve(studioDir) + "/")) return null;
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath);
    const ext = filePath.split(".").pop() ?? "";
    const contentType = MIME_TYPES["." + ext] ?? "application/octet-stream";
    return new Response(content, {
      headers: { "Content-Type": contentType },
    });
  }

  // Catch-all: serve static files, then SPA fallback for non-API routes
  app.notFound((ctx) => {
    // Try to serve a static file from the studio frontend directory
    const urlPath = ctx.req.path === "/" ? "/index.html" : ctx.req.path;
    const staticResponse = serveStaticFile(urlPath);
    if (staticResponse) return staticResponse;

    // SPA fallback for non-API routes
    if (!ctx.req.path.startsWith("/api/")) {
      const indexPath = join(studioDir, "index.html");
      if (existsSync(indexPath)) {
        return ctx.html(readFileSync(indexPath, "utf-8"));
      }
    }

    return ctx.text("Not found", 404);
  });

  clack.intro(c.bold("hyperframes dev"));

  const s = clack.spinner();
  s.start("Starting embedded studio...");

  const server = serve({
    fetch: app.fetch,
    port,
  });

  const studioUrl = `http://localhost:${port}`;

  s.stop(c.success("Studio running"));
  console.log();
  console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
  console.log(`  ${c.dim("Studio")}    ${c.accent(studioUrl)}`);
  console.log();
  console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
  console.log();

  // Open browser (skip if HYPERFRAMES_NO_OPEN is set, useful for testing)
  if (!process.env.HYPERFRAMES_NO_OPEN) {
    const urlToOpen = `${studioUrl}/#/project/${projectName}`;
    import("open")
      .then((mod) => mod.default(urlToOpen))
      .catch(() => {});
  }

  // Wait for SIGINT to shut down
  return new Promise<void>((resolvePromise) => {
    function cleanup(): void {
      if (createdSymlink && existsSync(symlinkPath)) {
        try {
          unlinkSync(symlinkPath);
        } catch {
          /* ignore */
        }
      }
    }

    process.on("SIGINT", () => {
      console.log();
      console.log(c.dim("  Shutting down..."));
      server.close(() => {
        cleanup();
        resolvePromise();
      });
    });
  });
}
