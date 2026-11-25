// `set-audio-group-attribute`: a live write to one `<hf-audio-group>`'s own attribute (fader, mute, label,
// FX chain or automation), which the preview's audio graph follows. Writes no file.
import { HF_AUDIO_AUTOMATION_ATTR } from "../../audioAutomation";
import { HF_AUDIO_FX_ATTR } from "../../audioFx";
import { HF_AUDIO_GROUP_TAG } from "../../audioGroups";

const GROUP_ATTRIBUTES: readonly string[] = [
  "data-volume",
  "data-hidden",
  "data-label",
  HF_AUDIO_FX_ATTR,
  HF_AUDIO_AUTOMATION_ATTR,
];
const MAX_GROUP_ID = 512;
export const MAX_GROUP_VALUE = 200_000;

export type SetAudioGroupAttributeParams = { id: string; attr: string; value: string | null };

export const isGroupId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_GROUP_ID;

export function parseSetAudioGroupAttribute(params: unknown): SetAudioGroupAttributeParams | null {
  if (Object.prototype.toString.call(params) !== "[object Object]") return null;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "attr,id,value") return null;
  const { id, attr, value } = record;
  const valid =
    isGroupId(id) &&
    typeof attr === "string" &&
    GROUP_ATTRIBUTES.includes(attr) &&
    (value === null || (typeof value === "string" && value.length <= MAX_GROUP_VALUE));
  return valid ? { id, attr, value: value as string | null } : null;
}

/** The group element `id` names; null when that id is not an `<hf-audio-group>`. */
export function audioGroupElement(id: string): Element | null {
  const el = document.getElementById(id);
  return el?.localName === HF_AUDIO_GROUP_TAG ? el : null;
}

export function setAudioGroupAttribute({ id, attr, value }: SetAudioGroupAttributeParams): {
  applied: boolean;
} {
  const group = audioGroupElement(id);
  if (!group) return { applied: false };
  if (value === null) group.removeAttribute(attr);
  else group.setAttribute(attr, value);
  return { applied: true };
}
