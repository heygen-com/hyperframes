import type { CheckDeadline } from "./checkDeadline.js";
import { logCheckProgress } from "./checkProgress.js";
import { BrowserCleanupError, closeManagedBrowser, onStopSignal } from "../browser/launch.js";
import { collectMotionBlurDrafts, dropMotionBlurConsoleEcho } from "./checkMotionBlur.js";
import { checkSnapshotDirectory } from "./checkSnapshotDirectory.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import {
  AUDIT_SEEK_OPTIONS,
  DENSE_GEOMETRY_SEEK_OPTIONS,
  SCREENSHOT_SEEK_OPTIONS,
  DEFAULT_ZOOM_PADDING_PX,
  DEFAULT_ZOOM_SCALE,
  captureRegionCrop,
  openSettledCompositionPage,
  padCropRegion,
  resolveCliChromeGpuMode,
  seekCompositionTimeline,
  waitForPreferredSeekTarget,
  seekInPage,
  type PrelaunchedBrowser,
} from "../capture/captureCompositionFrame.js";
import {
  auditClipDurations,
  shouldIgnoreHttpError,
  shouldIgnoreRequestFailure,
} from "../commands/validate.js";
import { loadBrowserScript } from "../commands/layout.js";
import { normalizeErrorMessage } from "./errorMessage.js";
import { ambiguousIssue, type MotionFrame } from "./motionAudit.js";
import type { LayoutIssue, LayoutIssueCode, LayoutRect } from "./layoutAudit.js";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer.js";
import { prepareFindingInspector } from "./checkFindingInspect.js";
import { collectTweenRecords, findTweenTails, tweenTailMessage } from "./gsapTweenTails.js";
import {
  measuredInMotion,
  readContrastMotion,
  type ContrastMotionSample,
} from "./contrastMotion.js";
import { resolveAutoProxy } from "./projectConfig.js";
import { findStageProxyBox } from "./compositionViewport.js";
import type { PreviewProxyBox } from "@hyperframes/core";
import { injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import {
  STUDIO_PREVIEW_CAPTURE_MODE,
  STUDIO_PREVIEW_MARK_META,
} from "@hyperframes/core/studio-preview-mark";
import {
  decideMediaProxyEligibility,
  proxyVariantFor,
  scanProjectMediaCodecMap,
} from "@hyperframes/studio-server/media-codec-map";
import {
  FfmpegUnavailableError,
  getProxyCachePath,
  resolveProxies,
  type ProxyProgress,
} from "@hyperframes/studio-server/proxy-transcoder";
import { rectToBbox } from "./checkTypes.js";
import type {
  AnchoredLayoutIssue,
  CheckAnchor,
  CheckAnnotationBox,
  CheckAuditDriver,
  CheckBbox,
  CheckBrowserResult,
  CheckFinding,
  CheckFindingCropRequest,
  CheckFindingFrameRequest,
  CheckFindingFrames,
  CheckFindingInspection,
  CheckGeometryCandidate,
  CheckOptions,
  CheckSeverity,
  ContrastAuditEntry,
  ContrastCapture,
  CraftFilm,
  CraftFrame,
  CraftTextPart,
  GeometryCandidateRequest,
  LayoutOptions,
  MotionSpecResolution,
  OffPivotFrame,
  OffPivotRotationSample,
  RotationSample,
  RunAuditGrid,
  SeekClock,
} from "./checkTypes.js";
import type { ProjectDir } from "./project.js";

interface RuntimeDraft {
  code: string;
  severity: CheckSeverity;
  message: string;
  time: number;
  timeRange?: [number, number];
  url?: string;
  line?: number;
  count?: number;
  abortedImage?: boolean;
  networkChanged?: boolean;
  fixHint?: string;
}

type RuntimeStamp = Pick<RuntimeDraft, "time" | "timeRange">;

interface RuntimeClock {
  now(): RuntimeStamp;
  at(time: number): void;
  during(range: [number, number]): void;
}

interface AnchorRequest {
  selector: string;
  time: number;
  bbox: CheckBbox;
}

interface ContrastCandidate {
  selector: string;
  text: string;
  fg: [number, number, number, number];
  large: boolean;
  bbox: CheckBbox;
}

interface PreparedContrast {
  // The untouched candidate object from __contrastAuditPrepare. It round-trips
  // back into __contrastAuditFinish verbatim — the browser script owns its
  // shape (e.g. bbox uses w/h, not width/height), so Node must not normalize
  // what it sends back. `candidate` is the parsed copy for Node-side reporting.
  raw: unknown;
  candidate: ContrastCandidate;
  knownBackdrop: boolean;
  anchor: CheckAnchor;
  motion: ContrastMotionSample | null;
}

interface FinishedContrast {
  selector: string;
  text: string;
  ratio: number;
  wcagAA: boolean;
  large: boolean;
  fg: string;
  bg: string;
}

const COPY_HEARTBEAT_MS = 10_000;

function elapsedText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Says on stderr how far each copy is, so a slow copy reads as slow and a stuck one as stuck. */
function startCopyHeartbeat(
  sources: ReadonlyArray<{ file: string }>,
  cached: readonly boolean[],
): {
  progress: (index: number, progress: ProxyProgress) => void;
  settled: (index: number) => void;
  stop: () => void;
} {
  const startedAt = Date.now();
  const latest = new Map<number, ProxyProgress>();
  const total = cached.filter((isCached) => !isCached).length;
  let finished = 0;
  const timer = setInterval(() => {
    for (const [index, { doneSeconds, totalSeconds }] of latest) {
      if (cached[index]) continue;
      const done = totalSeconds
        ? `${Math.min(100, Math.floor((doneSeconds / totalSeconds) * 100))}%`
        : "";
      console.error(
        `[hyperframes] making browser-playable copies: ${finished} of ${total} done. ${sources[index]!.file}: ${done || `${Math.floor(doneSeconds)}s done`} (${elapsedText(Date.now() - startedAt)} so far)`,
      );
    }
  }, COPY_HEARTBEAT_MS);
  timer.unref();
  return {
    progress: (index, progress) => void latest.set(index, progress),
    settled: (index) => {
      latest.delete(index);
      if (!cached[index]) finished += 1;
    },
    stop: () => clearInterval(timer),
  };
}

/**
 * Awaits the H.264 authoring proxy for every browser-hostile local video
 * asset in `html` BEFORE the timed render-ready wait starts. `check`'s
 * render-ready wait defaults to 3000ms (`DEFAULT_CHECK_OPTIONS.timeout`,
 * passed through as `renderReadyTimeoutMs`), and a cold `.transcode-cache`
 * cannot fit inside that window — without this, a project's first
 * hostile-asset check (e.g. a fresh CI checkout) would race the timeout
 * instead of paying a bounded one-time transcode cost
 * (docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md, unit U4).
 * A failed copy is a warning, not an error: a default render decodes the original with
 * ffmpeg. One warning per failed file, or one for all of them when ffmpeg itself is unusable.
 */
export async function preResolveHostileMediaProxies(
  projectDir: string,
  html: string,
  autoProxyOverride?: boolean,
): Promise<ProxyPreResolution> {
  const none: ProxyPreResolution = { findings: [], failedPaths: new Set(), files: [] };
  if (!resolveAutoProxy(projectDir, autoProxyOverride)) return none;
  let codecMap: Awaited<ReturnType<typeof scanProjectMediaCodecMap>>;
  try {
    codecMap = await scanProjectMediaCodecMap(projectDir, [{ html }]);
  } catch (err) {
    console.error(
      `[hyperframes] media proxy pre-resolve: scan failed (${normalizeErrorMessage(err)})`,
    );
    return none;
  }
  const hostileEntries = Object.entries(codecMap).filter(
    ([, facts]) => decideMediaProxyEligibility(facts).eligible,
  );
  if (hostileEntries.length === 0) return none;

  const startedAt = Date.now();
  const stageBox = findStageProxyBox(html);
  const sources = hostileEntries.map(([pathname, facts]) => {
    const file = pathname.replace(/^\/+/, "");
    return {
      pathname,
      file,
      sourcePath: resolve(projectDir, file),
      variant: proxyVariantFor(facts),
      box: stageBox,
    };
  });
  const total = hostileEntries.length;
  const cached = sources.map((source) => proxyCached(projectDir, source));
  const toMake = cached.filter((isCached) => !isCached).length;
  if (toMake > 0) {
    console.error(
      `[hyperframes] Making browser-playable copies of ${toMake} video${toMake === 1 ? "" : "s"} Chrome cannot decode. Only the first check of these files waits for this; later checks reuse the copies.`,
    );
  }
  let settled = 0;
  const heartbeat = startCopyHeartbeat(sources, cached);
  const stopped = new AbortController();
  const forgetStop = onStopSignal(() => stopped.abort());
  const results = await resolveProxies(
    projectDir,
    sources,
    (index) => {
      settled += 1;
      heartbeat.settled(index);
      if (toMake > 0) console.error(`[hyperframes] browser-playable copies: ${settled}/${total}`);
    },
    heartbeat.progress,
    stopped.signal,
  ).finally(() => {
    heartbeat.stop();
    forgetStop();
  });
  const failures = sources.flatMap((source, index) => {
    const result = results[index]!;
    return result.status === "rejected" ? [{ ...source, reason: result.reason }] : [];
  });
  console.error(
    `[hyperframes] media proxy pre-resolve: ${total - failures.length}/${total} ready, ${failures.length} failed (${Date.now() - startedAt}ms)`,
  );
  const unusableFfmpeg = failures.filter(({ reason }) => reason instanceof FfmpegUnavailableError);
  const findings = failures
    .filter(({ reason }) => !(reason instanceof FfmpegUnavailableError))
    .map(({ file, reason }) =>
      proxyFailedDraft(
        `Could not make a browser-playable copy of ${file}: ${normalizeErrorMessage(reason)}. A default render decodes the original with ffmpeg and does not need it, but publish stops on it (unless run with --no-proxy) and a browser that cannot decode the original will not play it in preview.`,
      ),
    );
  if (unusableFfmpeg[0]) {
    findings.unshift(
      proxyFailedDraft(
        `Could not make browser-playable copies of ${unusableFfmpeg.map(({ file }) => file).join(", ")}: ${normalizeErrorMessage(unusableFfmpeg[0].reason)}. Publish stops on them (unless run with --no-proxy) and a browser that cannot decode them will not play them in preview.`,
      ),
    );
  }
  const files = sources.map(({ file }, index): PreparedMediaFile => {
    const result = results[index]!;
    if (result.status === "rejected") {
      return { file, state: "failed", reason: normalizeErrorMessage(result.reason) };
    }
    return { file, state: cached[index] ? "cached" : "ready" };
  });
  return { findings, failedPaths: new Set(failures.map(({ pathname }) => pathname)), files };
}

function proxyCached(
  projectDir: string,
  source: {
    sourcePath: string;
    variant: ReturnType<typeof proxyVariantFor>;
    box?: PreviewProxyBox;
  },
): boolean {
  try {
    return existsSync(getProxyCachePath(projectDir, source.sourcePath, source.variant, source.box));
  } catch {
    return false;
  }
}

export interface PreparedMediaFile {
  file: string;
  state: "ready" | "cached" | "failed";
  reason?: string;
}

interface ProxyPreResolution {
  findings: RuntimeDraft[];
  /** Root-relative paths of the videos whose copy failed. */
  failedPaths: Set<string>;
  /** One entry per browser-hostile video, in project order. */
  files: PreparedMediaFile[];
}

function proxyFailedDraft(message: string): RuntimeDraft {
  return { code: "media_proxy_failed", severity: "warning", message, time: 0 };
}

async function loadCheckHtmlWithDeferredMedia(dir: string): Promise<string> {
  const { bundleWithLocalizedFonts } = await import("./bundleWithLocalizedFonts.js");
  return withCapturePreviewMark(await bundleWithLocalizedFonts(dir));
}

function withCapturePreviewMark(html: string): string {
  return injectTagsAtHeadStart(
    html,
    `<meta name="${STUDIO_PREVIEW_MARK_META}" content="${STUDIO_PREVIEW_CAPTURE_MODE}">`,
  );
}

export async function runBrowserCheck(
  project: ProjectDir,
  options: CheckOptions,
  motion: MotionSpecResolution,
  runGrid: RunAuditGrid,
  deadline?: CheckDeadline,
  prelaunched?: PrelaunchedBrowser,
): Promise<CheckBrowserResult> {
  const html = await loadCheckHtmlWithDeferredMedia(project.dir);
  deadline?.enter("copies");
  const { findings: drafts, failedPaths } = await preResolveHostileMediaProxies(
    project.dir,
    html,
    options.autoProxy,
  );
  deadline?.enter("launch");
  const server = await serveStaticProjectHtml(
    project.dir,
    html,
    "Failed to bind check server",
    [],
    options.autoProxy,
  );
  const clock = createRuntimeClock();
  let failure: { kind: "none" } | { kind: "failed"; error: unknown } = { kind: "none" };
  let chromeBrowser: import("puppeteer-core").Browser | undefined;
  const helperSession =
    samplingBrowserCount(options) > 1
      ? startHelperSession(html, server.url, options, deadline)
      : undefined;
  const helperOpen = helperSession?.opened;
  const helpers = helperOpen?.then(
    (helper) => [helper.driver],
    () => [],
  );

  try {
    const launchSettleStart = Date.now();
    const session = await openSettledCompositionPage(html, server.url, {
      navigationTimeoutMs: options.timeout,
      renderReadyTimeoutMs: options.timeout,
      renderReadyWarningSuffix:
        "the scene may still be building, so results can miss late content; raise --timeout (for example 20s)",
      prelaunched,
      browserGpuMode: options.browserGpuMode ?? resolveCliChromeGpuMode(),
      signal: deadline?.signal,
      onBrowser: deadline?.ownBrowser,
      onBrowserReady: deadline?.start,
      beforeNavigate: async (page) => {
        wireRuntimeListeners(page, drafts, clock);
        await deadline?.preparePage(page);
      },
      onLoaded: () => deadline?.enter("settle"),
    });
    chromeBrowser = session.browser;
    const page = session.page;
    await waitForPreferredSeekTarget(page);

    const rootAnchor = await resolveRootAnchor(page);
    deadline?.keepPartial(() => ({
      runtimeFindings: dropFailedProxyEchoes(
        keepFailedNetworkChanges(keepBrokenImageAborts(drafts, new Set()), new Set()),
        failedPaths,
      ).map((draft) => runtimeFinding(draft, rootAnchor)),
    }));
    const launchSettleMs = Date.now() - launchSettleStart;
    // validate's per-media-element audit, kept in the consolidation: a clip
    // whose intrinsic duration is meaningfully shorter than its data-duration
    // slot silently shortens the slot at render time — invisible to lint (no
    // intrinsic durations statically) and to the runtime listeners (nothing
    // errors). The session is already open, so this is one extra evaluate.
    const { analyzeClipMediaFit } = await import("@hyperframes/engine");
    for (const entry of await auditClipDurations(page, analyzeClipMediaFit, options.timeout)) {
      drafts.push({ code: "clip_media_fit", severity: entry.level, message: entry.text, time: 0 });
    }
    for (const tail of findTweenTails((await page.evaluate(collectTweenRecords)) ?? [])) {
      const message = tweenTailMessage(tail);
      drafts.push({ code: "gsap_tween_tail", severity: "warning", message, time: tail.later.end });
    }
    const blur = await collectMotionBlurDrafts(page);
    drafts.push(...blur);
    const sampleLog = sampleWindow(drafts);
    const driver = createPageDriver(page, clock, sampleLog);
    const result = await runGrid(
      driver,
      options,
      motion,
      helpers,
      deadline?.enter,
      logCheckProgress,
      deadline?.keepPartial,
    );
    helperSession?.stop();
    const helper = await helperOpen?.catch(() => undefined);
    const merged = helper ? mergeHelperDrafts(sampleLog, helper.sampleLog) : drafts;
    const broken = await abortedImagesStillBroken(page, merged);
    const unreachable = await networkChangesStillFailing(merged);
    return {
      ...result,
      timings: { ...result.timings, launchSettleMs },
      renderReadyTimedOut: session.renderReadyTimedOut,
      runtimeFindings: dropFailedProxyEchoes(
        dropMotionBlurConsoleEcho(
          keepFailedNetworkChanges(keepBrokenImageAborts(merged, broken), unreachable),
          blur,
        ),
        failedPaths,
      ).map((draft) => runtimeFinding(draft, rootAnchor)),
    };
  } catch (error) {
    failure = { kind: "failed", error };
    throw error;
  } finally {
    helperSession?.stop();
    await helperOpen?.catch(() => undefined);
    await closeCheckResources([chromeBrowser, helperSession?.browser()], server, failure);
  }
}

function createRuntimeClock(): RuntimeClock {
  let stamp: RuntimeStamp = { time: 0 };
  return {
    now: () => stamp,
    at: (time) => {
      stamp = { time };
    },
    during: (range) => {
      stamp = { time: range[0], timeRange: range };
    },
  };
}

const SAMPLING_BROWSER_BYTES = 250 * 1024 * 1024;

/** Chromes the sample grid splits over: one per spare core and 250 MB free (a container's limit counts), at most 2. */
export function samplingBrowserCount(
  options: CheckOptions,
  cores = os.availableParallelism(),
  free = Math.min(os.freemem(), process.availableMemory()),
): number {
  if (options.at?.length === 1) return 1;
  return Math.max(1, Math.min(2, cores - 1, Math.floor(free / SAMPLING_BROWSER_BYTES)));
}

interface SampleWindow {
  drafts: RuntimeDraft[];
  start: number;
  end: number;
}

function sampleWindow(drafts: RuntimeDraft[]): SampleWindow {
  return { drafts, start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY };
}

interface HelperSession {
  driver: CheckAuditDriver;
  sampleLog: SampleWindow;
}

/** Opens the helper Chrome; stop() cancels an open still in flight and closes it, once its pages are unused. */
function startHelperSession(
  html: string,
  url: string,
  options: CheckOptions,
  deadline: CheckDeadline | undefined,
) {
  const abort = new AbortController();
  let browser: Browser | undefined;
  const opened = openHelperSession(html, url, options, deadline, {
    signal: deadline ? AbortSignal.any([deadline.signal, abort.signal]) : abort.signal,
    onBrowser: (launched) => {
      browser = launched;
      deadline?.ownBrowser(launched);
    },
  });
  return {
    opened,
    browser: () => browser,
    stop: () => {
      abort.abort();
      // The close is shared, so the check's cleanup awaits this same close and reports its error.
      if (browser) void closeManagedBrowser(browser).catch(() => undefined);
    },
  };
}

async function openHelperSession(
  html: string,
  url: string,
  options: CheckOptions,
  deadline: CheckDeadline | undefined,
  owner: { signal: AbortSignal; onBrowser: (browser: Browser) => void },
): Promise<HelperSession> {
  const sampleLog = sampleWindow([]);
  const clock = createRuntimeClock();
  const session = await openSettledCompositionPage(html, url, {
    navigationTimeoutMs: options.timeout,
    renderReadyTimeoutMs: options.timeout,
    renderReadyWarningSuffix:
      "the scene may still be building, so results can miss late content; raise --timeout (for example 20s)",
    browserGpuMode: options.browserGpuMode ?? resolveCliChromeGpuMode(),
    signal: owner.signal,
    onBrowser: owner.onBrowser,
    beforeNavigate: async (page) => {
      wireRuntimeListeners(page, sampleLog.drafts, clock);
      await deadline?.preparePage(page);
    },
  });
  await waitForPreferredSeekTarget(session.page);
  return {
    driver: createPageDriver(session.page, clock, sampleLog),
    sampleLog,
  };
}

const draftKey = (draft: RuntimeDraft) => `${draft.code} ${draft.time} ${draft.message}`;

/**
 * The first page's drafts with the helper's sample-loop drafts merged in by time, as one page seeking every
 * sample would have logged them; the helper's load is the first page's, and what both logged at one time counts once.
 */
export function mergeHelperDrafts(primary: SampleWindow, helper: SampleWindow): RuntimeDraft[] {
  const window = ({ drafts, start, end }: SampleWindow) =>
    drafts.slice(Math.min(start, drafts.length), Math.min(end, drafts.length));
  const own = window(primary);
  const seen = new Set(own.map(draftKey));
  const extra = window(helper).filter((draft) => !seen.has(draftKey(draft)));
  const start = Math.min(primary.start, primary.drafts.length);
  return [
    ...primary.drafts.slice(0, start),
    ...[...own, ...extra].sort((a, b) => a.time - b.time),
    ...primary.drafts.slice(start + own.length),
  ];
}

/**
 * `check --snapshots`'s per-finding evidence crops. Opens its own session
 * (the main grid session already closed by the time findings are shaped) and
 * re-seeks to each finding's sample time — renders are deterministic, so a
 * fresh page at the same time reproduces the same pixels the grid audited.
 */
export async function captureFindingCrops(
  project: ProjectDir,
  options: CheckOptions,
  requests: CheckFindingCropRequest[],
  deadline?: CheckDeadline,
): Promise<string[]> {
  if (requests.length === 0) return [];
  return withFindingCapturePage(project, options, deadline, "crops", async (page, snapshotDir) => {
    const written: string[] = [];
    for (const request of requests) {
      await seekCompositionTimeline(page, request.time, SCREENSHOT_SEEK_OPTIONS);
      const canvas = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      const region = padCropRegion(request.bbox, canvas, DEFAULT_ZOOM_PADDING_PX);
      const buffer = await captureRegionCrop(page, region, DEFAULT_ZOOM_SCALE);
      writeFileSync(join(snapshotDir, request.filename), buffer);
      written.push(join(snapshotDir, request.filename));
    }
    return written;
  });
}

export async function captureFindingFrames(
  project: ProjectDir,
  options: CheckOptions,
  requests: CheckFindingFrameRequest[],
  deadline?: CheckDeadline,
): Promise<CheckFindingFrames> {
  if (requests.length === 0) return { written: [], inspected: [] };
  const inspector = requests.some((request) => request.inspect?.length)
    ? await prepareFindingInspector(project.dir, async (bundleOptions) => {
        const { bundleWithLocalizedFonts } = await import("./bundleWithLocalizedFonts.js");
        return withCapturePreviewMark(
          await bundleWithLocalizedFonts(project.dir, undefined, bundleOptions),
        );
      })
    : undefined;
  deadline?.signal.throwIfAborted();
  return withFindingCapturePage(
    project,
    options,
    deadline,
    "frames",
    async (page, snapshotDir, server) => {
      await inspector?.ready(server);
      deadline?.signal.throwIfAborted();
      const written: string[] = [];
      const inspected: CheckFindingInspection[] = [];
      for (const request of requests) {
        deadline?.enter("frames");
        await seekCompositionTimeline(page, request.time, SCREENSHOT_SEEK_OPTIONS);
        const buffer = await page.screenshot({ type: "png", optimizeForSpeed: true });
        writeFileSync(join(snapshotDir, request.filename), buffer);
        written.push(join(snapshotDir, request.filename));
        if (!inspector) continue;
        for (const target of request.inspect ?? []) {
          deadline?.enter("frames");
          const inspect = await inspector.inspect(page, target);
          deadline?.signal.throwIfAborted();
          inspected.push({ time: request.time, target, inspect });
        }
      }
      return { written, inspected };
    },
    inspector?.html,
  );
}

async function withFindingCapturePage<T>(
  project: ProjectDir,
  options: CheckOptions,
  deadline: CheckDeadline | undefined,
  what: "crops" | "frames",
  capture: (page: Page, snapshotDir: string, server: StaticProjectServer) => Promise<T>,
  pageHtml?: string,
): Promise<T> {
  const html = pageHtml ?? (await loadCheckHtmlWithDeferredMedia(project.dir));
  const server = await serveStaticProjectHtml(
    project.dir,
    html,
    "Failed to bind check server",
    [],
    options.autoProxy,
  );
  let chromeBrowser: import("puppeteer-core").Browser | undefined;
  let failure: { kind: "none" } | { kind: "failed"; error: unknown } = { kind: "none" };
  try {
    const session = await openSettledCompositionPage(html, server.url, {
      navigationTimeoutMs: options.timeout,
      renderReadyTimeoutMs: options.timeout,
      renderReadyWarningSuffix: `capturing finding ${what}`,
      signal: deadline?.signal,
      onBrowser: deadline?.ownBrowser,
      onBrowserReady: deadline?.start,
      beforeNavigate: (page) => deadline?.preparePage(page),
      browserGpuMode: options.browserGpuMode ?? resolveCliChromeGpuMode(),
    });
    chromeBrowser = session.browser;
    await waitForPreferredSeekTarget(session.page);
    const snapshotDir = checkSnapshotDirectory(project.dir);
    mkdirSync(snapshotDir, { recursive: true });
    return await capture(session.page, snapshotDir, server);
  } catch (error) {
    failure = { kind: "failed", error };
    throw error;
  } finally {
    await closeCheckResources([chromeBrowser], server, failure);
  }
}

async function closeCheckResources(
  browsers: (Browser | undefined)[],
  server: { close(): Promise<void> },
  failure: { kind: "none" } | { kind: "failed"; error: unknown },
): Promise<void> {
  const cleanup = await Promise.allSettled([
    ...browsers.map((browser) => (browser ? closeManagedBrowser(browser) : Promise.resolve())),
    server.close(),
  ]);
  const errors = cleanup
    .filter((entry) => entry.status === "rejected")
    .map((entry) => entry.reason);
  if (errors.length === 0) return;
  if (failure.kind === "failed") errors.unshift(failure.error);
  throw new BrowserCleanupError(errors, errors.map(normalizeErrorMessage).join("; "));
}

// `swapToProxy` / `emitUnavailableDiagnostic` (packages/core/src/runtime/
// mediaProxy.ts) embed their stable diagnostic codes in the console.info line
// precisely so this scraper can match a token instead of prose. Matching the
// shared "runtime_media_proxy_" prefix surfaces both codes; only those
// runtime-emitted info lines should ever become findings here — an ordinary
// `console.info` from a composition author's own script must not.
const MEDIA_PROXY_MARKER_PREFIX = "[hyperframes] runtime_media_proxy_";
const MEDIA_PROXY_UNAVAILABLE_MARKER = "[hyperframes] runtime_media_proxy_unavailable";
// `reportWebAudioMediaRoute` (packages/core/src/runtime/webAudioRoute.ts) uses
// the same code-in-the-console-line contract. It is emitted from the media
// DISCOVERY phase rather than from playback scheduling, precisely so this
// scraper can see it — `check` seeks, it never plays.
const WEB_AUDIO_BYPASS_MARKER = "[hyperframes] runtime_web_audio_bypass";
const WEBGPU_RUNTIME_FAILURE =
  /\b(?:GPUValidationError|GPUOutOfMemoryError|GPUInternalError)\b|WebGPU uncaptured error|(?:destroyed\b.*\b(?:GPU )?(?:resource|buffer|texture)\b.*\bsubmit)|(?:(?:GPU )?(?:resource|buffer|texture)\b.*\bdestroyed\b.*\bsubmit)/i;

function isWebGpuRuntimeFailure(text: string): boolean {
  return WEBGPU_RUNTIME_FAILURE.test(text);
}

function pushRuntimeDraft(drafts: RuntimeDraft[], draft: RuntimeDraft): void {
  if (draft.code !== "webgpu_runtime_error") {
    drafts.push(draft);
    return;
  }
  const duplicate = drafts.find(
    (entry) =>
      entry.code === draft.code &&
      entry.message === draft.message &&
      entry.url === draft.url &&
      entry.line === draft.line,
  );
  if (duplicate) {
    duplicate.count = (duplicate.count ?? 1) + 1;
    return;
  }
  drafts.push({ ...draft, count: 1 });
}

/**
 * The finding code for a runtime-emitted `console.info` line, or null for the
 * ordinary info logging a composition author's own script produces. Matching is
 * prefix-anchored on the stable diagnostic codes the runtime deliberately embeds
 * in the text, so a line that merely mentions one is not promoted.
 */
function runtimeInfoFindingCode(text: string): string | null {
  if (text.startsWith(WEB_AUDIO_BYPASS_MARKER)) return "web_audio_bypass";
  if (!text.startsWith(MEDIA_PROXY_MARKER_PREFIX)) return null;
  return text.includes(MEDIA_PROXY_UNAVAILABLE_MARKER)
    ? "media_proxy_unavailable"
    : "media_proxy_fallback";
}

function wireRuntimeListeners(page: Page, drafts: RuntimeDraft[], clock: RuntimeClock): void {
  followSampleTimeMarkers(page, clock.at);
  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();
    if (type === "error" && !text.startsWith("Failed to load resource")) {
      const location = message.location();
      pushRuntimeDraft(drafts, {
        code: "console_error",
        severity: "error",
        message: text,
        ...clock.now(),
        url: location.url,
        line: location.lineNumber,
      });
    } else if (type === "warn") {
      const location = message.location();
      const webGpuFailure = isWebGpuRuntimeFailure(text);
      pushRuntimeDraft(drafts, {
        code: webGpuFailure ? "webgpu_runtime_error" : "console_warning",
        severity: webGpuFailure ? "error" : "warning",
        message: text,
        ...clock.now(),
        url: location.url,
        line: location.lineNumber,
      });
    } else if (type === "info") {
      const code = runtimeInfoFindingCode(text);
      if (!code) return;
      const location = message.location();
      pushRuntimeDraft(drafts, {
        code,
        severity: "info",
        message: text,
        ...clock.now(),
        url: location.url,
        line: location.lineNumber,
      });
    }
  });
  page.on("pageerror", (error) => {
    const message = normalizeErrorMessage(error);
    if (message.includes("Unexpected token '<'") || message.includes("Unexpected token '&lt;'")) {
      return;
    }
    pushRuntimeDraft(drafts, {
      code: "page_error",
      severity: "error",
      message,
      ...clock.now(),
    });
  });
  wireNetworkListeners(page, drafts, clock);
}

