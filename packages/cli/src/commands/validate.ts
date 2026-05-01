import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProject } from "../utils/project.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
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

interface ContrastEntry {
  time: number;
  selector: string;
  text: string;
  ratio: number;
  wcagAA: boolean;
  large: boolean;
  fg: string;
  bg: string;
}

const CONTRAST_SAMPLES = 5;
const SEEK_SETTLE_MS = 150;
const MEDIA_EXTENSIONS = /\.(aac|flac|m4a|mov|mp3|mp4|oga|ogg|wav|webm)$/i;

export function shouldIgnoreRequestFailure(url: string, errorText: string | undefined): boolean {
  if (errorText !== "net::ERR_ABORTED") return false;
  try {
    return MEDIA_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function getCompositionDuration(page: import("puppeteer-core").Page): Promise<number> {
  return page.evaluate(() => {
    if (window.__hf?.duration && window.__hf.duration > 0) return window.__hf.duration;
    const root = document.querySelector("[data-composition-id][data-duration]");
    return root ? parseFloat(root.getAttribute("data-duration") ?? "0") : 0;
  });
}

async function seekTo(page: import("puppeteer-core").Page, time: number): Promise<void> {
  await page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") {
      window.__hf.seek(t);
      return;
    }
    const timelines = (window as unknown as Record<string, unknown>).__timelines as
      | Record<string, { seek: (t: number) => void }>
      | undefined;
    if (timelines) {
      for (const tl of Object.values(timelines)) {
        if (typeof tl.seek === "function") tl.seek(t);
      }
    }
  }, time);
  await new Promise((r) => setTimeout(r, SEEK_SETTLE_MS));
}

async function runContrastAudit(page: import("puppeteer-core").Page): Promise<ContrastEntry[]> {
  const duration = await getCompositionDuration(page);
  if (duration <= 0) return [];

  await page.addScriptTag({ content: loadContrastAuditScript() });

  const results: ContrastEntry[] = [];
  for (let i = 0; i < CONTRAST_SAMPLES; i++) {
    const t = +(((i + 0.5) / CONTRAST_SAMPLES) * duration).toFixed(3);
    await seekTo(page, t);

    const screenshot = (await page.screenshot({ encoding: "base64", type: "png" })) as string;
    const entries = await page.evaluate(
      (b64: string, time: number) =>
        typeof (window as unknown as Record<string, unknown>).__contrastAudit === "function"
          ? ((window as unknown as Record<string, unknown>).__contrastAudit as Function)(b64, time)
          : [],
      screenshot,
      t,
    );
    results.push(...(entries as ContrastEntry[]));
  }

  return results;
}

function loadContrastAuditScript(): string {
  const candidates = [
    join(__dirname, "contrast-audit.browser.js"),
    join(__dirname, "commands", "contrast-audit.browser.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  }

  throw new Error("Missing contrast audit browser script");
}

async function validateInBrowser(
  projectDir: string,
  opts: { timeout?: number; contrast?: boolean },
): Promise<{ errors: ConsoleEntry[]; warnings: ConsoleEntry[]; contrast?: ContrastEntry[] }> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { ensureBrowser } = await import("../browser/manager.js");

  let html = await bundleToSingleHtml(projectDir);

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
      () => `<script data-hyperframes-preview-runtime="1">${runtimeSource}</script>`,
    );
  }

  const { createServer } = await import("node:http");
  const { getMimeType } = await import("@hyperframes/core/studio-api");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
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
  let contrast: ContrastEntry[] | undefined;

  try {
    const browser = await ensureBrowser();
    const puppeteer = await import("puppeteer-core");
    const chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const page = await chromeBrowser.newPage();
    await page.setViewport(resolveCompositionViewportFromHtml(html));

    page.on("console", (msg) => {
      const type = msg.type();
      const loc = msg.location();
      const text = msg.text();
      if (type === "error") {
        if (text.startsWith("Failed to load resource")) return;
        errors.push({ level: "error", text, url: loc.url, line: loc.lineNumber });
      } else if (type === "warn") {
        warnings.push({ level: "warning", text, url: loc.url, line: loc.lineNumber });
      }
    });

    page.on("pageerror", (err) => {
      errors.push({ level: "error", text: err instanceof Error ? err.message : String(err) });
    });

    page.on("requestfailed", (req) => {
      const url = req.url();
      if (url.includes("favicon") || url.startsWith("data:")) return;
      const failureText = req.failure()?.errorText;
      if (shouldIgnoreRequestFailure(url, failureText)) return;
      const path = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
      errors.push({
        level: "error",
        text: `Failed to load ${path}: ${failureText ?? "net::ERR_FAILED"}`,
        url,
      });
    });

    page.on("response", (res) => {
      if (res.status() >= 400) {
        const url = res.url();
        if (url.includes("favicon")) return;
        const path = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
        errors.push({ level: "error", text: `${res.status()} loading ${path}`, url });
      }
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await new Promise((r) => setTimeout(r, opts.timeout ?? 3000));

    if (opts.contrast) {
      contrast = await runContrastAudit(page);
    }

    await chromeBrowser.close();
  } finally {
    server.close();
  }

  return { errors, warnings, contrast };
}

function printContrastFailures(failures: ContrastEntry[]) {
  console.log();
  console.log(`  ${c.warn("⚠")} WCAG AA contrast warnings (${failures.length}):`);
  for (const cf of failures) {
    const threshold = cf.large ? "3" : "4.5";
    console.log(
      `    ${c.warn("·")} ${cf.selector} ${c.dim(`"${cf.text}"`)} — ${c.warn(cf.ratio + ":1")} ${c.dim(`(need ${threshold}:1, t=${cf.time}s)`)}`,
    );
  }
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
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
    contrast: {
      type: "boolean",
      description: "WCAG contrast audit (enabled by default)",
      default: true,
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
    const useContrast = args.contrast ?? true;

    if (!args.json) {
      console.log(`${c.accent("◆")}  Validating ${c.accent(project.name)} in headless Chrome`);
    }

    try {
      const { errors, warnings, contrast } = await validateInBrowser(project.dir, {
        timeout,
        contrast: useContrast,
      });

      const contrastFailures = (contrast ?? []).filter((e) => !e.wcagAA);
      const contrastPassed = (contrast ?? []).filter((e) => e.wcagAA);

      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({
              ok: errors.length === 0,
              errors,
              warnings,
              contrast,
              contrastFailures: contrastFailures.length,
            }),
            null,
            2,
          ),
        );
        process.exit(errors.length > 0 ? 1 : 0);
      }

      if (errors.length === 0 && warnings.length === 0 && contrastFailures.length === 0) {
        const suffix =
          contrastPassed.length > 0 ? ` · ${contrastPassed.length} text elements pass WCAG AA` : "";
        console.log(`${c.success("◇")}  No console errors${suffix}`);
        return;
      }

      console.log();
      for (const e of errors) {
        console.log(`  ${c.error("✗")} ${e.text}${e.line ? c.dim(` (line ${e.line})`) : ""}`);
      }
      for (const w of warnings) {
        console.log(`  ${c.warn("⚠")} ${w.text}${w.line ? c.dim(` (line ${w.line})`) : ""}`);
      }
      if (contrastFailures.length > 0) printContrastFailures(contrastFailures);

      console.log();
      const parts = [`${errors.length} error(s)`, `${warnings.length} warning(s)`];
      if (contrastFailures.length > 0) parts.push(`${contrastFailures.length} contrast warning(s)`);
      console.log(`${c.accent("◇")}  ${parts.join(", ")}`);

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
