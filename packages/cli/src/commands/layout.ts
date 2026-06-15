import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  buildLayoutSampleTimes,
  buildTransitionSampleTimes,
  collapseStaticLayoutIssues,
  dedupeLayoutIssues,
  formatLayoutIssue,
  limitLayoutIssues,
  mergeSampleTimes,
  summarizeLayoutIssues,
  type LayoutIssue,
} from "../utils/layoutAudit.js";
import {
  ambiguousIssue,
  collectSamplingTargets,
  evaluateMotion,
  type MotionFrame,
} from "../utils/motionAudit.js";
import { findMotionSpec, readMotionSpec, type MotionSpec } from "../utils/motionSpec.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEEK_SETTLE_MS = 120;
// All new envelope fields are optional (?); additive changes don't bump this.
const INSPECT_SCHEMA_VERSION = 1;
// Motion verification (#1437): dense sampling grid for the seeked-timeline checks.
const MOTION_FPS = 20;
const MOTION_MAX_SAMPLES = 300;

export const examples: Example[] = [
  ["Inspect visual layout across the current composition", "hyperframes layout"],
  ["Inspect a specific project", "hyperframes layout ./my-video"],
  ["Output agent-readable JSON", "hyperframes layout --json"],
  ["Use explicit hero-frame timestamps", "hyperframes layout --at 1.5,4.0,7.25"],
  [
    "Also sample at tween boundaries to catch transient overlaps",
    "hyperframes layout --at-transitions",
  ],
  [
    "Verify motion intent (add a *.motion.json sidecar next to the composition)",
    "hyperframes layout --json",
  ],
];

interface LayoutAuditResult {
  duration: number;
  samples: number[];
  transitionSamples: number[];
  transitionSamplesDropped: number;
  rawIssues: LayoutIssue[];
  motionSamples: number;
}

function buildMotionSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(MOTION_MAX_SAMPLES, Math.max(2, Math.ceil(duration * MOTION_FPS) + 1));
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step * 1000) / 1000);
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

async function waitForFonts(page: import("puppeteer-core").Page, timeoutMs: number): Promise<void> {
  await page
    .evaluate((ms: number) => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fonts?.ready) return Promise.resolve();
      return Promise.race([
        fonts.ready.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
      ]);
    }, timeoutMs)
    .catch(() => {});
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
  await waitForFonts(page, 500);
  await new Promise((resolveSettle) => setTimeout(resolveSettle, SEEK_SETTLE_MS));
}

/**
 * Collect every tween start/end boundary from the registered timelines,
 * expressed in the registered timeline's own time (what seekTo consumes).
 * GSAP-only: timelines without getChildren (Anime/Lottie/Three adapters) are
 * skipped. Nested tween times are converted by climbing the parent chain,
 * accounting for each ancestor's startTime and timeScale.
 */
async function collectTweenBoundaries(page: import("puppeteer-core").Page): Promise<number[]> {
  return page.evaluate(() => {
    type AnimLike = {
      startTime?: () => number;
      duration?: () => number;
      timeScale?: () => number;
      parent?: AnimLike | null;
      getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => AnimLike[];
    };

    // GSAP getters read internal state through `this`, so the method must be
    // invoked bound to its animation (an unbound call throws inside GSAP).
    const callOr = (fn: (() => number) | undefined, self: AnimLike, fallback: number): number =>
      typeof fn === "function" ? fn.call(self) : fallback;

    const toTimelineTime = (root: AnimLike, anim: AnimLike, localTime: number): number => {
      let time = localTime;
      let node: AnimLike | null | undefined = anim;
      while (node && node !== root) {
        time = callOr(node.startTime, node, 0) + time / (callOr(node.timeScale, node, 1) || 1);
        node = node.parent;
      }
      return time;
    };

    const tweenBoundaries = (root: AnimLike, tween: AnimLike): number[] => {
      if (typeof tween.duration !== "function") return [];
      const start = toTimelineTime(root, tween, 0);
      const end = toTimelineTime(root, tween, tween.duration());
      return [start, end].filter((time) => Number.isFinite(time));
    };

    const timelineBoundaries = (timeline: AnimLike): number[] => {
      try {
        const tweens = timeline.getChildren?.(true, true, false) ?? [];
        return tweens.flatMap((tween) => tweenBoundaries(timeline, tween));
      } catch {
        return [];
      }
    };

    const win = window as unknown as { __timelines?: Record<string, AnimLike> };
    return Object.values(win.__timelines ?? {}).flatMap(timelineBoundaries);
  });
}