export function keepFailedNetworkChanges(
  drafts: RuntimeDraft[],
  failing: Set<string>,
): RuntimeDraft[] {
  return drafts.filter((draft) => !draft.networkChanged || failing.has(draft.url ?? ""));
}

/** Check's scrubs cancel image loads: an aborted image failed only if an `<img>` shows it and its decode fails. */
export function keepBrokenImageAborts(drafts: RuntimeDraft[], broken: Set<string>): RuntimeDraft[] {
  return drafts.filter((draft) => !draft.abortedImage || broken.has(draft.url ?? ""));
}

/** One finding per failed proxy: the preview's own 502s and swap notes for that file repeat `media_proxy_failed`. */
export function dropFailedProxyEchoes(
  drafts: RuntimeDraft[],
  failedPaths: ReadonlySet<string>,
): RuntimeDraft[] {
  if (failedPaths.size === 0) return drafts;
  return drafts.filter((draft) => !failedPaths.has(proxyEchoPath(draft) ?? ""));
}

function proxyEchoPath(draft: RuntimeDraft): string | undefined {
  if (draft.code === "http_error" || draft.code === "request_failed") {
    const url = parseUrl(draft.url);
    return url?.searchParams.has("hf-proxy") ? decodedPath(url) : undefined;
  }
  if (draft.code === "media_proxy_fallback" || draft.code === "media_proxy_unavailable") {
    return decodedPath(parseUrl(/"([^"]+)"/.exec(draft.message)?.[1]));
  }
  return undefined;
}

