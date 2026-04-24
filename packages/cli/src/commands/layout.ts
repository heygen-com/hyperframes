import { defineCommand } from "citty";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  buildLayoutSampleTimes,
  collapseStaticLayoutIssues,
  dedupeLayoutIssues,
  formatLayoutIssue,
  limitLayoutIssues,
  summarizeLayoutIssues,
  type LayoutIssue,
} from "../utils/layoutAudit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEEK_SETTLE_MS = 120;
const INSPECT_SCHEMA_VERSION = 1;

export const examples: Example[] = [
  ["Inspect visual layout across the current composition", "hyperframes layout"],
  ["Inspect a specific project", "hyperframes layout ./my-video"],
  ["Output agent-readable JSON", "hyperframes layout --json"],
  ["Use explicit hero-frame timestamps", "hyperframes layout --at 1.5,4.0,7.25"],
];

interface LayoutAuditResult {
  duration: number;
  samples: number[];
  rawIssues: LayoutIssue[];
}

async function getCompositionDuration(page: import("puppeteer-core").Page): Promise<number> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __hf?: { duration?: number };
      __player?: { duration?: number | (() => number) };
      __timelines?: Record<string, { duration?: number | (() => number) }>;
    };
    if (typeof win.__hf?.duration === "number" && win.__hf.duration > 0) return win.__hf.duration;
    const playerDuration = win.__player?.duration;
    if (typeof playerDuration === "function") return playerDuration();
    if (typeof playerDuration === "number" && playerDuration > 0) return playerDuration;

    const root = document.querySelector("[data-composition-id][data-duration]");
    const attrDuration = root ? parseFloat(root.getAttribute("data-duration") ?? "0") : 0;
    if (attrDuration > 0) return attrDuration;

    const timelines = win.__timelines;
    if (timelines) {
      for (const timeline of Object.values(timelines)) {
        const duration = timeline.duration;
        if (typeof duration === "function") return duration();
        if (typeof duration === "number" && duration > 0) return duration;
      }
    }

    return 0;
  });
}

async function seekTo(page: import("puppeteer-core").Page, time: number): Promise<void> {
  await page.evaluate((t: number) => {
    const win = window as unknown as {
      __hf?: { seek?: (time: number) => void };
      __player?: { seek?: (time: number) => void };
      __timelines?: Record<string, { pause?: () => void; seek?: (time: number) => void }>;
    };
    if (typeof win.__hf?.seek === "function") {
      win.__hf.seek(t);
      return;
    }
    if (typeof win.__player?.seek === "function") {
      win.__player.seek(t);
      return;
    }
    const timelines = win.__timelines;
    if (timelines) {
      for (const timeline of Object.values(timelines)) {
        if (typeof timeline.pause === "function") timeline.pause();
        if (typeof timeline.seek === "function") timeline.seek(t);
      }
    }
  }, time);
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
      ),
  );
  await page
    .evaluate(() => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fonts?.ready) return Promise.resolve();
      return Promise.race([
        fonts.ready.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
    })
    .catch(() => {});
  await new Promise((resolveSettle) => setTimeout(resolveSettle, SEEK_SETTLE_MS));
}

async function bundleProjectHtml(projectDir: string): Promise<string> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
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

  return html;
}

