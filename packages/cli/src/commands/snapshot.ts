// fallow-ignore-file complexity
import { defineCommand } from "citty";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, basename } from "node:path";
import {
  openSettledCompositionPage,
  runFfmpegOnce,
  seekCompositionTimeline,
} from "../capture/captureCompositionFrame.js";
import { resolveProject } from "../utils/project.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { c } from "../ui/colors.js";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { parseAngle, type Camera } from "./motionShotLayout.js";
import type { Example } from "./_examples.js";

// Runs IN THE BROWSER (serialized into page.evaluate). Tilt the whole stage so
// the REAL painted pixels are viewed from an orthogonal angle (FINDING [10]:
// snapshot only captured the composition's own head-on camera, so 3D depth /
// occlusion couldn't be verified). Same approach as motionShot's orbit camera:
// make the composition root + its ancestor chain preserve-3d, strip intermediate
// perspective, put one perspective on the root's parent (the lens) and rotate
// the root — works on any composition shape (no #stage assumption).
//
// Kept as a self-contained copy of motionShot.ts's `applyOrbitCamera` because
// that one is module-private; this is ~15 lines and sharing it would mean
// touching motionShot.ts (out of scope for this change).
function orbitStageSource(): string {
  return `function(cam) {
    var root = document.querySelector("[data-composition-id]")
      || document.querySelector("#stage")
      || document.body.firstElementChild
      || document.body;
    var n = root;
    while (n && n !== document.body) {
      n.style.transformStyle = "preserve-3d";
      n.style.perspective = "none";
      n = n.parentElement;
    }
    root.style.transformStyle = "preserve-3d";
    root.style.perspective = "none";
    root.style.transformOrigin = "50% 50%";
    root.style.transform = "rotateX(" + cam.pitch + "deg) rotateY(" + cam.yaw + "deg)";
    var lens = root.parentElement || document.body;
    lens.style.perspective = "1600px";
    lens.style.perspectiveOrigin = "50% 50%";
  }`;
}

/** Maximum time a single-frame FFmpeg extract is allowed to run. Mirrors the
 * default applied by `@hyperframes/engine`'s `runFfmpeg` so a pathological
 * clip (corrupt media, stalled network mount, codec edge case) cannot wedge
 * `hyperframes snapshot` indefinitely. */
const FFMPEG_EXTRACT_TIMEOUT_MS = 30_000;

/**
 * Extract a single frame from a video file at `timeSeconds` via FFmpeg.
 * Used to work around Chrome-headless's inability to reliably seek
 * <video> elements during snapshot capture.
 */