async function bundleProjectHtml(projectDir: string): Promise<string> {
  // `bundleToSingleHtml` now inlines the runtime IIFE by default, so the
  // previous post-bundle runtime substitution is no longer needed.
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  return bundleToSingleHtml(projectDir);
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
  opts: {
    samples: number;
    at?: number[];
    atTransitions: boolean;
    maxTransitionSamples?: number;
    timeout: number;
    tolerance: number;
    motion?: MotionSpec;
  },
): Promise<LayoutAuditResult> {
  const { ensureBrowser } = await import("../browser/manager.js");
  const puppeteer = await import("puppeteer-core");
  const html = await bundleProjectHtml(projectDir);
  const server = await serveStaticProjectHtml(
    projectDir,
    html,
    "Failed to bind local layout audit server",
  );
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
    await waitForFonts(page, 750);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 250));

    const duration = await getCompositionDuration(page);
    const baseSamples = buildLayoutSampleTimes({ duration, samples: opts.samples, at: opts.at });
    let transitionSamples: number[] = [];
    let transitionSamplesDropped = 0;
    if (opts.atTransitions) {
      const boundaries = await collectTweenBoundaries(page);
      const transitions = buildTransitionSampleTimes({
        duration,
        boundaries,
        cap: opts.maxTransitionSamples,
      });
      transitionSamples = transitions.times;
      transitionSamplesDropped = transitions.dropped;
    }
    const samples = mergeSampleTimes(baseSamples, transitionSamples);

    const issues = await collectLayoutIssues(page, samples, opts.tolerance);

    let motionSamples = 0;
    if (opts.motion) {
      const motion = await runMotionPass(page, opts.motion, duration);
      issues.push(...motion.issues);
      motionSamples = motion.sampleCount;
    }

    return {
      duration,
      samples,
      transitionSamples,
      transitionSamplesDropped,
      rawIssues: dedupeLayoutIssues(issues),
      motionSamples,
    };
  } finally {
    await chromeBrowser?.close().catch(() => {});
    await server.close();
  }
}

function loadBrowserScript(name: string): string {
  const candidates = [join(__dirname, name), join(__dirname, "commands", name)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  }
  throw new Error(`Missing browser script ${name}`);
}

function loadLayoutAuditScript(): string {
  return loadBrowserScript("layout-audit.browser.js");
}

async function collectLayoutIssues(
  page: import("puppeteer-core").Page,
  samples: number[],
  tolerance: number,
): Promise<LayoutIssue[]> {
  if (samples.length === 0) return [];
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
      { time, tolerance },
    );
    issues.push(...(sampleIssues as LayoutIssue[]));
  }
  return issues;
}

/** Reject selectors matching multiple elements — first-match-only sampling silently passes for siblings. */
async function findAmbiguousSelectors(
  page: import("puppeteer-core").Page,
  selectors: string[],
): Promise<LayoutIssue[]> {
  if (selectors.length === 0) return [];
  const multiMatch = await page.evaluate(
    (sels: string[]) =>
      sels.filter((sel) => {
        try {
          return document.querySelectorAll(sel).length > 1;
        } catch {
          return false;
        }
      }),
    selectors,
  );
  return multiMatch.map(ambiguousIssue);
}

async function collectMotionFrames(
  page: import("puppeteer-core").Page,
  times: number[],
  selectors: string[],
  livenessScopes: string[],
): Promise<MotionFrame[]> {
  const frames: MotionFrame[] = [];
  for (const time of times) {
    await seekTo(page, time);
    const sample = await page.evaluate(
      (options: { selectors: string[]; livenessScopes: string[] }) => {
        const win = window as unknown as {
          __hyperframesMotionSample?: (o: { selectors: string[]; livenessScopes: string[] }) => {
            data: MotionFrame["data"];
            liveness: Record<string, string>;
          };
        };
        return win.__hyperframesMotionSample?.(options) ?? { data: {}, liveness: {} };
      },
      { selectors, livenessScopes },
    );
    frames.push({ time, data: sample.data, liveness: sample.liveness });
  }
  return frames;
}