function parseUrl(target: string | undefined): URL | undefined {
  if (!target) return undefined;
  try {
    return new URL(target, "http://check.invalid/");
  } catch {
    return undefined;
  }
}

function decodedPath(url: URL | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
}

const IMAGE_DECODE_CAP_MS = 5000;

export async function networkChangesStillFailing(drafts: RuntimeDraft[]): Promise<Set<string>> {
  const urls = [
    ...new Set(drafts.filter((draft) => draft.networkChanged).map((draft) => draft.url ?? "")),
  ];
  const failing = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return response.status >= 400;
      } catch {
        return true;
      }
    }),
  );
  return new Set(urls.filter((_, i) => failing[i]));
}

async function abortedImagesStillBroken(page: Page, drafts: RuntimeDraft[]): Promise<Set<string>> {
  const urls = drafts.filter((draft) => draft.abortedImage).map((draft) => draft.url ?? "");
  if (urls.length === 0) return new Set();
  const broken = await page.evaluate(
    async (candidates: string[], capMs: number) => {
      // A load still pending at the cap (a deferred lazy image) is not a failure.
      const fails = (img: HTMLImageElement) =>
        new Promise<boolean>((resolve) => {
          const cap = setTimeout(() => resolve(false), capMs);
          img
            .decode()
            .then(
              () => resolve(false),
              () => resolve(true),
            )
            .finally(() => clearTimeout(cap));
        });
      const stillBroken = await Promise.all(
        candidates.map(async (url) => {
          const shown = Array.from(document.querySelectorAll("img")).filter(
            (img) => img.currentSrc === url || img.src === url,
          );
          return (await Promise.all(shown.map(fails))).some(Boolean);
        }),
      );
      return candidates.filter((_, i) => stillBroken[i]);
    },
    urls,
    IMAGE_DECODE_CAP_MS,
  );
  return new Set(broken);
}