async function serveProject(
  projectDir: string,
  html: string,
): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const { getMimeType } = await import("@hyperframes/core/studio-api");
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    const filePath = resolve(projectDir, decodeURIComponent(url).replace(/^\//, ""));
    const rel = relative(projectDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": getMimeType(filePath) });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.on("error", rejectPort);
    server.listen(0, () => {
      const addr = server.address();
      const resolvedPort = typeof addr === "object" && addr ? addr.port : 0;
      if (!resolvedPort) rejectPort(new Error("Failed to bind local layout audit server"));
      else resolvePort(resolvedPort);
    });
  });

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

async function alignViewportToComposition(
  page: import("puppeteer-core").Page,
  url: string,
): Promise<void> {
  const size = await page.evaluate(() => {
    const root = document.querySelector("[data-composition-id][data-width][data-height]");
    const width = root ? parseInt(root.getAttribute("data-width") ?? "", 10) : 0;
    const height = root ? parseInt(root.getAttribute("data-height") ?? "", 10) : 0;
    return {
      width: Number.isFinite(width) && width > 0 ? Math.min(width, 4096) : 1920,
      height: Number.isFinite(height) && height > 0 ? Math.min(height, 4096) : 1080,
    };
  });

  await page.setViewport(size);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
}

async function runLayoutAudit(
  projectDir: string,
  opts: { samples: number; at?: number[]; timeout: number; tolerance: number },
): Promise<LayoutAuditResult> {
  const { ensureBrowser } = await import("../browser/manager.js");
  const puppeteer = await import("puppeteer-core");
  const html = await bundleProjectHtml(projectDir);
  const server = await serveProject(projectDir, html);
  let chromeBrowser: import("puppeteer-core").Browser | undefined;

  try {
    const browser = await ensureBrowser();
    chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });

    const page = await chromeBrowser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10000 });
    await alignViewportToComposition(page, server.url);
    await page
      .waitForFunction(() => !!(window as unknown as { __timelines?: unknown }).__timelines, {
        timeout: opts.timeout,
      })
      .catch(() => {});
    await page
      .evaluate(() => {
        const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
        if (!fonts?.ready) return Promise.resolve();
        return Promise.race([
          fonts.ready.then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 750)),
        ]);
      })
      .catch(() => {});
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 250));

    const duration = await getCompositionDuration(page);
    const samples = buildLayoutSampleTimes({ duration, samples: opts.samples, at: opts.at });
    if (samples.length === 0) return { duration, samples, rawIssues: [] };

    await page.addScriptTag({ content: loadLayoutAuditScript() });

    const issues: LayoutIssue[] = [];
    for (const time of samples) {
      await seekTo(page, time);
      const sampleIssues = await page.evaluate(
        (auditOptions: { time: number; tolerance: number }) => {
          const win = window as unknown as {
            __hyperframesLayoutAudit?: (options: { time: number; tolerance: number }) => unknown[];
          };
          return win.__hyperframesLayoutAudit?.(auditOptions) ?? [];
        },
        { time, tolerance: opts.tolerance },
      );
      issues.push(...(sampleIssues as LayoutIssue[]));
    }

    return {
      duration,
      samples,
      rawIssues: dedupeLayoutIssues(issues),
    };
  } finally {
    await chromeBrowser?.close().catch(() => {});
    await server.close();
  }
}

