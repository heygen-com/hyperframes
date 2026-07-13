// The media-metadata wait exists twice on purpose: once Node-side and once
// inside a page.evaluate() body, which is serialized into the browser and
// cannot import the Node helper. Line-level markers don't survive the clone
// window drifting as the file is edited, hence the file-level suppression.
// fallow-ignore-file code-duplication
import { defineCommand } from "citty";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import type { ProjectLintResult } from "../utils/lintProject.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
import { c } from "../ui/colors.js";
import { printDeprecationNotice, withMeta } from "../utils/updateCheck.js";
import {
  installPageFunctionGuard,
  resolveCliChromeGpuMode,
  seekCompositionTimeline,
} from "../capture/captureCompositionFrame.js";

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
const PREFERRED_SEEK_TARGET_WAIT_MS = 500;
const MEDIA_EXTENSIONS = /\.(aac|flac|m4a|mov|mp3|mp4|oga|ogg|wav|webm)$/i;
// Floor for the initial page navigation. A blocking external <script> (GSAP
// from a CDN, etc.) delays `domcontentloaded`; the actual render (much larger
// budget) rides it out, so validate's navigation must be at least as patient as
// the user's --timeout, never stuck below this floor.
const NAV_TIMEOUT_FLOOR_MS = 10000;

// Navigation budget = the larger of the floor and the user's --timeout, so
// `--timeout` (already the "wait longer for slow loads" knob for media/settle)
// also extends navigation instead of being ignored by a hardcoded 10s.
export function resolveNavigationTimeoutMs(optTimeout?: number): number {
  return Math.max(NAV_TIMEOUT_FLOOR_MS, optTimeout ?? 0);
}

// Turn Puppeteer's opaque "Navigation timeout of Nms exceeded" into an
// actionable message: the usual cause is a blocking CDN <script> that render
// tolerates but validate's tighter budget does not. Returns a replacement Error
// for a navigation timeout, or null for any other error (caller rethrows as-is).
export function navigationTimeoutHint(err: unknown, navTimeoutMs: number): Error | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/navigation timeout/i.test(msg)) return null;
  return new Error(
    `Page navigation timed out after ${navTimeoutMs}ms. A blocking external <script> ` +
      `(e.g. GSAP loaded from a CDN) can delay page load past this budget even when the ` +
      `full render succeeds. Vendor the script locally (recommended for deterministic ` +
      `renders), or re-run with a longer --timeout.`,
  );
}

export function shouldIgnoreRequestFailure(
  url: string,
  errorText: string | undefined,
  resourceType?: string,
): boolean {
  if (errorText !== "net::ERR_ABORTED") return false;
  if (resourceType === "media") return true;
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

/**
 * Race a media element's `loadedmetadata`/`error` event against a deadline,
 * whichever comes first. Already-ready elements resolve immediately.
 *
 * This is the same wiring as the inline copy inside `auditClipDurations`'s
 * `page.evaluate()` below — duplicated, not imported, because Puppeteer
 * serializes that closure's source and re-runs it in an isolated browser
 * realm with no access to this module's scope. Kept here (duck-typed on
 * `EventTarget`-shaped objects, not `HTMLMediaElement`) so the actual
 * race/cleanup logic has a real, deterministic unit test — Node's built-in
 * `EventTarget` satisfies the same shape without a browser or DOM library.
 * If you change one copy, change both.
 */
export function raceMediaReady(
  el: EventTarget & { duration: number },
  deadlineMs: number,
): Promise<void> {
  if (Number.isFinite(el.duration) && el.duration > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onReady = () => {
      el.removeEventListener("loadedmetadata", onReady);
      el.removeEventListener("error", onReady);
      clearTimeout(timer);
      resolve();
    };
    el.addEventListener("loadedmetadata", onReady, { once: true });
    el.addEventListener("error", onReady, { once: true });
    const timer = setTimeout(onReady, Math.max(0, deadlineMs - Date.now()));
  });
}

/**
 * Flag `<video>`/`<audio>` clips whose source is meaningfully shorter than their
 * `data-duration` slot (the slot gets silently shortened in renders). Runs in
 * the live page to read each element's intrinsic `.duration`, which static lint
 * can't see.
 */
