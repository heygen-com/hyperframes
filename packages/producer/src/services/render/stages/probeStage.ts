// fallow-ignore-file code-duplication complexity
/**
 * probeStage — browser probe + recompile + media reconciliation.
 *
 * Runs only when `needsBrowser` is true (root duration unknown OR there are
 * unresolved nested compositions). Owns the `FileServerHandle` and the
 * `CaptureSession` it creates and returns them so the sequencer can both
 * reuse them downstream (the capture stage reuses the probe session) and
 * clean them up in its `finally` block.
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `recompileWithResolutions` runs inside this stage because it
 *     depends on browser-resolved durations. (Distributed-pipeline
 *     callers can think of recompile as logically separate from probe,
 *     but the implementation co-locates them here because they share
 *     the browser session.)
 *   - `composition` (videos/audios/duration) is mutated in place — callers
 *     downstream see the reconciled view through the same object reference.
 *   - The stage computes the final composition `duration` and `totalFrames`
 *     and returns them. Assigning those values onto the `RenderJob` is the
 *     sequencer's responsibility — a future chunk worker can't mutate the
 *     orchestrator's `job` object, and keeping the assignment in one place
 *     prevents the same value living in two writers.
 *   - The "Composition duration is 0" diagnostic builds the same hint
 *     string from the same console-buffer regex and `__timelines` probe.
 *   - The post-probe "failed network requests" warning fires with the same
 *     regex, the same first-10/first-5 slicing, and the same `console.warn`
 *     prefix.
 */

import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  closeCaptureSession,
  createCaptureSession,
  getCompositionDuration,
  initializeSession,
  isTransientBrowserError,
  probeBeginFrameLiveness,
} from "@hyperframes/engine";
import { fpsToNumber } from "@hyperframes/core";
import type { CompiledComposition } from "../../htmlCompiler.js";
import {
  discoverMediaFromBrowser,
  discoverAudioVolumeAutomationFromTimeline,
  discoverVideoVisibilityFromTimeline,
  recompileWithResolutions,
  resolveCompositionDurations,
} from "../../htmlCompiler.js";
import { createFileServer, type FileServerHandle, VIRTUAL_TIME_SHIM } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import {
  BROWSER_MEDIA_EPSILON,
  projectBrowserEndToCompositionTimeline,
  resolveBrowserMediaEnd,
  writeCompiledArtifacts,
  type CompositionMetadata,
} from "../shared.js";
import type { RenderJob } from "../../renderOrchestrator.js";
import { isActionableProbeFailure } from "./probeFailures.js";

export interface ProbeStageInput {
  projectDir: string;
  workDir: string;
  job: RenderJob;
  cfg: EngineConfig;
  /**
   * Capture-mode flag threaded from the orchestrator. The stage derives a
   * local copy of `cfg` with this value applied to `forceScreenshot`
   * before any engine call, so the caller-owned `cfg` is never mutated.
   */
  forceScreenshot: boolean;
  log: ProducerLogger;
  assertNotAborted: () => void;
  /** From compileStage. May be replaced via `recompileWithResolutions`. */
  compiled: CompiledComposition;
  /** From compileStage. Mutated in place (videos/audios pushed, duration set). */
  composition: CompositionMetadata;
  width: number;
  height: number;
  needsAlpha: boolean;
  deviceScaleFactor: number;
}

const FRAME_BOUNDARY_EPSILON = 1e-3;

function durationToFrameCount(duration: number, fps: number): number {
  const rawFrameCount = duration * fps;
  const nearestFrame = Math.round(rawFrameCount);
  return Math.abs(rawFrameCount - nearestFrame) <= FRAME_BOUNDARY_EPSILON
    ? nearestFrame
    : Math.ceil(rawFrameCount);
}

