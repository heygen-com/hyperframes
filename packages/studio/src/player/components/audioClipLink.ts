import { sameCompositionScope, type TimelineElement } from "../store/timelineElement";

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
