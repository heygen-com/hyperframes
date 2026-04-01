import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProject } from "../utils/project.js";
import { c } from "../ui/colors.js";
import { withMeta } from "../utils/updateCheck.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ConsoleEntry {
  level: "error" | "warning";
  text: string;
  url?: string;
  line?: number;
}

/**
 * Bundle the project HTML with the runtime injected, serve it via a minimal
 * static server, open headless Chrome, and collect console errors.
 */
async function validateInBrowser(
  projectDir: string,
  opts: { timeout?: number },
): Promise<{ errors: ConsoleEntry[]; warnings: ConsoleEntry[] }> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { ensureBrowser } = await import("../browser/manager.js");

  // 1. Bundle
  let html = await bundleToSingleHtml(projectDir);

  // Inject local runtime if available
  const runtimePath = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "core",
    "dist",
    "hyperframe.runtime.iife.js",
  );
  if (existsSync(runtimePath)) {
    const runtimeSource = readFileSync(runtimePath, "utf-8");
    html = html.replace(
      /<script[^>]*data-hyperframes-preview-runtime[^>]*src="[^"]*"[^>]*><\/script>/,
      `<script data-hyperframes-preview-runtime="1">${runtimeSource}</script>`,
    );
  }

  // 2. Start minimal file server for project assets (audio, images, fonts, json)
  const { createServer } = await import("node:http");
  const { getMimeType } = await import("@hyperframes/core/studio-api");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    // Serve project files
    const filePath = join(projectDir, decodeURIComponent(url));
    if (existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": getMimeType(filePath) });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, () => {
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  const errors: ConsoleEntry[] = [];
  const warnings: ConsoleEntry[] = [];

  try {
    // 3. Launch headless Chrome
    const browser = await ensureBrowser();
    const puppeteer = await import("puppeteer-core");
    const chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const page = await chromeBrowser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // 4. Capture console messages
    page.on("console", (msg) => {
      const type = msg.type();
      const loc = msg.location();
      const text = msg.text();
      if (type === "error") {
        // Network errors show as console errors but with no useful location.
        // We capture those separately via response/requestfailed events.
        if (text.startsWith("Failed to load resource")) return;
        errors.push({ level: "error", text, url: loc.url, line: loc.lineNumber });
      } else if (type === "warning") {
        warnings.push({ level: "warning", text, url: loc.url, line: loc.lineNumber });
      }
    });

    // Capture uncaught exceptions
    page.on("pageerror", (err) => {
      errors.push({ level: "error", text: err.message });
    });

    // Capture failed network requests for project assets (skip favicon, data: URIs)
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (url.includes("favicon")) return;
      if (url.startsWith("data:")) return;
      // Extract the path relative to the server
      const urlObj = new URL(url);
      const path = decodeURIComponent(urlObj.pathname).replace(/^\//, "");
      const failure = req.failure()?.errorText ?? "net::ERR_FAILED";
      errors.push({ level: "error", text: `Failed to load ${path}: ${failure}`, url });
    });

    // Capture HTTP errors (404, 500, etc.) for project assets
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 400) {
        const url = res.url();
        if (url.includes("favicon")) return;
        const urlObj = new URL(url);
        const path = decodeURIComponent(urlObj.pathname).replace(/^\//, "");
        errors.push({ level: "error", text: `${status} loading ${path}`, url });
      }
    });

    // 5. Navigate and wait
    const timeoutMs = opts.timeout ?? 3000;
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    // Wait for scripts to settle
    await new Promise((r) => setTimeout(r, timeoutMs));

    await chromeBrowser.close();
  } finally {
    server.close();
  }

  return { errors, warnings };
}

export default defineCommand({
  meta: {
    name: "validate",
    description: `Load a composition in headless Chrome and report console errors

Examples:
  hyperframes validate
  hyperframes validate ./my-project
  hyperframes validate --json
  hyperframes validate --timeout 5000`,
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    timeout: {
      type: "string",
      description: "Ms to wait for scripts to settle (default: 3000)",
      default: "3000",
    },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const timeout = parseInt(args.timeout as string, 10) || 3000;

    if (!args.json) {
      console.log(`${c.accent("◆")}  Validating ${c.accent(project.name)} in headless Chrome`);
    }

    try {
      const { errors, warnings } = await validateInBrowser(project.dir, { timeout });

      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({
              ok: errors.length === 0,
              errors,
              warnings,
            }),
            null,
            2,
          ),
        );
        process.exit(errors.length > 0 ? 1 : 0);
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(`${c.success("◇")}  No console errors`);
        return;
      }

      console.log();
      for (const e of errors) {
        const loc = e.line ? ` (line ${e.line})` : "";
        console.log(`  ${c.error("✗")} ${e.text}${c.dim(loc)}`);
      }
      for (const w of warnings) {
        const loc = w.line ? ` (line ${w.line})` : "";
        console.log(`  ${c.warn("⚠")} ${w.text}${c.dim(loc)}`);
      }
      console.log();
      console.log(`${c.accent("◇")}  ${errors.length} error(s), ${warnings.length} warning(s)`);

      process.exit(errors.length > 0 ? 1 : 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({ ok: false, error: message, errors: [], warnings: [] }),
            null,
            2,
          ),
        );
        process.exit(1);
      }
      console.error(`${c.error("✗")} ${message}`);
      process.exit(1);
    }
  },
});
