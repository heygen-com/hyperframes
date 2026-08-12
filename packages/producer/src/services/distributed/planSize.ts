import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { PLAN_AUDIO_RELATIVE_PATH } from "./shared.js";

const MAX_TOP_COMPONENTS = 10;
const SOURCE_MEDIA_EXTENSIONS = new Set([
  ".aac",
  ".aiff",
  ".avi",
  ".flac",
  ".m4a",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogg",
  ".ogv",
  ".ts",
  ".wav",
  ".webm",
]);

export type PlanSizeRootKind = "compiled" | "plan";

export interface PlanSizeComponent {
  /** Fixed category or a one-way hash for a video-frame directory; never a source path. */
  label: string;
  sizeBytes: number;
  fileCount: number;
}

export interface PlanSizeBreakdown {
  totalBytes: number;
  fileCount: number;
  compiledBytes: number;
  /** Attribution within compiledBytes, not an additional mutually-exclusive bucket. */
  sourceMediaBytes: number;
  videoFramesBytes: number;
  videoFrameFileCount: number;
  audioBytes: number;
  metadataBytes: number;
  otherBytes: number;
  /** Largest fixed/hash-only buckets, deterministically ordered and bounded. */
  topComponents: PlanSizeComponent[];
}

type PlanSizeCategory = "audio" | "compiled" | "metadata" | "other" | "video-frames";

interface ClassifiedFile {
  category: PlanSizeCategory;
  componentLabel: string;
}

const PLAN_ROOT_CATEGORY: Readonly<Record<string, PlanSizeCategory>> = {
  compiled: "compiled",
  [PLAN_AUDIO_RELATIVE_PATH]: "audio",
  meta: "metadata",
  "plan.json": "metadata",
};

function hashComponent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function classifyFile(segments: string[], rootKind: PlanSizeRootKind): ClassifiedFile {
  const rootName = segments[0] ?? "";
  const extractedRootName = rootKind === "compiled" ? "__hyperframes_video_frames" : "video-frames";
  if (rootName === extractedRootName) {
    const videoKey = segments[1] ?? "unknown";
    return {
      category: "video-frames",
      componentLabel: `video-frames:${hashComponent(videoKey)}`,
    };
  }

  const category = rootKind === "compiled" ? "compiled" : (PLAN_ROOT_CATEGORY[rootName] ?? "other");
  return { category, componentLabel: category };
}

function emptyBreakdown(): PlanSizeBreakdown {
  return {
    totalBytes: 0,
    fileCount: 0,
    compiledBytes: 0,
    sourceMediaBytes: 0,
    videoFramesBytes: 0,
    videoFrameFileCount: 0,
    audioBytes: 0,
    metadataBytes: 0,
    otherBytes: 0,
    topComponents: [],
  };
}

function addCategoryBytes(
  result: PlanSizeBreakdown,
  category: PlanSizeCategory,
  filePath: string,
  sizeBytes: number,
): void {
  if (category === "compiled") {
    result.compiledBytes += sizeBytes;
    if (SOURCE_MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      result.sourceMediaBytes += sizeBytes;
    }
    return;
  }
  if (category === "video-frames") {
    result.videoFramesBytes += sizeBytes;
    result.videoFrameFileCount += 1;
    return;
  }
  if (category === "audio") {
    result.audioBytes += sizeBytes;
    return;
  }
  if (category === "metadata") {
    result.metadataBytes += sizeBytes;
    return;
  }
  result.otherBytes += sizeBytes;
}

function recordFile(
  result: PlanSizeBreakdown,
  components: Map<string, PlanSizeComponent>,
  rootDir: string,
  rootKind: PlanSizeRootKind,
  filePath: string,
): void {
  let sizeBytes: number;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile()) return;
    sizeBytes = stat.size;
  } catch {
    return;
  }
  const rel = relative(rootDir, filePath);
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  const classified = classifyFile(segments, rootKind);

  result.totalBytes += sizeBytes;
  result.fileCount += 1;
  addCategoryBytes(result, classified.category, filePath, sizeBytes);

  const component = components.get(classified.componentLabel) ?? {
    label: classified.componentLabel,
    sizeBytes: 0,
    fileCount: 0,
  };
  component.sizeBytes += sizeBytes;
  component.fileCount += 1;
  components.set(classified.componentLabel, component);
}

function walkRegularFiles(dir: string, visit: (filePath: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRegularFiles(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

/**
 * Measure a staged compiled tree or finalized plan tree without following
 * symlinks. Component labels are fixed or hashed, so callers can safely put
 * the bounded result in logs/errors without exposing authored paths.
 */
export function measurePlanSizeBreakdown(
  rootDir: string,
  rootKind: PlanSizeRootKind = "plan",
): PlanSizeBreakdown {
  const result = emptyBreakdown();
  const components = new Map<string, PlanSizeComponent>();

  walkRegularFiles(rootDir, (filePath) =>
    recordFile(result, components, rootDir, rootKind, filePath),
  );
  result.topComponents = [...components.values()]
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.label.localeCompare(b.label))
    .slice(0, MAX_TOP_COMPONENTS);
  return result;
}
