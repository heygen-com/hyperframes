import { HF_AUDIO_GROUP_ATTR, resolveAudioGroups } from "@hyperframes/core/audio-groups";
import { AUDIO_GROUP_RENDER_ID_ATTR } from "@hyperframes/core";

interface HiddenCheckEl {
  hasAttribute(name: string): boolean;
  parentElement: HiddenCheckEl | null;
}

export function isSelfOrAncestorHidden(el: HiddenCheckEl): boolean {
  for (let current: HiddenCheckEl | null = el; current; current = current.parentElement) {
    if (current.hasAttribute("data-hidden")) return true;
  }
  return false;
}

interface GroupKeyEl {
  getAttribute(name: string): string | null;
}

/**
 * The bus key a member belongs to, as `resolveAudioGroups` keys them.
 *
 * The compiler's `data-hf-group-render-id` names one INSTANCE of a bus; the
 * author's `data-audio-group` names it only within its own composition file. A
 * sub-composition declaring a bus and its members, used twice, therefore had
 * both instances' members under one key: one sub-mix for two independent buses,
 * one instance's fader and chain over the other's audio, and — with only the
 * second muted — BOTH instances dropped from the export. Uncompiled documents
 * (the live preview) carry no stamp and read exactly as before.
 */
export function memberGroupKey(el: GroupKeyEl): string | null {
  return el.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR) ?? el.getAttribute(HF_AUDIO_GROUP_ATTR);
}

export type AudioGroupsById = ReadonlyMap<string, { hidden?: boolean }>;

export function audioGroupsById(
  document: Parameters<typeof resolveAudioGroups>[0],
): AudioGroupsById {
  return new Map(resolveAudioGroups(document).map((group) => [group.id, group] as const));
}

export function isMemberGroupHidden(groupsById: AudioGroupsById, el: GroupKeyEl): boolean {
  const groupId = memberGroupKey(el);
  return groupId ? (groupsById.get(groupId)?.hidden ?? false) : false;
}