function loadLayoutAuditScript(): string {
  const candidates = [
    join(__dirname, "layout-audit.browser.js"),
    join(__dirname, "commands", "layout-audit.browser.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  }

  throw new Error("Missing layout audit browser script");
}

function parseAt(value: unknown): number[] | undefined {
  if (!value) return undefined;
  const times = String(value)
    .split(",")
    .map((entry) => parseFloat(entry.trim()))
    .filter((time) => Number.isFinite(time) && time >= 0);
  return times.length > 0 ? times : undefined;
}

export function createInspectCommand(commandName: "inspect" | "layout") {
  return defineCommand({
    meta: {
      name: commandName,
      description: "Inspect rendered composition layout for text and container overflow",
    },
    args: {
      dir: { type: "positional", description: "Project directory", required: false },
      json: { type: "boolean", description: "Output agent-readable JSON", default: false },
      samples: {
        type: "string",
        description: "Number of midpoint samples across the duration (default: 9)",
        default: "9",
      },
      at: {
        type: "string",
        description: "Comma-separated timestamps in seconds (e.g., --at 1.5,4,7.25)",
      },
      tolerance: {
        type: "string",
        description: "Allowed pixel overflow before reporting an issue (default: 2)",
        default: "2",
      },
      timeout: {
        type: "string",
        description: "Ms to wait for runtime to initialize (default: 5000)",
        default: "5000",
      },
      "max-issues": {
        type: "string",
        description: "Maximum issues to print or return after static collapse (default: 80)",
        default: "80",
      },
      "collapse-static": {
        type: "boolean",
        description: "Collapse repeated static issues across samples (default: true)",
        default: true,
      },
      strict: {
        type: "boolean",
        description: "Exit non-zero on warnings too",
        default: false,
      },
    },
    async run({ args }) {
      const project = resolveProject(args.dir);
      const samples = Math.max(1, parseInt(args.samples as string, 10) || 9);
      const tolerance = Math.max(0, parseFloat(args.tolerance as string) || 2);
      const timeout = Math.max(500, parseInt(args.timeout as string, 10) || 5000);
      const maxIssues = Math.max(1, parseInt(args["max-issues"] as string, 10) || 80);
      const at = parseAt(args.at);
      const strict = !!args.strict;
      const collapseStatic = args["collapse-static"] !== false;

      if (!args.json) {
        const sampleLabel = at
          ? `${at.length} explicit timestamp(s)`
          : `${samples} timeline samples`;
        console.log(
          `${c.accent("◆")}  Inspecting layout for ${c.accent(project.name)} (${sampleLabel})`,
        );
      }

      try {
        const result = await runLayoutAudit(project.dir, {
          samples,
          at,
          timeout,
          tolerance,
        });
        const allIssues = collapseStatic
          ? collapseStaticLayoutIssues(result.rawIssues)
          : result.rawIssues;
        const limited = limitLayoutIssues(allIssues, maxIssues);
        const summary = summarizeLayoutIssues(allIssues);
        const ok = summary.errorCount === 0 && (!strict || summary.warningCount === 0);

        if (args.json) {
          console.log(
            JSON.stringify(
              withMeta({
                schemaVersion: INSPECT_SCHEMA_VERSION,
                duration: result.duration,
                samples: result.samples,
                tolerance,
                strict,
                collapseStatic,
                ...summary,
                totalIssueCount: limited.totalIssueCount,
                truncated: limited.truncated,
                ok,
                issues: limited.issues,
              }),
              null,
              2,
            ),
          );
          process.exit(ok ? 0 : 1);
        }

        if (result.samples.length === 0) {
          console.log();
          console.log(
            `${c.error("✗")} Could not determine composition duration — no layout samples run`,
          );
          process.exit(1);
        }

        console.log();
        if (limited.issues.length === 0) {
          console.log(
            `${c.success("◇")}  0 layout issues across ${result.samples.length} sample(s)`,
          );
          return;
        }

        for (const issue of limited.issues) {
          const icon =
            issue.severity === "error"
              ? c.error("✗")
              : issue.severity === "warning"
                ? c.warn("⚠")
                : c.dim("ℹ");
          const formatted = formatLayoutIssue(issue).replace(/\n/g, "\n    ");
          console.log(`  ${icon} ${c.dim(formatted)}`);
        }

        console.log();
        const parts = [
          `${summary.errorCount} error(s)`,
          `${summary.warningCount} warning(s)`,
          `${summary.infoCount} info(s)`,
        ];
        const suffix = limited.truncated ? c.dim(`, truncated at ${maxIssues} issue(s)`) : "";
        console.log(`${ok ? c.success("◇") : c.error("◇")}  ${parts.join(", ")}${suffix}`);

        process.exit(ok ? 0 : 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (args.json) {
          console.log(
            JSON.stringify(
              withMeta({
                schemaVersion: INSPECT_SCHEMA_VERSION,
                ok: false,
                error: message,
                issues: [],
                errorCount: 0,
                warningCount: 0,
                infoCount: 0,
                issueCount: 0,
              }),
              null,
              2,
            ),
          );
          process.exit(1);
        }
        console.error(`${c.error("✗")} Inspect failed: ${message}`);
        process.exit(1);
      }
    },
  });
}

export default createInspectCommand("layout");