function wireNetworkListeners(page: Page, drafts: RuntimeDraft[], clock: RuntimeClock): void {
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes("favicon") || url.startsWith("data:")) return;
    const failure = request.failure()?.errorText;
    if (shouldIgnoreRequestFailure(url, failure, request.resourceType())) return;
    drafts.push({
      code: "request_failed",
      severity: "error",
      message: `Failed to load ${urlPath(url)}: ${failure ?? "net::ERR_FAILED"}`,
      ...clock.now(),
      url,
      abortedImage: failure === "net::ERR_ABORTED" && request.resourceType() === "image",
      networkChanged: failure === "net::ERR_NETWORK_CHANGED",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (url.includes("favicon")) return;
    if (shouldIgnoreHttpError(url, response.status())) return;
    drafts.push({
      code: "http_error",
      severity: "error",
      message: `${response.status()} loading ${urlPath(url)}`,
      ...clock.now(),
      url,
    });
  });
}

function failWhenPageDies(page: Page, driver: CheckAuditDriver): CheckAuditDriver {
  const dead = new Promise<never>((_, reject) => {
    page.on("error", (error) =>
      reject(new Error(`The page crashed: ${normalizeErrorMessage(error)}`)),
    );
    page.on("close", () => reject(new Error("The page closed before the check finished")));
  });
  dead.catch(() => undefined);
  return Object.fromEntries(
    Object.entries(driver).map(([name, member]) => [
      name,
      typeof member === "function"
        ? (...args: unknown[]) => {
            const result: unknown = Reflect.apply(member, driver, args);
            return result instanceof Promise ? Promise.race([result, dead]) : result;
          }
        : member,
    ]),
  ) as unknown as CheckAuditDriver;
}

export function createPageDriver(
  page: Page,
  clock: RuntimeClock = createRuntimeClock(),
  sampleLog?: SampleWindow,
): CheckAuditDriver {
  return failWhenPageDies(page, {
    initialize: (contrast) => injectAuditScripts(page, contrast),
    markSamples: (phase) => {
      if (!sampleLog) return;
      if (phase === "drop") sampleLog.start = sampleLog.end = Number.POSITIVE_INFINITY;
      else sampleLog[phase] = sampleLog.drafts.length;
    },
    matchComponents: (components, findings) =>
      page.evaluate(matchComponentFindings, { components, findings }),
    getDuration: () => getCompositionDuration(page),
    hasNoTimelineDeclaration: () => hasNoTimelineDeclaration(page),
    getTransitionBoundaries: () => collectTweenBoundaries(page),
    getClipEdges: () => collectClipEdges(page),
    getCanvas: () =>
      page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    findAmbiguousSelectors: (selectors) => findAmbiguousSelectors(page, selectors),
    seek: async (time, screenshotFollows) => {
      clock.at(time);
      await seekCompositionTimeline(
        page,
        time,
        screenshotFollows ? SCREENSHOT_SEEK_OPTIONS : AUDIT_SEEK_OPTIONS,
      );
    },
    seekGeometry: async (time, { draws = false } = {}) => {
      clock.at(time);
      const options = draws
        ? { ...DENSE_GEOMETRY_SEEK_OPTIONS, skipWebglDraws: false }
        : DENSE_GEOMETRY_SEEK_OPTIONS;
      await seekCompositionTimeline(page, time, options);
    },
    collectLayout: (time, tolerance, layout) => collectLayout(page, time, tolerance, layout),
    collectOverlap: (time) => collectOverlap(page, time),
    collectOverlapGrid: async (times) => {
      const issues = await collectOverlapGrid(page, times);
      // What a grid sample queued for later lands after the grid, so it gets the grid's span, not its last time.
      if (times.length > 0) clock.during([times[0] ?? 0, times.at(-1) ?? 0]);
      return issues;
    },
    collectLayoutGeometry: () => collectLayoutGeometry(page),
    captureFrame: (scope) => captureFrame(page, scope),
    framesDiffer: (first, second) =>
      page
        .evaluate(
          (a, b) => Reflect.apply(Reflect.get(window, "__hyperframesFramesDiffer"), window, [a, b]),
          first,
          second,
        )
        .then((differ) => differ === true),
    collectSeekClock: () => collectSeekClock(page),
    collectRotationSample: (time) => collectRotationSample(page, time),
    collectOffPivotRotationSample: (time) => collectOffPivotRotationSample(page, time),
    collectGeometryCandidates: (time, request) => collectGeometryCandidates(page, time, request),
    collectMotionFrame: (time, selectors, scopes) =>
      collectMotionFrame(page, time, selectors, scopes),
    anchorMotionIssues: (issues) => anchorLayoutIssues(page, issues),
    collectContrast: (time, annotations, skipInMotion) =>
      collectContrast(page, time, annotations, skipInMotion),
    collectCraftFrame: (time) => collectCraftFrame(page, time),
    collectCraftFilm: () => collectCraftFilm(page),
  });
}

async function collectCraftFrame(page: Page, time: number): Promise<CraftFrame> {
  const raw = await page.evaluate((withCover: boolean) => {
    const sample = Reflect.get(window, "__hyperframesCraftSample");
    return typeof sample === "function" ? Reflect.apply(sample, window, [{ withCover }]) : null;
  }, time <= 1e-3);
  const record = isRecord(raw) ? raw : {};
  const parts = Reflect.get(record, "parts");
  const coveredBy = stringValue(record, "coveredBy");
  return {
    time,
    parts: Array.isArray(parts) ? parts.flatMap(parseCraftTextPart) : [],
    held: booleanValue(record, "held") ?? false,
    painted: booleanValue(record, "painted") ?? true,
    ...(coveredBy ? { coveredBy } : {}),
    signature: stringValue(record, "signature") ?? "",
  };
}

async function collectCraftFilm(page: Page): Promise<CraftFilm> {
  const raw = await page.evaluate(() => {
    const film = Reflect.get(window, "__hyperframesCraftFilm");
    return typeof film === "function" ? Reflect.apply(film, window, []) : null;
  });
  return { soundSources: (isRecord(raw) ? numberValue(raw, "soundSources") : null) ?? 0 };
}

const CRAFT_PART_NUMBERS = ["key", "block", "opacity", "fontPx"] as const;
const CRAFT_PART_STRINGS = ["selector", "blockSelector", "sourceFile", "text"] as const;
const CRAFT_RECT_NUMBERS = ["left", "top", "width", "height"] as const;

function parseCraftTextPart(value: unknown): CraftTextPart[] {
  if (!isRecord(value)) return [];
  const nums = requiredNumbers(value, CRAFT_PART_NUMBERS);
  const strings = requiredStrings(value, CRAFT_PART_STRINGS);
  const rect = recordField(value, "rect");
  const box = rect ? requiredNumbers(rect, CRAFT_RECT_NUMBERS) : null;
  const captions = booleanValue(value, "captions");
  return nums && strings && box && captions !== null
    ? [{ ...nums, ...strings, rect: box, captions }]
    : [];
}

function requiredStrings<K extends string>(
  value: Record<string, unknown>,
  keys: readonly K[],
): { [P in K]: string } | null {
  const out = {} as { [P in K]: string };
  for (const key of keys) {
    const entry = stringValue(value, key);
    if (entry === null) return null;
    out[key] = entry;
  }
  return out;
}

async function hasNoTimelineDeclaration(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.querySelector("[data-composition-id]")?.hasAttribute("data-no-timeline") ?? false,
  );
}

