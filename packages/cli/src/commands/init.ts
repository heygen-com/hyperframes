// The scaffolding command predates the complexity gate: run(), probeVideo,
// handleVideoFile, and applyResolutionPreset carry its interactive branching.
// This branch only repointed the scaffolded npm scripts; the refactor is its
// own task.
// fallow-ignore-file complexity
import { defineCommand, runCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Create a project with the interactive wizard", "hyperframes init my-video"],
  ["Pick a starter example", "hyperframes init my-video --example warm-grain"],
  ["Scaffold a 4K project", "hyperframes init my-video --resolution 4k"],
  ["Scaffold a portrait video", "hyperframes init my-video --resolution portrait"],
  ["Start from an existing video file", "hyperframes init my-video --video clip.mp4"],
  ["Start from an audio file", "hyperframes init my-video --audio track.mp3"],
  ["Scaffold with Tailwind CSS", "hyperframes init my-video --example blank --tailwind"],
  ["Non-interactive mode (for CI or AI agents)", "hyperframes init my-video --non-interactive"],
  [
    "Opt out of the GitHub skills check (CI/tests only)",
    "HYPERFRAMES_SKIP_SKILLS=1 hyperframes init my-video --non-interactive",
  ],
];
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { resolve, basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { printBanner } from "../ui/banner.js";
import {
  BUNDLED_TEMPLATES,
  resolveTemplateList,
  type TemplateOption,
} from "../templates/generators.js";
import { fetchRemoteTemplate } from "../templates/remote.js";
import { trackInitTemplate } from "../telemetry/events.js";
import { hasFFmpeg } from "../whisper/manager.js";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { VERSION } from "../version.js";
import {
  CANVAS_DIMENSIONS,
  normalizeResolutionFlag,
  type CanvasResolution,
} from "@hyperframes/core";

interface VideoMeta {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
}

const WEB_CODECS = new Set(["h264", "vp8", "vp9", "av1", "theora"]);

const DEFAULT_META: VideoMeta = {
  durationSeconds: 5,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: false,
  videoCodec: "h264",
};

// Pin the browser runtime exactly so repeated renders do not drift as Tailwind
// ships JIT/preflight changes on the CDN.
const TAILWIND_BROWSER_VERSION = "4.2.4";
const TAILWIND_BROWSER_SRC = `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@${TAILWIND_BROWSER_VERSION}/dist/index.global.js`;
const TAILWIND_BROWSER_INTEGRITY =
  "sha384-v5YF9xS+gLRWdvrQ0u/WRbCkjSIH0NjHIPe8tBL1ZRrmI7PiSH6LLdzs0aAIMCuh";

// ---------------------------------------------------------------------------
// ffprobe helper — shells out to ffprobe to avoid engine dependency
// ---------------------------------------------------------------------------

function probeVideo(filePath: string): VideoMeta | undefined {
  try {
    const ffprobePath = findFFprobe();
    if (!ffprobePath) return undefined;
    const raw = execFileSync(
      ffprobePath,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { encoding: "utf-8", timeout: 15_000 },
    );

    const parsed: {
      streams?: {
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        avg_frame_rate?: string;
      }[];
      format?: { duration?: string };
    } = JSON.parse(raw);

    const streams = parsed.streams ?? [];
    const videoStream = streams.find((s) => s.codec_type === "video");
    if (!videoStream) return undefined;

    const hasAudio = streams.some((s) => s.codec_type === "audio");

    let fps = 30;
    const fpsStr = videoStream.avg_frame_rate ?? videoStream.r_frame_rate;
    if (fpsStr) {
      const parts = fpsStr.split("/");
      const num = parseFloat(parts[0] ?? "");
      const den = parseFloat(parts[1] ?? "1");
      if (den !== 0 && !Number.isNaN(num) && !Number.isNaN(den)) {
        fps = Math.round((num / den) * 100) / 100;
      }
    }

    const durationStr = parsed.format?.duration;
    const durationSeconds = durationStr !== undefined ? parseFloat(durationStr) : 5;

    return {
      durationSeconds: Number.isNaN(durationSeconds) ? 5 : durationSeconds,
      width: videoStream.width ?? 1920,
      height: videoStream.height ?? 1080,
      fps,
      hasAudio,
      videoCodec: videoStream.codec_name ?? "unknown",
    };
  } catch {
    return undefined;
  }
}

function isWebCompatible(codec: string): boolean {
  return WEB_CODECS.has(codec.toLowerCase());
}

// hasFFmpeg is imported from whisper/manager.ts to avoid duplication

function transcodeToMp4(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const ffmpegPath = findFFmpeg();
    if (!ffmpegPath) {
      resolvePromise(false);
      return;
    }
    const child = spawn(
      ffmpegPath,
      [
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-y",
        outputPath,
      ],
      { stdio: "pipe" },
    );

    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", () => resolvePromise(false));
  });
}

