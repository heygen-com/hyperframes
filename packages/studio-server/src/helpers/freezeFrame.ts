import { createHash, randomBytes } from "node:crypto";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { readMediaOffsetSeconds } from "@hyperframes/parsers/media-duration";
import { resolveRateSpec, sourceTimeAt } from "@hyperframes/core/speed-ramp";
import { MEDIA_LINK_ATTR as LINK_ATTR, relinkSplitHalves } from "@hyperframes/core/media-link";
import {
  findTargetElement,
  isHTMLElement,
  parseSourceDocument,
  splitElementInHtml,
  type SourceMutationTarget,
} from "./sourceMutation.js";

const FREEZE_HOLD_SECONDS = 2;
const EPSILON = 1e-3;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function numberAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function trackOf(el: Element): number {
  return numberAttr(el, "data-track-index") ?? numberAttr(el, "data-layer") ?? 0;
}

/** Media seconds shown at `playhead`: the clip's in-point plus the source its rate (or rate lane) has consumed. */
export function freezeFrameMediaTime(input: {
  clipStart: number;
  playhead: number;
  mediaStart: number;
  playbackRate: number;
  automation: string | null;
}): number {
  const rate = resolveRateSpec(input.automation, input.playbackRate);
  return input.mediaStart + sourceTimeAt(rate, Math.max(0, input.playhead - input.clipStart));
}

export function freezeExtractArgs(src: string, mediaTime: number, output: string): string[] {
  return ["-y", "-ss", String(round3(mediaTime)), "-i", src, "-frames:v", "1", output];
}

export const randomStillToken = (): string => randomBytes(4).toString("hex");

export function freezeStillFileName(
  clipId: string,
  playhead: number,
  token: string = randomStillToken(),
): string {
  const stem = clipId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "clip";
  const idHash = createHash("sha256").update(clipId).digest("hex").slice(0, 10);
  return `${stem}-${idHash}-${Math.round(playhead * 1000)}-${token}.png`;
}

export interface FreezeSource {
  id: string;
  src: string;
  mediaTime: number;
}

/** The video to freeze and the media time under the playhead, read from the source file. */
export function readFreezeSource(
  html: string,
  target: SourceMutationTarget,
  playhead: number,
): FreezeSource | null {
  const { document } = parseSourceDocument(html);
  const el = findTargetElement(document, target);
  if (!el || el.tagName.toLowerCase() !== "video") return null;
  const src = el.getAttribute("src");
  const start = numberAttr(el, "data-start");
  const duration = numberAttr(el, "data-duration");
  if (!src || start === null || duration === null) return null;
  if (playhead <= start + EPSILON || playhead >= start + duration - EPSILON) return null;
  return {
    id: el.getAttribute("id") || "clip",
    src,
    mediaTime: freezeFrameMediaTime({
      clipStart: start,
      playhead,
      mediaStart: readMediaOffsetSeconds((name) => el.getAttribute(name)),
      playbackRate: numberAttr(el, "data-playback-rate") ?? 1,
      automation: el.getAttribute("data-automation"),
    }),
  };
}

function targetOf(el: Element): SourceMutationTarget {
  const hfId = el.getAttribute("data-hf-id");
  return { ...(hfId ? { hfId } : {}), id: el.getAttribute("id") };
}

function spans(el: Element, time: number): boolean {
  const start = numberAttr(el, "data-start");
  const duration = numberAttr(el, "data-duration");
  if (start === null || duration === null) return false;
  return time > start + EPSILON && time < start + duration - EPSILON;
}

function uniqueId(document: Document, base: string): string {
  let id = base;
  for (let n = 2; document.getElementById(id); n++) id = `${base}-${n}`;
  return id;
}

function shiftTracks(document: Document, tracks: Set<number>, from: number, by: number): void {
  for (const el of document.querySelectorAll("[data-start]")) {
    if (el.hasAttribute("data-composition-id") || !tracks.has(trackOf(el))) continue;
    const start = numberAttr(el, "data-start");
    if (start === null || start < from - EPSILON) continue;
    el.setAttribute("data-start", String(round3(start + by)));
  }
}