async function injectAuditScripts(page: Page, contrast: boolean): Promise<void> {
  await page.addScriptTag({ content: loadBrowserScript("motion-signature.browser.js") });
  await page.addScriptTag({ content: loadBrowserScript("layout-audit.browser.js") });
  await page.addScriptTag({ content: loadBrowserScript("motion-sample.browser.js") });
  if (contrast) {
    await page.addScriptTag({ content: loadBrowserScript("contrast-audit.browser.js") });
  }
}

async function getCompositionDuration(page: Page): Promise<number> {
  // Duration resolution is serialized into the page and must remain self-contained.
  // fallow-ignore-next-line complexity
  return page.evaluate(() => {
    const value = (target: unknown, key: string): unknown =>
      typeof target === "object" && target !== null ? Reflect.get(target, key) : undefined;
    const positive = (candidate: unknown): number | null =>
      typeof candidate === "number" && candidate > 0 ? candidate : null;
    const callDuration = (target: unknown): number | null => {
      const duration = value(target, "duration");
      if (typeof duration === "function") {
        const result = Reflect.apply(duration, target, []);
        return positive(result);
      }
      return positive(duration);
    };
    const hfDuration = positive(value(Reflect.get(window, "__hf"), "duration"));
    if (hfDuration) return hfDuration;
    const playerDuration = callDuration(Reflect.get(window, "__player"));
    if (playerDuration) return playerDuration;
    const root = document.querySelector("[data-composition-id][data-duration]");
    const authored = root ? parseFloat(root.getAttribute("data-duration") ?? "0") : 0;
    if (authored > 0) return authored;
    const timelines = Reflect.get(window, "__timelines");
    if (typeof timelines !== "object" || timelines === null) return 0;
    for (const key of Object.keys(timelines)) {
      const duration = callDuration(Reflect.get(timelines, key));
      if (duration) return duration;
    }
    return 0;
  });
}

async function collectClipEdges(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    type Clip = { kind: string; start: number; duration: number };
    const manifest = Reflect.get(window, "__clipManifest") as { clips?: Clip[] } | undefined;
    return (manifest?.clips ?? [])
      .filter((clip) => clip.kind !== "audio")
      .flatMap((clip) => [clip.start, clip.start + clip.duration]);
  });
}

async function collectTweenBoundaries(page: Page): Promise<number[]> {
  // GSAP getter binding and parent-time conversion form one serialized algorithm.
  // fallow-ignore-next-line complexity
  return page.evaluate(() => {
    const property = (target: unknown, key: string): unknown =>
      (typeof target === "object" && target !== null) || typeof target === "function"
        ? Reflect.get(target, key)
        : undefined;
    const numberCall = (target: unknown, key: string, fallback: number): number => {
      const method = property(target, key);
      if (typeof method !== "function") return fallback;
      const result = Reflect.apply(method, target, []);
      return typeof result === "number" ? result : fallback;
    };
    const rootTime = (root: unknown, animation: unknown, local: number): number => {
      let time = local;
      let node = animation;
      while (node && node !== root) {
        time = numberCall(node, "startTime", 0) + time / (numberCall(node, "timeScale", 1) || 1);
        node = property(node, "parent");
      }
      return time;
    };
    const timelines = Reflect.get(window, "__timelines");
    if (typeof timelines !== "object" || timelines === null) return [];
    const boundaries: number[] = [];
    for (const key of Object.keys(timelines)) {
      const timeline = Reflect.get(timelines, key);
      const getChildren = property(timeline, "getChildren");
      if (typeof getChildren !== "function") continue;
      try {
        const children = Reflect.apply(getChildren, timeline, [true, true, false]);
        if (!Array.isArray(children)) continue;
        for (const child of children) {
          const duration = numberCall(child, "duration", Number.NaN);
          if (!Number.isFinite(duration)) continue;
          boundaries.push(rootTime(timeline, child, 0), rootTime(timeline, child, duration));
        }
      } catch {
        continue;
      }
    }
    return boundaries.filter(Number.isFinite);
  });
}

async function collectLayout(
  page: Page,
  time: number,
  tolerance: number,
  layout?: LayoutOptions,
): Promise<AnchoredLayoutIssue[]> {
  const raw = await page.evaluate(
    (options: { time: number; tolerance: number; proseCoverageFloor?: number }) => {
      const audit = Reflect.get(window, "__hyperframesLayoutAudit");
      if (typeof audit !== "function") return [];
      const result = Reflect.apply(audit, window, [options]);
      return Array.isArray(result) ? result : [];
    },
    {
      time,
      tolerance,
      ...(typeof layout?.proseCoverageFloor === "number"
        ? { proseCoverageFloor: layout.proseCoverageFloor }
        : {}),
    },
  );
  return anchorLayoutIssues(page, raw.flatMap(parseLayoutIssue));
}

async function collectOverlap(page: Page, time: number): Promise<AnchoredLayoutIssue[]> {
  const raw = await page.evaluate(
    (options: { time: number }) => {
      const audit = Reflect.get(window, "__hyperframesOverlapAudit");
      if (typeof audit !== "function") return [];
      const result = Reflect.apply(audit, window, [options]);
      return Array.isArray(result) ? result : [];
    },
    { time },
  );
  return anchorLayoutIssues(page, raw.flatMap(parseLayoutIssue));
}

const SAMPLE_TIME_MARKER = "__hfCheckSample ";

function followSampleTimeMarkers(page: Page, setTime: (time: number) => void): void {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "debug" && text.startsWith(SAMPLE_TIME_MARKER)) {
      setTime(Number(text.slice(SAMPLE_TIME_MARKER.length)));
    }
  });
}

interface OverlapGridSample {
  raw: unknown[];
  anchors: CheckAnchor[];
}

// Never yields to the renderer between samples, so it paints no frame for them.
async function overlapGridInPage(
  grid: {
    times: number[];
    marker: string;
    fallback: boolean;
    skipDraws: boolean;
    videoFrames: boolean;
  },
  seek: typeof seekInPage,
  anchors: typeof anchorsInPage,
): Promise<OverlapGridSample[]> {
  const audit = Reflect.get(window, "__hyperframesOverlapAudit");
  const waitForCompletion = Reflect.get(window, "__hfWaitForSeekCompletion");
  const samples: OverlapGridSample[] = [];
  for (const time of grid.times) {
    console.debug(`${grid.marker}${time}`);
    seek(time, grid.fallback, false, grid.skipDraws);
    if (typeof waitForCompletion === "function") {
      await Reflect.apply(waitForCompletion, window, [{ videoFrames: grid.videoFrames }]);
    }
    const result: unknown =
      typeof audit === "function" ? Reflect.apply(audit, window, [{ time }]) : [];
    const raw = Array.isArray(result) ? result : [];
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const requests = raw.map((issue) => ({
      selector: String(Reflect.get(Object(issue), "selector")),
      time,
      bbox: zero,
    }));
    samples.push({ raw, anchors: anchors(requests) });
  }
  return samples;
}

async function collectOverlapGrid(page: Page, times: number[]): Promise<AnchoredLayoutIssue[][]> {
  if (times.length === 0) return [];
  const grid = {
    times,
    marker: SAMPLE_TIME_MARKER,
    fallback: DENSE_GEOMETRY_SEEK_OPTIONS.fallbackToBridgeAndTimelines,
    skipDraws: DENSE_GEOMETRY_SEEK_OPTIONS.skipWebglDraws,
    videoFrames: DENSE_GEOMETRY_SEEK_OPTIONS.waitForVideoFrames,
  };
  const samples = (await page.evaluate(
    `(${overlapGridInPage})(${JSON.stringify(grid)}, ${seekInPage}, ${anchorsInPage})`,
  )) as OverlapGridSample[];
  return samples.map(({ raw, anchors }) =>
    raw.flatMap((value, index) =>
      parseLayoutIssue(value).map((issue) => ({
        ...issue,
        ...(anchors[index] ?? fallbackAnchor(undefined)),
        bbox: rectToBbox(issue.rect),
        time: issue.time,
      })),
    ),
  );
}

async function captureFrame(page: Page, scope?: string): Promise<string> {
  if (!scope) return page.screenshot({ encoding: "base64", type: "png" });
  try {
    const box = await page.evaluate(isolateScopePaint, scope);
    if (!box || box.width < 1 || box.height < 1) return "";
    return await page.screenshot({
      encoding: "base64",
      type: "png",
      clip: box,
      omitBackground: true,
    });
  } finally {
    await page.evaluate(restoreScopePaint);
  }
}

