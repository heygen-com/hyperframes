import { readMediaOffsetSeconds } from "@hyperframes/parsers/media-duration";

/**
 * Linked clips: members sharing a `data-link` id are edited as one (a detached
 * video + its audio). An editing contract only; playback and render ignore it.
 */
export const MEDIA_LINK_ATTR = "data-link";

interface AttributeReader {
  getAttribute(name: string): string | null;
}

export interface LinkTiming {
  start: number;
  duration: number;
  mediaStart: number;
  playbackRate: number;
}

const LINK_TIMING_FIELDS: ReadonlyArray<[keyof LinkTiming, string]> = [
  ["start", "start"],
  ["duration", "duration"],
  ["mediaStart", "media-start"],
  ["playbackRate", "playback-rate"],
];

const SYNC_TOLERANCE_S = 1e-3;

function readNumber(el: AttributeReader, names: string[], fallback: number): number {
  for (const name of names) {
    const raw = el.getAttribute(name);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

export function readLinkTiming(el: AttributeReader): LinkTiming {
  return {
    start: readNumber(el, ["data-start"], 0),
    duration: readNumber(el, ["data-duration"], 0),
    mediaStart: readMediaOffsetSeconds((name) => el.getAttribute(name)),
    playbackRate: readNumber(el, ["data-playback-rate"], 1),
  };
}

/** The timing fields (`start`, `duration`, `media-start`, `playback-rate`) on which members disagree. */
export function linkTimingMismatches(members: readonly AttributeReader[]): string[] {
  const timings = members.map(readLinkTiming);
  const first = timings[0];
  if (!first) return [];
  return LINK_TIMING_FIELDS.filter(([key]) =>
    timings.some((timing) => Math.abs(timing[key] - first[key]) > SYNC_TOLERANCE_S),
  ).map(([, field]) => field);
}

const LINK_SCOPE_SELECTOR = "[data-composition-id], [data-composition-file]";

/** The composition a link group stays inside: the nearest inline composition or file host. */
export function linkScopeOf(el: Element): Element | null {
  return el.parentElement?.closest(LINK_SCOPE_SELECTOR) ?? null;
}

export function mintLinkId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`lk-${n}`)) n += 1;
  return `lk-${n}`;
}

function takenLinkIds(doc: Document): string[] {
  return Array.from(
    doc.querySelectorAll(`[id], [${MEDIA_LINK_ATTR}], [${SYNC_ORIGIN_ATTR}]`),
  ).flatMap((el) => [
    el.id,
    el.getAttribute(MEDIA_LINK_ATTR) ?? "",
    el.getAttribute(SYNC_ORIGIN_ATTR) ?? "",
  ]);
}

function renameShared(
  doc: Document,
  ids: readonly string[],
  attr: string,
  taken: Set<string>,
): void {
  const renamed = new Map<string, string>();
  for (const id of ids) {
    const el = doc.getElementById(id);
    const old = el?.getAttribute(attr);
    if (!el || !old) continue;
    let fresh = renamed.get(old);
    if (!fresh) {
      fresh = mintLinkId(taken);
      taken.add(fresh);
      renamed.set(old, fresh);
    }
    el.setAttribute(attr, fresh);
  }
}

/** Split right halves get a fresh link id; a sync origin is reminted only when video and audio were both cut. */
export function relinkSplitHalves(doc: Document, rightHalfIds: readonly string[]): void {
  const taken = new Set(takenLinkIds(doc));
  renameShared(doc, rightHalfIds, MEDIA_LINK_ATTR, taken);
  renameShared(doc, idsWithBothSidesCut(doc, rightHalfIds), SYNC_ORIGIN_ATTR, taken);
}

function idsWithBothSidesCut(doc: Document, rightHalfIds: readonly string[]): string[] {
  const tagsByOrigin = new Map<string, Set<string>>();
  const originOf = (id: string) => doc.getElementById(id)?.getAttribute(SYNC_ORIGIN_ATTR) ?? null;
  for (const id of rightHalfIds) {
    const origin = originOf(id);
    const tag = doc.getElementById(id)?.tagName.toLowerCase();
    if (!origin || !tag) continue;
    tagsByOrigin.set(origin, (tagsByOrigin.get(origin) ?? new Set()).add(tag));
  }
  return rightHalfIds.filter((id) => {
    const tags = tagsByOrigin.get(originOf(id) ?? "");
    return tags?.has("video") === true && tags.has("audio");
  });
}

