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
import { AUDIO_GROUP_RENDER_ID_ATTR, MEDIA_RENDER_ID_ATTR } from "./compiler/mediaRenderIds.js";
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

/**
 * A group element's `data-volume`, defaulting to 1 for a missing, unparseable
 * or absent element. Shared so the preview bus and `resolveAudioGroups` (which
 * the render reads) cannot drift: the export was ~8 dB quieter than what was
 * auditioned for exactly as long as the preview ignored this.
 */
export function readAudioGroupVolume(el: Element | null | undefined): number {
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
    volume: readAudioGroupVolume(el),
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
/**
 * The `<hf-audio-group>` element for a group id, or null.
 *
 * Tag-checked, which a bare `getElementById` is not. Every group attribute —
 * the fader, the mute, the FX chain, the automation lane — is read off whatever
 * this returns, so an unrelated element sharing the id used to be read as a bus:
 * an `<audio id="vo" data-audio-group="vo" data-volume="0.5" data-fx-chain=…>`
 * had its own fader and chain applied a SECOND time on the bus, and a
 * `<div id="bg" data-hidden>` silenced group "bg" in preview only. The render
 * never had this problem — `resolveAudioGroups` only ever accepted the tag —
 * so the two disagreed on exactly the attributes the bus exists to carry.
 *
 * Returning null is the documented "group with no element" case, which
 * degrades to a flat sum rather than borrowing a stranger's settings.
 */
export function resolveGroupElement(
  doc:
    | (Pick<Document, "getElementById"> & Partial<Pick<Document, "querySelectorAll">>)
    | null
    | undefined,
  groupId: string,
): Element | null {
  // A render-stamped key names an INSTANCE, and `getElementById` cannot find it
  // — the author id is what is on the element's `id`. Tried first so a compiled
  // document resolves the right one of two identically-named buses.
  // Compare the raw attribute value instead of interpolating an author-provided
  // id into a selector. Quotes and backslashes are valid attribute values, and
  // turning one into selector syntax made this otherwise tolerant reader throw.
  const stamped = Array.from(
    doc?.querySelectorAll?.(`${HF_AUDIO_GROUP_TAG}[${MEDIA_RENDER_ID_ATTR}]`) ?? [],
  ).find((candidate) => candidate.getAttribute(MEDIA_RENDER_ID_ATTR) === groupId);
  if (stamped) return stamped;
  const el = doc?.getElementById(groupId) ?? null;
  if (!el) return null;
  return el.tagName?.toLowerCase() === HF_AUDIO_GROUP_TAG ? el : null;
}

/**
 * Whether the bus a member belongs to is muted.
 *
 * Membership is held by the MEMBER's `data-audio-group`; a group never nests
 * its members. So `el.closest("[data-hidden]")` cannot see a muted bus, which
 * is how the render came to drop a hidden group's members while the preview
 * fallback played them at full level.
 */
export function isMemberGroupHidden(
  doc: Pick<Document, "getElementById"> | null | undefined,
  el: Element | null | undefined,
): boolean {
  // A compiler stamp identifies the bus INSTANCE. The author id is only unique
  // within one composition file, so resolving by it in an inlined document made
  // every repeated sub-composition consult the first instance's mute state.
  const groupId =
    el?.getAttribute?.(AUDIO_GROUP_RENDER_ID_ATTR) ?? el?.getAttribute?.(HF_AUDIO_GROUP_ATTR);
  if (!groupId) return false;
  return resolveGroupElement(doc, groupId)?.hasAttribute("data-hidden") ?? false;
}

export function resolveAudioGroups(root: ParentNode): HfAudioGroup[] {
  const membersByGroup = new Map<string, string[]>();
  for (const member of root.querySelectorAll(`audio[${HF_AUDIO_GROUP_ATTR}]`)) {
    // The render-stamped instance key when the compiler has been through
    // (`assignMediaRenderIds`), else the author id. An author id is unique only
    // per composition FILE, so a sub-composition declaring a bus AND its members
    // and used twice put both instances' members under one key — one sub-mix for
    // two independent buses, instance B's fader and chain over instance A's
    // audio, and with only B muted BOTH instances dropped from the export. The
    // live preview has no stamps, so it reads exactly as before.
    const groupId =
      member.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR) ?? member.getAttribute(HF_AUDIO_GROUP_ATTR);
    if (!groupId || !member.id) continue;
    const members = membersByGroup.get(groupId);
    if (members) members.push(member.id);
    else membersByGroup.set(groupId, [member.id]);
  }

  const groupElements = new Map<string, Element>();
  for (const el of root.querySelectorAll(HF_AUDIO_GROUP_TAG)) {
    // Keyed the same way, so a stamped document pairs instance for instance and
    // an unstamped one keeps id-for-id.
    const key = el.getAttribute(MEDIA_RENDER_ID_ATTR) ?? el.id;
    if (key) groupElements.set(key, el);
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
    } else if (doc.getElementById(id) && !resolveGroupElement(doc, id)) {
      // A group with no members resolves to no entry above, and its own bus
      // element would then pass this existence check and be returned as if it
      // were a clip — a source the analysis can only fail to find, which the
      // docblock above promises is dropped.
      add(id);
    }
  }
  return out;
}

/** The group an audio member belongs to, or null. Membership is audio-only in
 * v1, matching `resolveAudioGroups` and the render mixer; video and group-bus
 * attributes are inert.
 *
 * Tolerant of objects that only partially implement `Element` (test doubles
 * for `HTMLMediaElement` commonly do) — anything missing `tagName` or
 * `getAttribute` simply has no group, mirroring `readChain`'s style in
 * `runtime/audioFx.ts`. */
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
  const styleId = "__hf-audio-group-inert";
  if (!doc?.head || doc.getElementById(styleId)) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `${HF_AUDIO_GROUP_TAG}{display:none!important}`;
  doc.head.appendChild(style);
}

/** Compatibility bridge until the Studio solo controls are removed later in the stack. */
export function isAudibleUnderSolo(
  soloed: ReadonlySet<string>,
  id: string,
  groupId?: string | null,
): boolean {
  if (soloed.size === 0) return true;
  if (soloed.has(id)) return true;
  return Boolean(groupId && soloed.has(groupId));
}

/** Compatibility bridge until the Studio solo controls are removed later in the stack. */
export function isGroupHalfLitUnderSolo(
  soloed: ReadonlySet<string>,
  groupId: string,
  memberIds: readonly string[],
): boolean {
  if (soloed.size === 0 || soloed.has(groupId)) return false;
  return memberIds.some((id) => soloed.has(id));
}