// Liveness signs only the scope's subtree, so its frame must show only that paint: anything else behind or
// over the box (a moving background, grain, the page canvas) would read as the scope moving; the canvas stays clear.
function isolateScopePaint(
  scope: string,
): { x: number; y: number; width: number; height: number } | null {
  let target: Element | null = null;
  try {
    target = document.querySelector(scope);
  } catch {
    return null;
  }
  if (!target) return null;
  const visibility = getComputedStyle(target).visibility;
  target.setAttribute("data-hf-capture-scope", "");
  const style = document.createElement("style");
  style.id = "__hf_capture_scope_style";
  style.textContent = `:not([data-hf-capture-scope], [data-hf-capture-scope] *) { visibility: hidden !important; }
    :root:not([data-hf-capture-scope]), body:not([data-hf-capture-scope]) { background: none !important; }
    [data-hf-capture-scope] { visibility: ${visibility} !important; }`;
  document.head.append(style);
  const rect = target.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function restoreScopePaint(): void {
  document.getElementById("__hf_capture_scope_style")?.remove();
  document.querySelector("[data-hf-capture-scope]")?.removeAttribute("data-hf-capture-scope");
}

async function collectLayoutGeometry(page: Page): Promise<string> {
  return page.evaluate(() => {
    const geometry = Reflect.get(window, "__hyperframesLayoutGeometry");
    if (typeof geometry !== "function") return "";
    const result = Reflect.apply(geometry, window, []);
    return typeof result === "string" ? result : "";
  });
}

export async function collectSeekClock(page: Page): Promise<SeekClock[]> {
  // Serialized into the page; each optional GSAP read is one branch of one function.
  // fallow-ignore-next-line complexity
  return page.evaluate(() => {
    const callOrUndefined = (target: unknown, key: string, args: unknown[] = []): unknown => {
      try {
        return Reflect.apply(Reflect.get(Object(target), key), target, args);
      } catch {
        return undefined;
      }
    };
    const known: { ids: WeakMap<object, number>; next: number } = Reflect.get(
      window,
      "__hfSeekClocks",
    ) ?? {
      ids: new WeakMap(),
      next: 0,
    };
    Reflect.set(window, "__hfSeekClocks", known);
    const idOf = (target: object): number => {
      if (!known.ids.has(target)) known.ids.set(target, ++known.next);
      return known.ids.get(target) ?? 0;
    };
    const clocks: SeekClock[] = [];
    const timelines: unknown = Reflect.get(window, "__timelines");
    const registered = typeof timelines === "object" && timelines ? Object.values(timelines) : [];
    const gsapRoot = Reflect.get(Reflect.get(window, "gsap") ?? {}, "globalTimeline");
    const children = callOrUndefined(gsapRoot, "getChildren", [false, true, true]);
    for (const timeline of [...registered, ...(Array.isArray(children) ? children : [])]) {
      const total = Number(
        callOrUndefined(timeline, "totalDuration") ?? callOrUndefined(timeline, "duration"),
      );
      if (typeof timeline !== "object" || !timeline || !(total > 0)) continue;
      const time = callOrUndefined(timeline, "totalTime") ?? callOrUndefined(timeline, "time");
      if (typeof time !== "number" || !Number.isFinite(time)) continue;
      const progress = Number(callOrUndefined(timeline, "totalProgress") ?? time / total);
      const done = callOrUndefined(timeline, "reversed") === true ? progress <= 0 : progress >= 1;
      clocks.push({ id: idOf(timeline), time, done });
    }
    for (const animation of document.getAnimations?.() ?? []) {
      if (typeof animation.currentTime !== "number") continue;
      const time = animation.currentTime;
      const end = Number(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY);
      const atEnd = animation.playbackRate < 0 ? time <= 0 : time >= end;
      clocks.push({ id: idOf(animation), time, done: animation.playState === "finished" || atEnd });
    }
    return clocks;
  });
}

/** Invoke a `window.__hyperframes*` sampler injected by layout-audit.browser.js
 * and return its array result (or [] when absent / non-array). Shared by the
 * per-frame sample collectors so the page.evaluate boilerplate lives once. */
async function evaluateSampler(page: Page, globalName: string): Promise<unknown[]> {
  return page.evaluate((name) => {
    const sample = Reflect.get(window, name);
    if (typeof sample !== "function") return [];
    const result = Reflect.apply(sample, window, []);
    return Array.isArray(result) ? result : [];
  }, globalName);
}

async function collectRotationSample(page: Page, time: number): Promise<RotationSample[]> {
  const raw = await evaluateSampler(page, "__hyperframesRotationSample");
  return raw.flatMap((value) => parseRotationSample(value, time));
}

function parseRotationSample(value: unknown, time: number): RotationSample[] {
  if (!isRecord(value)) return [];
  const selector = stringValue(value, "selector");
  const cx = numberValue(value, "cx");
  const cy = numberValue(value, "cy");
  const w = numberValue(value, "w");
  const h = numberValue(value, "h");
  const angle = numberValue(value, "angle");
  if (!selector || cx === null || cy === null || w === null || h === null || angle === null) {
    return [];
  }
  return [{ time, selector, cx, cy, w, h, angle }];
}

async function collectOffPivotRotationSample(page: Page, time: number): Promise<OffPivotFrame> {
  const raw = await evaluateSampler(page, "__hyperframesOffPivotRotationSample");
  return { time, samples: raw.flatMap(parseOffPivotRotationSample) };
}

/** Read every named key as a finite number; null if ANY is missing/non-finite.
 * The mapped return type keeps each field a plain `number` (not `number |
 * undefined`) so callers read `nums.ax` without re-narrowing. */
function requiredNumbers<K extends string>(
  value: Record<string, unknown>,
  keys: readonly K[],
): { [P in K]: number } | null {
  const out = {} as { [P in K]: number };
  for (const key of keys) {
    const num = numberValue(value, key);
    if (num === null) return null;
    out[key] = num;
  }
  return out;
}

const OFF_PIVOT_REQUIRED_NUMBERS = ["ax", "ay", "bx", "by", "len", "angle", "hubCount"] as const;

function parseOffPivotRotationSample(value: unknown): OffPivotRotationSample[] {
  if (!isRecord(value)) return [];
  const selector = stringValue(value, "selector");
  const nums = requiredNumbers(value, OFF_PIVOT_REQUIRED_NUMBERS);
  if (!selector || !nums) return [];
  return [
    {
      selector,
      ax: nums.ax,
      ay: nums.ay,
      bx: nums.bx,
      by: nums.by,
      len: nums.len,
      angle: nums.angle,
      hx: numberValue(value, "hx"),
      hy: numberValue(value, "hy"),
      hr: numberValue(value, "hr"),
      hubCount: nums.hubCount,
    },
  ];
}

async function collectGeometryCandidates(
  page: Page,
  time: number,
  request: GeometryCandidateRequest,
): Promise<CheckGeometryCandidate[]> {
  try {
    const raw = await page.evaluate((options: GeometryCandidateRequest) => {
      const collect = Reflect.get(window, "__hyperframesGeometryCandidates");
      if (typeof collect !== "function") return [];
      const result = Reflect.apply(collect, window, [options]);
      return Array.isArray(result) ? result : [];
    }, request);
    return raw.flatMap((value) => parseGeometryCandidate(value, time));
  } catch {
    return [];
  }
}

async function findAmbiguousSelectors(
  page: Page,
  selectors: string[],
): Promise<AnchoredLayoutIssue[]> {
  const ambiguous = await page.evaluate(
    (values: string[]) =>
      values.filter((selector) => {
        try {
          return document.querySelectorAll(selector).length > 1;
        } catch {
          return false;
        }
      }),
    selectors,
  );
  return anchorLayoutIssues(page, ambiguous.map(ambiguousIssue));
}

async function collectMotionFrame(
  page: Page,
  time: number,
  selectors: string[],
  livenessScopes: string[],
): Promise<MotionFrame> {
  const raw = await page.evaluate(
    (options: { selectors: string[]; livenessScopes: string[] }) => {
      const sample = Reflect.get(window, "__hyperframesMotionSample");
      if (typeof sample !== "function") return null;
      return Reflect.apply(sample, window, [options]);
    },
    { selectors, livenessScopes },
  );
  return parseMotionFrame(raw, time, selectors, livenessScopes);
}

async function anchorLayoutIssues(
  page: Page,
  issues: LayoutIssue[],
): Promise<AnchoredLayoutIssue[]> {
  const requests = issues.map((issue) => ({
    selector: issue.selector,
    time: issue.time,
    bbox: rectToBbox(issue.rect),
  }));
  const anchors = await resolveAnchors(page, requests);
  return issues.map((issue, index) => ({
    ...issue,
    ...(anchors[index] ?? fallbackAnchor(requests[index])),
  }));
}

async function resolveAnchors(page: Page, requests: AnchorRequest[]): Promise<CheckAnchor[]> {
  if (requests.length === 0) return [];
  return page.evaluate(anchorsInPage, requests);
}

function anchorsInPage(values: AnchorRequest[]): CheckAnchor[] {
  const root = document.querySelector("[data-composition-id]");
  return values.map((request) => {
    let element: Element | null = null;
    try {
      element = document.querySelector(request.selector);
    } catch {
      element = null;
    }
    element ??= root;
    // Clones the anchor-extraction block in prepareContrast's evaluate() below;
    // both run inside separate serialized browser closures and can't share a
    // Node-side helper.
    // fallow-ignore-next-line code-duplication
    const dataAttributes: Record<string, string> = {};
    for (const attribute of Array.from(element?.attributes ?? [])) {
      if (attribute.name.startsWith("data-")) dataAttributes[attribute.name] = attribute.value;
    }
    const source = element
      ?.closest("[data-composition-file]")
      ?.getAttribute("data-composition-file");
    return {
      selector: element ? request.selector : "[data-composition-id]",
      dataAttributes,
      sourceFile: source || "index.html",
      bbox: request.bbox,
      time: request.time,
    };
  });
}

async function resolveRootAnchor(page: Page): Promise<CheckAnchor> {
  const selector = await page.evaluate(
    (explicit) => (document.querySelector(explicit) ? explicit : "[data-composition-id]"),
    '[data-composition-id][data-root="true"]',
  );
  const anchors = await resolveAnchors(page, [
    { selector, time: 0, bbox: await compositionBbox(page, selector) },
  ]);
  return anchors[0] ?? fallbackAnchor(undefined);
}

async function compositionBbox(page: Page, selector: string): Promise<CheckBbox> {
  return page.evaluate((root) => {
    const rect = document.querySelector(root)?.getBoundingClientRect();
    return rect
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : { x: 0, y: 0, width: 0, height: 0 };
  }, selector);
}

async function collectContrast(
  page: Page,
  time: number,
  snapshotAnnotations?: CheckAnnotationBox[],
  skipInMotion = false,
): Promise<ContrastCapture> {
  let prepared: PreparedContrast[] = [];
  try {
    const candidates = await prepareContrast(page, time);
    const motion = skipInMotion ? await page.evaluate(readContrastMotion).catch(() => []) : [];
    prepared = parsePreparedContrast(candidates, motion);
    if (prepared.length === 0 && !snapshotAnnotations) return { entries: [] };
    // This screenshot is the one contrast math is sampled from below — it must
    // stay untouched by the annotation overlay (finishContrast reads real
    // painted pixels), so annotation only ever happens on a SECOND shot.
    const { shot, region } = await measurementShot(page, prepared);
    const raw = await finishContrast(
      page,
      shot,
      time,
      prepared.map((entry) => entry.raw),
      region,
    );
    const finished = raw.flatMap(parseFinishedContrast);
    const entries = joinContrastEntries(finished, prepared);
    if (!snapshotAnnotations) return { entries };
    // __contrastAuditFinish restores the text paint hidden by prepare. The
    // measurement screenshot intentionally has glyphs removed so contrast
    // can sample the pixels behind them; never persist that image as visual
    // QA evidence. Capture the restored page for the overview instead.
    const overviewShot = await page.screenshot({ encoding: "base64", type: "png" });
    if (typeof overviewShot !== "string") throw new Error("Overview screenshot was not base64");
    // Contrast failures are only known once measurement above completes, so
    // they're appended to the layout-derived annotations passed in by the
    // pipeline rather than being requested up front.
    const annotations = [
      ...snapshotAnnotations,
      ...contrastFailureAnnotations(entries, snapshotAnnotations.length),
    ];
    const pngBase64 = await captureOverviewShot(page, annotations, overviewShot);
    return { entries, pngBase64 };
  } finally {
    await page
      .evaluate(() => {
        const restore = Reflect.get(window, "__contrastAuditRestoreIfPending");
        if (typeof restore === "function") Reflect.apply(restore, window, []);
      })
      .catch(() => undefined);
  }
}

async function measurementShot(
  page: Page,
  prepared: PreparedContrast[],
): Promise<{ shot: string | null; region: TextRegion | undefined }> {
  const frame = plainFrame(page.viewport());
  const sampled = prepared.filter((entry) => !entry.knownBackdrop);
  if (frame && sampled.length === 0) {
    const clip = { x: 0, y: 0, ...frame };
    return { shot: null, region: { clip, frameWidth: frame.width, frameHeight: frame.height } };
  }
  const region = textRegion(sampled, frame);
  const shot = await page.screenshot({
    encoding: "base64",
    type: "png",
    omitBackground: true,
    ...(region ? { clip: region.clip, captureBeyondViewport: false } : {}),
  });
  if (typeof shot !== "string") throw new Error("Contrast screenshot was not base64");
  return { shot, region };
}

function contrastFailureAnnotations(
  entries: ContrastAuditEntry[],
  labelOffset: number,
): CheckAnnotationBox[] {
  return entries
    .filter((entry) => !entry.wcagAA)
    .map((entry, index) => ({
      label: `${labelOffset + index + 1} contrast_aa_failure`,
      bbox: entry.bbox,
    }));
}

const ANNOTATION_OVERLAY_ID = "__hyperframesCheckAnnotations";

/**
 * `check --snapshots`'s overview-frame annotation: every audit for this
 * sample time has already run (layout/geometry findings arrive via
 * `annotations`; contrast failures were just measured above), so it's safe
 * to draw labeled boxes and take one more shot without perturbing anything
 * audits read. No-op (returns the plain screenshot) when there's nothing to
 * annotate — the common case stays exactly as before this feature existed.
 */
export async function captureOverviewShot(
  page: Page,
  annotations: CheckAnnotationBox[],
  fallbackScreenshot: string,
): Promise<string> {
  if (annotations.length === 0) return fallbackScreenshot;
  await injectAnnotationOverlay(page, annotations);
  try {
    const shot = await page.screenshot({ encoding: "base64", type: "png" });
    return typeof shot === "string" ? shot : fallbackScreenshot;
  } finally {
    await removeAnnotationOverlay(page);
  }
}

/** One small, self-contained DOM overlay: fixed-position labeled boxes over
 * each finding's bbox. Injected immediately before the annotated overview
 * shot and torn down immediately after (see `captureOverviewShot`), so it
 * never leaks into any audit's DOM reads. */
async function injectAnnotationOverlay(page: Page, boxes: CheckAnnotationBox[]): Promise<void> {
  await page.evaluate(
    (items: CheckAnnotationBox[], overlayId: string) => {
      const root = document.createElement("div");
      root.id = overlayId;
      root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
      for (const item of items) {
        const box = document.createElement("div");
        box.style.cssText = `position:fixed;left:${item.bbox.x}px;top:${item.bbox.y}px;width:${item.bbox.width}px;height:${item.bbox.height}px;border:2px solid #ff2d55;box-sizing:border-box;`;
        const label = document.createElement("div");
        label.textContent = item.label;
        label.style.cssText =
          "position:absolute;top:-18px;left:0;background:#ff2d55;color:#fff;font:11px/16px monospace;padding:0 4px;white-space:nowrap;";
        box.appendChild(label);
        root.appendChild(box);
      }
      document.body.appendChild(root);
    },
    boxes,
    ANNOTATION_OVERLAY_ID,
  );
}

async function removeAnnotationOverlay(page: Page): Promise<void> {
  await page.evaluate((overlayId: string) => {
    document.getElementById(overlayId)?.remove();
  }, ANNOTATION_OVERLAY_ID);
}

async function prepareContrast(page: Page, time: number): Promise<unknown[]> {
  // Candidate-to-element provenance must be captured while the prepare restore list is live.
  // fallow-ignore-next-line complexity
  return page.evaluate((sampleTime: number) => {
    const prepare = Reflect.get(window, "__contrastAuditPrepare");
    const candidates = typeof prepare === "function" ? Reflect.apply(prepare, window, []) : [];
    if (!Array.isArray(candidates)) return [];
    const restores = Reflect.get(window, "__contrastAuditRestores");
    const restoreList = Array.isArray(restores) ? restores : [];
    const escape = (value: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const selectorFor = (element: Element | null, fallback: string): string => {
      if (!element) return fallback;
      if (element.id) return `#${escape(element.id)}`;
      const parts: string[] = [];
      for (
        let current: Element | null = element;
        current && current !== document.body;
        current = current.parentElement
      ) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter(
              (item) => item.tagName === current?.tagName,
            )
          : [];
        parts.push(
          siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag,
        );
      }
      return parts.reverse().join(" > ") || fallback;
    };
    // Part of the serialized evaluate body above; cannot delegate to Node helpers.
    // fallow-ignore-next-line complexity
    return candidates.map((candidate, index) => {
      const restore = restoreList[index];
      const candidateObject = typeof candidate === "object" && candidate !== null ? candidate : {};
      const elementValue =
        typeof restore === "object" && restore !== null ? Reflect.get(restore, "el") : null;
      const element = elementValue instanceof Element ? elementValue : null;
      const fallback = Reflect.get(candidateObject, "selector");
      const selector = selectorFor(
        element,
        typeof fallback === "string" ? fallback : "[data-composition-id]",
      );
      const dataAttributes: Record<string, string> = {};
      for (const attribute of Array.from(element?.attributes ?? [])) {
        if (attribute.name.startsWith("data-")) dataAttributes[attribute.name] = attribute.value;
      }
      const source = element
        ?.closest("[data-composition-file]")
        ?.getAttribute("data-composition-file");
      return {
        candidate: { ...candidateObject, selector },
        anchor: {
          selector,
          dataAttributes,
          sourceFile: source || "index.html",
          bbox: Reflect.get(candidateObject, "bbox"),
          time: sampleTime,
        },
      };
    });
  }, time);
}

interface TextRegion {
  clip: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
}

// The smallest whole-pixel rect holding every box contrast samples; undefined means the full frame.
function plainFrame(
  viewport: { width: number; height: number; deviceScaleFactor?: number } | null,
): { width: number; height: number } | undefined {
  if (!viewport || (viewport.deviceScaleFactor ?? 1) !== 1) return undefined;
  return { width: viewport.width, height: viewport.height };
}

function textRegion(
  prepared: PreparedContrast[],
  viewport: { width: number; height: number } | undefined,
): TextRegion | undefined {
  if (!viewport || prepared.length === 0) return undefined;
  const boxes = prepared.map((entry) => entry.candidate.bbox);
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x))));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y))));
  const right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map((b) => b.x + b.width))));
  const bottom = Math.min(
    viewport.height,
    Math.ceil(Math.max(...boxes.map((b) => b.y + b.height))),
  );
  if (right <= x || bottom <= y) return undefined;
  const clip = { x, y, width: right - x, height: bottom - y };
  return { clip, frameWidth: viewport.width, frameHeight: viewport.height };
}

