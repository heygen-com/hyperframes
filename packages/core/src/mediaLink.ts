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
    mediaStart: readNumber(el, ["data-media-start", "data-playback-start"], 0),
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

/** The composition a link group stays inside: the nearest inline composition or file host. */
export function linkScopeOf(el: Element): Element | null {
  return el.parentElement?.closest("[data-composition-id], [data-composition-file]") ?? null;
}

export function mintLinkId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`lk-${n}`)) n += 1;
  return `lk-${n}`;
}

function takenLinkIds(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(`[id], [${MEDIA_LINK_ATTR}]`)).flatMap((el) => [
    el.id,
    el.getAttribute(MEDIA_LINK_ATTR) ?? "",
  ]);
}

/**
 * After a split, the right halves are clones still carrying the left halves'
 * link id. Give each group's right halves one fresh shared id, so each half of
 * a linked pair is its own pair.
 */
export function relinkSplitHalves(doc: Document, rightHalfIds: readonly string[]): void {
  const taken = new Set(takenLinkIds(doc));
  const renamed = new Map<string, string>();
  for (const id of rightHalfIds) {
    const el = doc.getElementById(id);
    const oldLink = el?.getAttribute(MEDIA_LINK_ATTR);
    if (!el || !oldLink) continue;
    let fresh = renamed.get(oldLink);
    if (!fresh) {
      fresh = mintLinkId(taken);
      taken.add(fresh);
      renamed.set(oldLink, fresh);
    }
    el.setAttribute(MEDIA_LINK_ATTR, fresh);
  }
}
