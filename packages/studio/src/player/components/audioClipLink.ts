import { sameCompositionScope, type TimelineElement } from "../store/timelineElement";
import { syncPartnerOf } from "./clipSync";

type LinkScoped = Pick<TimelineElement, "sourceFile" | "compositionScope">;
type LinkedElement = Pick<TimelineElement, "id" | "key" | "link"> & LinkScoped;

const keyOf = (element: Pick<TimelineElement, "id" | "key">) => element.key ?? element.id;

const SOURCE_BASE = "https://project.invalid/";
const SOURCE_ORIGIN = new URL(SOURCE_BASE).origin;

export function mediaAssetIdentity(
  element: Pick<TimelineElement, "src" | "sourceFile">,
): string | null {
  const src = element.src?.trim();
  if (!src) return null;
  try {
    const url = new URL(src, new URL(element.sourceFile ?? "index.html", SOURCE_BASE));
    if (url.origin !== SOURCE_ORIGIN) return `${url.origin}${url.pathname}${url.search}`;
    return decodeURIComponent(`${url.origin}${url.pathname}`);
  } catch {
    return null;
  }
}

function isLinked(element: Pick<TimelineElement, "link">): boolean {
  return typeof element.link === "string" && element.link.length > 0;
}

export function sharesLinkGroup(
  a: Pick<TimelineElement, "link"> & LinkScoped,
  b: Pick<TimelineElement, "link"> & LinkScoped,
): boolean {
  return isLinked(a) && a.link === b.link && sameCompositionScope(a, b);
}

export function audioPillFlags(
  audio: Pick<TimelineElement, "hidden" | "audioGroupHidden">,
  _elements?: readonly unknown[],
): { muted: boolean } {
  return { muted: audio.hidden === true || audio.audioGroupHidden === true };
}

export function linkedMembersOf<T extends LinkedElement>(
  element: T,
  elements: readonly T[],
  linked = true,
): T[] {
  if (!linked || !isLinked(element)) return [element];
  const members = elements.filter((candidate) => sharesLinkGroup(candidate, element));
  return members.some((member) => keyOf(member) === keyOf(element))
    ? members
    : [element, ...members];
}

export function expandToLinkedMembers(
  keys: Iterable<string>,
  elements: readonly LinkedElement[],
  linked = true,
): Set<string> {
  const expanded = new Set(keys);
  if (!linked) return expanded;
  const seeds = elements.filter((el) => expanded.has(keyOf(el)) && isLinked(el));
  for (const element of elements) {
    if (seeds.some((seed) => sharesLinkGroup(seed, element))) expanded.add(keyOf(element));
  }
  return expanded;
}

export function linkedGestureKeys(
  selected: ReadonlySet<string>,
  grabbed: LinkedElement,
  elements: readonly LinkedElement[],
  altKey: boolean,
  linked = true,
): Set<string> {
  const grabbedKey = keyOf(grabbed);
  if (altKey) return new Set([grabbedKey]);
  const base = selected.has(grabbedKey) ? selected : [grabbedKey];
  return expandToLinkedMembers(base, elements, linked);
}

type TimedLinked = LinkedElement & Pick<TimelineElement, "start" | "duration">;

const edgeTime = (el: Pick<TimelineElement, "start" | "duration">, edge: "start" | "end") =>
  edge === "start" ? el.start : el.start + el.duration;

/** A trim drags a link partner along only when its edge sits at the grabbed clip's edge time. */
export function dropMisalignedTrimPartners(
  keys: ReadonlySet<string>,
  grabbed: TimedLinked,
  elements: readonly TimedLinked[],
  edge: "start" | "end",
): Set<string> {
  const kept = new Set(keys);
  if (!isLinked(grabbed)) return kept;
  for (const el of elements) {
    if (el.link !== grabbed.link || keyOf(el) === keyOf(grabbed)) continue;
    if (Math.abs(edgeTime(el, edge) - edgeTime(grabbed, edge)) > 1e-3) kept.delete(keyOf(el));
  }
  return kept;
}

type BoundedElement = Pick<
  TimelineElement,
  | "id"
  | "key"
  | "tag"
  | "start"
  | "duration"
  | "link"
  | "syncOrigin"
  | "playbackStart"
  | "playbackRate"
>;

const tagOf = (el: Pick<TimelineElement, "tag">) => el.tag.trim().toLowerCase();

function partnerVideoBounds(
  audio: BoundedElement,
  elements: readonly BoundedElement[],
): { videoKey: string; start: number; end: number } | null {
  if (tagOf(audio) !== "audio") return null;
  const linkedVideo = isLinked(audio)
    ? elements.find((el) => el.link === audio.link && tagOf(el) === "video")
    : undefined;
  const video = linkedVideo ?? syncPartnerOf(audio, elements);
  return video
    ? { videoKey: keyOf(video), start: video.start, end: video.start + video.duration }
    : null;
}

/** `start` moved so a clip of `duration` sits inside `bounds`; a clip longer than them pins to their start. */
export function clampStartIntoBounds(
  start: number,
  duration: number,
  bounds: { start: number; end: number },
): number {
  return Math.max(bounds.start, Math.min(start, bounds.end - duration));
}

export function heldPartnerVideoBounds(
  audio: BoundedElement,
  elements: readonly BoundedElement[],
  gestureKeys: ReadonlySet<string>,
): { start: number; end: number } | null {
  const bounds = partnerVideoBounds(audio, elements);
  return bounds && !gestureKeys.has(bounds.videoKey) ? bounds : null;
}