// ---------------------------------------------------------------------------
// Static template helpers
// ---------------------------------------------------------------------------

/** Resolve an asset directory that differs between dev (src/) and built (dist/). */
function resolveAssetDir(devSegments: string[], builtSegments: string[]): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(base, ...devSegments);
  const builtPath = resolve(base, ...builtSegments);
  return existsSync(devPath) ? devPath : builtPath;
}

// Resolves bundled templates shipped inside the CLI package
// (packages/cli/src/templates/<id> in dev, dist/templates/<id> when packed).
// Dev-mode also checks registry/examples/<id> so that smoke CI tests pick up
// PR-branch template changes before the PR is merged to main.
function getStaticTemplateDir(templateId: string): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(base, "..", "templates", templateId);
  if (existsSync(devPath)) return devPath;
  // fallback: repo-root registry/examples/<id> (4 levels up from src/commands/)
  const registryPath = resolve(base, "..", "..", "..", "..", "registry", "examples", templateId);
  if (existsSync(registryPath)) return registryPath;
  return resolve(base, "templates", templateId);
}

function getSharedTemplateDir(): string {
  return resolveAssetDir(["..", "templates", "_shared"], ["templates", "_shared"]);
}

function toPackageName(projectName: string): string {
  const normalized = basename(projectName)
    .trim()
    .toLowerCase()
    .replace(/^[._]+/, "")
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "hyperframes-project";
}

function getHyperframesPackageSpecifier(): string {
  return VERSION === "0.0.0-dev" ? "hyperframes" : `hyperframes@${VERSION}`;
}

function hyperframesScript(command: string): string {
  return `npx --yes ${getHyperframesPackageSpecifier()} ${command}`;
}

function buildPackageScripts(): Record<string, string> {
  return {
    dev: hyperframesScript("preview"),
    check: hyperframesScript("check"),
    render: hyperframesScript("render"),
    publish: hyperframesScript("publish"),
  };
}

function writeDefaultPackageJson(destDir: string, projectName: string): void {
  const packageJsonPath = resolve(destDir, "package.json");
  if (existsSync(packageJsonPath)) return;

  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: toPackageName(projectName),
        private: true,
        type: "module",
        scripts: buildPackageScripts(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function listHtmlFiles(dir: string): string[] {
  const files: string[] = [];
  const ignoredDirs = new Set([".git", "dist", "node_modules"]);

  function walk(currentDir: string): void {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(entryPath);
      }
    }
  }

  walk(dir);
  return files;
}

export function injectTailwindBrowserScript(html: string): string {
  if (html.includes(TAILWIND_BROWSER_SRC)) return html;

  const script = [
    `<script>`,
    `window.__tailwindReady=new Promise(function(resolve){`,
    `var loaded=document.readyState==="complete";`,
    `var resolved=false;`,
    `var observer;`,
    `function readTailwindCss(){var styles=document.querySelectorAll("style");for(var i=styles.length-1;i>=0;i--){var text=styles[i].textContent||"";if(text.indexOf("tailwindcss v")!==-1)return text;}return "";}`,
    `function finish(){if(resolved||!loaded||!readTailwindCss())return;resolved=true;if(observer)observer.disconnect();resolve(true);}`,
    `observer=new MutationObserver(finish);`,
    `observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});`,
    `if(loaded){finish();}else{window.addEventListener("load",function(){loaded=true;finish();},{once:true});}`,
    `});`,
    `</script>`,
    `<script src="${TAILWIND_BROWSER_SRC}" integrity="${TAILWIND_BROWSER_INTEGRITY}" crossorigin="anonymous"></script>`,
  ].join("\n");

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, (closingHead) => `\n${script}\n${closingHead}`);
  }

  return `${script}\n${html}`;
}

function writeTailwindSupport(destDir: string): void {
  for (const file of listHtmlFiles(destDir)) {
    const html = readFileSync(file, "utf-8");
    writeFileSync(file, injectTailwindBrowserScript(html), "utf-8");
  }
}

function patchVideoSrc(
  dir: string,
  videoFilename: string | undefined,
  durationSeconds?: number,
): void {
  const htmlFiles = readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name));

  for (const file of htmlFiles) {
    let content = readFileSync(file, "utf-8");
    if (videoFilename) {
      content = content.replaceAll("__VIDEO_SRC__", videoFilename);
    } else {
      // Remove video elements with placeholder src
      content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/video>/g, "");
      content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
      // Remove audio elements with placeholder src
      content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/audio>/g, "");
      content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    }
    // Patch duration — use probed duration or default
    const dur = durationSeconds ? String(Math.round(durationSeconds * 100) / 100) : "10";
    content = content.replaceAll("__VIDEO_DURATION__", dur);
    writeFileSync(file, content, "utf-8");
  }
}