export interface ProbeStageResult {
  /** May be reassigned from `recompileWithResolutions`. */
  compiled: CompiledComposition;
  /** Created when `needsBrowser` was true; `null` otherwise. */
  fileServer: FileServerHandle | null;
  /** Created when `needsBrowser` was true; `null` otherwise. */
  probeSession: CaptureSession | null;
  /** The probeSession's `browserConsoleBuffer`, or `[]` if no probe ran. */
  lastBrowserConsole: string[];
  /** Composition duration (post-probe). Guaranteed > 0 — the stage throws on <= 0. */
  duration: number;
  totalFrames: number;
  /** Wall-clock ms for the entire probe phase (near-zero when `needsBrowser` was false). */
  browserProbeMs: number;
  /**
   * True when the BeginFrame liveness probe timed out on this host (SwiftShader
   * stalls the first BeginFrame indefinitely for heavy-layer compositions —
   * style-N caption comps). The probe session has already been relaunched in
   * screenshot mode; the sequencer must flip its `captureForceScreenshot`
   * local so downstream capture stages follow.
   */
  beginFrameStalled: boolean;
}

export function hasScriptedAudioVolumeAutomation(html: string, audioCount: number): boolean {
  if (audioCount <= 0) return false;

  const { document } = parseHTML(html);
  const scriptBodies = [...document.querySelectorAll("script")]
    .map((script) => script.textContent ?? "")
    .join("\n");
  if (!scriptBodies) return false;

  return (
    /\.\s*volume\s*=/i.test(scriptBodies) ||
    /\b(?:gsap|tl|timeline|tween)\s*\.\s*(?:to|fromTo|set)\s*\([\s\S]{0,2000}\bvolume\s*:/i.test(
      scriptBodies,
    )
  );
}

/**
 * True when the compiled HTML has at least one `<video>` carrying the
 * auto-injected `data-hf-auto-start` sentinel. Uses a DOM query, not a
 * substring scan — `html.includes("data-hf-auto-start")` false-fires on any
 * comment or prose that merely mentions the attribute (issue #1938).
 */
export function hasAutoStartVideos(html: string): boolean {
  const { document } = parseHTML(html);
  return document.querySelector("video[data-hf-auto-start]") !== null;
}

/**
 * Variable-bound audio/video sources are resolved by the browser runtime, not
 * the static compiler. Probe them whenever the current render overrides the
 * referenced variable so media extraction follows the resolved row value.
 */
export function hasVariableBoundMedia(
  html: string,
  variables: Record<string, unknown> | undefined,
): boolean {
  if (!variables || Object.keys(variables).length === 0) return false;
  const { document } = parseHTML(html);
  return Array.from(
    document.querySelectorAll("audio[data-var-src], video[data-var-src], source[data-var-src]"),
  ).some((element) => {
    const variableId = element.getAttribute("data-var-src")?.trim();
    return Boolean(variableId && Object.hasOwn(variables, variableId));
  });
}

/**
 * Runtime-created media does not exist when the static compiler scans the HTML.
 * Launch a browser probe so discoverMediaFromBrowser can reconcile it before
 * extraction, even when the root duration is already known. External script
 * sources have no inline text to inspect and remain a known heuristic gap.
 */
function hasRuntimeInsertedMedia(html: string): boolean {
  const { document } = parseHTML(html);
  const scriptBodies = [...document.querySelectorAll("script")]
    .map((script) => script.textContent ?? "")
    .join("\n");
  return (
    /\bcreateElement\s*\(\s*["'`](?:video|audio)["'`]\s*\)/i.test(scriptBodies) ||
    /\bnew\s+(?:Audio|Video)\s*\(/i.test(scriptBodies) ||
    /<(?:video|audio)\b[^>]*>/i.test(scriptBodies)
  );
}

export async function runProbeStage(input: ProbeStageInput): Promise<ProbeStageResult> {
  const {
    projectDir,
    workDir,
    job,
    cfg,
    forceScreenshot,
    log,
    assertNotAborted,
    composition,
    width,
    height,
    needsAlpha,
    deviceScaleFactor,
  } = input;
  let { compiled } = input;

  const probeCfg: EngineConfig =
    cfg.forceScreenshot === forceScreenshot ? cfg : { ...cfg, forceScreenshot };

  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let beginFrameStalled = false;
  let lastBrowserConsole: string[] = [];

  const probeStart = Date.now();
  const hasAutoStart = hasAutoStartVideos(compiled.html);
  const hasScriptedAudio = hasScriptedAudioVolumeAutomation(
    compiled.html,
    composition.audios.length,
  );
  const hasVariableMedia = hasVariableBoundMedia(compiled.html, job.config.variables);
  const hasInsertedMedia = hasRuntimeInsertedMedia(compiled.html);
  const needsBrowser =
    composition.duration <= 0 ||
    compiled.unresolvedCompositions.length > 0 ||
    hasAutoStart ||
    hasScriptedAudio ||
    hasVariableMedia ||
    hasInsertedMedia;

  if (needsBrowser) {
    const reasons = [];
    if (composition.duration <= 0) reasons.push("root duration unknown");
    if (compiled.unresolvedCompositions.length > 0)
      reasons.push(`${compiled.unresolvedCompositions.length} unresolved composition(s)`);
    if (hasAutoStart) reasons.push("auto-start video(s)");
    if (hasScriptedAudio) reasons.push("scripted audio volume");
    if (hasInsertedMedia) reasons.push("runtime-inserted media");
    if (hasVariableMedia) reasons.push("variable-bound media source(s)");

    log.info("Launching browser for composition probe...", {
      reasons,
    });

    fileServer = await createFileServer({
      projectDir,
      compiledDir: join(workDir, "compiled"),
      port: 0,
      preHeadScripts: [VIRTUAL_TIME_SHIM],
      fps: job.config.fps,
    });
    assertNotAborted();

    const captureOpts: CaptureOptions = {
      width,
      height,
      fps: job.config.fps,
      format: needsAlpha ? "png" : "jpeg",
      quality: needsAlpha ? undefined : 80,
      variables: job.config.variables,
      deviceScaleFactor,
    };

    const PROBE_MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
      const attemptStart = Date.now();
      try {
        log.info("Creating capture session...", { attempt, maxAttempts: PROBE_MAX_ATTEMPTS });
        probeSession = await createCaptureSession(
          fileServer.url,
          join(workDir, "probe"),
          captureOpts,
          null,
          probeCfg,
        );
        log.info("Waiting for composition to initialize...", { attempt });
        const heartbeat = setInterval(() => {
          const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(1);
          log.info(`Still waiting for browser initialization... (${elapsed}s elapsed)`);
        }, 30_000);
        try {
          await initializeSession(probeSession);
        } finally {
          clearInterval(heartbeat);
        }
      } catch (err) {
        const isTransient = isTransientBrowserError(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn("Browser probe attempt failed", {
          attempt,
          maxAttempts: PROBE_MAX_ATTEMPTS,
          isTransient,
          error: errMsg,
          elapsedMs: Date.now() - attemptStart,
        });

        if (probeSession) {
          try {
            await closeCaptureSession(probeSession);
          } catch (closeErr) {
            log.warn("Failed to close crashed probe session", {
              error: closeErr instanceof Error ? closeErr.message : String(closeErr),
            });
          }
          probeSession = null;
        }

        if (isTransient && attempt < PROBE_MAX_ATTEMPTS) {
          log.info("Retrying with a fresh browser session...", {
            attempt: attempt + 1,
            maxAttempts: PROBE_MAX_ATTEMPTS,
          });
          assertNotAborted();
          continue;
        }
        throw err;
      }
      log.info("Composition ready", {
        attempt,
        initMs: Date.now() - attemptStart,
      });
      break;
    }
    assertNotAborted();
    // After the retry loop, probeSession is guaranteed non-null (the loop
    // either breaks with a valid session or throws on the last attempt).
    const session = probeSession!;
    probeSession = session;
    lastBrowserConsole = session.browserConsoleBuffer;

    // BeginFrame liveness probe. On SwiftShader, heavy-layer compositions
    // (multi-group nested opacity caption animations — style-N prod comps)
    // stall the FIRST BeginFrame indefinitely (tested to 30 min). The
    // auto-worker calibration catches this via its capped protocol timeout,
    // but renders with explicit `--workers N` skip calibration and would
    // hang for the full protocol timeout. One bounded BeginFrame here gives
    // ground truth for every render that probes a browser: on stall,
    // relaunch the probe session in screenshot mode and tell the sequencer
    // (via `beginFrameStalled`) to route the whole render through
    // screenshot capture — the path the baseline already uses for these
    // comps. Healthy comps pay one extra composited frame (<1s on GPU, a
    // few seconds on SwiftShader).
    if (probeSession.launchCaptureMode === "beginframe") {
      const probeTimeoutMs =
        Number(process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS) > 0
          ? Number(process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS)
          : 30_000;
      const livenessStart = Date.now();
      // Tick inside the post-warmup cushion: warmup < probe < first capture
      // keeps the session's BeginFrame frameTimeTicks monotonic.
      const probeTick = Math.max(
        0,
        probeSession.beginFrameTimeTicks - 5 * probeSession.beginFrameIntervalMs,
      );
      const alive = await probeBeginFrameLiveness(
        probeSession.page,
        probeTimeoutMs,
        probeTick,
        probeSession.beginFrameIntervalMs,
      );
      assertNotAborted();
      if (alive) {
        log.info("BeginFrame liveness probe passed", {
          probeMs: Date.now() - livenessStart,
        });
      } else {
        beginFrameStalled = true;
        log.warn(
          "[Render] BeginFrame liveness probe timed out — this composition stalls " +
            "BeginFrame on this host (SwiftShader heavy-layer pattern). Relaunching " +
            "the probe browser in screenshot capture mode; the render will use " +
            "screenshot capture throughout.",
          { probeTimeoutMs },
        );
        lastBrowserConsole = probeSession.browserConsoleBuffer;
        await closeCaptureSession(probeSession).catch(() => {});
        probeSession = await createCaptureSession(
          fileServer.url,
          join(workDir, "probe-screenshot"),
          captureOpts,
          null,
          { ...probeCfg, forceScreenshot: true },
        );
        await initializeSession(probeSession);
        assertNotAborted();
        lastBrowserConsole = probeSession.browserConsoleBuffer;
      }
    }

    // Discover root composition duration
    if (composition.duration <= 0) {
      log.info("Discovering composition duration...");
      const discoveredDuration = await getCompositionDuration(session);
      assertNotAborted();
      log.info("Probed composition duration from browser", {
        discoveredDuration,
        staticDuration: compiled.staticDuration,
      });
      composition.duration = discoveredDuration;
    } else {
      log.info("Using static duration from data-duration attribute", {
        duration: composition.duration,
      });
    }

    // Resolve unresolved composition durations via window.__timelines
    if (compiled.unresolvedCompositions.length > 0) {
      const resolutions = await resolveCompositionDurations(
        session.page,
        compiled.unresolvedCompositions,
      );
      assertNotAborted();
      if (resolutions.length > 0) {
        compiled = await recompileWithResolutions(
          compiled,
          resolutions,
          projectDir,
          join(workDir, "downloads"),
        );
        assertNotAborted();
        // Update composition metadata with re-parsed media
        composition.videos = compiled.videos;
        composition.audios = compiled.audios;
        composition.images = compiled.images;
        writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));
      }
    }

    // Discover media elements from browser DOM (catches dynamically-set src)
    log.info("Discovering media assets from browser DOM...");
    const browserMedia = await discoverMediaFromBrowser(session.page);
    assertNotAborted();
    if (browserMedia.length > 0) {
      const existingVideoIds = new Set(composition.videos.map((v) => v.id));
      const existingAudioIds = new Set(composition.audios.map((a) => a.id));

      pruneMutedBrowserMedia(composition, browserMedia, existingAudioIds);

      for (const el of browserMedia) {
        if (!el.src || el.src === "about:blank") continue;
        if (el.muted && el.tagName === "audio") continue;

        // Convert absolute localhost URLs back to relative paths
        let src = el.src;
        if (fileServer && src.startsWith(fileServer.url)) {
          src = src.slice(fileServer.url.length).replace(/^\//, "");
        }

        if (el.tagName === "video") {
          // fallow-ignore-next-line code-duplication
          if (existingVideoIds.has(el.id)) {
            // Reconcile to browser/runtime media metadata (runtime src can differ from static HTML).
            const existing = composition.videos.find((v) => v.id === el.id);
            if (existing) {
              if (existing.src !== src) {
                existing.src = src;
              }
              const projectedEnd = projectBrowserEndToCompositionTimeline(
                existing.start,
                el.start,
                resolveBrowserMediaEnd(el.start, el.end, el.duration),
              );
              if (
                projectedEnd > 0 &&
                (existing.end <= 0 || Math.abs(existing.end - projectedEnd) > BROWSER_MEDIA_EPSILON)
              ) {
                existing.end = projectedEnd;
              }
              if (
                el.mediaStart > 0 &&
                (existing.mediaStart <= 0 ||
                  Math.abs(existing.mediaStart - el.mediaStart) > BROWSER_MEDIA_EPSILON)
              ) {
                existing.mediaStart = el.mediaStart;
              }
              if (el.hasAudio && !el.muted && !existing.hasAudio) {
                existing.hasAudio = true;
              }
              if (el.loop && !existing.loop) {
                existing.loop = true;
              }
            }
          } else {
            // New video discovered from browser
            composition.videos.push({
              id: el.id,
              src,
              start: el.start,
              end: resolveBrowserMediaEnd(el.start, el.end, el.duration),
              mediaStart: el.mediaStart,
              loop: el.loop,
              hasAudio: el.hasAudio && !el.muted,
            });
            existingVideoIds.add(el.id);
          }
        } else if (el.tagName === "audio") {
          // fallow-ignore-next-line code-duplication
          if (existingAudioIds.has(el.id)) {
            const existing = composition.audios.find((a) => a.id === el.id);
            if (existing) {
              if (existing.src !== src) {
                existing.src = src;
              }
              const projectedEnd = projectBrowserEndToCompositionTimeline(
                existing.start,
                el.start,
                resolveBrowserMediaEnd(el.start, el.end, el.duration),
              );
              if (
                projectedEnd > 0 &&
                (existing.end <= 0 || Math.abs(existing.end - projectedEnd) > BROWSER_MEDIA_EPSILON)
              ) {
                existing.end = projectedEnd;
              }
              if (
                el.mediaStart > 0 &&
                (existing.mediaStart <= 0 ||
                  Math.abs(existing.mediaStart - el.mediaStart) > BROWSER_MEDIA_EPSILON)
              ) {
                existing.mediaStart = el.mediaStart;
              }
              if (
                el.volume > 0 &&
                Math.abs((existing.volume ?? 1) - el.volume) > BROWSER_MEDIA_EPSILON
              ) {
                existing.volume = el.volume;
              }
            }
          } else {
            composition.audios.push({
              id: el.id,
              src,
              start: el.start,
              end: resolveBrowserMediaEnd(el.start, el.end, el.duration),
              mediaStart: el.mediaStart,
              layer: 0,
              volume: el.volume,
              type: "audio",
            });
            existingAudioIds.add(el.id);
          }
        }
      }
    }

    if (composition.audios.length > 0) {
      log.info("Discovering audio volume automation...", {
        audioCount: composition.audios.length,
      });
      const automation = await discoverAudioVolumeAutomationFromTimeline(
        session.page,
        composition.audios.map((audio) => audio.id),
        composition.duration,
        fpsToNumber(job.config.fps),
      );
      assertNotAborted();
      if (automation.length > 0) {
        const byId = new Map(automation.map((entry) => [entry.id, entry.keyframes]));
        for (const audio of composition.audios) {
          const keyframes = byId.get(audio.id);
          if (!keyframes || keyframes.length === 0) continue;
          audio.volumeKeyframes = keyframes;
          log.info(`[Probe] Runtime audio volume automation: ${audio.id}`, {
            keyframeCount: keyframes.length,
          });
        }
      }
    }

    // Runtime video discovery: for videos with auto-injected timing (data-hf-auto-start),
    // seek the GSAP timeline to find actual scene visibility windows and override start/end.
    if (composition.videos.length > 0) {
      log.info("Discovering video visibility windows...", {
        videoCount: composition.videos.length,
      });
      const visibilityWindows = await discoverVideoVisibilityFromTimeline(
        session.page,
        composition.duration,
      );
      assertNotAborted();

      for (const win of visibilityWindows) {
        const video = composition.videos.find((v) => v.id === win.videoId);
        if (!video) continue;
        if (win.visibleStart >= 0 && win.visibleEnd > win.visibleStart) {
          video.start = win.visibleStart;
          video.end = win.visibleEnd;
          log.info(
            `[Probe] Runtime video discovery: ${video.id} visible ${win.visibleStart.toFixed(2)}s–${win.visibleEnd.toFixed(2)}s`,
          );
        }
      }
    }
  }
  const browserProbeMs = Date.now() - probeStart;

  const duration = composition.duration;
  const totalFrames = durationToFrameCount(duration, fpsToNumber(job.config.fps));

  if (duration <= 0) {
    // Gather diagnostics to help users understand why the render would produce a black video.
    // Wrapped in try/catch because the browser tab may have crashed (which could be
    // WHY duration is 0), and we don't want a Puppeteer error to mask the real message.
    const diagnostics: string[] = [];
    try {
      if (probeSession) {
        const timelinesInfo = await probeSession.page.evaluate(() => {
          const tl = (window as any).__timelines;
          const hf = (window as any).__hf;
          return {
            timelineKeys: tl ? Object.keys(tl) : [],
            hfDuration: hf?.duration ?? null,
            gsapLoaded: typeof (window as any).gsap !== "undefined",
          };
        });
        if (!timelinesInfo.gsapLoaded) {
          diagnostics.push(
            "GSAP is not loaded — CDN script may have failed to download. " +
              "Bundle GSAP locally in your project instead of using a CDN <script src>.",
          );
        } else if (timelinesInfo.timelineKeys.length === 0) {
          diagnostics.push(
            "GSAP is loaded but no timelines were registered on window.__timelines. " +
              "Ensure your script creates a timeline and assigns it: " +
              'window.__timelines["main"] = gsap.timeline({ paused: true });',
          );
        }
        for (const line of probeSession.browserConsoleBuffer) {
          if (/\[Browser:ERROR\]|\[Browser:PAGEERROR\]|404|net::ERR_/i.test(line)) {
            diagnostics.push(`Browser: ${line}`);
          }
        }
      }
    } catch (err) {
      log.warn("Failed to gather browser diagnostics for zero-duration composition", {
        error: err instanceof Error ? err.message : String(err),
      });
      diagnostics.push("(Could not gather browser diagnostics — page may have crashed)");
    }
    const hint =
      diagnostics.length > 0
        ? "\n\nDiagnostics:\n  - " + diagnostics.join("\n  - ")
        : "\n\nCheck that GSAP timelines are registered on window.__timelines.";
    throw new Error("Composition duration is 0 — this would produce a black video." + hint);
  }

  // Surface browser-side asset failures (404s, script errors) as warnings.
  // These don't block the render but indicate missing images, fonts, or
  // scripts that may produce unexpected visual artifacts.
  if (probeSession) {
    const failedRequests = probeSession.browserConsoleBuffer.filter(isActionableProbeFailure);
    if (failedRequests.length > 0) {
      log.warn("Browser encountered network failures during page load:", {
        failures: failedRequests.slice(0, 10),
      });
      for (const line of failedRequests.slice(0, 5)) {
        console.warn(`[Render] Asset load failure: ${line}`);
      }
    }
  }

  return {
    compiled,
    fileServer,
    probeSession,
    lastBrowserConsole,
    duration,
    totalFrames,
    browserProbeMs,
    beginFrameStalled,
  };
}

/**
 * Preview/render parity for `muted` media: the runtime keeps muted elements
 * silent, so the mixer must exclude their audio too (they used to be mixed at
 * full volume). Muted video still renders frames but loses its audio track;
 * muted audio drops out of the mix entirely. Pure over its inputs so the
 * parity rule is testable without the probe-session harness.
 */
export function pruneMutedBrowserMedia(
  composition: {
    videos: { id: string; hasAudio?: boolean }[];
    audios: { id: string }[];
  },
  browserMedia: { id: string; tagName: string; muted?: boolean }[],
  existingAudioIds?: Set<string>,
): void {
  for (const el of browserMedia) {
    if (!el.muted) continue;
    if (el.tagName === "video") {
      const existing = composition.videos.find((v) => v.id === el.id);
      if (existing) existing.hasAudio = false;
    } else {
      const idx = composition.audios.findIndex((a) => a.id === el.id);
      if (idx >= 0) composition.audios.splice(idx, 1);
      existingAudioIds?.delete(el.id);
    }
  }
}
