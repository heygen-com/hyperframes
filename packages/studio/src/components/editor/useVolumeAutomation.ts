/**
 * The volume lane's state and edits for the media section.
 *
 * Volume lives in a different panel section from the FX chain, but is automated
 * the same way, so it reads and writes through the same helper the FX group uses
 * rather than a second interpretation of the attribute.
 */

import {
  HF_AUDIO_AUTOMATION_DATA_KEY,
  sampleAutomationLane,
  VOLUME_TARGET,
} from "@hyperframes/core/audio-automation";
import { usePlayerStore } from "../../player";
import type { DomEditSelection } from "./domEditingTypes";
import {
  automationAttrValue,
  HF_AUDIO_AUTOMATION_ATTR,
  readPanelAutomation,
  withoutLane,
  withPointAt,
  withSeededLane,
} from "./propertyPanelAutomation";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";

export interface VolumeAutomationBinding {
  volumeAutomated: boolean;
  onAutomateVolume: () => void;
  onRemoveVolumeAutomation: () => void;
  /** Write `v` as a keyframe at the playhead instead of the disabled fallback. */
  onCommitVolumeAt: (v: number) => void;
  /** The envelope's own value at the playhead, so the slider tracks it live. */
  automatedVolumeValue: number | undefined;
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
  // ponytail: no GSAP animations passed — a media clip always carries an
  // explicit data-duration (set on drop by timelineAssetDrop.ts, or by the
  // compiler's media-duration probe for authored HTML), so `deriveElementTiming`
  // never falls through to its animations-inferred branch here regardless.
  const playheadTime = usePlayerStore((s) => s.currentTime);
  const { start: elStart, duration: elDuration } = deriveElementTiming(element);
  const clipTimeSec = Math.min(elDuration, Math.max(0, playheadTime - elStart));
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
  const volumeLane = automation.lanes.find((lane) => lane.target === VOLUME_TARGET);
  return {
    volumeAutomated: volumeLane !== undefined,
    automatedVolumeValue: volumeLane ? sampleAutomationLane(volumeLane, clipTimeSec) : undefined,
    // Seeded at the level the slider already shows, so automating the track does
    // not change how loud it is.
    onAutomateVolume: () =>
      write(withSeededLane(automation, VOLUME_TARGET, Number.isFinite(current) ? current : 1)),
    onRemoveVolumeAutomation: () => write(withoutLane(automation, VOLUME_TARGET)),
    onCommitVolumeAt: (v: number) => write(withPointAt(automation, VOLUME_TARGET, clipTimeSec, v)),
  };
}
