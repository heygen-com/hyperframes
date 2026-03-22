import fs from "node:fs";
import path from "node:path";

type AttrMap = Record<string, string>;

type ParsedTag = {
  tagName: string;
  attrs: AttrMap;
  raw: string;
};

type TimelineClip = {
  id: string | null;
  label: string;
  start: number;
  duration: number;
  track: number;
  kind: "video" | "audio" | "image" | "element";
  tagName: string | null;
  compositionId: string | null;
  compositionSrc: string | null;
  assetUrl: string | null;
  durationSource: "deterministic" | "fallback";
};

type TimelinePayload = {
  source: "hf-preview";
  type: "timeline";
  durationInFrames: number;
  clips: TimelineClip[];
  scenes: [];
  compositionWidth: number;
  compositionHeight: number;
};

function parseNum(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const inputPath = normalizedArgs[0];
  let forcedFps: number | null = null;
  let forcedMaxDuration: number | null = null;
  for (let i = 1; i < normalizedArgs.length; i += 1) {
    const arg = normalizedArgs[i];
    if (arg === "--fps" && normalizedArgs[i + 1]) {
      forcedFps = parseNum(normalizedArgs[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--max-duration" && normalizedArgs[i + 1]) {
      forcedMaxDuration = parseNum(normalizedArgs[i + 1]);
      i += 1;
    }
  }
  return { inputPath, forcedFps, forcedMaxDuration };
}

function parseAttributes(rawAttrs: string): AttrMap {
  const attrs: AttrMap = {};
  const attrRegex = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = attrRegex.exec(rawAttrs);
    if (!match) break;
    const key = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function parseTags(html: string): ParsedTag[] {
  const tags: ParsedTag[] = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = tagRegex.exec(html);
    if (!match) break;
    const raw = match[0];
    if (raw.startsWith("</") || raw.startsWith("<!")) continue;
    const tagName = String(match[1] || "").toLowerCase();
    if (!tagName) continue;
    tags.push({
      tagName,
      raw,
      attrs: parseAttributes(match[2] || ""),
    });
  }
  return tags;
}

function extractWindowNumber(html: string, key: string): number | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedKey}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const match = html.match(regex);
  if (!match) return null;
  return parseNum(match[1]);
}

function normalizeDurationSeconds(
  rawDuration: number | null,
  fallbackDuration: number | null,
  maxDuration: number,
): number {
  const safeFallback = fallbackDuration != null && fallbackDuration > 0 ? fallbackDuration : 0;
  const safeRaw = rawDuration != null && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  if (safeRaw > 0) return Math.min(safeRaw, maxDuration);
  if (safeFallback > 0) return Math.min(safeFallback, maxDuration);
  return 0;
}

function shouldIncludeTimelineNode(tag: ParsedTag, rootCompositionId: string | null): boolean {
  const attrs = tag.attrs;
  if (attrs["data-composition-id"] && rootCompositionId && attrs["data-composition-id"] === rootCompositionId) {
    return false;
  }
  if (tag.tagName === "script" || tag.tagName === "style" || tag.tagName === "link" || tag.tagName === "meta") {
    return false;
  }
  if ((attrs.class || "").split(/\s+/).includes("__preview_render_frame__")) return false;
  if (attrs["data-start"] != null) return true;
  if (attrs["data-track-index"] != null) return true;
  if (attrs["data-composition-src"] != null) return true;
  if (attrs["data-composition-id"] != null) return true;
  return tag.tagName === "video" || tag.tagName === "audio" || tag.tagName === "img";
}

function inferClipDuration(tag: ParsedTag, start: number, maxDuration: number): number | null {
  const attrs = tag.attrs;
  const durationAttr = parseNum(attrs["data-duration"]);
  if (durationAttr != null && durationAttr > 0) return normalizeDurationSeconds(durationAttr, null, maxDuration);

  const endAttr = parseNum(attrs["data-end"]);
  if (endAttr != null && endAttr > start) {
    return normalizeDurationSeconds(endAttr - start, null, maxDuration);
  }

  if (tag.tagName === "video" || tag.tagName === "audio") {
    const sourceDuration = parseNum(attrs["data-source-duration"]);
    const playbackStart = parseNum(attrs["data-playback-start"]) ?? parseNum(attrs["data-playbackStart"]) ?? 0;
    if (sourceDuration != null && sourceDuration > 0) {
      return normalizeDurationSeconds(Math.max(0, sourceDuration - playbackStart), null, maxDuration);
    }
  }

  if (attrs["data-composition-id"]) {
    const sourceDuration = parseNum(attrs["data-source-duration"]);
    if (sourceDuration != null && sourceDuration > 0) {
      return normalizeDurationSeconds(sourceDuration, null, maxDuration);
    }
  }

  return null;
}

