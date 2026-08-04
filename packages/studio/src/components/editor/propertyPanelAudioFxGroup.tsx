/**
 * The audio FX panel's bridge to the element/attribute world.
 *
 * Chain, carve and automation are all serialised onto the element the way colour
 * grading carries its config, so persistence is an ordinary attribute write with
 * no new server route. Split out of PropertyPanelFlat, which is at its size
 * budget, and self-contained enough to test on its own.
 */

import { useState } from "react";
import {
  HF_AUDIO_FX_ATTR,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import {
  analyseCarveBands,
  carveBandsToChain,
  HF_AUDIO_CARVE_ATTR,
  normalizeCarveSettings,
  type HfCarveSettings,
} from "@hyperframes/core/audio-carve";
import { fxAutomationTarget, type HfAutomation } from "@hyperframes/core/audio-automation";
import {
  automatedTargetsOf,
  automationAttrValue,
  HF_AUDIO_AUTOMATION_ATTR,
  readPanelAutomation,
  resolveAutomationRange,
  withoutLane,
  withSeededLane,
} from "./propertyPanelAutomation";
import type { DomEditSelection } from "./domEditingTypes";

/**
 * Rate the carve source is decoded at. Analysis is self-consistent because it
 * reads the decoded buffer's own rate, so this only has to be a sane audio rate.
 */
const DECODE_SAMPLE_RATE = 48000;
import { FxSection, type AudioTrackOption } from "./propertyPanelFxSection.js";

/**
 * Bridges the FX panel to the element/attribute world. Chain and carve are
 * serialised onto the element the way colour grading carries its config, so
 * persistence is an ordinary attribute write with no new server route.
 */
export function AudioFxGroup({
  element,
  onSetAttributeQuiet,
  onSetAttributeLive,
}: {
  element: DomEditSelection;
  /**
   * Every write here is quiet: it persists to the source and skips the preview
   * reload, because the runtime applies chain and automation edits to the
   * running graph — a reload would only interrupt the audio to reach the same
   * state, which is heard as the track chopping.
   *
   * It does re-read the selection afterwards, which this panel depends on: each
   * edit is computed from the current attribute, so without the resync a second
   * edit would work from a pre-edit value and appear to do nothing.
   */
  onSetAttributeQuiet: (attr: string, value: string | null) => void | Promise<void>;
  /** Continuous, non-persisting write for a dial being dragged. */
  onSetAttributeLive: (attr: string, value: string | null) => void | Promise<void>;
}) {
  const chain = ((): HfAudioFxChain => {
    const raw = element.dataAttributes?.["fx-chain"];
    if (!raw) return { version: 1, nodes: [] };
    try {
      return parseAudioFxChain(raw);
    } catch {
      // Show an unreadable chain as empty rather than breaking the panel; the
      // attribute is left untouched until the user changes something.
      return { version: 1, nodes: [] };
    }
  })();

  const automation = readPanelAutomation(element.dataAttributes?.["automation"], chain);
  const automatedTargets = automatedTargetsOf(automation);

  // Written through the live path on purpose. It persists to the source just
  // like the refreshing one, but skips the preview reload — and a reload
  // restarts every playing track, which is heard as the audio chopping. The
  // runtime follows the attribute and swaps the graph in place instead.
  const writeAutomation = (next: HfAutomation): void => {
    void onSetAttributeQuiet(HF_AUDIO_AUTOMATION_ATTR, automationAttrValue(next) || null);
  };

  /**
   * Start automating one effect parameter.
   *
   * The lane is seeded with a single point at the value the control currently
   * holds, so switching to an envelope never changes the sound — it only moves
   * where the value comes from. The author then adds points in the timeline.
   */
  const automateParam = (nodeId: string, paramKey: string): void => {
    const target = fxAutomationTarget(nodeId, paramKey);
    const node = chain.nodes.find((n) => n.id === nodeId);
    const range = resolveAutomationRange(target, chain);
    if (!node || !range) return;
    const raw = node.params?.[paramKey];
    writeAutomation(
      withSeededLane(automation, target, typeof raw === "number" ? raw : range.default),
    );
  };

  /** Stop automating it, handing the value back to the panel control. */
  const removeParamAutomation = (nodeId: string, paramKey: string): void => {
    writeAutomation(withoutLane(automation, fxAutomationTarget(nodeId, paramKey)));
  };

  /**
   * Turn carve on or off.
   *
   * Switching off drops the filters it generated — left behind they keep dipping
   * the bed with nothing in the panel to explain them — but that is a second
   * attribute, and each write is a read-modify-write against the same source
   * file. Fired together, both read the same content and the later one drops the
   * earlier: either the carve settings went and the filters stayed, or the
   * reverse. Awaiting the first means the second reads the file it produced.
   *
   * One commit carrying both would also close the window where a failure of just
   * the second leaves them half-applied; that needs a multi-attribute quiet
   * commit, which does not exist yet.
   */
  const setCarve = async (next: HfCarveSettings | null): Promise<void> => {
    if (!next) {
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      if (kept.length !== chain.nodes.length) {
        await onSetAttributeQuiet(
          HF_AUDIO_FX_ATTR,
          kept.length ? serializeAudioFxChain({ version: 1, nodes: kept }) : null,
        );
      }
    }
    await onSetAttributeQuiet(HF_AUDIO_CARVE_ATTR, next ? JSON.stringify(next) : null);
  };

  /** Every lane belonging to a node that is going away. */
  const removeNodeAutomation = (nodeId: string): void => {
    const prefix = `fx.${nodeId}.`;
    const kept = automation.lanes.filter((lane) => !lane.target.startsWith(prefix));
    if (kept.length !== automation.lanes.length) {
      writeAutomation({ version: 1, lanes: kept });
    }
  };

  const carve = ((): HfCarveSettings | null => {
    const raw = element.dataAttributes?.["fx-carve"];
    if (!raw) return null;
    try {
      return normalizeCarveSettings(JSON.parse(raw));
    } catch {
      return null;
    }
  })();

  const sourceOptions: AudioTrackOption[] = (() => {
    const doc = element.element?.ownerDocument;
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[id]"))
      .filter((a) => a.id !== element.id)
      .map((a) => ({ id: a.id, label: a.id }));
  })();

  const [analysing, setAnalysing] = useState(false);

  /**
   * Decodes the chosen voice track and turns its spectrum into peaking filters
   * on this one. The bands replace any previous carve output but leave
   * hand-added effects alone, so re-analysing does not discard other work.
   */
  const analyse = async (): Promise<void> => {
    if (!carve?.source) return;
    const doc = element.element?.ownerDocument;
    const voice = doc?.getElementById(carve.source) as HTMLAudioElement | null;
    const src = voice?.getAttribute("src");
    if (!src) return;
    setAnalysing(true);
    try {
      const res = await fetch(new URL(src, doc!.baseURI).href);
      const bytes = await res.arrayBuffer();
      // Decoded in an OfflineAudioContext, not a live one. Opening a second
      // output device mid-playback makes the running track glitch while the
      // hardware is reconfigured; an offline context touches no device.
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return;
      const decoder = new Ctor(1, 1, DECODE_SAMPLE_RATE);
      const buffer = await decoder.decodeAudioData(bytes);
      const bands = analyseCarveBands(buffer.getChannelData(0), buffer.sampleRate, carve);
      const carved = carveBandsToChain(bands);
      // Carve output is tagged so a re-run replaces it instead of stacking.
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      const next = {
        version: 1,
        nodes: [...carved.nodes.map((n) => ({ ...n, fromCarve: true })), ...kept],
      };
      // Live, like every other chain write: the runtime swaps the graph in
      // place, so a reload would only interrupt the audio to reach the same
      // filters.
      onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));
    } catch {
      // Leave the chain as it was; the button simply re-enables.
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <FxSection
      chain={chain}
      automatedTargets={automatedTargets}
      onAutomateParam={automateParam}
      onRemoveParamAutomation={removeParamAutomation}
      onRemoveNodeAutomation={removeNodeAutomation}
      onChainChange={(next) =>
        // Live for the same reason as automation above: adding, removing or
        // bypassing an effect is applied to the running graph, so a reload would
        // only interrupt the audio to reach the same state.
        onSetAttributeQuiet(
          HF_AUDIO_FX_ATTR,
          next.nodes.length ? serializeAudioFxChain(next) : null,
        )
      }
      onChainPreview={(next) =>
        // Live writes skip the preview refresh entirely, so dragging a knob no
        // longer reloads the composition and restarts playback on every pixel.
        // The gesture-end write above is the one that resyncs.
        onSetAttributeLive(HF_AUDIO_FX_ATTR, next.nodes.length ? serializeAudioFxChain(next) : null)
      }
      carve={carve}
      onCarveChange={(next) => void setCarve(next)}
      onCarvePreview={(next) => onSetAttributeLive(HF_AUDIO_CARVE_ATTR, JSON.stringify(next))}
      sourceOptions={sourceOptions}
      onAnalyseCarve={() => void analyse()}
      analysing={analysing}
    />
  );
}
