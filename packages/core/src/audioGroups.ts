/**
 * The audio group model: a named bucket of audio tracks that shares a label,
 * an FX chain, and automation. Membership is held by the member (`data-audio-group`
 * pointing at a group id), not by the group nesting its members, so a track
 * dropped from the DOM simply disappears from the group on the next resolve —
 * nothing dangles.
 *
 * Parse-only: this module answers "what groups exist and who is in them," and
 * nothing here routes or sums audio yet.
 */

export const HF_AUDIO_GROUP_TAG = "hf-audio-group";
export const HF_AUDIO_GROUP_ATTR = "data-audio-group";

export interface HfAudioGroup {
  id: string;
  /** `data-label`, falling back to the id when absent. */
  label: string;
  /** Member element ids, in document order. */
  memberIds: string[];
}

/**
 * Every group with at least one member, resolved from the live document.
 *
 * A group with members but no `<hf-audio-group>` element still resolves
 * (label = id) so a hand-authored composition degrades gracefully. Audio
 * only in v1 — a `data-audio-group` on a `<video>` is ignored.
 */
export function resolveAudioGroups(root: ParentNode): HfAudioGroup[] {
  const membersByGroup = new Map<string, string[]>();
  for (const member of root.querySelectorAll(`audio[${HF_AUDIO_GROUP_ATTR}]`)) {
    const groupId = member.getAttribute(HF_AUDIO_GROUP_ATTR);
    if (!groupId || !member.id) continue;
    const members = membersByGroup.get(groupId);
    if (members) members.push(member.id);
    else membersByGroup.set(groupId, [member.id]);
  }

  const groupElements = new Map<string, Element>();
  for (const el of root.querySelectorAll(HF_AUDIO_GROUP_TAG)) {
    if (el.id) groupElements.set(el.id, el);
  }

  const groups: HfAudioGroup[] = [];
  for (const [id, memberIds] of membersByGroup) {
    const el = groupElements.get(id);
    const label = el?.getAttribute("data-label") || id;
    groups.push({ id, label, memberIds });
  }
  return groups;
}

/**
 * Expand a list of source ids for a carve: a plain id passes through if it
 * still exists, a group id expands to its CURRENT members. Resolved fresh
 * every time — group membership is never frozen into the carve's own
 * attribute, so adding a fourth voice to a group already named in a carve's
 * `sources` picks it up on the next analysis without editing that carve.
 *
 * Dedupes and preserves first-seen order; an id that resolves to nothing
 * (a deleted clip, an empty or vanished group) is dropped rather than kept
 * as a dangling reference the analysis would only fail to find anyway.
 */
export function resolveCarveSourceIds(doc: Document, ids: readonly string[]): string[] {
  const groupsById = new Map(resolveAudioGroups(doc).map((group) => [group.id, group] as const));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) {
    const group = groupsById.get(id);
    if (group) {
      group.memberIds.forEach(add);
    } else if (doc.getElementById(id)) {
      add(id);
    }
  }
  return out;
}

/** The group a member belongs to, or null. Groups do not nest — this ignores
 * `data-audio-group` on an `<hf-audio-group>` element itself.
 *
 * Tolerant of objects that only partially implement `Element` (test doubles
 * for `HTMLMediaElement` commonly do) — anything missing `tagName` or
 * `getAttribute` simply has no group, mirroring `readChain`'s style in
 * `runtime/audioFx.ts`. */
export function audioGroupOf(el: Element): string | null {
  if (typeof el.tagName !== "string") return null;
  if (el.tagName.toLowerCase() === HF_AUDIO_GROUP_TAG) return null;
  return typeof el.getAttribute === "function" ? el.getAttribute(HF_AUDIO_GROUP_ATTR) : null;
}
