import { existsSync } from "node:fs";
import type { Fps } from "@hyperframes/core";
import type { Page } from "puppeteer-core";
import {
  buildVideoLayerInput,
  isHttpUrl,
  qualifyVideoLayer,
  resolveProjectRelativeSrc,
  type VideoElement,
  type VideoLayerInput,
} from "@hyperframes/engine";

export type VideoLayerPlan =
  | { videoId: string; layer: VideoLayerInput }
  | { videoId?: undefined; reason: string };

type ProbePage = Pick<Page, "evaluate">;

const SAMPLES = 9;

type FitOrReason = { fit: "fill" | "cover" } | { reason: string };

/** Runs in the page; must stay self-contained. */
// fallow-ignore-next-line complexity
export function inspectVideoLayout(
  id: string,
  w: number,
  h: number,
  time: number,
): { fit: "fill" | "cover" } | { reason: string } {
  (window as unknown as { __hf?: { seek?: (t: number) => void } }).__hf?.seek?.(time);
  const video = document.getElementById(id);
  if (!video) return { reason: "video_missing" };
  const r = video.getBoundingClientRect();
  if (Math.abs(r.left) > 0.5 || Math.abs(r.top) > 0.5) return { reason: "not_full_canvas" };
  if (Math.abs(r.width - w) > 0.5 || Math.abs(r.height - h) > 0.5) {
    return { reason: "not_full_canvas" };
  }
  const painted = (s: CSSStyleDeclaration) =>
    (s.backgroundColor !== "" &&
      s.backgroundColor !== "transparent" &&
      s.backgroundColor !== "rgba(0, 0, 0, 0)") ||
    (s.backgroundImage !== "" && s.backgroundImage !== "none");
  for (let e: Element | null = video; e && e !== document.documentElement; ) {
    const s = getComputedStyle(e);
    if (s.opacity !== "1") return { reason: "opacity" };
    if (s.transform !== "none" || s.filter !== "none") return { reason: "transform_or_filter" };
    if (s.clipPath !== "none" || s.maskImage !== "none") return { reason: "clip_or_mask" };
    if (s.mixBlendMode !== "normal") return { reason: "blend_mode" };
    if (s.visibility !== "visible" || s.display === "none") return { reason: "not_shown" };
    const cleared = e === document.body || e.hasAttribute("data-composition-id");
    if (e !== video && painted(s) && !cleared) return { reason: "ancestor_background" };
    e = e.parentElement;
  }
  // Capture clears every composition root's background, so one painted above the video would lose it.
  for (const root of Array.from(document.querySelectorAll("[data-composition-id]"))) {
    if (root.parentElement?.closest("[data-composition-id]") && painted(getComputedStyle(root))) {
      return { reason: "subcomposition_background" };
    }
  }
  const fitStyle = getComputedStyle(video).objectFit;
  if (fitStyle !== "fill" && fitStyle !== "cover") return { reason: "object_fit" };
  const own = Number.parseInt(getComputedStyle(video).zIndex, 10) || 0;
  for (const other of Array.from(document.body.querySelectorAll("*"))) {
    if (other === video || other.contains(video) || video.contains(other)) continue;
    if (other.tagName === "SCRIPT" || other.tagName === "STYLE") continue;
    const z = Number.parseInt(getComputedStyle(other).zIndex, 10) || 0;
    const before = video.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING;
    if (z < own || (z === own && before)) {
      const box = other.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return { reason: "paints_under" };
    }
  }
  return { fit: fitStyle === "cover" ? "cover" : "fill" };
}

/** Checks, at sampled times, that the video fills the canvas with nothing painting under or around it. */
async function probeVideoLayout(
  page: ProbePage,
  videoId: string,
  canvas: { width: number; height: number },
  duration: number,
): Promise<FitOrReason> {
  let fit: "fill" | "cover" = "fill";
  for (let i = 0; i < SAMPLES; i++) {
    const t = (duration * i) / SAMPLES;
    const seen = await page.evaluate(inspectVideoLayout, videoId, canvas.width, canvas.height, t);
    if ("reason" in seen) return seen;
    if (seen.fit === "cover") fit = "cover";
  }
  await page.evaluate(() =>
    (window as unknown as { __hf?: { seek?: (t: number) => void } }).__hf?.seek?.(0),
  );
  return { fit };
}

export async function planVideoLayerPassthrough(input: {
  videos: readonly VideoElement[];
  duration: number;
  fps: Fps;
  canvas: { width: number; height: number };
  page: ProbePage;
  projectDir: string;
  compiledDir: string;
}): Promise<VideoLayerPlan> {
  const q = qualifyVideoLayer(input.videos, input.duration);
  if (!q.qualifies) return { reason: q.reason };
  const { video } = q;
  if (isHttpUrl(video.src)) return { reason: "remote_source" };
  const path = resolveProjectRelativeSrc(video.src, input.projectDir, input.compiledDir);
  if (!existsSync(path)) return { reason: "source_missing" };
  const layout = await probeVideoLayout(input.page, video.id, input.canvas, input.duration);
  if ("reason" in layout) return layout;
  const layer = await buildVideoLayerInput(
    path,
    video.mediaStart,
    input.duration,
    input.fps,
    input.canvas,
    layout.fit,
  );
  return layer ? { videoId: video.id, layer } : { reason: "source_unsupported" };
}