/**
 * Motion verification (#1437): sample the asserted selectors on a dense grid
 * against the same seeked timeline the renderer uses, then evaluate the spec's
 * assertions in Node. Reuses the live page from the layout audit — no extra
 * Chrome launch. Findings reuse the LayoutIssue shape.
 */
async function runMotionPass(
  page: import("puppeteer-core").Page,
  spec: MotionSpec,
  duration: number,
): Promise<{ issues: LayoutIssue[]; sampleCount: number }> {
  const times = buildMotionSampleTimes(spec.duration ?? duration);
  if (times.length === 0) return { issues: [], sampleCount: 0 };

  const { selectors, livenessScopes } = collectSamplingTargets(spec.assertions);
  const ambiguous = await findAmbiguousSelectors(page, selectors);
  if (ambiguous.length > 0) return { issues: ambiguous, sampleCount: 0 };

  const canvas = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.addScriptTag({ content: loadBrowserScript("motion-sample.browser.js") });
  const frames = await collectMotionFrames(page, times, selectors, livenessScopes);
  return { issues: evaluateMotion(frames, spec.assertions, canvas), sampleCount: frames.length };
}

/** Read + validate the motion sidecar; print the error and exit on a bad spec. */
function resolveMotionSpec(specPath: string, json: boolean): MotionSpec {
  const parsed = readMotionSpec(specPath);
  if (parsed.ok) return parsed.spec;

  const message = `Invalid motion spec ${specPath}: ${parsed.errors.join("; ")}`;
  if (json) {
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
  } else {
    console.error(`${c.error("✗")} ${message}`);
  }
  process.exit(1);
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
      description:
        "Inspect rendered composition layout for text/container overflow, plus optional motion verification via a *.motion.json sidecar",
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
      "at-transitions": {
        type: "boolean",
        description:
          "Also sample at every tween start/end boundary (plus segment midpoints) to catch transient overlaps at transition seams",
        default: false,
      },
      "max-transition-samples": {
        type: "string",
        description:
          "Optional cap on transition-derived samples; when it truncates, the omitted count is reported (default: unlimited)",
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
      const atTransitions = !!args["at-transitions"];
      const maxTransitionSamplesRaw = parseInt(args["max-transition-samples"] as string, 10);
      const maxTransitionSamples =
        Number.isFinite(maxTransitionSamplesRaw) && maxTransitionSamplesRaw > 0
          ? maxTransitionSamplesRaw
          : undefined;
      const strict = !!args.strict;
      const collapseStatic = args["collapse-static"] !== false;

      // Motion verification (#1437): an optional `*.motion.json` sidecar opts the
      // composition into seeked-timeline assertion checks. Absent → layout-only.
      const motionSpecPath = findMotionSpec(project.dir);
      const motionSpec = motionSpecPath
        ? resolveMotionSpec(motionSpecPath, !!args.json)
        : undefined;

      if (!args.json) {
        const baseLabel = at ? `${at.length} explicit timestamp(s)` : `${samples} timeline samples`;
        const sampleLabel = atTransitions ? `${baseLabel} + transition boundaries` : baseLabel;
        const motionLabel = motionSpec
          ? ` + motion spec (${motionSpec.assertions.length} assertion(s))`
          : "";
        console.log(
          `${c.accent("◆")}  Inspecting layout for ${c.accent(project.name)} (${sampleLabel}${motionLabel})`,
        );
      }

      try {
        const result = await runLayoutAudit(project.dir, {
          samples,
          at,
          atTransitions,
          maxTransitionSamples,
          timeout,
          tolerance,
          motion: motionSpec,
        });
        if (!args.json && result.transitionSamplesDropped > 0) {
          console.log(
            `${c.warn("⚠")}  ${result.transitionSamplesDropped} transition sample(s) omitted by --max-transition-samples; raise or drop it to sample every boundary`,
          );
        }
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
                transitionSamples: atTransitions ? result.transitionSamples : undefined,
                transitionSamplesDropped: atTransitions
                  ? result.transitionSamplesDropped
                  : undefined,
                tolerance,
                strict,
                collapseStatic,
                motionSpec: motionSpec ? motionSpecPath : undefined,
                motionSamples: motionSpec ? result.motionSamples : undefined,
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