/** Shared by a detached or linked video + audio of one file; it survives Unlink so a drifted pair can resync. */
export const SYNC_ORIGIN_ATTR = "data-sync-origin";

export type SyncTiming = Pick<LinkTiming, "start" | "mediaStart" | "playbackRate">;

const rateOf = (timing: SyncTiming) => (timing.playbackRate > 0 ? timing.playbackRate : 1);

/** Where source time zero lands on the timeline: `start − mediaStart / rate`. */
export function sourceZeroTime(timing: SyncTiming): number {
  return timing.start - timing.mediaStart / rateOf(timing);
}

/** Frames `clip` sits from `partner`, positive when it plays late; null when their rates differ. */
export function syncOffsetFrames(
  clip: SyncTiming,
  partner: SyncTiming,
  fps: number,
): number | null {
  if (Math.abs(rateOf(clip) - rateOf(partner)) > 1e-6) return null;
  const frames = Math.round((sourceZeroTime(clip) - sourceZeroTime(partner)) * fps);
  return Object.is(frames, -0) ? 0 : frames;
}

/** `+10`, `-1:21` (seconds:frames once past one second). */
export function formatSyncOffset(frames: number, fps: number): string {
  const sign = frames < 0 ? "-" : "+";
  const whole = Math.abs(frames);
  const perSecond = Math.max(1, Math.round(fps));
  if (whole < perSecond) return `${sign}${whole}`;
  const seconds = Math.floor(whole / perSecond);
  const rest = String(whole % perSecond).padStart(2, "0");
  return `${sign}${seconds}:${rest}`;
}

/** Move into Sync: the start that puts `clip` back on `partner`, or null before zero. */
export function moveIntoSyncStart(clip: SyncTiming, partner: SyncTiming): number | null {
  const start = clip.start - (sourceZeroTime(clip) - sourceZeroTime(partner));
  return start >= -SYNC_TOLERANCE_S ? Math.max(0, start) : null;
}

/** Slip into Sync: the media start that syncs `clip` in place, or null before the file's start. */
export function slipIntoSyncMediaStart(clip: SyncTiming, partner: SyncTiming): number | null {
  const mediaStart = (clip.start - sourceZeroTime(partner)) * rateOf(clip);
  return mediaStart >= -SYNC_TOLERANCE_S ? Math.max(0, mediaStart) : null;
}

interface PairableElement extends AttributeReader {
  tagName: string;
  closest(selectors: string): Element | null;
  ownerDocument: Document;
}

function sharedSeconds(a: LinkTiming, b: LinkTiming): number {
  return Math.min(a.start + a.duration, b.start + b.duration) - Math.max(a.start, b.start);
}

/** `el`'s source partner (same sync origin, other tag): most shared timeline, then nearest start. */
function sameOriginInScope(el: PairableElement, tag: string, origin: string): Element[] {
  const scopeOf = (node: PairableElement) => node.closest(LINK_SCOPE_SELECTOR) ?? el.ownerDocument;
  const scope = scopeOf(el);
  return Array.from(scope.querySelectorAll(tag)).filter(
    (candidate) =>
      candidate.getAttribute(SYNC_ORIGIN_ATTR) === origin && scopeOf(candidate) === scope,
  );
}

export function findSyncPartner(el: PairableElement): Element | null {
  const origin = el.getAttribute(SYNC_ORIGIN_ATTR);
  const tag = el.tagName.toLowerCase();
  if (!origin || (tag !== "video" && tag !== "audio")) return null;
  const partnerTag = tag === "video" ? "audio" : "video";
  const own = readLinkTiming(el);
  let best: { el: Element; shared: number; distance: number } | null = null;
  for (const candidate of sameOriginInScope(el, partnerTag, origin)) {
    const timing = readLinkTiming(candidate);
    const shared = sharedSeconds(own, timing);
    const distance = Math.abs(timing.start - own.start);
    if (!best || shared > best.shared || (shared === best.shared && distance < best.distance)) {
      best = { el: candidate, shared, distance };
    }
  }
  return best?.el ?? null;
}
