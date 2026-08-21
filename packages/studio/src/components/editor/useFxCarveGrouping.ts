/**
 * B6's normative rule: plural voiceover carve always targets a group.
 *
 * Split out of `useFxCarve.ts`, which owned all of this before the file grew
 * past a size where "carve targets a group" was still one thing to read —
 * same reason `useFxCarve.ts` itself was split out of
 * `propertyPanelAudioFxGroup.tsx`.
 */

import { classifyAudioName, type HfCarveSettings } from "@hyperframes/core/audio-carve";
import { resolveAudioGroups } from "@hyperframes/core/audio-groups";

/**
 * An id for a new voiceover group, de-duped against every id already in the
 * document — group ids and plain element ids share one namespace, so both
 * have to be checked.
 */
export function mintGroupId(doc: Document): string {
  const taken = new Set([
    ...resolveAudioGroups(doc).map((g) => g.id),
    ...Array.from(doc.querySelectorAll("[id]")).map((el) => el.id),
  ]);
  if (!taken.has("voiceover")) return "voiceover";
  let n = 2;
  while (taken.has(`voiceover-${n}`)) n += 1;
  return `voiceover-${n}`;
}

export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown })?.then === "function";
}

/**
 * Plural voiceover carve, always against a group — normative, not a
 * suggestion (groups doc §1.6). Picking a second ungrouped voice clip mints a
 * group behind the two of them and points the carve at it instead, the same
 * way a hand-authored composition is expected to work; a source list already
 * naming a group is left alone; this only fires on a run of plain clip ids.
 *
 * Returns the settings unchanged, synchronously, when there is nothing to do —
 * NOT wrapped in a promise even though the caller may `await` the result. An
 * `async` function always yields a microtask, which would push every
 * `setCarve` call (grouped or not) one tick later than before this existed;
 * several tests assert on `onSetAttributeQuiet` synchronously after mount and
 * would miss that write.
 */
function withAutoGroupedSources(
  doc: Document,
  next: HfCarveSettings,
  assignGroup: ((clipIds: readonly string[], groupId: string) => Promise<void>) | undefined,
): HfCarveSettings | Promise<HfCarveSettings> {
  if (!assignGroup || next.sources.length < 2) return next;
  const groupIds = new Set(resolveAudioGroups(doc).map((g) => g.id));
  if (next.sources.some((id) => groupIds.has(id))) return next;
  const groupId = mintGroupId(doc);
  return assignGroup(next.sources, groupId).then(() => ({ ...next, sources: [groupId] }));
}

/**
 * `setCarve`'s first step: apply the auto-group rule, if a document and a
 * write-back are both available.
 *
 * Deliberately NOT an `async function`: wrapping this in one would make every
 * call return a promise-wrapped value, forcing the caller's `await` to yield
 * a microtask even on the synchronous branch — the exact bug
 * `withAutoGroupedSources`'s own sync-when-possible contract exists to avoid.
 * The caller does the `isPromiseLike` check (re-exported from here) and only
 * awaits the branch that is genuinely async.
 */
export function resolveNextCarveSettings(
  nextRaw: HfCarveSettings | null,
  doc: Document | undefined,
  assignGroup: ((clipIds: readonly string[], groupId: string) => Promise<void>) | undefined,
): HfCarveSettings | Promise<HfCarveSettings> | null {
  return nextRaw && doc ? withAutoGroupedSources(doc, nextRaw, assignGroup) : nextRaw;
}

export interface CarveCandidate {
  id: string;
  label: string;
  kind: ReturnType<typeof classifyAudioName>;
}

/**
 * One row per ungrouped clip that overlaps the bed, one row per group that has
 * ANY overlapping member (union, not per-clip — a narration group spanning
 * the whole timeline is relevant even if each of its segments only overlaps
 * part of the bed). Grouped members never appear individually.
 */
export function collectCarveCandidates(
  doc: Document,
  others: readonly HTMLAudioElement[],
  overlapsBed: (a: Element) => boolean,
): CarveCandidate[] {
  const groupByMember = new Map(
    resolveAudioGroups(doc).flatMap((group) => group.memberIds.map((id) => [id, group] as const)),
  );
  const offeredGroupIds = new Set<string>();
  const described: CarveCandidate[] = [];
  for (const a of others) {
    const group = groupByMember.get(a.id);
    if (!group) {
      if (overlapsBed(a)) {
        described.push({
          id: a.id,
          label: a.id,
          kind: classifyAudioName(a.id, a.getAttribute("src")),
        });
      }
      continue;
    }
    if (offeredGroupIds.has(group.id)) continue;
    const members = group.memberIds
      .map((id) => doc.getElementById(id))
      // Not `instanceof HTMLAudioElement`: these belong to the composition's
      // iframe document, so the constructor is a different realm's and the
      // instanceof is false for every one (mirrors resolveCarveVoices in
      // useFxCarve.ts).
      .filter((el): el is HTMLElement => el?.tagName === "AUDIO");
    if (!members.some(overlapsBed)) continue;
    offeredGroupIds.add(group.id);
    described.push({
      id: group.id,
      label: `${group.label} (${members.length})`,
      kind: classifyAudioName(
        group.label,
        ...members.flatMap((m) => [m.id, m.getAttribute("src")]),
      ),
    });
  }
  return described;
}
