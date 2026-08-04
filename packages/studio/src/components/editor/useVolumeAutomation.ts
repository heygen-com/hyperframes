/**
 * The volume lane's state and edits for the media section.
 *
 * Volume lives in a different panel section from the FX chain, but is automated
 * the same way, so it reads and writes through the same helper the FX group uses
 * rather than a second interpretation of the attribute.
 */

import { VOLUME_TARGET } from "@hyperframes/core/audio-automation";
import type { DomEditSelection } from "./domEditingTypes";
import {
  automationAttrValue,
  HF_AUDIO_AUTOMATION_ATTR,
  readPanelAutomation,
  withoutLane,
  withSeededLane,
} from "./propertyPanelAutomation";

export interface VolumeAutomationBinding {
  volumeAutomated: boolean;
  onAutomateVolume: () => void;
  onRemoveVolumeAutomation: () => void;
}

export function useVolumeAutomation(
  element: DomEditSelection,
  onSetAttribute: (attr: string, value: string) => void | Promise<void>,
): VolumeAutomationBinding {
  // The chain is not needed to resolve a volume lane — volume is always a valid
  // target — so this deliberately does not parse it.
  const automation = readPanelAutomation(element.dataAttributes?.["automation"], undefined);
  const write = (next: Parameters<typeof automationAttrValue>[0]): void => {
    void onSetAttribute(HF_AUDIO_AUTOMATION_ATTR, automationAttrValue(next));
  };
  const current = Number(element.dataAttributes?.["volume"] ?? "1");
  return {
    volumeAutomated: automation.lanes.some((lane) => lane.target === VOLUME_TARGET),
    // Seeded at the level the slider already shows, so automating the track does
    // not change how loud it is.
    onAutomateVolume: () =>
      write(withSeededLane(automation, VOLUME_TARGET, Number.isFinite(current) ? current : 1)),
    onRemoveVolumeAutomation: () => write(withoutLane(automation, VOLUME_TARGET)),
  };
}
