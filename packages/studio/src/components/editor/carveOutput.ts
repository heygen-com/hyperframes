import {
  HF_AUDIO_FX_ATTR,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import { type HfAutomation } from "@hyperframes/core/audio-automation";
import { isCarveVoiceElement } from "./useFxCarveGrouping.js";
import { automationAttrValue, HF_AUDIO_AUTOMATION_ATTR } from "./propertyPanelAutomation";
import type { CarveClip } from "./useFxCarveNodes.js";
import { readClipClock } from "./clipAudioClock.js";

/** Lanes belonging to nodes the carve generated, which a re-run replaces. */
export function withoutCarveLanes(automation: HfAutomation, chain: HfAudioFxChain): HfAutomation {
  const prefixes = chain.nodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);
  if (prefixes.length === 0) return automation;
  return {
    version: automation.version,
    lanes: automation.lanes.filter((lane) => !prefixes.some((p) => lane.target.startsWith(p))),
  };
}

/**
 * Every named voice that is actually there with something to decode. A source
 * naming a deleted track is skipped rather than failing the whole analysis.
 *
 * Read out to plain values here rather than carrying elements around: it is
 * what lets the src and the start be non-null by construction downstream
 * instead of by assertion.
 */
export function resolveCarveVoices(doc: Document, sources: readonly string[]): CarveClip[] {
  const voices: CarveClip[] = [];
  for (const id of sources) {
    const el = doc.getElementById(id);
    // By tag name, not `instanceof HTMLAudioElement`: these elements belong to
    // the composition's iframe document, so the constructor they were made
    // from is not this realm's and the instanceof is false for every one.
    if (!isCarveVoiceElement(el)) continue;
    const src = el.getAttribute("src");
    if (!src) continue;
    const clock = readClipClock((name) => el.getAttribute(name));
    voices.push({ src, start: el.getAttribute("data-start"), clock });
  }
  return voices;
}

/**
 * What the carve generated is only justified by the voices it was measured
 * from: switched off, or left naming none — every source deleted, say — there
 * is nothing those filters are making room for. Left behind they keep dipping
 * the bed with nothing in the panel to explain them.
 */
export async function dropCarveOutput(
  chain: HfAudioFxChain,
  automation: HfAutomation,
  onSetAttributeQuiet: (attr: string, value: string | null) => void | Promise<void>,
): Promise<void> {
  const carriedOver = withoutCarveLanes(automation, chain);
  if (carriedOver.lanes.length !== automation.lanes.length) {
    await onSetAttributeQuiet(HF_AUDIO_AUTOMATION_ATTR, automationAttrValue(carriedOver) || null);
  }
  const kept = chain.nodes.filter((n) => !n.fromCarve);
  if (kept.length !== chain.nodes.length) {
    await onSetAttributeQuiet(
      HF_AUDIO_FX_ATTR,
      kept.length ? serializeAudioFxChain({ version: 1, nodes: kept }) : null,
    );
  }
}
