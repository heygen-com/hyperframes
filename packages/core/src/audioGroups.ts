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

import { HF_AUDIO_FX_ATTR } from "./audioFx.js";
import { HF_AUDIO_AUTOMATION_ATTR } from "./audioAutomation.js";

export const HF_AUDIO_GROUP_TAG = "hf-audio-group";
export const HF_AUDIO_GROUP_ATTR = "data-audio-group";

export interface HfAudioGroup {
  id: string;
  /** `data-label`, falling back to the id when absent. */
  label: string;
  /** Member element ids, in document order. */
  memberIds: string[];
  /** Serialised FX chain JSON from the group element's `data-fx-chain`, when set. */
  fxChain?: string;
  /** Serialised automation JSON from the group element's `data-automation`, when set. */
  automation?: string;
  /** The group element's `data-volume`, defaulting to 1 when absent or there is no group element. */
  volume: number;
  /**
   * The group element's `data-hidden`. Render drops every member rather than
   * zeroing them (RULES: mute-by-drop, never mute-by-volume-0) — B5 defines
   * the UI for this; this field just makes the read available now.
   */
  hidden: boolean;
}

function parseGroupVolume(el: Element | undefined): number {
  const raw = el?.getAttribute("data-volume");
  const parsed = raw ? parseFloat(raw) : 1;
  return Number.isFinite(parsed) ? parsed : 1;
}

function buildGroup(id: string, memberIds: string[], el: Element | undefined): HfAudioGroup {
  const fxChain = el?.getAttribute(HF_AUDIO_FX_ATTR);
  const automation = el?.getAttribute(HF_AUDIO_AUTOMATION_ATTR);
  return {
    id,
    label: el?.getAttribute("data-label") || id,
    memberIds,
    ...(fxChain ? { fxChain } : {}),
    ...(automation ? { automation } : {}),
    volume: parseGroupVolume(el),
    hidden: el?.hasAttribute("data-hidden") ?? false,
  };
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
    groups.push(buildGroup(id, memberIds, groupElements.get(id)));
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

/**
 * Solo ("Hear only this") predicate — shared by the studio store (which owns
 * the `soloed` set and the UI's lit/half-lit state) and the preview transport
 * (which turns it into gain). An element is audible while any solo is active
 * only if IT is soloed, or its OWN group is soloed (group solo = members
 * solo). There is no "ancestor" to reach up to in this data model — a group
 * bus is never itself attenuated by solo, so a soloed member's path through
 * its group stays open by construction; this predicate only ever gates the
 * member's own gain. No solo active at all is the one path that returns true
 * unconditionally.
 */
export function isAudibleUnderSolo(
  soloed: ReadonlySet<string>,
  id: string,
  groupId?: string | null,
): boolean {
  if (soloed.size === 0) return true;
  if (soloed.has(id)) return true;
  return Boolean(groupId && soloed.has(groupId));
}

/** Half-lit: this group itself isn't soloed, but at least one of its members
 *  is — the display-only signal that "some of what's under here still plays". */
export function isGroupHalfLitUnderSolo(
  soloed: ReadonlySet<string>,
  groupId: string,
  memberIds: readonly string[],
): boolean {
  if (soloed.size === 0 || soloed.has(groupId)) return false;
  return memberIds.some((id) => soloed.has(id));
}
