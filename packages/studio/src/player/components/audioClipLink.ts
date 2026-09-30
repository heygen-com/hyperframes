import type { TimelineElement } from "../store/timelineElement";

type LinkedElement = Pick<TimelineElement, "id" | "key" | "link">;

const keyOf = (element: Pick<TimelineElement, "id" | "key">) => element.key ?? element.id;

export function mediaFileKey(src: string | undefined): string | null {
  if (!src) return null;
  const path = src.split(/[?#]/, 1)[0] ?? "";
  const segment = path.split(/[/\\]/).pop()?.trim().toLowerCase() ?? "";
  return segment.length > 0 ? segment : null;
}

function isLinked(element: Pick<TimelineElement, "link">): boolean {
  return typeof element.link === "string" && element.link.length > 0;
}

export function audioPillFlags(
  audio: Pick<TimelineElement, "hidden" | "audioGroupHidden" | "link">,
  _elements?: readonly unknown[],
): { muted: boolean; linked: boolean } {
  return {
    muted: audio.hidden === true || audio.audioGroupHidden === true,
    linked: isLinked(audio),
  };
}

export function linkedMembersOf<T extends LinkedElement>(element: T, elements: readonly T[]): T[] {
  if (!isLinked(element)) return [element];
  const members = elements.filter((candidate) => candidate.link === element.link);
  return members.some((member) => keyOf(member) === keyOf(element))
    ? members
    : [element, ...members];
}

export function expandToLinkedMembers(
  keys: Iterable<string>,
  elements: readonly LinkedElement[],
): Set<string> {
  const expanded = new Set(keys);
  const links = new Set(
    elements.filter((el) => expanded.has(keyOf(el)) && isLinked(el)).map((el) => el.link),
  );
  if (links.size === 0) return expanded;
  for (const element of elements) {
    if (isLinked(element) && links.has(element.link)) expanded.add(keyOf(element));
  }
  return expanded;
}

export function linkedGestureKeys(
  selected: ReadonlySet<string>,
  grabbed: LinkedElement,
  elements: readonly LinkedElement[],
  altKey: boolean,
): Set<string> {
  const grabbedKey = keyOf(grabbed);
  if (altKey) return new Set([grabbedKey]);
  const base = selected.has(grabbedKey) ? selected : [grabbedKey];
  return expandToLinkedMembers(base, elements);
}
