/**
 * The volume lane's state and edits for the media section.
 *
 * Volume lives in a different panel section from the FX chain, but is automated
 * the same way, so it reads and writes through the same helper the FX group uses
 * rather than a second interpretation of the attribute.
 */

import { HF_AUDIO_AUTOMATION_DATA_KEY, VOLUME_TARGET } from "@hyperframes/core/audio-automation";
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
  onSetAttributeQuiet: (attr: string, value: string | null) => void | Promise<void>,
): VolumeAutomationBinding {
  // The chain is not needed to resolve a volume lane — volume is always a valid
  // target — so this deliberately does not parse it.
  const automation = readPanelAutomation(
    element.dataAttributes?.[HF_AUDIO_AUTOMATION_DATA_KEY],
    undefined,
  );
  const write = (next: Parameters<typeof automationAttrValue>[0]): void => {
    // Quiet: clicking the toggle used to reload the preview and restart every
    // playing track, while the same click on an effect parameter did not.
    void onSetAttributeQuiet(HF_AUDIO_AUTOMATION_ATTR, automationAttrValue(next) || null);
  };
  // `??` alone would let an empty `data-volume` through as Number("") === 0, so
  // automating the track would seed its lane at silence. The engine reads the same
  // empty value as unity.
  const raw = element.dataAttributes?.["volume"];
  const parsed = raw ? Number(raw) : 1;
  const current = Number.isFinite(parsed) ? parsed : 1;
  return {
    volumeAutomated: automation.lanes.some((lane) => lane.target === VOLUME_TARGET),
    // Seeded at the level the slider already shows, so automating the track does
    // not change how loud it is.
    onAutomateVolume: () =>
      write(withSeededLane(automation, VOLUME_TARGET, Number.isFinite(current) ? current : 1)),
    onRemoveVolumeAutomation: () => write(withoutLane(automation, VOLUME_TARGET)),
  };
}
