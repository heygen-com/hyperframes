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

/**
 * v1 membership, in one place: an `<audio>` carrying a NON-EMPTY
 * `data-audio-group`.
 *
 * Both readers below derive from this string, because they disagreed when they
 * did not. `resolveAudioGroups` scanned `audio[...]` while `audioGroupOf`
 * returned the attribute off any element, so the same DOM answered "no group"
 * for a `<video data-audio-group="voiceover">` in one and `"voiceover"` in the
 * other. The render already enforces audio-only (see audioMixer's
 * `type === "audio"` guard), so the disagreement was preview routing a track
 * the export would never group.
 */
const MEMBER_SELECTOR = `audio[${HF_AUDIO_GROUP_ATTR}]`;

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
  for (const member of root.querySelectorAll(MEMBER_SELECTOR)) {
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

/**
 * The group a member belongs to, or null — the same predicate
 * `resolveAudioGroups` scans with, so the two can never disagree about a given
 * element.
 *
 * Non-`<audio>` returns null: video is out of scope in v1, and so is
 * `data-audio-group` on an `<hf-audio-group>` itself (groups do not nest).
 * `data-audio-group=""` returns null rather than `""` — the resolver skips a
 * falsy id, and the "or null" in this contract has to mean it.
 *
 * Tolerant of objects that only partially implement `Element` (test doubles for
 * `HTMLMediaElement` commonly do): anything missing `tagName` or `getAttribute`
 * simply has no group, mirroring `readChain`'s style in `runtime/audioFx.ts`.
 */
export function audioGroupOf(el: Element): string | null {
  if (typeof el.tagName !== "string" || el.tagName.toLowerCase() !== "audio") return null;
  if (typeof el.getAttribute !== "function") return null;
  return el.getAttribute(HF_AUDIO_GROUP_ATTR) || null;
}

/**
 * Make `<hf-audio-group>` inert, once per document.
 *
 * The element is metadata — an id, a label, a chain, an automation lane — and
 * carries no content, but "no content" is not "no box": it is still an unknown
 * custom element, so in a flex or grid composition root it counts as an item
 * (taking a `gap`, shifting `justify-content`, moving every `:nth-child` after
 * it), and in inline formatting it can still open a line box. Authored layout
 * would shift by adding a group, which is not something a mixing decision is
 * allowed to do.
 *
 * `!important` because an author rule can outrank a bare type selector on
 * specificity — inertness here is a contract, not a default. Emitted from the
 * runtime rather than the compiler so preview and render share one source.
 */
export function ensureAudioGroupInertStyle(doc: Document): void {
  const STYLE_ID = "__hf-audio-group-inert";
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${HF_AUDIO_GROUP_TAG}{display:none!important}`;
  doc.head.appendChild(style);
}
