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
  writeCompiledArtifacts,
  type CompositionMetadata,
} from "../shared.js";
import type { RenderJob } from "../../renderOrchestrator.js";

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
  let lastBrowserConsole: string[] = [];

  const probeStart = Date.now();
  const hasAutoStart = hasAutoStartVideos(compiled.html);
  const hasScriptedAudio = hasScriptedAudioVolumeAutomation(
    compiled.html,
    composition.audios.length,
  );
  const needsBrowser =
    composition.duration <= 0 ||
    compiled.unresolvedCompositions.length > 0 ||
    hasAutoStart ||
    hasScriptedAudio;

  if (needsBrowser) {
    const reasons = [];
    if (composition.duration <= 0) reasons.push("root duration unknown");
    if (compiled.unresolvedCompositions.length > 0)
      reasons.push(`${compiled.unresolvedCompositions.length} unresolved composition(s)`);
    if (hasAutoStart) reasons.push("auto-start video(s)");
    if (hasScriptedAudio) reasons.push("scripted audio volume");

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

      for (const el of browserMedia) {
        if (!el.src || el.src === "about:blank") continue;

        // Convert absolute localhost URLs back to relative paths
        let src = el.src;
        if (fileServer && src.startsWith(fileServer.url)) {
          src = src.slice(fileServer.url.length).replace(/^\//, "");
        }

        if (el.tagName === "video") {
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
                el.end,
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
              if (el.hasAudio && !existing.hasAudio) {
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
              end: el.end,
              mediaStart: el.mediaStart,
              loop: el.loop,
              hasAudio: el.hasAudio,
            });
            existingVideoIds.add(el.id);
          }
        } else if (el.tagName === "audio") {
          if (existingAudioIds.has(el.id)) {
            const existing = composition.audios.find((a) => a.id === el.id);
            if (existing) {
              if (existing.src !== src) {
                existing.src = src;
              }
              const projectedEnd = projectBrowserEndToCompositionTimeline(
                existing.start,
                el.start,
                el.end,
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
              end: el.end,
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
  const totalFrames = Math.ceil(duration * fpsToNumber(job.config.fps));

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
    const failedRequests = probeSession.browserConsoleBuffer.filter((line) =>
      /404|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|net::ERR_/i.test(line),
    );
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
  };
}
