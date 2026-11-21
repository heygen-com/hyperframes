// `assign-audio-group`: a live regroup as Studio's group create and its unwind write it: each member's
// `data-audio-group`, then the group's own `<hf-audio-group>` added or removed. Writes no file.
import { HF_AUDIO_GROUP_ATTR, HF_AUDIO_GROUP_TAG } from "../../audioGroups";
import { EDITING_ELEMENT_HANDLE, MAX_DESCRIBE_HANDLES, MAX_ELEMENT_VALUE } from "../editingElement";
import type { EditingElementHandle } from "../editingElement";
import { audioGroupElement, isGroupId } from "./setAudioGroupAttribute";

type Member = { handle: EditingElementHandle; group: string | null };
type GroupElement = { id: string; label: string | null; present: boolean };
export type AssignAudioGroupParams = { members: Member[]; element: GroupElement | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";
const keysAre = (value: Record<string, unknown>, keys: string) =>
  Object.keys(value).sort().join() === keys;

function member(value: unknown): Member | null {
  if (!isRecord(value) || !keysAre(value, "group,handle")) return null;
  const { handle, group } = value;
  const valid =
    typeof handle === "string" &&
    EDITING_ELEMENT_HANDLE.test(handle) &&
    (group === null || isGroupId(group));
  return valid ? { handle, group: group as string | null } : null;
}

function groupElement(value: unknown): GroupElement | null {
  if (!isRecord(value) || !keysAre(value, "id,label,present")) return null;
  const { id, label, present } = value;
  const labelOk =
    label === null || (typeof label === "string" && label.length <= MAX_ELEMENT_VALUE);
  return isGroupId(id) && labelOk && typeof present === "boolean"
    ? { id, label: label as string | null, present }
    : null;
}

export function parseAssignAudioGroup(params: unknown): AssignAudioGroupParams | null {
  if (!isRecord(params) || !keysAre(params, "element,members")) return null;
  const { members, element } = params;
  if (!Array.isArray(members) || members.length > MAX_DESCRIBE_HANDLES) return null;
  const parsed = members.map(member);
  const group = element === null ? null : groupElement(element);
  if (parsed.includes(null) || (element !== null && !group)) return null;
  return { members: parsed as Member[], element: group };
}

/** Adds the group element when absent, or removes it when it is one; true when either happened. */
function placeGroupElement({ id, label, present }: GroupElement): boolean {
  if (!present) {
    const existing = audioGroupElement(id);
    existing?.remove();
    return existing !== null;
  }
  if (!document.body || document.getElementById(id)) return false;
  const el = document.createElement(HF_AUDIO_GROUP_TAG);
  el.id = id;
  if (label) el.setAttribute("data-label", label);
  document.body.appendChild(el);
  return true;
}

/** `previous` is each member's group before this write, null for none or a member that is gone. */
export function assignAudioGroup(
  { members, element }: AssignAudioGroupParams,
  elementForHandle: (handle: EditingElementHandle) => Element | null,
): { previous: Array<string | null>; changed: boolean } {
  const previous = members.map(({ handle, group }) => {
    const el = elementForHandle(handle);
    if (!el) return null;
    const prior = el.getAttribute(HF_AUDIO_GROUP_ATTR);
    if (group) el.setAttribute(HF_AUDIO_GROUP_ATTR, group);
    else el.removeAttribute(HF_AUDIO_GROUP_ATTR);
    return prior;
  });
  return { previous, changed: element ? placeGroupElement(element) : false };
}