function growRootToFit(document: Document): void {
  const root = document.querySelector("[data-composition-id]");
  const rootDuration = root ? numberAttr(root, "data-duration") : null;
  if (!root || rootDuration === null) return;
  let end = rootDuration;
  for (const el of root.querySelectorAll("[data-start][data-duration]")) {
    const start = numberAttr(el, "data-start");
    const duration = numberAttr(el, "data-duration");
    if (start !== null && duration !== null) end = Math.max(end, start + duration);
  }
  if (end > rootDuration + EPSILON) root.setAttribute("data-duration", String(round3(end)));
}

const COPIED_PICTURE_ATTRS = ["class", "style", "data-color-grading"];

function buildStill(
  document: Document,
  video: Element,
  input: { id: string; imageSrc: string; playhead: number; holdSeconds: number },
): Element {
  const img = document.createElement("img");
  img.setAttribute("id", input.id);
  for (const name of COPIED_PICTURE_ATTRS) {
    const value = video.getAttribute(name);
    if (value !== null) img.setAttribute(name, value);
  }
  if (!img.classList.contains("clip")) img.classList.add("clip");
  img.setAttribute("src", input.imageSrc);
  img.setAttribute("alt", "");
  img.setAttribute("data-start", String(round3(input.playhead)));
  img.setAttribute("data-duration", String(input.holdSeconds));
  img.setAttribute("data-track-index", String(trackOf(video)));
  img.setAttribute("data-timeline-label", "Freeze");
  return img;
}

export interface FreezeFrameResult {
  html: string;
  freezeId: string;
}

/**
 * Split the video at the playhead, put a still of that frame in the gap and push the rest of its
 * track (and a linked partner's, which is split too and left silent for the hold) right by the hold.
 */
function linkedPartners(document: Document, video: Element): Element[] {
  const link = video.getAttribute(LINK_ATTR);
  if (!link) return [];
  return Array.from(document.querySelectorAll(`[${LINK_ATTR}]`)).filter(
    (el) => el !== video && el.getAttribute(LINK_ATTR) === link,
  );
}

/** Split every element at `time`, in order; the new right halves' ids, or null if one missed. */
function splitAll(
  html: string,
  elements: readonly Element[],
  time: number,
): { html: string; rightHalfIds: string[] } | null {
  const rightHalfIds: string[] = [];
  let next = html;
  for (const el of elements) {
    const split = splitElementInHtml(
      next,
      targetOf(el),
      time,
      `${el.getAttribute("id") || "clip"}-split`,
      {
        start: numberAttr(el, "data-start") ?? 0,
        duration: numberAttr(el, "data-duration") ?? 0,
        track: trackOf(el),
      },
    );
    if (!split.matched || !split.newId) return null;
    next = split.html;
    rightHalfIds.push(split.newId);
  }
  return { html: next, rightHalfIds };
}

/**
 * Split the video at the playhead, put a still of that frame in the gap and push the rest of its
 * track (and a linked partner's, which is split too and left silent for the hold) right by the hold.
 */
export function applyFreezeFrameToHtml(
  html: string,
  input: {
    target: SourceMutationTarget;
    playhead: number;
    imageSrc: string;
    holdSeconds?: number;
  },
): FreezeFrameResult | null {
  const hold = input.holdSeconds ?? FREEZE_HOLD_SECONDS;
  const { document: before } = parseSourceDocument(html);
  const video = findTargetElement(before, input.target);
  if (!video || !isHTMLElement(video) || !spans(video, input.playhead)) return null;
  const partners = linkedPartners(before, video);
  const tracks = new Set([trackOf(video), ...partners.map(trackOf)]);
  const cut = splitAll(
    html,
    [video, ...partners.filter((el) => spans(el, input.playhead))],
    input.playhead,
  );
  if (!cut) return null;

  const { document, wrappedFragment } = parseSourceDocument(cut.html);
  relinkSplitHalves(document, cut.rightHalfIds);
  shiftTracks(document, tracks, input.playhead, hold);
  const leftHalf = findTargetElement(document, input.target);
  if (!leftHalf?.parentElement) return null;
  const freezeId = uniqueId(document, `${video.getAttribute("id") || "clip"}-freeze`);
  const still = buildStill(document, leftHalf, {
    id: freezeId,
    imageSrc: input.imageSrc,
    playhead: input.playhead,
    holdSeconds: hold,
  });
  leftHalf.parentElement.insertBefore(still, leftHalf.nextSibling);
  growRootToFit(document);
  return {
    html: ensureHfIds(wrappedFragment ? document.body.innerHTML || "" : document.toString()),
    freezeId,
  };
}
