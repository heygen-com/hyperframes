import { defineCommand, runCommand } from "citty";
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
import { execSync, execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { TEMPLATES, type TemplateId } from "../templates/generators.js";

const ALL_TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

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

// ---------------------------------------------------------------------------
// ffprobe helper — shells out to ffprobe to avoid engine dependency
// ---------------------------------------------------------------------------

function probeVideo(filePath: string): VideoMeta | undefined {
  try {
    const raw = execFileSync(
      "ffprobe",
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

function hasFFmpeg(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function transcodeToMp4(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "ffmpeg",
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

function getStaticTemplateDir(templateId: string): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  // In dev: cli/src/commands/ → ../templates = cli/src/templates/
  // In built: cli/dist/ → templates = cli/dist/templates/
  const devPath = resolve(dir, "..", "templates", templateId);
  const builtPath = resolve(dir, "templates", templateId);
  return existsSync(devPath) ? devPath : builtPath;
}

function patchVideoSrc(dir: string, videoFilename: string | undefined): void {
  const htmlFiles = readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));

  for (const file of htmlFiles) {
    let content = readFileSync(file, "utf-8");
    if (videoFilename) {
      content = content.replaceAll("__VIDEO_SRC__", videoFilename);
    } else {
      // Remove video elements with placeholder src
      content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/video>/g, "");
      content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    }
    writeFileSync(file, content, "utf-8");
  }
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
    const msg =
      "ffprobe not found — using defaults (1920x1080, 5s, 30fps). Install: brew install ffmpeg";
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
            { value: "yes", label: "Yes, transcode", hint: "converts to H.264 MP4" },
            { value: "no", label: "No, keep original", hint: "video won't play in browser" },
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
        clack.log.info(c.accent("Install: brew install ffmpeg"));
      } else {
        console.log(c.warn("ffmpeg not installed — cannot transcode. Copying original."));
        console.log(c.dim("Install: ") + c.accent("brew install ffmpeg"));
      }
      copyFileSync(videoPath, resolve(destDir, localVideoName));
    }
  } else {
    copyFileSync(videoPath, resolve(destDir, localVideoName));
  }

  return { meta, localVideoName };
}

// ---------------------------------------------------------------------------
// scaffoldProject — copy template, patch video refs, write meta.json
// ---------------------------------------------------------------------------

function scaffoldProject(
  destDir: string,
  name: string,
  templateId: TemplateId,
  localVideoName: string | undefined,
): void {
  mkdirSync(destDir, { recursive: true });

  const templateDir = getStaticTemplateDir(templateId);
  cpSync(templateDir, destDir, { recursive: true });
  patchVideoSrc(destDir, localVideoName);

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
}

// ---------------------------------------------------------------------------
// nextStepLoop — "What do you want to do?" loop after scaffolding
// ---------------------------------------------------------------------------