export async function auditClipDurations(
  page: import("puppeteer-core").Page,
  analyzeClipMediaFit: typeof import("@hyperframes/engine").analyzeClipMediaFit,
  extraWaitMs: number,
): Promise<ConsoleEntry[]> {
  // fallow-ignore-next-line complexity
  const clips = await page.evaluate(async (maxWaitMs: number) => {
    const nodes = Array.from(
      document.querySelectorAll("video[data-duration], audio[data-duration]"),
    ) as HTMLMediaElement[];

    // The caller's page-settle sleep is a flat, unconditional wait shared with
    // other audits — it isn't aware of how long any given media element takes
    // to load metadata. A slow-loading audio file (large narration WAV, remote
    // source) can still be mid-fetch when that sleep elapses, which read as
    // el.duration === NaN and was misreported as "could not read the duration"
    // even though the render pipeline (which properly awaits media readiness)
    // handles the same file fine. Give still-loading elements one more real
    // chance via loadedmetadata before giving up, instead of a single fixed-time
    // snapshot. Elements that already have a duration resolve immediately, so
    // this adds no latency in the common case.
    const deadline = Date.now() + maxWaitMs;
    await Promise.all(
      nodes.map((el) => {
        if (Number.isFinite(el.duration) && el.duration > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const cleanup = () => {
            el.removeEventListener("loadedmetadata", onReady);
            el.removeEventListener("error", onReady);
            clearTimeout(timer);
          };
          const onReady = () => {
            cleanup();
            resolve();
          };
          el.addEventListener("loadedmetadata", onReady, { once: true });
          el.addEventListener("error", onReady, { once: true });
          const timer = setTimeout(onReady, Math.max(0, deadline - Date.now()));
        });
      }),
    );

    const rows: Array<{
      id: string;
      kind: string;
      slot: number;
      mediaStart: number;
      duration: number;
      loop: boolean;
    }> = [];
    for (const el of nodes) {
      const slot = parseFloat(el.getAttribute("data-duration") ?? "");
      if (!(slot > 0)) continue;
      rows.push({
        id: el.id || el.getAttribute("src") || `(${el.tagName.toLowerCase()})`,
        kind: el.tagName === "AUDIO" ? "Audio" : "Video",
        slot,
        mediaStart: parseFloat(el.getAttribute("data-media-start") ?? "0") || 0,
        duration: el.duration,
        loop: el.loop || el.getAttribute("data-loop") === "true",
      });
    }
    return rows;
  }, extraWaitMs);

  const warnings: ConsoleEntry[] = [];
  const unreadable: string[] = [];
  for (const clip of clips) {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      // Metadata never loaded (e.g. slow remote source) — record so the gap in
      // coverage isn't silent, rather than dropping it.
      unreadable.push(clip.id);
      continue;
    }
    const mediaSeconds = Math.max(0, clip.duration - clip.mediaStart);
    const fit = analyzeClipMediaFit({ slotSeconds: clip.slot, mediaSeconds, loop: clip.loop });
    if (!fit) continue;
    warnings.push({
      level: "warning",
      text:
        `${clip.kind} "${clip.id}" is ${mediaSeconds.toFixed(2)}s but its slot (data-duration) ` +
        `is ${clip.slot.toFixed(2)}s — the slot is shortened to the media length when rendered. ` +
        `Set data-duration to ~${mediaSeconds.toFixed(2)}s if that isn't intended.`,
    });
  }
  if (unreadable.length > 0) {
    warnings.push({
      level: "warning",
      text:
        `Could not read the duration of ${unreadable.length} media element(s) within the ` +
        `validate timeout (${unreadable.join(", ")}); their slot vs. source fit was not checked. ` +
        `Re-run with a longer --timeout if the source is slow to load.`,
    });
  }
  return warnings;
}

interface ContrastCandidate {
  selector: string;
  text: string;
  fg: [number, number, number, number];
  fontSize: number;
  fontWeight: number;
  large: boolean;
  bbox: { x: number; y: number; w: number; h: number };
}