async function finishContrast(
  page: Page,
  screenshot: string | null,
  time: number,
  candidates: unknown[],
  region: TextRegion | undefined,
): Promise<unknown[]> {
  return page.evaluate(
    async (payload: {
      screenshot: string | null;
      time: number;
      candidates: unknown[];
      region: TextRegion | null;
    }) => {
      const finish = Reflect.get(window, "__contrastAuditFinish");
      if (typeof finish !== "function") return [];
      const result = await Reflect.apply(finish, window, [
        payload.screenshot,
        payload.time,
        payload.candidates,
        payload.region,
      ]);
      return Array.isArray(result) ? result : [];
    },
    { screenshot, time, candidates, region: region ?? null },
  );
}

function parsePreparedContrast(
  raw: unknown[],
  motion: (ContrastMotionSample | null)[],
): PreparedContrast[] {
  return raw.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const raw = Reflect.get(value, "candidate");
    const candidate = parseContrastCandidate(raw);
    const anchor = parseAnchor(Reflect.get(value, "anchor"));
    return candidate && anchor
      ? [
          {
            raw,
            candidate,
            anchor,
            knownBackdrop: knownBackdrop(raw),
            motion: motion[index] ?? null,
          },
        ]
      : [];
  });
}

function knownBackdrop(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const own = Reflect.get(raw, "ownBg");
  const solid = Reflect.get(raw, "solidBg");
  return Array.isArray(solid) || (Array.isArray(own) && own.length >= 4 && own[3] >= 0.99);
}

function parseContrastCandidate(value: unknown): ContrastCandidate | null {
  if (!isRecord(value)) return null;
  const selector = stringValue(value, "selector");
  const text = stringValue(value, "text");
  const fg = rgbaValue(Reflect.get(value, "fg"));
  const large = booleanValue(value, "large");
  const bbox = parseBbox(Reflect.get(value, "bbox"));
  return selector && text !== null && fg && large !== null && bbox
    ? { selector, text, fg, large, bbox }
    : null;
}

function parseFinishedContrast(value: unknown): FinishedContrast[] {
  if (!isRecord(value)) return [];
  const selector = stringValue(value, "selector");
  const text = stringValue(value, "text");
  const ratio = numberValue(value, "ratio");
  const wcagAA = booleanValue(value, "wcagAA");
  const large = booleanValue(value, "large");
  const fg = stringValue(value, "fg");
  const bg = stringValue(value, "bg");
  return selector &&
    text !== null &&
    ratio !== null &&
    wcagAA !== null &&
    large !== null &&
    fg &&
    bg
    ? [{ selector, text, ratio, wcagAA, large, fg, bg }]
    : [];
}

