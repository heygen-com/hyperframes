import { fpsToFfmpegArg } from "../fps.js";
import type { ImportClip, ImportTimeline } from "./schema.js";
import { planTransitions, type PlanOptions } from "./transitions.js";

export interface EmitOptions extends PlanOptions {
  /** Maps a clip to the project-relative path to write into `src` (default: the clip's own `src`). */
  srcFor?: (clip: ImportClip) => string;
  /** Stage size when the timeline does not carry one. */
  fallbackSize?: { width: number; height: number };
  gsapSrc?: string;
}

export interface EmitResult {
  html: string;
  width: number;
  height: number;
  warnings: string[];
}

const DEFAULT_SIZE = { width: 1920, height: 1080 };
const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js";

// Microseconds, not milliseconds: a millisecond start can fall after the frame it should begin on.
const num = (n: number) => String(Math.round(n * 1e6) / 1e6);

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Ids the generated document already uses. A clip is given an id of its own, so one named `root`
 * would otherwise repeat the composition's, and a fade aimed at `#root` would fade every layer.
 */
const RESERVED_IDS = ["root"];

/** Strips leading and trailing hyphens in one pass; a `-+$` pattern backtracks quadratically on a long run of them. */
function trimHyphens(text: string): string {
  let from = 0;
  let to = text.length;
  while (from < to && text[from] === "-") from++;
  while (to > from && text[to - 1] === "-") to--;
  return text.slice(from, to);
}

/** Element ids must be unique and attribute-safe; media without an id is dropped from the render. */
function elementIds(clips: ImportClip[]): Map<string, string> {
  const used = new Set<string>(RESERVED_IDS);
  const ids = new Map<string, string>();
  for (const clip of clips) {
    const base = trimHyphens(clip.id.replace(/[^A-Za-z0-9_-]+/g, "-")) || "clip";
    const safe = /^[A-Za-z]/.test(base) ? base : `c-${base}`;
    let candidate = safe;
    for (let n = 2; used.has(candidate); n++) candidate = `${safe}-${n}`;
    used.add(candidate);
    ids.set(clip.id, candidate);
  }
  return ids;
}

function timingAttrs(clip: ImportClip): string[] {
  const attrs = [`data-start="${num(clip.start)}"`, `data-duration="${num(clip.duration)}"`];
  if (clip.kind === "image") return [...attrs, `data-track-index="${clip.trackIndex}"`];
  if (clip.mediaStart > 0) attrs.push(`data-media-start="${num(clip.mediaStart)}"`);
  if (clip.playbackRate !== null && clip.playbackRate !== 1) {
    attrs.push(`data-playback-rate="${clip.playbackRate}"`);
  }
  attrs.push(`data-track-index="${clip.trackIndex}"`);
  return attrs;
}

function soundAttrs(clip: ImportClip): string[] {
  const attrs: string[] = [];
  // An editor who puts a still on the timeline means it to stay there, so say so: `check` calls a long
  // stretch where nothing changes a mistake, and `data-hold` is how deliberate stillness is marked.
  // It only informs that audit; it changes nothing in the render.
  if (clip.kind === "image") attrs.push("data-hold");
  if (clip.volume !== null && clip.volume !== 1) attrs.push(`data-volume="${clip.volume}"`);
  if (clip.kind === "video")
    attrs.push(clip.hasAudio ? 'data-has-audio="true"' : "muted", "playsinline");
  return attrs;
}

function clipAttrs(clip: ImportClip, id: string, src: string, zIndex: number): string[] {
  const attrs = [`id="${escapeAttr(id)}"`];
  if (clip.kind !== "audio") attrs.push('class="clip"');
  attrs.push(`src="${escapeAttr(src)}"`, ...timingAttrs(clip), ...soundAttrs(clip));
  if (clip.kind !== "audio") {
    attrs.push(
      `style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; z-index: ${zIndex}"`,
    );
  }
  return attrs;
}

function clipElement(clip: ImportClip, id: string, src: string, zIndex: number): string {
  const attrs = clipAttrs(clip, id, src, zIndex);
  const tag = clip.kind === "video" ? "video" : clip.kind === "audio" ? "audio" : "img";
  if (clip.kind === "image") attrs.push(`alt="${escapeAttr(clip.label ?? "")}"`);
  const open = `<${tag} ${attrs.join(" ")}`;
  return tag === "img" ? `${open} />` : `${open}></${tag}>`;
}

/** Renders a flat timeline as a lint-clean `index.html` following the composition contract. */
export function emitTimelineComposition(
  timeline: ImportTimeline,
  options: EmitOptions = {},
): EmitResult {
  const size = {
    width: timeline.width ?? options.fallbackSize?.width ?? DEFAULT_SIZE.width,
    height: timeline.height ?? options.fallbackSize?.height ?? DEFAULT_SIZE.height,
  };
  const warnings = [...timeline.warnings];
  const ids = elementIds(timeline.clips);
  const srcFor = options.srcFor ?? ((clip: ImportClip) => clip.src);

  const plan = planTransitions(timeline, { mediaDuration: options.mediaDuration });
  warnings.push(...plan.warnings);
  const fades = plan.fades.map((fade) => {
    const [from, to] = fade.direction === "in" ? [0, 1] : [1, 0];
    const target = `#${ids.get(fade.clipId) ?? fade.clipId}`;
    return `      tl.fromTo("${target}", { opacity: ${from} }, { opacity: ${to}, duration: ${num(fade.duration)}, ease: "none" }, ${num(fade.start)});`;
  });

  const ordered = [...plan.clips].sort((a, b) => a.start - b.start || a.trackIndex - b.trackIndex);
  const elements = ordered.map((clip) => {
    const id = ids.get(clip.id) ?? clip.id;
    return `      ${clipElement(clip, id, srcFor(clip), clip.trackIndex + 1)}`;
  });

  const { width, height } = size;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="${options.gsapSrc ?? GSAP_SRC}"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${num(timeline.duration)}"
      data-width="${width}"
      data-height="${height}"
      data-fps="${fpsToFfmpegArg(timeline.fps)}"
    >
${elements.join("\n")}
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
${fades.join("\n")}${fades.length ? "\n" : ""}      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  return { html, width, height, warnings };
}