async function runContrastAudit(page: import("puppeteer-core").Page): Promise<ContrastEntry[]> {
  const duration = await getCompositionDuration(page);
  if (duration <= 0) return [];

  await page.addScriptTag({ content: loadContrastAuditScript() });

  const results: ContrastEntry[] = [];
  for (let i = 0; i < CONTRAST_SAMPLES; i++) {
    const t = +(((i + 0.5) / CONTRAST_SAMPLES) * duration).toFixed(3);
    await seekCompositionTimeline(page, t, {
      fallbackToBridgeAndTimelines: true,
      waitForPreferredSeekTargetMs: PREFERRED_SEEK_TARGET_WAIT_MS,
      animationFrameSettle: "none",
      settleMs: SEEK_SETTLE_MS,
    });

    try {
      // __contrastAuditPrepare() hides each candidate text element's own
      // paint (color/fill → transparent, layout-neutral) so this screenshot
      // captures the real pixels behind the glyphs — that's what
      // __contrastAuditFinish samples directly instead of a proximity-based
      // ring outside the text's bbox. See contrast-audit.browser.js for why:
      // it's robust to rounded pills, cross-component panel edges,
      // backdrop-filter blur, and partially-overlapping translucent
      // decoration in ways a ring isn't.
      //
      // This call is the FIRST statement inside the try — not before it —
      // so if prepare() itself throws partway through hiding elements, the
      // finally below still runs and restores whatever it managed to hide.
      const candidates = (await page.evaluate(() =>
        typeof (window as unknown as Record<string, unknown>).__contrastAuditPrepare === "function"
          ? (
              (window as unknown as Record<string, unknown>).__contrastAuditPrepare as () => unknown
            )()
          : [],
      )) as ContrastCandidate[];

      const screenshot = (await page.screenshot({ encoding: "base64", type: "png" })) as string;
      const entries = await page.evaluate(
        (b64: string, time: number, cands: ContrastCandidate[]) =>
          typeof (window as unknown as Record<string, unknown>).__contrastAuditFinish === "function"
            ? ((window as unknown as Record<string, unknown>).__contrastAuditFinish as Function)(
                b64,
                time,
                cands,
              )
            : [],
        screenshot,
        t,
        candidates,
      );
      results.push(...(entries as ContrastEntry[]));
    } finally {
      // If prepare(), the screenshot, or finish() above throws, this restores
      // any still-hidden text paint so the NEXT sample in the loop doesn't
      // audit a page with stale invisible elements. No-op after a normal
      // finish() call.
      await page.evaluate(() => {
        const restore = (window as unknown as Record<string, unknown>)
          .__contrastAuditRestoreIfPending;
        if (typeof restore === "function") (restore as () => void)();
      });
    }
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

/**
 * Pull the `missing_or_empty_sub_composition` lint findings out of a
 * `lintProject` result and shape them as `ConsoleEntry`s. Extracted as a
 * pure function so it's testable without a headless browser or a real
 * project directory — see validate.test.ts.
 */
export function extractCompositionErrorsFromLint(
  lintResult: Pick<ProjectLintResult, "results">,
): ConsoleEntry[] {
  return lintResult.results
    .flatMap((r) => r.result.findings)
    .filter((f) => f.code === "missing_or_empty_sub_composition" && f.severity === "error")
    .map((f) => ({ level: "error" as const, text: f.message }));
}

// Match the render pipeline: localize remote <img>/<video>/<audio>/@font-face
// into a temp dir (served as an extra asset root) so validate resolves them
// same-origin and doesn't false-fail on cross-origin (crossorigin/CORS) fetches
// the real render never makes. Best-effort: no-op on any failure.
async function localizeRemoteAssets(
  html: string,
): Promise<{ html: string; assetRoots: string[]; cleanup: () => void }> {
  let dir: string | undefined;
  try {
    const { loadProducer } = await import("../utils/producer.js");
    const { localizeRemoteMediaSources, localizeRemoteImageSources, localizeRemoteFontFaces } =
      await loadProducer();
    dir = mkdtempSync(join(tmpdir(), "hf-validate-assets-"));
    const assetDir = dir;
    const media = await localizeRemoteMediaSources(html, assetDir);
    const images = await localizeRemoteImageSources(media.html, assetDir);
    const fonts = await localizeRemoteFontFaces(images.html, assetDir);
    const count =
      media.remoteMediaAssets.size + images.remoteMediaAssets.size + fonts.remoteMediaAssets.size;
    return {
      html: fonts.html,
      assetRoots: count > 0 ? [assetDir] : [],
      cleanup: () => rmSync(assetDir, { recursive: true, force: true }),
    };
  } catch {
    // Best-effort: drop any partial temp dir before falling back to remote URLs.
    if (dir) rmSync(dir, { recursive: true, force: true });
    return { html, assetRoots: [], cleanup: () => {} };
  }
}

async function validateInBrowser(
  project: ProjectDir,
  opts: { timeout?: number; contrast?: boolean },
): Promise<{ errors: ConsoleEntry[]; warnings: ConsoleEntry[]; contrast?: ContrastEntry[] }> {
  const projectDir = project.dir;
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { ensureBrowser } = await import("../browser/manager.js");
  const { serveStaticProjectHtml } = await import("../utils/staticProjectServer.js");
  const { lintProject } = await import("../utils/lintProject.js");

  // Fail fast on missing/empty/unparsable data-composition-src references
  // before spending time bundling and launching a browser. The bundler
  // (bundleToSingleHtml → inlineSubCompositions) is intentionally tolerant of
  // these — it skips the broken scene and keeps going, silently, with only a
  // console.warn — so validate would otherwise report "No console errors"
  // for a project that renders a materially broken video. Surface it as a
  // real validate failure instead.
  const lintResult = await lintProject(projectDir);
  const compositionErrors = extractCompositionErrorsFromLint(lintResult);

  // `bundleToSingleHtml` now inlines the runtime IIFE by default, so the
  // previous post-bundle regex substitution (which matched `src="..."` on the
  // runtime tag) is no longer needed — there's no `src` attribute to match.
  const html = await bundleToSingleHtml(projectDir);

  const localized = await localizeRemoteAssets(html);
  const server = await serveStaticProjectHtml(
    projectDir,
    localized.html,
    undefined,
    localized.assetRoots,
  ).catch((err) => {
    // Server never started — the finally below won't run, so clean up here.
    localized.cleanup();
    throw err;
  });

  const errors: ConsoleEntry[] = [...compositionErrors];
  const warnings: ConsoleEntry[] = [];
  let contrast: ContrastEntry[] | undefined;
  const viewport = resolveCompositionViewportFromHtml(html);

  try {
    const browser = await ensureBrowser();
    const puppeteer = await import("puppeteer-core");
    const { buildChromeArgs, analyzeClipMediaFit } = await import("@hyperframes/engine");
    const chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: buildChromeArgs(
        { ...viewport, captureMode: "screenshot" },
        { browserGpuMode: resolveCliChromeGpuMode() },
      ),
    });

    const page = await chromeBrowser.newPage();
    await installPageFunctionGuard(page);
    await page.setViewport(viewport);

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
      const text = normalizeErrorMessage(err);
      // CDN scripts (e.g. GSAP from jsdelivr) returning HTML error pages
      // instead of JS produce "Unexpected token '<'" SyntaxErrors. These
      // are network failures, not composition authoring errors.
      if (text.includes("Unexpected token '<'") || text.includes("Unexpected token '&lt;'")) return;
      errors.push({ level: "error", text });
    });

    page.on("requestfailed", (req) => {
      const url = req.url();
      if (url.includes("favicon") || url.startsWith("data:")) return;
      const failureText = req.failure()?.errorText;
      if (shouldIgnoreRequestFailure(url, failureText, req.resourceType())) return;
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

    const navTimeoutMs = resolveNavigationTimeoutMs(opts.timeout);
    try {
      await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
    } catch (err) {
      const hinted = navigationTimeoutHint(err, navTimeoutMs);
      if (hinted) throw hinted;
      throw err;
    }
    await new Promise((r) => setTimeout(r, opts.timeout ?? 3000));

    for (const w of await auditClipDurations(page, analyzeClipMediaFit, opts.timeout ?? 3000)) {
      warnings.push(w);
    }

    if (opts.contrast) {
      contrast = await runContrastAudit(page);
    }

    await chromeBrowser.close();
  } finally {
    await server.close();
    localized.cleanup();
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

function emitJsonReport(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrast: ContrastEntry[] | undefined,
  contrastFailures: ContrastEntry[],
): void {
  console.log(
    JSON.stringify(
      withMeta(
        {
          ok: errors.length === 0,
          errors,
          warnings,
          contrast,
          contrastFailures: contrastFailures.length,
        },
        { deprecated: true },
      ),
      null,
      2,
    ),
  );
}

function formatConsoleEntry(prefix: string, e: ConsoleEntry): string {
  return `  ${prefix} ${e.text}${e.line ? c.dim(` (line ${e.line})`) : ""}`;
}

function formatTotals(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrastFailures: ContrastEntry[],
): string {
  const parts = [`${errors.length} error(s)`, `${warnings.length} warning(s)`];
  if (contrastFailures.length > 0) parts.push(`${contrastFailures.length} contrast warning(s)`);
  return parts.join(", ");
}

function emitTextReport(
  errors: ConsoleEntry[],
  warnings: ConsoleEntry[],
  contrastFailures: ContrastEntry[],
  contrastPassed: ContrastEntry[],
): void {
  const hasIssues = errors.length > 0 || warnings.length > 0 || contrastFailures.length > 0;
  if (!hasIssues) {
    const suffix =
      contrastPassed.length > 0 ? ` · ${contrastPassed.length} text elements pass WCAG AA` : "";
    console.log(`${c.success("◇")}  No console errors${suffix}`);
    return;
  }

  console.log();
  for (const e of errors) console.log(formatConsoleEntry(c.error("✗"), e));
  for (const w of warnings) console.log(formatConsoleEntry(c.warn("⚠"), w));
  if (contrastFailures.length > 0) printContrastFailures(contrastFailures);

  console.log();
  console.log(`${c.accent("◇")}  ${formatTotals(errors, warnings, contrastFailures)}`);
}

function emitFailureReport(message: string, asJson: boolean): void {
  if (asJson) {
    console.log(
      JSON.stringify(
        withMeta({ ok: false, error: message, errors: [], warnings: [] }, { deprecated: true }),
        null,
        2,
      ),
    );
    return;
  }
  console.error(`${c.error("✗")} ${message}`);
}

export default defineCommand({
  meta: {
    name: "validate",
    description: `Load a composition in headless Chrome and report console errors (deprecated, use check)

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
      description:
        "Ms to wait for scripts to settle and media to load (default: 3000). Also raises the " +
        "page-navigation budget above its 10s floor when a slow external <script> needs longer.",
      default: "3000",
    },
  },
  async run({ args }) {
    printDeprecationNotice("validate");
    const project = resolveProject(args.dir);
    const timeout = parseInt(args.timeout as string, 10) || 3000;
    const useContrast = args.contrast ?? true;
    const asJson = Boolean(args.json);

    if (!asJson) {
      console.log(`${c.accent("◆")}  Validating ${c.accent(project.name)} in headless Chrome`);
    }

    try {
      const result = await validateInBrowser(project, { timeout, contrast: useContrast });
      const exitCode = printValidationResult(result, asJson);
      process.exit(exitCode);
    } catch (err: unknown) {
      const message = normalizeErrorMessage(err);
      emitFailureReport(message, asJson);
      process.exit(1);
    }
  },
});

function printValidationResult(
  result: { errors: ConsoleEntry[]; warnings: ConsoleEntry[]; contrast?: ContrastEntry[] },
  asJson: boolean,
): number {
  const { errors, warnings, contrast } = result;
  const contrastFailures = (contrast ?? []).filter((e) => !e.wcagAA);
  const contrastPassed = (contrast ?? []).filter((e) => e.wcagAA);

  if (asJson) {
    emitJsonReport(errors, warnings, contrast, contrastFailures);
  } else {
    emitTextReport(errors, warnings, contrastFailures, contrastPassed);
  }
  return errors.length > 0 ? 1 : 0;
}
