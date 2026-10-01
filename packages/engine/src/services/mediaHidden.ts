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