async function extractVideoFrameToBuffer(
  videoPath: string,
  timeSeconds: number,
  useVp9AlphaDecoder = false,
): Promise<Buffer | null> {
  const tmp = mkdtempSync(join(tmpdir(), "hf-snapshot-frame-"));
  const outPath = join(tmp, "frame.png");
  try {
    const ffmpegPath = findFFmpeg();
    if (!ffmpegPath) return null;
    // `-ss` before `-i` performs a fast keyframe seek; adequate for snapshot accuracy
    // (±1 frame) and orders of magnitude faster than the decode-and-scan alternative.
    const args = ["-hide_banner", "-loglevel", "error"];
    if (useVp9AlphaDecoder) {
      args.push("-c:v", "libvpx-vp9");
    }
    args.push(
      "-ss",
      String(Math.max(0, timeSeconds)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      outPath,
    );
    const result = await runFfmpegOnce(ffmpegPath, args, FFMPEG_EXTRACT_TIMEOUT_MS);
    if (result.code !== 0 || result.timedOut || !existsSync(outPath)) return null;
    return readFileSync(outPath);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

export const examples: Example[] = [
  ["Capture 5 key frames from a composition", "snapshot capture"],
  ["Capture 10 evenly-spaced frames", "snapshot capture --frames 10"],
  ["View the 3D stage from an isometric angle", "snapshot capture --angle iso"],
];

/**
 * Seeking the timeline to EXACTLY `data-duration` renders blank — the runtime
 * treats t >= clip-end as past-end and unmounts the clip (verified on a V4 3D
 * artifact: t=8.0 of an 8s clip was pure white, t=7.76 showed the final hero).
 * So the "final frame" must be sampled just-before-end. The blank tail observed
 * spanned the last ~2.5% of the timeline, hence a 3%-of-duration nudge (floored
 * at 50ms so very short clips still back off a readable amount).
 */
export function tailFrameTime(duration: number): number {
  return Math.max(0, duration - Math.max(0.05, duration * 0.03));
}

/**
 * Pick the seek positions to screenshot. Pure so the "tail is always captured"
 * guarantee is unit-testable (FINDING [7]: evenly-spaced --at times skipped the
 * final beat and short hero beats with no signal).
 *
 * - No --at: evenly-spaced frames, but the LAST point is moved off the exact
 *   duration to `tailFrameTime` so it isn't blank.
 * - With --at: the user's exact times are honoured, plus a guaranteed
 *   end-of-timeline frame appended (unless `includeEnd` is false), so the tail
 *   is never silently skipped. A near-duplicate of the tail is not added twice.
 *
 * `appendedTail` flags that the readable-tail frame was added on top of the
 * caller's request — used to warn that short sub-interval beats between samples
 * may still be missed and need explicit --at.
 */
export function computeSnapshotTimes(
  duration: number,
  opts: { frames: number; at?: number[]; includeEnd?: boolean },
): { times: number[]; appendedTail: boolean } {
  const includeEnd = opts.includeEnd !== false;
  const tail = tailFrameTime(duration);
  const round = (t: number) => Math.round(t * 1000) / 1000;

  if (opts.at?.length) {
    const times = opts.at.map(round);
    // Only append if the user didn't already sample at/near the readable tail.
    const hasTail = times.some((t) => Math.abs(t - tail) < 0.05 || t >= duration);
    if (includeEnd && duration > 0 && !hasTail) {
      return { times: [...times, round(tail)], appendedTail: true };
    }
    return { times, appendedTail: false };
  }

  const n = opts.frames;
  if (n <= 1) return { times: [round(duration / 2)], appendedTail: false };
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
  // Replace the final (exact-duration, blank) point with the readable tail.
  if (includeEnd) times[times.length - 1] = tail;
  return { times: times.map(round), appendedTail: false };
}

/**
 * Render key frames from a composition as PNG screenshots.
 * The agent can Read these to verify its output visually.
 */
async function captureSnapshots(
  projectDir: string,
  opts: {
    frames?: number;
    timeout?: number;
    at?: number[];
    outputDir?: string;
    angle?: Camera;
    includeEnd?: boolean;
  },
): Promise<string[]> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");

  const numFrames = opts.frames ?? 5;

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(projectDir, html);

  const savedPaths: string[] = [];

  try {
    const { browser: chromeBrowser, page } = await openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: opts.timeout ?? 5000,
      renderReadyWarningSuffix: "snapshots may be inaccurate",
    });

    try {
      // Font verification — split into loaded / errored / unused. Only status
      // "error" is a real failure; a face still "unloaded"/"loading" after
      // document.fonts.ready + the settle wait was simply never requested by any
      // rendered text (an unused @font-face), so it is reported as "unused", not
      // FAILED — printing it as FAILED alongside "loaded" read as a contradiction.
      const fontReport = await page
        .evaluate(() => {
          const loaded: string[] = [];
          const errored: string[] = [];
          const unused: string[] = [];
          (document as any).fonts.forEach((f: any) => {
            const entry = `${f.family} (${f.weight} ${f.style})`;
            if (f.status === "loaded") loaded.push(entry);
            else if (f.status === "error") errored.push(entry);
            else unused.push(entry);
          });
          return { loaded, errored, unused };
        })
        .catch(() => ({ loaded: [] as string[], errored: [] as string[], unused: [] as string[] }));

      if (
        fontReport.loaded.length > 0 ||
        fontReport.errored.length > 0 ||
        fontReport.unused.length > 0
      ) {
        const parts = [`${fontReport.loaded.length} loaded`];
        if (fontReport.errored.length > 0) parts.push(`${fontReport.errored.length} failed`);
        if (fontReport.unused.length > 0) parts.push(`${fontReport.unused.length} unused`);
        console.log(`\n   ${c.dim("Fonts:")} ${parts.join(", ")}`);
        if (fontReport.errored.length > 0) {
          console.log(`   ${c.error("Fonts FAILED:")} ${fontReport.errored.join(", ")}`);
        }
      }

      const duration = await page.evaluate(() => {
        const win = window as any;
        if (typeof win.__player?.getDuration === "function") {
          const d = win.__player.getDuration();
          if (Number.isFinite(d) && d > 0) return d;
        }
        const root = document.querySelector("[data-composition-id][data-duration]");
        if (root) return parseFloat(root.getAttribute("data-duration") ?? "0");
        return 0;
      });

      if (duration <= 0 && !opts.at?.length) {
        return [];
      }

      // Calculate seek positions — explicit timestamps or evenly spaced, always
      // including a readable end-of-timeline frame (FINDING [7]).
      const { times: positions, appendedTail } = computeSnapshotTimes(duration, {
        frames: numFrames,
        at: opts.at,
        includeEnd: opts.includeEnd,
      });
      if (appendedTail) {
        console.log(
          `   ${c.dim(`Note: added an end-of-timeline frame at ${positions[positions.length - 1]!.toFixed(2)}s. Short beats between your --at times may still be skipped — pass them explicitly.`)}`,
        );
      }

      // Orthogonal camera (FINDING [10]) — re-applied after each seek inside the
      // loop, since renderSeek may touch the stage's inline transform.
      const cameraExpr =
        opts.angle && (opts.angle.yaw !== 0 || opts.angle.pitch !== 0)
          ? `(${orbitStageSource()})(${JSON.stringify(opts.angle)})`
          : null;

      const snapshotDir = opts.outputDir ?? join(projectDir, "snapshots");
      mkdirSync(snapshotDir, { recursive: true });
      try {
        const { readdirSync } = await import("node:fs");
        for (const file of readdirSync(snapshotDir)) {
          if (/\.(png|jpg|jpeg)$/i.test(file)) {
            rmSync(join(snapshotDir, file), { force: true });
          }
        }
      } catch {
        /* best-effort — proceed even if cleanup fails */
      }

      // Chrome-headless ignores programmatic <video>.currentTime writes, so
      // we extract frames via FFmpeg and overlay them as <img> elements.
      //
      // The engine's injectVideoFramesBatch returns the subset of videoIds it
      // actually painted (skipped ancestor-hidden videos are excluded).
      // Snapshot doesn't use the return value, but the local type must match
      // the real export — a `Promise<void>` shape rejects the `as` cast on
      // the dynamic import.
      type InjectFn = (
        page: unknown,
        updates: Array<{ videoId: string; dataUri: string }>,
      ) => Promise<string[]>;
      type SyncVisibilityFn = (page: unknown, activeVideoIds: string[]) => Promise<void>;
      type ExtractMediaMetadataFn = (
        filePath: string,
      ) => Promise<{ videoCodec: string; hasAlpha: boolean }>;
      let injectVideoFramesBatch: InjectFn | null = null;
      let syncVideoFrameVisibility: SyncVisibilityFn | null = null;
      let extractMediaMetadata: ExtractMediaMetadataFn | null = null;
      try {
        const engine = (await import("@hyperframes/engine")) as {
          injectVideoFramesBatch: InjectFn;
          syncVideoFrameVisibility: SyncVisibilityFn;
          extractMediaMetadata: ExtractMediaMetadataFn;
        };
        injectVideoFramesBatch = engine.injectVideoFramesBatch;
        syncVideoFrameVisibility = engine.syncVideoFrameVisibility;
        extractMediaMetadata = engine.extractMediaMetadata;
      } catch {
        // Engine unavailable in this install — snapshot will still run, and
        // compositions without <video data-start> get exactly the old behaviour.
      }
      const alphaDecoderCache = new Map<string, Promise<boolean>>();
      const shouldUseVp9AlphaDecoder = (filePath: string): Promise<boolean> => {
        if (!extractMediaMetadata) return Promise.resolve(false);
        const cached = alphaDecoderCache.get(filePath);
        if (cached) return cached;
        const pending = extractMediaMetadata(filePath)
          .then((meta) => meta.hasAlpha && meta.videoCodec === "vp9")
          .catch(() => false);
        alphaDecoderCache.set(filePath, pending);
        return pending;
      };

      const hasPlayer = await page.evaluate(() => !!(window as any).__player);
      if (!hasPlayer) {
        console.warn(`   ${c.warn("⚠")} No player API — seeks will be skipped`);
      }

      for (let i = 0; i < positions.length; i++) {
        const time = positions[i]!;

        await seekCompositionTimeline(page, time);

        if (cameraExpr) await page.evaluate(cameraExpr);

        if (injectVideoFramesBatch && syncVideoFrameVisibility) {
          const active = await page.evaluate((t: number) => {
            return Array.from(document.querySelectorAll("video[data-start]"))
              .map((el) => {
                const v = el as HTMLVideoElement;
                const start = parseFloat(v.dataset.start ?? "0") || 0;
                const rawRate = v.defaultPlaybackRate;
                const playbackRate =
                  Number.isFinite(rawRate) && rawRate > 0 ? Math.max(0.1, Math.min(5, rawRate)) : 1;
                const mediaStart =
                  parseFloat(v.dataset.playbackStart ?? v.dataset.mediaStart ?? "0") || 0;
                const rawDuration = parseFloat(v.dataset.duration ?? "");
                const srcDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
                const duration =
                  Number.isFinite(rawDuration) && rawDuration > 0
                    ? rawDuration
                    : srcDur > 0
                      ? Math.max(0, (srcDur - mediaStart) / playbackRate)
                      : Number.POSITIVE_INFINITY;
                let relTime = (t - start) * playbackRate + mediaStart;
                if (v.loop && srcDur > mediaStart && relTime >= srcDur) {
                  relTime = mediaStart + ((relTime - mediaStart) % (srcDur - mediaStart));
                }
                const activeNow = t >= start && t < start + duration && relTime >= 0 && !!v.id;
                return {
                  id: v.id,
                  src: v.currentSrc || v.src,
                  relTime,
                  active: activeNow,
                };
              })
              .filter((entry) => entry.active && entry.src);
          }, time);

          const updates: Array<{ videoId: string; dataUri: string }> = [];
          for (const v of active) {
            // Resolve the <video> src to an FFmpeg input. Prefer a project-local
            // file (fast, sandboxed); fall back to the absolute http(s) URL for
            // remote assets (e.g. an S3-hosted clip embedded by an upstream agent)
            // — FFmpeg reads http(s) input directly, and Chrome-headless can't seek
            // it either, so without this those videos render blank in snapshots.
            let ffmpegInput: string | null = null;
            let inputIsLocal = false;
            try {
              const url = new URL(v.src);
              const decodedPath = decodeURIComponent(url.pathname).replace(/^\//, "");
              const candidate = resolve(projectDir, decodedPath);
              const rel = relative(projectDir, candidate);
              if (!rel.startsWith("..") && !isAbsolute(rel) && existsSync(candidate)) {
                ffmpegInput = candidate;
                inputIsLocal = true;
              } else if (url.protocol === "http:" || url.protocol === "https:") {
                ffmpegInput = url.href;
              }
            } catch {
              /* unresolvable src (e.g. blob:, data:) — skip */
            }
            if (!ffmpegInput) continue;
            // VP9-alpha detection shells out to ffprobe, which has no timeout.
            // Only probe local files (filesystem-bounded); for remote URLs skip it
            // (pass false) so a stalled host can't wedge snapshot in ffprobe before
            // the bounded extractVideoFrameToBuffer below ever runs. Remote
            // VP9-alpha overlays aren't a current path — revisit with a bounded
            // ffprobe if one appears.
            const useVp9AlphaDecoder = inputIsLocal
              ? await shouldUseVp9AlphaDecoder(ffmpegInput)
              : false;
            const png = await extractVideoFrameToBuffer(
              ffmpegInput,
              Math.max(0, v.relTime),
              useVp9AlphaDecoder,
            );
            if (!png) continue;
            updates.push({
              videoId: v.id,
              dataUri: `data:image/png;base64,${png.toString("base64")}`,
            });
          }

          // Sync visibility even when empty — clears stale overlays from prior seeks
          try {
            if (updates.length > 0) {
              await injectVideoFramesBatch(page, updates);
            }
            await syncVideoFrameVisibility(
              page,
              active.map((a) => a.id),
            );
          } catch {
            /* fall through to plain screenshot */
          }
        }

        const timeLabel = `${time.toFixed(1)}s`;
        const filename = `frame-${String(i).padStart(2, "0")}-at-${timeLabel}.png`;
        const framePath = join(snapshotDir, filename);

        await page.screenshot({ path: framePath, type: "png" });
        const rel = relative(projectDir, framePath);
        savedPaths.push(rel.startsWith("..") || isAbsolute(rel) ? framePath : rel);
      }
    } finally {
      await chromeBrowser.close();
    }
  } finally {
    await server.close();
  }

  return savedPaths;
}

export default defineCommand({
  meta: {
    name: "snapshot",
    description: "Capture key frames from a composition as PNG screenshots for visual verification",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    output: {
      type: "string",
      alias: "o",
      description: "Directory to write snapshots into (default: <project>/snapshots)",
    },
    frames: {
      type: "string",
      description: "Number of evenly-spaced frames to capture (default: 5)",
      default: "5",
    },
    at: {
      type: "string",
      description: "Comma-separated timestamps in seconds (e.g., --at 3.0,10.5,18.0)",
    },
    timeout: {
      type: "string",
      description: "Ms to wait for runtime to initialize (default: 5000)",
      default: "5000",
    },
    angle: {
      type: "string",
      description:
        "Orthogonal 3D camera for depth/occlusion checks: a preset (front|iso|top|side) or 'yaw,pitch' degrees. Tilts the whole stage before screenshotting (real pixels, not bbox markers).",
    },
    end: {
      type: "boolean",
      description:
        "Always include a readable end-of-timeline frame (default: true). Pass --no-end to capture only your exact --at times.",
      default: true,
    },
    describe: {
      type: "string",
      description:
        "Gemini vision frame analysis. Runs by default when GEMINI_API_KEY is set. Pass a custom question (e.g. --describe 'Is the logo visible in every beat?') to override the default prompt, or --describe false to opt out.",
    },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const frames = parseInt(args.frames as string, 10) || 5;
    const timeout = parseInt(args.timeout as string, 10) || 5000;
    const atTimestamps = args.at
      ? String(args.at)
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !isNaN(n))
      : undefined;
    // Gemini frame analysis runs by default (silently skipped if
    // GEMINI_API_KEY is not set). `--describe "custom question"` overrides
    // the default prompt with a targeted question. `--describe false` opts
    // out entirely.
    const describeArg =
      args.describe === undefined
        ? "true"
        : String(args.describe) === "false"
          ? null
          : String(args.describe);

    const camera = args.angle ? parseAngle(String(args.angle)) : undefined;

    const label = atTimestamps
      ? `${atTimestamps.length} frames at [${atTimestamps.map((t) => t.toFixed(1) + "s").join(", ")}]`
      : `${frames} frames`;
    const angleLabel =
      camera && (camera.yaw !== 0 || camera.pitch !== 0)
        ? ` ${c.dim(`(angle yaw ${camera.yaw}° pitch ${camera.pitch}°)`)}`
        : "";
    console.log(`${c.accent("◆")}  Capturing ${label} from ${c.accent(project.name)}${angleLabel}`);

    try {
      const snapshotDir = args.output
        ? resolve(String(args.output))
        : join(project.dir, "snapshots");
      const paths = await captureSnapshots(project.dir, {
        frames,
        timeout,
        at: atTimestamps,
        outputDir: snapshotDir,
        angle: camera,
        includeEnd: args.end !== false,
      });

      if (paths.length === 0) {
        console.log(
          `\n${c.error("✗")} Could not determine composition duration — no frames captured`,
        );
        process.exit(1);
      }

      console.log(
        `\n${c.success("◇")}  ${paths.length} snapshots saved to ${args.output ? snapshotDir : "snapshots/"}`,
      );
      for (const p of paths) {
        console.log(`   ${p}`);
      }

      // Generate contact sheet for quick AI review
      try {
        const { createSnapshotContactSheet } = await import("../capture/contactSheet.js");
        const sheets = await createSnapshotContactSheet(
          snapshotDir,
          join(snapshotDir, "contact-sheet.jpg"),
        );
        if (sheets.length > 0) {
          const label =
            sheets.length === 1 ? "contact-sheet.jpg" : `contact-sheet-1..${sheets.length}.jpg`;
          console.log(`   ${c.dim(label)} (grid view for AI review)`);
        }
      } catch {
        /* non-critical */
      }

      // Gemini vision descriptions. Runs by default — see describeArg
      // resolution above. `null` means the user explicitly opted out with
      // `--describe false`; missing GEMINI_API_KEY logs a skip and continues.
      if (describeArg !== null) {
        try {
          const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          if (!geminiKey) {
            console.log(`   ${c.dim("--describe: GEMINI_API_KEY not set, skipping")}`);
          } else if (paths.length > 0) {
            console.log(`   ${c.dim("Describing frames with Gemini vision...")}`);
            const { GoogleGenAI } = await import("@google/genai");
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const model = process.env.HYPERFRAMES_GEMINI_MODEL || "gemini-3.1-flash-lite-preview";
            const customQuestion =
              describeArg === "true"
                ? "Describe this video composition frame in 1-2 sentences. Be specific and factual: what elements are visible, what text appears, is the frame blank/black/loading, what is the composition. Flag any obvious problems."
                : describeArg;

            const descriptions: string[] = [
              `# Snapshot Frame Descriptions`,
              ``,
              `**Question asked:** ${customQuestion}`,
              ``,
              `Compare each description against your storyboard spec. A "black frame" or "loading screen" for a content beat is a bug.`,
              ``,
            ];

            // Scale down PNGs before sending to stay under Gemini's 4 MB inline
            // limit. Full 1920×1080 PNGs are typically 3-6 MB. Use sharp if
            // available; otherwise skip files over the limit.
            type SharpFn = (buf: Buffer) => {
              resize: (w: number) => { jpeg: () => { toBuffer: () => Promise<Buffer> } };
            };
            let sharpFn: SharpFn | null = null;
            try {
              const s = await import("sharp");
              sharpFn = (s.default ?? s) as unknown as SharpFn;
            } catch {
              /* sharp not installed — fall back to size check */
            }

            const results = await Promise.allSettled(
              paths.map(async (p) => {
                const filename = basename(p);
                const filePath = join(snapshotDir, filename);
                if (!existsSync(filePath)) return { filename, desc: "file not found" };
                const raw = readFileSync(filePath);
                let imageData: Buffer;
                let mimeType = "image/png";
                if (sharpFn) {
                  imageData = await sharpFn(raw).resize(960).jpeg().toBuffer();
                  mimeType = "image/jpeg";
                } else {
                  if (raw.length > 3_800_000)
                    return {
                      filename,
                      desc: "file too large for Gemini — install sharp to enable auto-resize",
                    };
                  imageData = raw;
                }
                const base64 = imageData.toString("base64");
                const response = await ai.models.generateContent({
                  model,
                  contents: [
                    {
                      role: "user",
                      parts: [{ inlineData: { mimeType, data: base64 } }, { text: customQuestion }],
                    },
                  ],
                  config: { maxOutputTokens: 250 },
                });
                return { filename, desc: response.text?.trim() || "no description" };
              }),
            );

            for (const result of results) {
              if (result.status === "fulfilled") {
                descriptions.push(`## ${result.value.filename}`, `${result.value.desc}`, ``);
              } else {
                // Log first failure so Gemini issues are visible rather than silent
                const errMsg = normalizeErrorMessage(result.reason);
                descriptions.push(`## (error)`, `Gemini call failed: ${errMsg.slice(0, 120)}`, ``);
              }
            }

            const descPath = join(snapshotDir, "descriptions.md");
            writeFileSync(descPath, descriptions.join("\n"));
            console.log(`   ${c.dim("descriptions.md")} (Gemini frame analysis)`);
          }
        } catch (descErr) {
          const msg = normalizeErrorMessage(descErr);
          console.log(`   ${c.dim(`--describe failed: ${msg.slice(0, 80)}`)}`);
        }
      }
    } catch (err) {
      const msg = normalizeErrorMessage(err);
      console.error(`\n${c.error("✗")} Snapshot failed: ${msg}`);
      process.exit(1);
    }
  },
});