function resolveNodeAssetUrl(tag: ParsedTag): string | null {
  const attrs = tag.attrs;
  return (
    attrs.src ??
    attrs["data-src"] ??
    attrs["data-asset-src"] ??
    attrs["data-video-src"] ??
    attrs["data-image-src"] ??
    null
  );
}

function resolveRootTag(tags: ParsedTag[]): ParsedTag | null {
  const explicitRoot = tags.find((tag) => tag.attrs["data-composition-id"] === "master");
  if (explicitRoot) return explicitRoot;
  return tags.find((tag) => tag.attrs["data-composition-id"] != null) ?? null;
}

function main() {
  const { inputPath, forcedFps, forcedMaxDuration } = parseArgs();
  if (!inputPath) {
    console.error("Usage: pnpm debug:timeline <path-to-html> [--fps 30] [--max-duration 1800]");
    process.exit(2);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(2);
  }

  const html = fs.readFileSync(resolvedPath, "utf-8");
  const tags = parseTags(html);
  const root = resolveRootTag(tags);
  const rootCompositionId = root?.attrs["data-composition-id"] ?? null;

  const maxDuration =
    (forcedMaxDuration != null && forcedMaxDuration > 0
      ? forcedMaxDuration
      : extractWindowNumber(html, "window.__HF_MAX_DURATION_SEC")) ?? 1800;
  const canonicalFps =
    (forcedFps != null && forcedFps > 0
      ? forcedFps
      : (parseNum(root?.attrs["data-fps"]) ?? extractWindowNumber(html, "window.__HF_FPS"))) ?? 30;

  const rootDurationRaw =
    parseNum(root?.attrs["data-composition-duration"]) ??
    parseNum(root?.attrs["data-duration"]) ??
    parseNum(tags.find((tag) => tag.tagName === "html")?.attrs["data-composition-duration"] ?? null);
  const rootDuration = normalizeDurationSeconds(rootDurationRaw, null, maxDuration);

  const nodes = tags.filter((tag) => shouldIncludeTimelineNode(tag, rootCompositionId));
  const clips: TimelineClip[] = [];
  let maxEnd = 0;
  let unresolvedClipCount = 0;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const attrs = node.attrs;
    const start = Math.max(0, parseNum(attrs["data-start"]) ?? 0);
    const inferredDuration = inferClipDuration(node, start, maxDuration);
    const hasDeterministicDuration = inferredDuration != null && inferredDuration > 0;
    let duration = hasDeterministicDuration ? normalizeDurationSeconds(inferredDuration, 0, maxDuration) : 0;
    let durationSource: "deterministic" | "fallback" = "deterministic";
    if (duration <= 0 && rootDuration > start) {
      duration = normalizeDurationSeconds(rootDuration - start, 0, maxDuration);
      durationSource = "fallback";
    }
    if (duration <= 0) {
      unresolvedClipCount += 1;
      continue;
    }
    if (hasDeterministicDuration) {
      const end = start + duration;
      if (end > maxEnd) maxEnd = end;
    }
    const kind =
      node.tagName === "video"
        ? "video"
        : node.tagName === "audio"
          ? "audio"
          : node.tagName === "img"
            ? "image"
            : "element";
    const trackRaw = parseNum(attrs["data-track-index"]);
    const track = trackRaw != null && Number.isFinite(trackRaw) ? Math.floor(trackRaw) : i;
    clips.push({
      id: attrs.id ?? null,
      label: attrs["data-label"] ?? attrs["aria-label"] ?? attrs.id ?? kind,
      start,
      duration,
      track,
      kind,
      tagName: node.tagName || null,
      compositionId: attrs["data-composition-id"] ?? null,
      compositionSrc: attrs["data-composition-src"] ?? null,
      assetUrl: resolveNodeAssetUrl(node),
      durationSource,
    });
  }

  let effectiveDuration = 0;
  if (maxEnd > 0) effectiveDuration = normalizeDurationSeconds(maxEnd, 0, maxDuration);
  if (effectiveDuration <= 0) effectiveDuration = normalizeDurationSeconds(rootDuration, 1, maxDuration);
  if (effectiveDuration <= 0) effectiveDuration = 1;

  const compositionWidth = parseNum(root?.attrs["data-width"]) ?? 1920;
  const compositionHeight = parseNum(root?.attrs["data-height"]) ?? 1080;
  const payload: TimelinePayload = {
    source: "hf-preview",
    type: "timeline",
    durationInFrames: Math.max(1, Math.round(effectiveDuration * canonicalFps)),
    clips,
    scenes: [],
    compositionWidth,
    compositionHeight,
  };

  const output = {
    file: resolvedPath,
    debug: {
      canonicalFps,
      maxDurationSeconds: maxDuration,
      rootCompositionId,
      rootDurationSeconds: rootDuration,
      deterministicMaxEndSeconds: maxEnd,
      effectiveDurationSeconds: effectiveDuration,
      unresolvedClipCount,
      clipCount: clips.length,
    },
    payload,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