function joinContrastEntries(
  finished: FinishedContrast[],
  prepared: PreparedContrast[],
): ContrastAuditEntry[] {
  const remaining = [...prepared];
  return finished.flatMap((entry) => {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.candidate.selector === entry.selector && candidate.candidate.text === entry.text,
    );
    const match = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
    if (!match) return [];
    if (!entry.wcagAA && match.motion && measuredInMotion(match.motion)) return [];
    return [{ ...entry, ...match.anchor }];
  });
}

function parseLayoutIssue(value: unknown): LayoutIssue[] {
  if (!isRecord(value)) return [];
  const code = layoutCodeValue(Reflect.get(value, "code"));
  const severity = severityValue(Reflect.get(value, "severity"));
  const time = numberValue(value, "time");
  const selector = stringValue(value, "selector");
  const message = stringValue(value, "message");
  const rect = parseRect(Reflect.get(value, "rect"));
  if (!code || !severity || time === null || !selector || !message || !rect) return [];
  const issue: LayoutIssue = { code, severity, time, selector, message, rect };
  assignOptionalLayoutFields(issue, value);
  return [issue];
}

function parseGeometryCandidate(value: unknown, time: number): CheckGeometryCandidate[] {
  if (!isRecord(value)) return [];
  const rect = parseRect(Reflect.get(value, "rect"));
  const elementRect = parseRect(Reflect.get(value, "elementRect"));
  if (!rect || !elementRect) return [];
  const identity = parseGeometryIdentity(value);
  if (!identity) return [];
  const anchor = parseGeometryAnchor(value, rect, time);
  if (!anchor) return [];
  const candidate: CheckGeometryCandidate = { ...identity, ...anchor, rect, elementRect };
  const overflow = parseOverflow(Reflect.get(value, "overflow"));
  if (overflow) candidate.overflow = overflow;
  return [candidate];
}

function parseGeometryIdentity(
  value: Record<string, unknown>,
): Pick<CheckGeometryCandidate, "kind" | "tag" | "text"> | null {
  const kindValue = Reflect.get(value, "kind");
  const kind = kindValue === "text" || kindValue === "media" ? kindValue : null;
  if (!kind) return null;
  const tag = stringValue(value, "tag");
  if (!tag) return null;
  const text = stringValue(value, "text");
  return text === null ? null : { kind, tag, text };
}

function parseGeometryAnchor(
  value: Record<string, unknown>,
  rect: LayoutRect,
  time: number,
): CheckAnchor | null {
  const selector = stringValue(value, "selector");
  if (!selector) return null;
  const sourceFile = stringValue(value, "sourceFile");
  if (!sourceFile) return null;
  const dataAttributes = stringRecord(Reflect.get(value, "dataAttributes"));
  return dataAttributes
    ? {
        selector,
        sourceFile,
        dataAttributes,
        bbox: rectToBbox(rect),
        time,
      }
    : null;
}

function assignOptionalLayoutFields(issue: LayoutIssue, value: Record<string, unknown>): void {
  assignOptionalString(issue, value, "containerSelector");
  assignOptionalString(issue, value, "text");
  assignOptionalString(issue, value, "fixHint");
  const containerRect = parseRect(Reflect.get(value, "containerRect"));
  if (containerRect) issue.containerRect = containerRect;
  const overflow = parseOverflow(Reflect.get(value, "overflow"));
  if (overflow) issue.overflow = overflow;
  const coveredFraction = numberValue(value, "coveredFraction");
  if (coveredFraction !== null) issue.coveredFraction = coveredFraction;
  const lifetime = recordField(value, "lifetime");
  const start = lifetime ? numberValue(lifetime, "start") : null;
  const end = lifetime ? numberValue(lifetime, "end") : null;
  if (start !== null && end !== null) issue.lifetime = { start, end };
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const field = Reflect.get(value, key);
  return isRecord(field) ? field : null;
}

function parseMotionFrame(
  value: unknown,
  time: number,
  selectors: string[],
  scopes: string[],
): MotionFrame {
  const rawData = recordField(value, "data");
  const rawLiveness = recordField(value, "liveness");
  const data: MotionFrame["data"] = {};
  for (const selector of selectors) {
    data[selector] = rawData ? parseFrameSample(Reflect.get(rawData, selector)) : null;
  }
  const liveness: Record<string, string> = {};
  for (const scope of scopes) {
    const signature = rawLiveness ? Reflect.get(rawLiveness, scope) : "";
    liveness[scope] = typeof signature === "string" ? signature : "";
  }
  return { time, data, liveness };
}

function parseFrameSample(value: unknown): MotionFrame["data"][string] {
  if (!isRecord(value)) return null;
  const rect = parseRect(Reflect.get(value, "rect"));
  const opacity = numberValue(value, "opacity");
  const visible = booleanValue(value, "visible");
  return rect && opacity !== null && visible !== null ? { rect, opacity, visible } : null;
}

function parseAnchor(value: unknown): CheckAnchor | null {
  if (!isRecord(value)) return null;
  const selector = stringValue(value, "selector");
  const sourceFile = stringValue(value, "sourceFile");
  const time = numberValue(value, "time");
  const bbox = parseBbox(Reflect.get(value, "bbox"));
  const dataAttributes = stringRecord(Reflect.get(value, "dataAttributes"));
  return selector && sourceFile && time !== null && bbox && dataAttributes
    ? { selector, sourceFile, time, bbox, dataAttributes }
    : null;
}

function runtimeFinding(draft: RuntimeDraft, root: CheckAnchor): CheckFinding {
  return {
    code: draft.code,
    severity: draft.severity,
    message:
      (draft.count ?? 1) > 1 ? `${draft.message} (repeated ${draft.count} times)` : draft.message,
    selector: root.selector,
    dataAttributes: root.dataAttributes,
    sourceFile: root.sourceFile,
    bbox: root.bbox,
    time: draft.time,
    ...(draft.timeRange ? { timeRange: draft.timeRange } : {}),
    url: draft.url,
    line: draft.line,
    ...(draft.fixHint ? { fixHint: draft.fixHint } : {}),
  };
}

function fallbackAnchor(request: AnchorRequest | undefined): CheckAnchor {
  return {
    selector: request?.selector ?? "[data-composition-id]",
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: request?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    time: request?.time ?? 0,
  };
}

function parseBbox(value: unknown): CheckBbox | null {
  if (!isRecord(value)) return null;
  const x = numberValue(value, "x");
  const y = numberValue(value, "y");
  const width = numberValue(value, "width") ?? numberValue(value, "w");
  const height = numberValue(value, "height") ?? numberValue(value, "h");
  return x !== null && y !== null && width !== null && height !== null
    ? { x, y, width, height }
    : null;
}

function parseRect(value: unknown): LayoutRect | null {
  if (!isRecord(value)) return null;
  const left = numberValue(value, "left");
  const top = numberValue(value, "top");
  const right = numberValue(value, "right");
  const bottom = numberValue(value, "bottom");
  const width = numberValue(value, "width");
  const height = numberValue(value, "height");
  return left !== null &&
    top !== null &&
    right !== null &&
    bottom !== null &&
    width !== null &&
    height !== null
    ? { left, top, right, bottom, width, height }
    : null;
}

function parseOverflow(value: unknown): LayoutIssue["overflow"] | null {
  if (!isRecord(value)) return null;
  const overflow: LayoutIssue["overflow"] = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const amount = numberValue(value, side);
    if (amount !== null) overflow[side] = amount;
  }
  return Object.keys(overflow).length > 0 ? overflow : null;
}

const LAYOUT_ISSUE_CODES: readonly LayoutIssueCode[] = [
  "text_box_overflow",
  "clipped_text",
  "canvas_overflow",
  "container_overflow",
  "content_overlap",
  "visibility_escapes_segment",
  "text_occluded",
  "canvas_covered",
  "video_alpha_unread",
  "text_not_painted",
  "caption_zone_collision",
  "frame_out_of_frame",
  "escaped_container",
  "panel_out_of_canvas",
  "canvas_content_at_edge",
  "connector_detached",
  "connector_orphan",
  "rotation_pivot_drift",
  "off_pivot_rotation",
  "motion_appears_late",
  "motion_out_of_order",
  "motion_off_frame",
  "motion_frozen",
  "motion_selector_missing",
  "motion_selector_ambiguous",
];

function layoutCodeValue(value: unknown): LayoutIssueCode | null {
  return LAYOUT_ISSUE_CODES.find((code) => code === value) ?? null;
}

function severityValue(value: unknown): CheckSeverity | null {
  return value === "error" || value === "warning" || value === "info" ? value : null;
}

function rgbaValue(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [red, green, blue, alpha] = value;
  return [red, green, blue, alpha].every((channel) => typeof channel === "number")
    ? [red, green, blue, alpha]
    : null;
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const record: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    const entry = Reflect.get(value, key);
    if (typeof entry !== "string") return null;
    record[key] = entry;
  }
  return record;
}

function assignOptionalString(
  issue: LayoutIssue,
  source: Record<string, unknown>,
  key: "containerSelector" | "text" | "fixHint",
): void {
  const value = stringValue(source, key);
  if (value !== null) issue[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  const entry = Reflect.get(value, key);
  return typeof entry === "string" ? entry : null;
}

function numberValue(value: Record<string, unknown>, key: string): number | null {
  const entry = Reflect.get(value, key);
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

function booleanValue(value: Record<string, unknown>, key: string): boolean | null {
  const entry = Reflect.get(value, key);
  return typeof entry === "boolean" ? entry : null;
}

function urlPath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
  } catch {
    return url;
  }
}

export function matchComponentFindings({
  components,
  findings,
}: {
  components: string[];
  findings: CheckFinding[];
}): boolean[] {
  const roots = components.flatMap((selector) => {
    const matches = [...document.querySelectorAll(selector)];
    if (!matches.length) throw new Error(`Component selector matched nothing: ${selector}`);
    return matches;
  });
  function matchesSelector(selector: string): boolean | null {
    try {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) return null;
      return elements.some((el) => roots.some((root) => root.contains(el)));
    } catch {
      return null;
    }
  }
  return findings.map((finding) => {
    if (!finding.selector || finding.selector === "[data-composition-id]") return true;
    const container = Reflect.get(finding, "containerSelector");
    return (
      matchesSelector(finding.selector) !== false ||
      (typeof container === "string" && matchesSelector(container) !== false)
    );
  });
}