async function patchTranscript(dir: string, transcriptPath: string): Promise<void> {
  const { loadTranscript, patchCaptionHtml } = await import("../whisper/normalize.js");
  const { words } = loadTranscript(transcriptPath);
  if (words.length === 0) return;
  patchCaptionHtml(dir, words);
}

// ---------------------------------------------------------------------------
// handleVideoFile — probe, check codec, optionally transcode, copy to destDir
// ---------------------------------------------------------------------------

async function handleVideoFile(
  videoPath: string,
  destDir: string,
  interactive: boolean,
): Promise<{ meta: VideoMeta; localVideoName: string }> {
  const probed = probeVideo(videoPath);
  let meta: VideoMeta = { ...DEFAULT_META };
  let localVideoName = basename(videoPath);

  if (probed) {
    meta = probed;
    if (interactive) {
      clack.log.info(
        `Video: ${meta.width}x${meta.height}, ${meta.durationSeconds.toFixed(1)}s, ${meta.fps}fps${meta.hasAudio ? ", has audio" : ""}`,
      );
    }
  } else {
    const msg = `ffprobe not found — using defaults (1920x1080, 5s, 30fps). Install: ${getFFmpegInstallHint()}`;
    if (interactive) {
      clack.log.warn(msg);
    } else {
      console.log(c.warn(msg));
    }
  }

  // Check codec compatibility
  if (probed && !isWebCompatible(probed.videoCodec)) {
    if (interactive) {
      clack.log.warn(
        c.warn(`Video codec "${probed.videoCodec}" is not supported by web browsers.`),
      );
    } else {
      console.log(c.warn(`Video codec "${probed.videoCodec}" is not supported by browsers.`));
    }

    if (hasFFmpeg()) {
      let shouldTranscode = !interactive; // non-interactive auto-transcodes

      if (interactive) {
        const transcode = await clack.select({
          message: "Transcode to H.264 MP4 for browser playback?",
          options: [
            {
              value: "yes",
              label: "Yes, transcode",
              hint: "converts to H.264 MP4",
            },
            {
              value: "no",
              label: "No, keep original",
              hint: "video won't play in browser",
            },
          ],
        });
        if (clack.isCancel(transcode)) {
          clack.cancel("Setup cancelled.");
          process.exit(0);
        }
        shouldTranscode = transcode === "yes";
      }

      if (shouldTranscode) {
        const mp4Name = localVideoName.replace(/\.[^.]+$/, ".mp4");
        const mp4Path = resolve(destDir, mp4Name);
        const spin = clack.spinner();
        spin.start("Transcoding to H.264 MP4...");
        const ok = await transcodeToMp4(videoPath, mp4Path);
        if (ok) {
          spin.stop(c.success(`Transcoded to ${mp4Name}`));
          localVideoName = mp4Name;
        } else {
          spin.stop(c.warn("Transcode failed — copying original file"));
          copyFileSync(videoPath, resolve(destDir, localVideoName));
        }
      } else {
        copyFileSync(videoPath, resolve(destDir, localVideoName));
      }
    } else {
      if (interactive) {
        clack.log.warn(c.dim("ffmpeg not installed — cannot transcode."));
        clack.log.info(c.accent(`Install: ${getFFmpegInstallHint()}`));
      } else {
        console.log(c.warn("ffmpeg not installed — cannot transcode. Copying original."));
        console.log(c.dim("Install: ") + c.accent(getFFmpegInstallHint()));
      }
      copyFileSync(videoPath, resolve(destDir, localVideoName));
    }
  } else {
    copyFileSync(videoPath, resolve(destDir, localVideoName));
  }

  return { meta, localVideoName };
}

// ---------------------------------------------------------------------------
// applyResolutionPreset — rewrite stage dimensions in scaffolded HTML
// ---------------------------------------------------------------------------

/**
 * Rewrite the canvas dimensions in every scaffolded HTML file to match a
 * preset. We rewrite by regex rather than DOM-parsing so template comments
 * and indentation survive byte-for-byte — these are review-target files,
 * not transient build artifacts.
 *
 * Scope: HTML files only. Templates whose `#stage` dimensions live in an
 * external `.css` stylesheet are not patched — the bundled `blank` template
 * inlines its CSS, and that's the convention for new templates. If you
 * author a template with external CSS, replicate the dimension swap there
 * by hand or move the dimensions inline.
 */
