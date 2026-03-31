#!/usr/bin/env tsx
/**
 * Generate Template Preview Images + Videos
 *
 * Uses @hyperframes/producer to render PNG thumbnails and short MP4 preview
 * videos of each built-in template.
 *
 * Output: docs/images/templates/<id>.png + <id>.mp4
 *
 * Usage:
 *   pnpm generate:previews                  # all templates (PNG + MP4)
 *   pnpm generate:previews -- --only warm-grain
 *   pnpm generate:previews -- --skip-video  # thumbnails only (faster)
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createFileServer,
  createCaptureSession,
  initializeSession,
  captureFrame,
  getCompositionDuration,
  closeCaptureSession,
  createRenderJob,
  executeRenderJob,
} from "@hyperframes/producer";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundledTemplatesDir = resolve(repoRoot, "packages/cli/src/templates");
const examplesDir = resolve(repoRoot, "examples");
const outputDir = resolve(repoRoot, "docs/images/templates");

if (!process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
  process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = resolve(
    repoRoot,
    "packages/core/dist/hyperframe.manifest.json",
  );
}

const SKIP_TEMPLATES = new Set(["blank"]);
const DEFAULT_CONFIG = { width: 1920, height: 1080, captureTime: 2.0 };
const TEMPLATE_CONFIG: Record<string, { width: number; height: number; captureTime: number }> = {
  vignelli: { width: 1080, height: 1920, captureTime: 2.0 },
};

function patchTemplateHtml(dir: string, durationSeconds: number): void {
  const htmlFiles = readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));

  for (const file of htmlFiles) {
    let content = readFileSync(file, "utf-8");
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/video>/g, "");
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/audio>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    const dur = String(Math.round(durationSeconds * 100) / 100);
    content = content.replaceAll("__VIDEO_DURATION__", dur);
    writeFileSync(file, content, "utf-8");
  }
}

function parseArgs(): { only: string | null; skipVideo: boolean } {
  let only: string | null = null;
  let skipVideo = false;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    }
    if (process.argv[i] === "--skip-video") skipVideo = true;
  }
  return { only, skipVideo };
}

function resolveTemplateDir(templateId: string): string | null {
  for (const base of [bundledTemplatesDir, examplesDir]) {
    const dir = join(base, templateId);
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

function discoverTemplates(only: string | null): string[] {
  const seen = new Set<string>();
  const all: string[] = [];

  for (const dir of [bundledTemplatesDir, examplesDir]) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        e.name !== "_shared" &&
        !SKIP_TEMPLATES.has(e.name) &&
        !seen.has(e.name) &&
        existsSync(join(dir, e.name, "index.html"))
      ) {
        seen.add(e.name);
        all.push(e.name);
      }
    }
  }

  if (only) {
    if (!all.includes(only)) {
      console.error(`Template "${only}" not found. Available: ${all.join(", ")}`);
      process.exit(1);
    }
    return [only];
  }
  return all;
}

function prepareTemplateDir(templateId: string): string {
  const tmpDir = join(tmpdir(), `hf-preview-${templateId}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const src = resolveTemplateDir(templateId);
  if (!src) throw new Error(`Template directory not found for "${templateId}"`);
  cpSync(src, tmpDir, { recursive: true });
  patchTemplateHtml(tmpDir, 5);
  return tmpDir;
}

async function generateThumbnail(templateId: string, projectDir: string): Promise<void> {
  const config = TEMPLATE_CONFIG[templateId] ?? DEFAULT_CONFIG;

  const framesDir = join(projectDir, "_thumb_frames");
  mkdirSync(framesDir, { recursive: true });

  const fileServer = await createFileServer({ projectDir, port: 0 });
  try {
    const session = await createCaptureSession(fileServer.url, framesDir, {
      width: config.width,
      height: config.height,
      fps: 30,
      format: "png",
    });
    await initializeSession(session);

    let duration: number;
    try {
      duration = await getCompositionDuration(session);
    } catch {
      duration = 5;
    }

    const t = Math.min(config.captureTime, duration * 0.8);
    const result = await captureFrame(session, 0, t);
    cpSync(result.path, join(outputDir, `${templateId}.png`));
    console.log(`  ✓ ${templateId}.png (${result.captureTimeMs}ms)`);

    await closeCaptureSession(session);
  } finally {
    fileServer.close();
    rmSync(framesDir, { recursive: true, force: true });
  }
}

async function generateVideo(templateId: string, projectDir: string): Promise<void> {
  const outMp4 = join(outputDir, `${templateId}.mp4`);
  const job = createRenderJob({
    fps: 24,
    quality: "draft",
    format: "mp4",
  });
  await executeRenderJob(job, projectDir, outMp4);
  console.log(`  ✓ ${templateId}.mp4`);
}

async function main(): Promise<void> {
  const { only, skipVideo } = parseArgs();
  const templates = discoverTemplates(only);

  console.log(
    `Generating previews for ${templates.length} templates${skipVideo ? " (thumbnails only)" : " + videos"}...\n`,
  );
  mkdirSync(outputDir, { recursive: true });

  for (const templateId of templates) {
    const projectDir = prepareTemplateDir(templateId);
    try {
      await generateThumbnail(templateId, projectDir);
      if (!skipVideo) {
        await generateVideo(templateId, projectDir);
      }
    } catch (err) {
      console.error(`  ✗ ${templateId}: ${err instanceof Error ? err.message : err}`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }

  console.log(`\nDone. Output: ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