async function nextStepLoop(destDir: string): Promise<void> {
  while (true) {
    const next = await clack.select({
      message: "What do you want to do?",
      options: [
        { value: "dev", label: "Open in studio", hint: "full editor with timeline" },
        { value: "render", label: "Render to MP4", hint: "export video now" },
        { value: "done", label: "Done for now" },
      ],
    });

    if (clack.isCancel(next) || next === "done") {
      clack.outro(c.success("Happy editing!"));
      return;
    }

    // Hand off to the selected command — use explicit imports so the
    // bundler can resolve them (dynamic import with a variable fails in bundles)
    try {
      if (next === "dev") {
        const devCmd = await import("./dev.js").then((m) => m.default);
        await runCommand(devCmd, { rawArgs: [destDir] });
      } else if (next === "render") {
        const renderCmd = await import("./render.js").then((m) => m.default);
        await runCommand(renderCmd, { rawArgs: [destDir] });
      }
    } catch {
      // Command may throw on Ctrl+C — that's fine, loop back
    }

    // Wait a tick so any lingering SIGINT state clears before Clack prompts again
    await new Promise((r) => setTimeout(r, 100));
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Exported command
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: { name: "init", description: "Scaffold a new composition project" },
  args: {
    name: { type: "positional", description: "Project name", required: false },
    template: {
      type: "string",
      description: `Template: ${ALL_TEMPLATE_IDS.join(", ")}`,
      alias: "t",
    },
    video: { type: "string", description: "Path to a source video file", alias: "V" },
  },
  async run({ args }) {
    const templateFlag = args.template;
    const videoFlag = args.video;

    // -----------------------------------------------------------------------
    // Non-interactive mode: flags provided
    // -----------------------------------------------------------------------
    if (templateFlag) {
      if (!ALL_TEMPLATE_IDS.includes(templateFlag as TemplateId)) {
        console.error(c.error(`Unknown template: ${templateFlag}`));
        console.error(`Available: ${ALL_TEMPLATE_IDS.join(", ")}`);
        process.exit(1);
      }
      const templateId = templateFlag as TemplateId;
      const name = args.name ?? "my-video";
      const destDir = resolve(name);

      if (existsSync(destDir) && readdirSync(destDir).length > 0) {
        console.error(c.error(`Directory already exists and is not empty: ${name}`));
        process.exit(1);
      }

      mkdirSync(destDir, { recursive: true });

      let localVideoName: string | undefined;

      if (videoFlag) {
        const videoPath = resolve(videoFlag);
        if (!existsSync(videoPath)) {
          console.error(c.error(`Video file not found: ${videoFlag}`));
          process.exit(1);
        }
        const result = await handleVideoFile(videoPath, destDir, false);
        localVideoName = result.localVideoName;
      }

      scaffoldProject(destDir, basename(destDir), templateId, localVideoName);

      console.log(c.success(`\nCreated ${c.accent(name + "/")}`));
      for (const f of readdirSync(destDir)) {
        console.log(`  ${c.accent(f)}`);
      }
      return;
    }

    // -----------------------------------------------------------------------
    // Interactive mode
    // -----------------------------------------------------------------------
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

    // 2. Got a video?
    let localVideoName: string | undefined;

    if (videoFlag) {
      // Video supplied via --video flag even in interactive mode
      const videoPath = resolve(videoFlag);
      if (!existsSync(videoPath)) {
        clack.log.error(`Video file not found: ${videoFlag}`);
        clack.cancel("Setup cancelled.");
        process.exit(1);
      }
      mkdirSync(destDir, { recursive: true });
      const result = await handleVideoFile(videoPath, destDir, true);
      localVideoName = result.localVideoName;
    } else {
      const videoChoice = await clack.select({
        message: "Got a video file?",
        options: [
          { value: "yes", label: "Yes", hint: "MP4 or WebM recommended" },
          {
            value: "no",
            label: "No",
            hint: "Start with motion graphics or text",
          },
        ],
        initialValue: "no" as "yes" | "no",
      });
      if (clack.isCancel(videoChoice)) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (videoChoice === "yes") {
        const pathResult = await clack.text({
          message: "Path to your video file (drag and drop or paste)",
          placeholder: "/path/to/video.mp4",
          validate(val) {
            const trimmed = val?.trim();
            if (!trimmed) return "Please enter a file path";
            if (!existsSync(resolve(trimmed))) return "File not found";
            return undefined;
          },
        });
        if (clack.isCancel(pathResult)) {
          clack.cancel("Setup cancelled.");
          process.exit(0);
        }

        const videoPath = resolve(String(pathResult).trim());

        mkdirSync(destDir, { recursive: true });
        const result = await handleVideoFile(videoPath, destDir, true);
        localVideoName = result.localVideoName;
      }
    }

    // 3. Pick template — single list for all templates
    const templateResult = await clack.select({
      message: "Pick a template",
      options: TEMPLATES.map((t) => ({
        value: t.id,
        label: t.label,
        hint: t.hint,
      })),
      initialValue: TEMPLATES[0]?.id,
    });
    if (clack.isCancel(templateResult)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    const templateId: TemplateId = templateResult;

    // 4. Copy template and patch
    scaffoldProject(destDir, name, templateId, localVideoName);

    const files = readdirSync(destDir);
    clack.note(files.map((f) => c.accent(f)).join("\n"), c.success(`Created ${name}/`));

    await nextStepLoop(destDir);
  },
});