export function applyResolutionPreset(destDir: string, resolution: CanvasResolution): void {
  const { width, height } = CANVAS_DIMENSIONS[resolution];
  for (const file of listHtmlFiles(destDir)) {
    let html = readFileSync(file, "utf-8");
    let changed = false;

    const dataWidthRe = /(data-width=)["'](\d+)["']/g;
    if (dataWidthRe.test(html)) {
      html = html.replace(dataWidthRe, `$1"${width}"`);
      changed = true;
    }
    const dataHeightRe = /(data-height=)["'](\d+)["']/g;
    if (dataHeightRe.test(html)) {
      html = html.replace(dataHeightRe, `$1"${height}"`);
      changed = true;
    }

    const htmlOpenRe = /<html\b([^>]*)>/i;
    const htmlOpen = html.match(htmlOpenRe);
    if (htmlOpen) {
      const attrs = htmlOpen[1] ?? "";
      let next: string;
      if (/data-resolution=/.test(attrs)) {
        next = attrs.replace(/data-resolution=["'][^"']*["']/, `data-resolution="${resolution}"`);
      } else {
        next = `${attrs.replace(/\s+$/, "")} data-resolution="${resolution}"`;
      }
      if (next !== attrs) {
        html = html.replace(htmlOpenRe, `<html${next}>`);
        changed = true;
      }
    }

    // Inline `html, body { ... }` CSS: handle width-before-height and
    // height-before-width orderings. Hand-authored templates can use either.
    const bodyCssRe = /(html\s*,\s*body\s*\{[^}]*?width:\s*)\d+px([^}]*?height:\s*)\d+px/i;
    if (bodyCssRe.test(html)) {
      html = html.replace(bodyCssRe, `$1${width}px$2${height}px`);
      changed = true;
    }
    const bodyCssReverseRe = /(html\s*,\s*body\s*\{[^}]*?height:\s*)\d+px([^}]*?width:\s*)\d+px/i;
    if (bodyCssReverseRe.test(html)) {
      html = html.replace(bodyCssReverseRe, `$1${height}px$2${width}px`);
      changed = true;
    }

    const viewportRe = /(<meta[^>]*name=["']viewport["'][^>]*content=["'])width=\d+,\s*height=\d+/i;
    if (viewportRe.test(html)) {
      html = html.replace(viewportRe, `$1width=${width}, height=${height}`);
      changed = true;
    }

    if (changed) writeFileSync(file, html, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// scaffoldProject — copy template, patch video refs, write meta.json
// ---------------------------------------------------------------------------

async function scaffoldProject(
  destDir: string,
  name: string,
  templateId: string,
  localVideoName: string | undefined,
  durationSeconds?: number,
  tailwind = false,
  resolution?: CanvasResolution,
): Promise<void> {
  mkdirSync(destDir, { recursive: true });

  // Use bundled template if available, otherwise fetch from GitHub.
  // Check for index.html inside the dir — an empty directory left by the
  // build toolchain should not prevent the remote fetch fallback.
  const templateDir = getStaticTemplateDir(templateId);
  if (existsSync(join(templateDir, "index.html"))) {
    cpSync(templateDir, destDir, { recursive: true });
  } else {
    await fetchRemoteTemplate(templateId, destDir);
  }
  patchVideoSrc(destDir, localVideoName, durationSeconds);
  if (tailwind) writeTailwindSupport(destDir);
  if (resolution) applyResolutionPreset(destDir, resolution);

  writeFileSync(
    resolve(destDir, "meta.json"),
    JSON.stringify(
      {
        id: name,
        name,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  // Write hyperframes.json so `hyperframes add` knows which registry to use
  // and where to drop block/component files. Overwritten only if absent.
  if (!existsSync(resolve(destDir, "hyperframes.json"))) {
    const { writeProjectConfig, DEFAULT_PROJECT_CONFIG } =
      await import("../utils/projectConfig.js");
    writeProjectConfig(destDir, DEFAULT_PROJECT_CONFIG);
  }

  writeDefaultPackageJson(destDir, name);

  // Copy shared files (CLAUDE.md, AGENTS.md) for AI agent context
  const sharedDir = getSharedTemplateDir();
  if (existsSync(sharedDir)) {
    for (const entry of readdirSync(sharedDir, { withFileTypes: true })) {
      const src = join(sharedDir, entry.name);
      const dest = resolve(destDir, entry.name);
      if (entry.isFile() || entry.isSymbolicLink()) {
        copyFileSync(src, dest);
      }
    }
  }
}

/**
 * Keep the AI coding skills present and current — TARGETED, not the full
 * set. Guarantees the core set (the `/hyperframes` entry router + shared
 * domain skills) and refreshes any skill already installed; the end-user
 * workflow skills are NOT pulled here — they install on demand when their
 * workflow is triggered (`hyperframes skills update <name>`, which the router
 * runs before entering a workflow). Re-running `init` on an up-to-date machine
 * is a no-op, and `init` never expands a deliberate partial install.
 * Best-effort: offline, it degrades to a presence check and never breaks init.
 * The install itself lands once GLOBALLY (~/.claude/skills + ~/.agents/skills)
 * and mirrors into every other installed agent, so it is project-independent —
 * the check is global-first to match.
 */
async function keepSkillsCurrent(destDir: string): Promise<void> {
  const { updateSkills } = await import("./skills.js");

  console.log();
  console.log(c.bold("Checking AI coding skills against GitHub..."));
  // Wrap defensively (non-strict already swallows most failures): a
  // skills-install failure can never break `init` itself — it warns and
  // proceeds, since --skip-skills no longer escapes this path.
  try {
    const result = await updateSkills({ refreshInstalled: true, cwd: destDir });
    if (result.presenceOnly) {
      // Freshness never got checked (GitHub unreachable) — don't claim
      // "up to date"; the engine already reported what it could verify or
      // blind-install. Point at the recovery command instead.
      console.log(
        c.dim("Skills freshness unverified — run `npx hyperframes skills update` when online."),
      );
    } else if (result.installed.length === 0) {
      console.log(c.success("AI coding skills are already up to date."));
    } else {
      console.log(
        c.dim("Workflow skills not installed here are added on demand, when first used."),
      );
    }
  } catch (err) {
    console.log(
      c.dim(`AI coding skills install skipped: ${err instanceof Error ? err.message : err}`),
    );
  }
}

// ---------------------------------------------------------------------------
// Exported command
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a new composition project",
  },
  args: {
    name: { type: "positional", description: "Project name", required: false },
    example: {
      type: "string",
      description: "Example name (e.g. warm-grain, swiss-grid, blank)",
      alias: "e",
    },
    // Accepted-but-errored so users who still type the old flag get a clear
    // message rather than citty silently ignoring it and producing a blank
    // project. The actual behavior is gone — this exists purely for the
    // diagnostic. `hidden` keeps it out of --help output so new users aren't
    // taught about a flag that's already gone.
    template: {
      type: "string",
      description: "[renamed] Use --example instead.",
      alias: "t",
      hidden: true,
    },
    video: {
      type: "string",
      description: "Path to a video file (MP4, WebM, MOV)",
      alias: "v",
    },
    "video-legacy": {
      type: "string",
      description: "[renamed] Use --video (or -v) instead of -V.",
      alias: "V",
      hidden: true,
    },
    audio: {
      type: "string",
      description: "Path to an audio file (MP3, WAV, M4A)",
      alias: "a",
    },
    "skip-transcribe": {
      type: "boolean",
      description: "Skip whisper transcription",
    },
    model: {
      type: "string",
      description:
        "Whisper model for transcription (e.g. tiny.en, base.en, small.en, medium.en, large)",
    },
    language: {
      type: "string",
      description:
        "Language code for transcription (e.g. en, es, ja). Filters out non-target speech.",
    },
    "non-interactive": {
      type: "boolean",
      description: "Disable interactive prompts (for CI/agents)",
    },
    "skip-skills": {
      type: "boolean",
      description:
        "[temporarily ignored] init always checks AI skills against GitHub while the skills.sh registry catches up; set HYPERFRAMES_SKIP_SKILLS=1 to opt out (CI/tests)",
    },
    tailwind: {
      type: "boolean",
      description: "Add Tailwind CSS browser-runtime support",
    },
    resolution: {
      type: "string",
      description:
        "Canvas resolution preset: landscape (1920x1080), portrait (1080x1920), landscape-4k (3840x2160), portrait-4k (2160x3840), square (1080x1080), square-4k (2160x2160). Aliases: 1080p, 4k, uhd, 1080p-square, square-1080p, 4k-square. Default: keep template dimensions (typically 1920x1080).",
    },
  },
  async run({ args }) {
    if (args.template !== undefined) {
      // Quote the value in case it looks flag-like — keeps the suggested
      // command copy-pasteable.
      console.error(
        c.error(
          `The --template flag was renamed to --example. Example:\n  npx hyperframes init ${args.name ?? "my-video"} --example "${args.template}"`,
        ),
      );
      process.exit(1);
    }
    if (args["video-legacy"] !== undefined) {
      console.error(
        c.error(
          `The -V short flag no longer maps to --video. Use --video (or -v). Example:\n  npx hyperframes init ${args.name ?? "my-video"} --video "${args["video-legacy"]}"`,
        ),
      );
      process.exit(1);
    }
    const exampleFlag = args.example;
    const videoFlag = args.video;
    const audioFlag = args.audio;
    const skipTranscribe = args["skip-transcribe"] === true;
    // Temporary measure while the skills.sh registry sync lags GitHub main: the
    // `--skip-skills` FLAG is neutered so an agent (or user) that passes it can
    // NOT dodge the GitHub skills freshness check. The "don't pass --skip-skills"
    // guidance lives in SKILL.md, which ships through the same laggy skills.sh
    // channel and can't be relied on to reach the agent — so the guarantee has to
    // live in the CLI, the one channel that updates promptly (`npx
    // hyperframes@latest`). CI and unit tests still opt out via the
    // HYPERFRAMES_SKIP_SKILLS=1 env var, which the agent/user CLI path never sets.
    // Revert to `args["skip-skills"] === true` once skills.sh catches up.
    const skipSkills = process.env.HYPERFRAMES_SKIP_SKILLS === "1";
    const skipSkillsFlagIgnored = args["skip-skills"] === true && !skipSkills;
    const tailwind = args.tailwind === true;
    const nonInteractive = args["non-interactive"] === true;
    const modelFlag = args.model;
    const languageFlag = args.language;
    const interactive = !nonInteractive && process.stdout.isTTY === true;

    if (skipSkillsFlagIgnored) {
      console.log(
        c.dim(
          "Note: --skip-skills is temporarily ignored — init always checks AI skills " +
            "against GitHub while the skills.sh registry catches up.",
        ),
      );
    }

    let resolutionPreset: CanvasResolution | undefined;
    if (args.resolution !== undefined) {
      resolutionPreset = normalizeResolutionFlag(args.resolution);
      if (!resolutionPreset) {
        console.error(
          c.error(
            `Invalid --resolution: "${args.resolution}". ` +
              `Use one of: landscape, portrait, landscape-4k, portrait-4k, square, square-4k ` +
              `(or aliases 1080p, 4k, uhd, 1080p-square, square-1080p, 4k-square).`,
          ),
        );
        process.exit(1);
      }
    }

    // -----------------------------------------------------------------------
    // Non-interactive mode — all inputs from flags, defaults where missing
    // -----------------------------------------------------------------------
    if (!interactive) {
      const templateId = exampleFlag ?? "blank";
      const name = args.name ?? "my-video";
      const destDir = resolve(name);

      if (existsSync(destDir) && readdirSync(destDir).length > 0) {
        console.error(c.error(`Directory already exists and is not empty: ${name}`));
        process.exit(1);
      }

      if (videoFlag && audioFlag) {
        console.error(c.error("Cannot use --video and --audio together"));
        process.exit(1);
      }

      // Validate source files before creating destDir so a failed run does
      // not leave an empty orphan directory behind. The interactive path
      // already validates in this order.
      const videoPath = videoFlag ? resolve(videoFlag) : undefined;
      if (videoPath && !existsSync(videoPath)) {
        console.error(c.error(`Video file not found: ${videoFlag}`));
        process.exit(1);
      }
      const audioPath = audioFlag ? resolve(audioFlag) : undefined;
      if (audioPath && !existsSync(audioPath)) {
        console.error(c.error(`Audio file not found: ${audioFlag}`));
        process.exit(1);
      }

      mkdirSync(destDir, { recursive: true });

      let localVideoName: string | undefined;
      let videoDuration: number | undefined;
      let sourceFilePath: string | undefined;

      // Handle video
      if (videoPath) {
        sourceFilePath = videoPath;
        const result = await handleVideoFile(videoPath, destDir, false);
        localVideoName = result.localVideoName;
        videoDuration = result.meta.durationSeconds;
        console.log(
          `Video: ${result.meta.width}x${result.meta.height}, ${result.meta.durationSeconds.toFixed(1)}s`,
        );
      }

      // Handle audio
      if (audioPath) {
        sourceFilePath = audioPath;
        copyFileSync(audioPath, resolve(destDir, basename(audioPath)));
        console.log(`Audio: ${basename(audioPath)}`);
      }

      // Transcribe
      if (sourceFilePath && !skipTranscribe) {
        try {
          const { ensureWhisper, ensureModel } = await import("../whisper/manager.js");
          await ensureWhisper();
          await ensureModel(modelFlag);
          console.log("Transcribing...");
          const { transcribe: runTranscribe } = await import("../whisper/transcribe.js");
          const result = await runTranscribe(sourceFilePath, destDir, {
            model: modelFlag,
            language: languageFlag,
          });
          console.log(
            `Transcribed: ${result.wordCount} words (${result.durationSeconds.toFixed(1)}s)`,
          );
          if (!videoDuration) videoDuration = result.durationSeconds;
        } catch (err) {
          console.log(`Transcription skipped: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Scaffold
      try {
        await scaffoldProject(
          destDir,
          basename(destDir),
          templateId,
          localVideoName,
          videoDuration,
          tailwind,
          resolutionPreset,
        );
      } catch (err) {
        console.error(
          c.error(
            `Failed to scaffold example "${templateId}": ${err instanceof Error ? err.message : err}`,
          ),
        );
        console.error(c.dim("Use --example blank for offline use."));
        process.exit(1);
      }
      trackInitTemplate(templateId, { tailwind });
      const transcriptFile = resolve(destDir, "transcript.json");
      if (existsSync(transcriptFile)) {
        await patchTranscript(destDir, transcriptFile);
      }

      console.log(c.success(`Created ${c.accent(name + "/")}`));
      for (const f of readdirSync(destDir).filter((f) => !f.startsWith("."))) {
        console.log(`  ${c.accent(f)}`);
      }

      if (!skipSkills) {
        await keepSkillsCurrent(destDir);
      }

      console.log();
      console.log("Get started:");
      console.log();
      if (skipSkills) {
        console.log(`  ${c.accent("1.")} Install AI coding skills (one-time):`);
        console.log(`     ${c.accent("npx hyperframes skills update")}`);
      } else {
        console.log(
          `  ${c.accent("1.")} Restart your AI agent (new session) so it loads the skills.`,
        );
      }
      console.log();
      console.log(`  ${c.accent("2.")} Open this project with your AI coding agent:`);
      console.log(
        `     ${c.accent(`cd ${name}`)} then start ${c.accent("Claude Code")}, ${c.accent("Cursor")}, or your preferred agent`,
      );
      console.log();
      console.log(`  ${c.accent("3.")} Try a starter prompt:`);
      console.log(
        `     ${c.dim('"Using /hyperframes, create a 15-second intro about [your topic]"')}`,
      );
      console.log(`     ${c.dim("More patterns: hyperframes.heygen.com/guides/prompting")}`);
      console.log();
      console.log(`  ${c.accent("4.")} Preview in the browser:`);
      console.log(`     ${c.accent(`cd ${name}`)} && ${c.accent("npm run dev")}`);
      console.log();
      console.log(`  ${c.accent("5.")} Check the composition:`);
      console.log(`     ${c.accent(`cd ${name}`)} && ${c.accent("npm run check")}`);
      console.log();
      console.log(`  ${c.accent("6.")} Render to MP4 when ready:`);
      console.log(`     ${c.accent(`cd ${name}`)} && ${c.accent("npm run render")}`);
      console.log();
      console.log(`  ${c.dim("Full docs: hyperframes.heygen.com")}`);
      return;
    }

    // -----------------------------------------------------------------------
    // Interactive mode
    // -----------------------------------------------------------------------
    printBanner();
    clack.intro("Create a new HyperFrames project");

    // 1. Project name
    let name: string;
    const hasPositionalName = args.name !== undefined && args.name !== "";
    if (hasPositionalName) {
      name = args.name ?? "my-video";
    } else {
      const nameResult = await clack.text({
        message: "Project name",
        placeholder: "my-video",
        defaultValue: "my-video",
      });
      if (clack.isCancel(nameResult)) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }
      name = nameResult;
    }

    const destDir = resolve(name);

    if (existsSync(destDir) && readdirSync(destDir).length > 0) {
      const overwrite = await clack.confirm({
        message: `Directory ${c.accent(name)} already exists and is not empty. Overwrite?`,
        initialValue: false,
      });
      if (clack.isCancel(overwrite) || !overwrite) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }
    }

    // 2. Video/audio file handling (only via --video/--audio flags, no interactive prompt)
    let localVideoName: string | undefined;
    let sourceFilePath: string | undefined;
    let videoDuration: number | undefined;

    if (videoFlag) {
      const videoPath = resolve(videoFlag);
      if (!existsSync(videoPath)) {
        clack.log.error(`File not found: ${videoFlag}`);
        clack.cancel("Setup cancelled.");
        process.exit(1);
      }
      mkdirSync(destDir, { recursive: true });
      sourceFilePath = videoPath;
      const result = await handleVideoFile(videoPath, destDir, true);
      localVideoName = result.localVideoName;
      videoDuration = result.meta.durationSeconds;
    } else if (audioFlag) {
      const audioPath = resolve(audioFlag);
      if (!existsSync(audioPath)) {
        clack.log.error(`File not found: ${audioFlag}`);
        clack.cancel("Setup cancelled.");
        process.exit(1);
      }
      mkdirSync(destDir, { recursive: true });
      sourceFilePath = audioPath;
      copyFileSync(audioPath, resolve(destDir, basename(audioPath)));
      clack.log.info(`Audio copied to ${c.accent(basename(audioPath))}`);
    }

    // 2b. Transcribe if we have a source file with audio (via flags)
    if (sourceFilePath) {
      const transcribeChoice = await clack.confirm({
        message: "Generate captions from audio?",
        initialValue: true,
      });
      if (!clack.isCancel(transcribeChoice) && transcribeChoice) {
        const { findWhisper } = await import("../whisper/manager.js");
        const needsInstall = findWhisper() === undefined;
        if (needsInstall) {
          clack.log.info(c.dim("whisper-cpp not found — installing automatically..."));
        }

        const spin = clack.spinner();
        spin.start(
          needsInstall
            ? "Installing whisper-cpp (this may take a moment)..."
            : "Preparing transcription...",
        );
        try {
          const { ensureWhisper, ensureModel } = await import("../whisper/manager.js");
          await ensureWhisper({
            onProgress: (msg) => spin.message(msg),
          });
          await ensureModel(modelFlag, {
            onProgress: (msg) => spin.message(msg),
          });

          spin.message("Transcribing audio...");
          const { transcribe: runTranscribe } = await import("../whisper/transcribe.js");
          const transcribeResult = await runTranscribe(sourceFilePath, destDir, {
            model: modelFlag,
            language: languageFlag,
            onProgress: (msg) => spin.message(msg),
          });
          spin.stop(
            c.success(
              `Transcribed ${transcribeResult.wordCount} words (${transcribeResult.durationSeconds.toFixed(1)}s)`,
            ),
          );
        } catch (err) {
          spin.stop(c.dim(`Transcription skipped: ${err instanceof Error ? err.message : err}`));
        }
      }
    }

    // 3. Pick example — skip prompt if --example was provided
    let templateId: string;

    if (exampleFlag) {
      templateId = exampleFlag;
    } else {
      // Resolve full template list (bundled + remote)
      const allTemplates = await resolveTemplateList();
      const defaultTemplate = "blank";
      const templateResult = await clack.select({
        message: "Pick an example",
        options: allTemplates.map((t: TemplateOption) => ({
          value: t.id,
          label: t.label,
          hint: t.source === "remote" ? `${t.hint} (download)` : t.hint,
        })),
        initialValue: defaultTemplate,
      });
      if (clack.isCancel(templateResult)) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }
      templateId = templateResult;
    }

    // 4. Scaffold project (bundled templates are instant, remote templates download from GitHub)
    const spin = clack.spinner();
    const isBundled = BUNDLED_TEMPLATES.some((t) => t.id === templateId);
    if (!isBundled) {
      spin.start(`Downloading example ${c.accent(templateId)}...`);
    }
    try {
      await scaffoldProject(
        destDir,
        name,
        templateId,
        localVideoName,
        videoDuration,
        tailwind,
        resolutionPreset,
      );
      if (!isBundled) {
        spin.stop(c.success(`Downloaded ${templateId}`));
      }
    } catch (err) {
      if (!isBundled) {
        spin.stop(c.error("Download failed"));
      }
      clack.log.error(
        `${err instanceof Error ? err.message : err}\n${c.dim("Use --example blank for offline use.")}`,
      );
      process.exit(1);
    }
    trackInitTemplate(templateId, { tailwind });

    // 4b. Patch captions with transcript if available
    const transcriptFile = resolve(destDir, "transcript.json");
    if (existsSync(transcriptFile)) {
      await patchTranscript(destDir, transcriptFile);
    }

    const files = readdirSync(destDir);
    clack.note(files.map((f) => c.accent(f)).join("\n"), c.success(`Created ${name}/`));

    // Check skills against GitHub and refresh only what's stale — the core set
    // plus anything already installed; workflow skills install on demand. The
    // --skip-skills flag is temporarily neutered (see above); CI/tests opt out
    // via HYPERFRAMES_SKIP_SKILLS=1.
    if (!skipSkills) {
      await keepSkillsCurrent(destDir);
    }

    // Auto-launch studio preview
    clack.log.info("Opening studio preview...");
    try {
      const previewCmd = await import("./preview.js").then((m) => m.default);
      await runCommand(previewCmd, { rawArgs: [destDir] });
    } catch {
      // Ctrl+C or error — that's fine
    }
  },
});
