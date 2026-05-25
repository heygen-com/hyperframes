import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { resolveProject } from "../utils/project.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { c } from "../ui/colors.js";
import type { Example } from "./_examples.js";

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
    const result = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>(
      (resolvePromise) => {
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
        const ff = spawn("ffmpeg", args);
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ff.kill("SIGTERM");
        }, FFMPEG_EXTRACT_TIMEOUT_MS);
        ff.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        ff.on("close", (code) => {
          clearTimeout(timer);
          resolvePromise({ code, stderr, timedOut });
        });
        ff.on("error", () => {
          clearTimeout(timer);
          resolvePromise({ code: null, stderr: "ffmpeg spawn failed", timedOut });
        });
      },
    );
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
  ["Capture 5 key frames from a composition", "snapshot captures/stripe"],
  ["Capture 10 evenly-spaced frames", "snapshot captures/stripe --frames 10"],
];

/**
 * Render key frames from a composition as PNG screenshots.
 * The agent can Read these to verify its output visually.
 */
async function captureSnapshots(
  projectDir: string,
  opts: { frames?: number; timeout?: number; at?: number[] },
): Promise<string[]> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { ensureBrowser } = await import("../browser/manager.js");

  const numFrames = opts.frames ?? 5;

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(projectDir, html);

  const savedPaths: string[] = [];

  try {
    const browser = await ensureBrowser();
    const puppeteer = await import("puppeteer-core");
    const chromeBrowser = await puppeteer.default.launch({
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

    try {
      const page = await chromeBrowser.newPage();
      await page.setViewport(resolveCompositionViewportFromHtml(html));

      await page.goto(server.url, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });

      // __renderReady is set after the player is constructed AND the root
      // timeline is bound — waiting for it guarantees renderSeek will work.
      const timeoutMs = opts.timeout ?? 5000;
      const runtimeReady = await page
        .waitForFunction(() => !!(window as any).__renderReady, { timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);

      if (!runtimeReady) {
        console.warn(
          `\n   ${c.warn("⚠")} Runtime did not become render-ready within ${timeoutMs}ms — snapshots may be inaccurate`,
        );
      }

      // Wait for shader transition pre-rendering (HyperShader IndexedDB hydration).
      // Uses the ready state flag as primary signal, with the loading overlay
      // display:none as a fallback for older builds.
      await page
        .waitForFunction(
          () => {
            const win = window as unknown as {
              __hf?: { shaderTransitions?: Record<string, { ready?: boolean }> };
            };
            const shaderTransitions = win.__hf?.shaderTransitions;
            if (shaderTransitions !== undefined) {
              return Object.values(shaderTransitions).every((s) => s.ready === true);
            }
            const overlay = document.querySelector(
              "[data-hyper-shader-loading]",
            ) as HTMLElement | null;
            if (!overlay) return true;
            return window.getComputedStyle(overlay).display === "none";
          },
          { timeout: 90_000 },
        )
        .catch(() => {
          console.warn(`   ${c.warn("⚠")} Shader transitions did not finish pre-rendering`);
        });

      // Wait for fonts to finish loading before capturing
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // Extra settle time for media and animations to initialize
      await new Promise((r) => setTimeout(r, 1500));

      // Font verification — report which fonts loaded vs fell back
      const fontReport = await page
        .evaluate(() => {
          const loaded: string[] = [];
          const failed: string[] = [];
          (document as any).fonts.forEach((f: any) => {
            const entry = `${f.family} (${f.weight} ${f.style})`;
            if (f.status === "loaded") loaded.push(entry);
            else failed.push(entry + ` [${f.status}]`);
          });
          return { loaded, failed };
        })
        .catch(() => ({ loaded: [] as string[], failed: [] as string[] }));

      if (fontReport.loaded.length > 0 || fontReport.failed.length > 0) {
        console.log(
          `\n   ${c.dim("Fonts loaded:")} ${fontReport.loaded.length > 0 ? fontReport.loaded.join(", ") : "none"}`,
        );
        if (fontReport.failed.length > 0) {
          console.log(`   ${c.error("Fonts FAILED:")} ${fontReport.failed.join(", ")}`);
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

      // Calculate seek positions — explicit timestamps or evenly spaced
      const positions: number[] = opts.at?.length
        ? opts.at
        : numFrames === 1
          ? [duration / 2]
          : Array.from({ length: numFrames }, (_, i) => (i / (numFrames - 1)) * duration);

      const snapshotDir = join(projectDir, "snapshots");
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
      type InjectFn = (
        page: unknown,
        updates: Array<{ videoId: string; dataUri: string }>,
      ) => Promise<void>;
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

        await page.evaluate((t: number) => {
          const player = (window as any).__player;
          if (!player) return;
          const safe = Math.max(0, Number(t) || 0);
          if (typeof player.renderSeek === "function") {
            player.renderSeek(safe);
          } else if (typeof player.seek === "function") {
            player.seek(safe);
          }
          if ((window as any).gsap?.ticker?.tick) {
            (window as any).gsap.ticker.tick();
          }
        }, time);

        await page.evaluate(`new Promise(function(r) {
          var settled = false;
          function finish() { if (settled) return; settled = true; r(); }
          window.setTimeout(finish, 100);
          requestAnimationFrame(function() { requestAnimationFrame(finish); });
        })`);

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
            let filePath: string | null = null;
            try {
              const url = new URL(v.src);
              const decodedPath = decodeURIComponent(url.pathname).replace(/^\//, "");
              const candidate = resolve(projectDir, decodedPath);
              const rel = relative(projectDir, candidate);
              if (!rel.startsWith("..") && !isAbsolute(rel) && existsSync(candidate)) {
                filePath = candidate;
              }
            } catch {
              /* unresolvable src (e.g. blob:, data:) — skip */
            }
            if (!filePath) continue;
            const png = await extractVideoFrameToBuffer(
              filePath,
              Math.max(0, v.relTime),
              await shouldUseVp9AlphaDecoder(filePath),
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
        savedPaths.push(`snapshots/${filename}`);
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

    const label = atTimestamps
      ? `${atTimestamps.length} frames at [${atTimestamps.map((t) => t.toFixed(1) + "s").join(", ")}]`
      : `${frames} frames`;
    console.log(`${c.accent("◆")}  Capturing ${label} from ${c.accent(project.name)}`);

    try {
      const paths = await captureSnapshots(project.dir, { frames, timeout, at: atTimestamps });

      if (paths.length === 0) {
        console.log(
          `\n${c.error("✗")} Could not determine composition duration — no frames captured`,
        );
        process.exit(1);
      }

      console.log(`\n${c.success("◇")}  ${paths.length} snapshots saved to snapshots/`);
      for (const p of paths) {
        console.log(`   ${p}`);
      }

      // Generate contact sheet for quick AI review
      try {
        const { createSnapshotContactSheet } = await import("../capture/contactSheet.js");
        const snapshotDir = join(project.dir, "snapshots");
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
            const snapshotDir = join(project.dir, "snapshots");

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
                const filename = p.replace("snapshots/", "");
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
                const errMsg =
                  result.reason instanceof Error ? result.reason.message : String(result.reason);
                descriptions.push(`## (error)`, `Gemini call failed: ${errMsg.slice(0, 120)}`, ``);
              }
            }

            const descPath = join(snapshotDir, "descriptions.md");
            writeFileSync(descPath, descriptions.join("\n"));
            console.log(`   ${c.dim("descriptions.md")} (Gemini frame analysis)`);
          }
        } catch (descErr) {
          const msg = descErr instanceof Error ? descErr.message : String(descErr);
          console.log(`   ${c.dim(`--describe failed: ${msg.slice(0, 80)}`)}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n${c.error("✗")} Snapshot failed: ${msg}`);
      process.exit(1);
    }
  },
});
