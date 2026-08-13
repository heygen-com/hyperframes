/**
 * The audio FX panel's bridge to the element/attribute world.
 *
 * Chain, carve and automation are all serialised onto the element the way colour
 * grading carries its config, so persistence is an ordinary attribute write with
 * no new server route. Split out of PropertyPanelFlat, which is at its size
 * budget, and self-contained enough to test on its own.
 */

import { useEffect, useState } from "react";
import {
  defaultAudioFxParams,
  HF_AUDIO_FX_ATTR,
  HF_AUDIO_FX_DATA_KEY,
  mintAudioFxNodeId,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "@hyperframes/core/audio-fx";
import {
  analyseCarveBands,
  analyseCarveDuck,
  analyseCarveDynamics,
  carveBandsToChain,
  carveProfile,
  classifyAudioName,
  clipsOverlap,
  DEFAULT_CARVE,
  mixCarveSources,
  HF_AUDIO_CARVE_ATTR,
  normalizeCarveSettings,
  type HfCarveSettings,
} from "@hyperframes/core/audio-carve";
import {
  fxAutomationTarget,
  sampleAutomationLane,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import {
  automatedTargetsOf,
  automationAttrValue,
  withLane,
  HF_AUDIO_AUTOMATION_ATTR,
  HF_AUDIO_AUTOMATION_DATA_KEY,
  readPanelAutomation,
  resolveAutomationRange,
  withoutLane,
  withSeededLane,
} from "./propertyPanelAutomation";
import { levellingResult, removeLevelling } from "@hyperframes/core/audio-leveller";
import type { DomEditSelection } from "./domEditingTypes";
import { useLivePlayheadTime } from "../../hooks/useLivePlayheadTime";
import { usePlayerStore } from "../../player";

/**
 * Rate the carve source is decoded at. Analysis is self-consistent because it
 * reads the decoded buffer's own rate, so this only has to be a sane audio rate.
 */
const DECODE_SAMPLE_RATE = 48000;
import { FxSection, type AudioTrackOption } from "./propertyPanelFxSection.js";

/** A clip's span, with an unwritten duration left unbounded rather than zero. */
function spanOf(
  start: string | null | undefined,
  duration: string | null | undefined,
): { start: number; duration: number | null } {
  const n =
    duration === null || duration === undefined || duration === "" ? Number.NaN : Number(duration);
  return { start: clipStart(start), duration: Number.isFinite(n) ? n : null };
}

/** Where a clip starts on the timeline, in seconds. */
function clipStart(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Lanes belonging to nodes the carve generated, which a re-run replaces. */
function withoutCarveLanes(automation: HfAutomation, chain: HfAudioFxChain): HfAutomation {
  const prefixes = chain.nodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);
  if (prefixes.length === 0) return automation;
  return {
    version: automation.version,
    lanes: automation.lanes.filter((lane) => !prefixes.some((p) => lane.target.startsWith(p))),
  };
}

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
    const raw = element.dataAttributes?.[HF_AUDIO_FX_DATA_KEY];
    if (!raw) return { version: 1, nodes: [] };
    try {
      return parseAudioFxChain(raw);
    } catch {
      // Show an unreadable chain as empty rather than breaking the panel; the
      // attribute is left untouched until the user changes something.
      return { version: 1, nodes: [] };
    }
  })();

  const automation = readPanelAutomation(
    element.dataAttributes?.[HF_AUDIO_AUTOMATION_DATA_KEY],
    chain,
  );
  const automatedTargets = automatedTargetsOf(automation);

  /**
   * What every automated knob is worth at the playhead, so the rack shows the
   * value the audio is actually using rather than the one the attribute stores.
   *
   * An automated parameter has two values: the number sitting in the chain, which
   * is only a seed once a lane exists, and the number the envelope is on right now.
   * The second is the true one, and a rack that shows the first reads as broken
   * during playback — the carve is visibly working and the readouts do not move.
   *
   * Sampled while paused as well, because the same argument applies to a scrub:
   * the playhead is somewhere, and the envelope has a value there.
   *
   * Sampled off the clip too, which is not obvious. A lane holds its first value
   * backwards and its last value forwards, so before the clip starts it already
   * knows what it will open on — while the stored number is a seed the lane
   * replaced and nothing will ever play. Showing that seed put a value on screen
   * that the automation never uses, and made the fader jump the moment the clip
   * came under the playhead.
   */
  const playhead = useLivePlayheadTime();
  const localTime = playhead - clipStart(element.dataAttributes?.["start"]);
  const liveAutomationValues = ((): Map<string, number> => {
    const values = new Map<string, number>();
    for (const lane of automation.lanes) {
      const range = resolveAutomationRange(lane.target, chain);
      if (!range) continue;
      values.set(lane.target, sampleAutomationLane(lane, localTime, range.scale));
    }
    return values;
  })();

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
    // What the carve generated is only justified by the voices it was measured
    // from: switched off, or left naming none — every source deleted, say —
    // there is nothing those filters are making room for. Left behind they keep
    // dipping the bed with nothing in the panel to explain them.
    const generatedOutputStands = Boolean(next?.enabled) && (next?.sources.length ?? 0) > 0;
    if (!generatedOutputStands) {
      const carriedOver = withoutCarveLanes(automation, chain);
      if (carriedOver.lanes.length !== automation.lanes.length) {
        await onSetAttributeQuiet(
          HF_AUDIO_AUTOMATION_ATTR,
          automationAttrValue(carriedOver) || null,
        );
      }
    }
    if (!generatedOutputStands) {
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      if (kept.length !== chain.nodes.length) {
        await onSetAttributeQuiet(
          HF_AUDIO_FX_ATTR,
          kept.length ? serializeAudioFxChain({ version: 1, nodes: kept }) : null,
        );
      }
    }
    await onSetAttributeQuiet(HF_AUDIO_CARVE_ATTR, next ? JSON.stringify(next) : null);

    // Every setting here describes the filters, so changing one rebuilds them.
    // There is no apply button: a carve naming a voice with no filters behind it
    // is a setting nobody applied, and the panel already knows everything it needs
    // to. Picking the voice is what starts it; strength and dynamic re-derive what
    // is already there. A carve with no source yet has nothing to analyse.
    const changed =
      next &&
      next.enabled &&
      next.sources.length > 0 &&
      (!carve ||
        // Switching it back on is a change like any other: the filters went with
        // the switch, so there is nothing left to hear until they are rebuilt.
        // Without this, On restored the setting and left the bed uncarved.
        !carve.enabled ||
        next.sources.join("\u0000") !== carve.sources.join("\u0000") ||
        next.strength !== carve.strength);
    if (next && changed) await analyse(next);
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

  /**
   * Is some other track carving against this one?
   *
   * A carve is a relationship — a bed is carved against a voice — and the voice is
   * the far end of it. Offering the same control there offers to carve a track
   * against itself by proxy, and switching it on left a setting with no source it
   * could legally name. Read off the other elements' own carve attributes, because
   * that is where the relationship is recorded.
   */
  const carvedAgainstBy = ((): string | null => {
    const doc = element.element?.ownerDocument;
    if (!doc || !element.id) return null;
    for (const other of Array.from(doc.querySelectorAll<HTMLElement>(`[${HF_AUDIO_CARVE_ATTR}]`))) {
      if (other.id === element.id) continue;
      try {
        const raw = other.getAttribute(HF_AUDIO_CARVE_ATTR);
        if (raw && normalizeCarveSettings(JSON.parse(raw)).sources.includes(element.id ?? "")) {
          return other.id || "another track";
        }
      } catch {
        // An unreadable carve on some other element says nothing about this one.
      }
    }
    return null;
  })();

  /**
   * The tracks worth offering as the voice.
   *
   * Not every audio element is a plausible answer: a music bed is the thing being
   * carved, and a 200 ms whoosh has no speech to make room for. Offering them made
   * the picker a list of everything and the "exactly one candidate" rule — which is
   * what lets an obvious pairing carve itself — almost never true, because a
   * composition with a voice, a bed and two stings looked like four options.
   *
   * Classified by name, which is a hint and not a fact, so the rule is loose in the
   * safe direction: a name that says nothing stays in, voice-shaped names sort
   * first, and if filtering would leave nothing at all every track comes back. A
   * picker that hides the track somebody needs is worse than a long one.
   */
  const { sourceOptions, autoSourceIds } = ((): {
    sourceOptions: AudioTrackOption[];
    autoSourceIds: string[];
  } => {
    const doc = element.element?.ownerDocument;
    if (!doc) return { sourceOptions: [], autoSourceIds: [] };
    const others = Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[id]")).filter(
      (a) => a.id !== element.id,
    );
    // Only tracks that are actually playing while this bed is. A voice somewhere
    // else on the timeline cannot mask it, so including it would contribute silence
    // to the analysis and leave the author wondering why it changed nothing.
    const bedSpan = spanOf(element.dataAttributes?.["start"], element.dataAttributes?.["duration"]);
    const described = others
      .filter((a) =>
        clipsOverlap(
          bedSpan,
          spanOf(a.getAttribute("data-start"), a.getAttribute("data-duration")),
        ),
      )
      .map((a) => ({
        id: a.id,
        label: a.id,
        kind: classifyAudioName(a.id, a.getAttribute("src")),
      }));
    const plausible = described.filter((t) => t.kind === "voice" || t.kind === "unknown");
    const offered = plausible.length > 0 ? plausible : described;
    const byVoiceFirst = (list: typeof described) =>
      [...list].sort((a, b) => (a.kind === "voice" ? 0 : 1) - (b.kind === "voice" ? 0 : 1));
    return {
      sourceOptions: byVoiceFirst(offered).map(({ id, label }) => ({ id, label })),
      // What the panel may pick WITHOUT being asked — never the fallback. The
      // fallback exists so the picker can still show a track whose name reads as
      // music or as an effect, because a name is a hint and the author may know
      // better. Choosing off that list is a different act: it is the panel
      // deciding, and "the only audio left is a 200 ms explosion" is not a voice
      // to make room for. A bed surrounded by nothing plausible waits instead.
      autoSourceIds: byVoiceFirst(plausible).map((t) => t.id),
    };
  })();

  /**
   * The voices this carve names that are still in the composition.
   *
   * Existence, not the candidate list: a voice can stop being offered without
   * being gone (it stopped overlapping the bed), and dropping it then would
   * quietly rewrite a relationship the author set. Deleted is the case that has
   * to be noticed, because what the carve produced was measured from that track.
   *
   * Asked of the timeline rather than of `element.element.ownerDocument`, which
   * is the preview's DOM and outlives a delete: measured in the studio, a bed
   * selected right after its voice was deleted still found that voice through
   * the document, so the carve sat on a measurement of a track the timeline had
   * already dropped. The store is what the delete actually edited.
   */
  const timelineElements = usePlayerStore((s) => s.elements);
  const survivingSources = ((): string[] => {
    if (!carve) return [];
    const present = new Set(timelineElements.map((el) => el.domId ?? el.id));
    // Absence only means deletion once the timeline is known to describe THIS
    // composition, and the bed being in it is the proof. Without that check a
    // store that is empty — not loaded yet, or a panel mounted outside the
    // player — reads as "every voice was deleted" and throws away a carve that
    // is perfectly fine. Unchanged sources are what the prune treats as nothing
    // to do.
    if (!element.id || !present.has(element.id)) return carve.sources;
    return carve.sources.filter((id) => present.has(id));
  })();

  /**
   * A deleted voice re-analyses the bed.
   *
   * The filters and envelopes are a measurement of specific tracks, so losing one
   * makes them a measurement of something that is no longer there — the bed keeps
   * ducking for a voice nobody can hear. `analyse` already skips a source it
   * cannot find, but nothing asked it to run again.
   *
   * Pruning is the whole trigger: `setCarve` re-analyses when the source list
   * changes, so the surviving voices are re-measured together. Losing the LAST
   * one leaves an empty list, which the effects below repoint at whatever
   * candidates remain — and if there are none, `setCarve` drops what the carve
   * generated, since there is nothing left it could be making room for.
   *
   * Keyed on the survivors rather than on the candidates: a voice that had
   * stopped overlapping was never in the candidate list, so its deletion would
   * not change that identity and this would never fire.
   */
  useEffect(() => {
    if (carvedAgainstBy || !carve?.enabled) return;
    if (survivingSources.length === carve.sources.length) return;
    void setCarve({ ...carve, sources: survivingSources });
    // Keyed on the identity of the decision, not on setCarve — which is rebuilt
    // every render and would re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carve, carvedAgainstBy, survivingSources.join(" ")]);

  /**
   * A bed with voices above it carves itself.
   *
   * Carving is what a bed under speech wants, and making the author find the
   * control, name the voices and set a strength before hearing the thing they
   * already wanted is ceremony.
   *
   * Every candidate, not one of them. This used to refuse when there were several,
   * because picking one of three was a guess — but they are analysed together now,
   * so "all of them" is the answer rather than a guess: a bed running under a
   * narrator, an answer and a second presenter should make room for all three.
   *
   * Runs once per state. The write lands in `data-fx-carve`, which is what `carve`
   * is read from, so the condition is false on every later render — and switching it
   * off stores `enabled: false`, which is also a configured carve. That is the whole
   * reason the flag exists rather than "off" being an absent attribute.
   */
  const candidateIds = autoSourceIds.join("\u0000");
  useEffect(() => {
    // Exactly one candidate is the sibling effect's case below, not this one's:
    // both guards passing for a single candidate fired two setCarve calls with
    // the same result — two decodes, two FFT runs, two concurrent attribute
    // writes.
    if (carvedAgainstBy || autoSourceIds.length <= 1) return;
    const all = autoSourceIds;
    // Nothing configured: the default carve, pointed at everything it could hear.
    if (carve === null) {
      void setCarve({ ...DEFAULT_CARVE, sources: all });
      return;
    }
    // Configured but naming no voice — switched on before there was anything to
    // listen to, or a source list emptied. The card reads the candidates out, so
    // they have to be the stored ones too.
    if (carve.enabled && carve.sources.length === 0) void setCarve({ ...carve, sources: all });
    // Keyed on the identity of the decision, not on setCarve — which is rebuilt
    // every render and would re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carve, carvedAgainstBy, candidateIds]);

  /**
   * A bed with one obvious voice above it carves itself.
   *
   * Carving is what a bed under narration wants, and making the author find the
   * control, pick the voice and set a strength before hearing the thing they
   * already wanted is ceremony. So an unconfigured track with exactly ONE
   * candidate voice gets the default carve applied for it.
   *
   * Exactly one, not the first of several: picking for the author when the answer
   * is ambiguous is how the wrong track gets carved, and a carve against the wrong
   * voice is silent and confusing. With several candidates the module still appears,
   * with the picker waiting.
   *
   * Runs once. The write lands in `data-fx-carve`, which is what `carve` is read
   * from, so the condition is false on every later render — and switching it off
   * stores `enabled: false`, which is also a configured carve. That is the whole
   * reason the flag exists rather than "off" being an absent attribute.
   */
  useEffect(() => {
    if (carvedAgainstBy || autoSourceIds.length !== 1) return;
    const only = autoSourceIds[0];
    if (!only) return;
    // Nothing configured: the default carve, pointed at the one candidate.
    if (carve === null) {
      void setCarve({ ...DEFAULT_CARVE, sources: [only] });
      return;
    }
    // Configured but with no voice yet — a carve switched on before there was
    // anything to listen to, or one whose source was cleared. The panel reads the
    // sole candidate out as the source, so it has to be the stored one too;
    // otherwise the card claims a relationship the attribute does not record.
    if (carve.enabled && carve.sources.length === 0) void setCarve({ ...carve, sources: [only] });
    // Deliberately keyed on the identity of the decision, not on setCarve — which
    // is rebuilt every render and would re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carve, carvedAgainstBy, autoSourceIds.length, autoSourceIds[0]]);

  const [analysing, setAnalysing] = useState(false);

  /**
   * Decodes the chosen voice track and turns its spectrum into peaking filters
   * on this one. The bands replace any previous carve output but leave
   * hand-added effects alone, so re-analysing does not discard other work.
   */
  /**
   * Measure THIS track and write the levelling lane.
   *
   * Same shape as the carve below it — decode offline, lock the rack while it
   * works, write once — but it listens to the track it is on rather than to a
   * voice above it, so it needs no source picker.
   */
  const runLeveller = async (): Promise<void> => {
    const el = element.element;
    const src = el?.getAttribute("src");
    const doc = el?.ownerDocument;
    if (!src || !doc) return;
    setAnalysing(true);
    try {
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return;
      const res = await fetch(new URL(src, doc.baseURI).href);
      const buffer = await new Ctor(1, 1, DECODE_SAMPLE_RATE).decodeAudioData(
        await res.arrayBuffer(),
      );
      const result = levellingResult(chain, buffer.getChannelData(0), buffer.sampleRate);
      if (!result) return;
      await onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(result.chain));
      // Merged by target, never written wholesale: the script describes its own
      // lane only, and replacing the attribute would take the carve's lanes and
      // the volume lane with it.
      const lane = result.automation.lanes[0];
      if (lane) {
        void onSetAttributeQuiet(
          HF_AUDIO_AUTOMATION_ATTR,
          automationAttrValue(withLane(automation, lane)) || null,
        );
      }
    } catch {
      // A track whose audio cannot be fetched or decoded simply gets no
      // levelling, the same way an unreadable carve source is skipped.
    } finally {
      setAnalysing(false);
    }
  };

  const removeLeveller = (): void => {
    const { chain: next, removedTarget } = removeLevelling(chain);
    void onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));
    // The lane goes with the node. An orphan keeps driving a parameter that is
    // no longer in the graph.
    if (removedTarget) {
      void onSetAttributeQuiet(
        HF_AUDIO_AUTOMATION_ATTR,
        automationAttrValue(withoutLane(automation, removedTarget)) || null,
      );
    }
  };

  const analyse = async (active: HfCarveSettings | null = carve): Promise<void> => {
    if (!active?.sources.length) return;
    const doc = element.element?.ownerDocument;
    if (!doc) return;
    // Every named voice that is actually there with something to decode. A source
    // naming a deleted track is skipped rather than failing the whole analysis.
    //
    // Read out to plain values here rather than carrying elements around: it is
    // what lets the src and the start be non-null by construction downstream
    // instead of by assertion.
    const voices: { src: string; start: string | null }[] = [];
    for (const id of active.sources) {
      const el = doc.getElementById(id);
      // By tag name, not `instanceof HTMLAudioElement`: these elements belong to
      // the composition's iframe document, so the constructor they were made
      // from is not this realm's and the instanceof is false for every one.
      if (el?.tagName !== "AUDIO") continue;
      const src = el.getAttribute("src");
      if (!src) continue;
      voices.push({ src, start: el.getAttribute("data-start") });
    }
    if (voices.length === 0) return;
    setAnalysing(true);
    try {
      // Decoded in an OfflineAudioContext, not a live one. Opening a second
      // output device mid-playback makes the running track glitch while the
      // hardware is reconfigured; an offline context touches no device.
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return;
      const decode = async (relative: string): Promise<AudioBuffer> => {
        const res = await fetch(new URL(relative, doc.baseURI).href);
        return new Ctor(1, 1, DECODE_SAMPLE_RATE).decodeAudioData(await res.arrayBuffer());
      };
      const bedStart = clipStart(element.dataAttributes?.["start"]);
      // Every voice, summed onto the bed's own clock. One question — where and when
      // is speech masking this bed — with one answer, even when the answer comes
      // from three people talking at different times. Doing this before the analysis
      // is also what lets the bands and the envelopes stay a single set: the chain is
      // fixed, so there is no per-voice filter to switch between.
      const decoded = await Promise.all(
        voices.map(async (voice) => ({
          samples: (await decode(voice.src)).getChannelData(0),
          offsetSeconds: clipStart(voice.start) - bedStart,
        })),
      );
      const voiceMix = mixCarveSources(decoded, DECODE_SAMPLE_RATE);
      if (voiceMix.length === 0) return;
      // Strength is what the author set; these are the numbers it means.
      const profile = carveProfile(active.strength);
      // The bed as well as the voice, when the carve is asked to match levels:
      // "how far over the voice is this bed" cannot be answered by listening to
      // one of them.
      const bedSrc = profile.duckDb > 0 ? element.element?.getAttribute("src") : null;
      const bedBuffer = bedSrc ? await decode(bedSrc).catch(() => null) : null;
      const bands = analyseCarveBands(voiceMix, DECODE_SAMPLE_RATE, profile);
      const carved = carveBandsToChain(bands);

      // The level half of the carve, measured against the speech it has to sit
      // under. No offset to apply: the mix is already on the bed's clock.
      const duck = bedBuffer
        ? analyseCarveDuck(voiceMix, bedBuffer.getChannelData(0), DECODE_SAMPLE_RATE, profile, 0)
        : [];

      // Carve output is tagged so a re-run replaces it instead of stacking.
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      // Ids, minted against the nodes already claiming one, because a dynamic
      // carve automates these filters and a lane addresses its node by id.
      let claimed: HfAudioFxChain = { version: 1, nodes: kept };
      const mint = (node: HfAudioFxNode): HfAudioFxNode => {
        const withId = { ...node, id: mintAudioFxNodeId(claimed), fromCarve: true };
        claimed = { version: 1, nodes: [...claimed.nodes, withId] };
        return withId;
      };
      const carvedNodes: HfAudioFxNode[] = carved.nodes.map(mint);
      // The gain stage sits after the filters, and only exists when the carve was
      // asked to make level room. It sits at 0 and is driven by the envelope below.
      const duckNode =
        duck.length > 0
          ? mint({
              type: "gain",
              enabled: true,
              params: { ...defaultAudioFxParams("gain"), gain: 0 },
            })
          : null;
      const next = {
        version: 1,
        nodes: [...carvedNodes, ...(duckNode ? [duckNode] : []), ...kept],
      };
      // Live, like every other chain write: the runtime swaps the graph in
      // place, so a reload would only interrupt the audio to reach the same
      // filters.
      //
      // Awaited, because the automation write below is a second read-modify-write
      // against the same file — fired together the later one would drop the
      // earlier — and because a lane naming a node the chain does not have yet is
      // pruned when it is read back.
      await onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));

      /**
       * One carve envelope as a lane on this bed's clock.
       *
       * No shifting: the voices were summed onto the bed's clock before the analysis
       * ran, so what comes back is already in the bed's own time. A lane does hold
       * its first value backwards to the start of its clip, so an envelope that
       * begins later needs an explicit "no cut" at zero or the bed starts out ducked.
       */
      const laneFor = (id: string, points: { t: number; v: number }[]): HfAutomationLane[] => {
        const timed = points
          .map((p) => ({ t: Number(p.t.toFixed(3)), v: p.v }))
          .filter((p) => p.t >= 0);
        if ((timed[0]?.t ?? 0) > 0) timed.unshift({ t: 0, v: 0 });
        return timed.length > 1 ? [{ target: fxAutomationTarget(id, "gain"), points: timed }] : [];
      };

      // Each filter's depth becomes an envelope of the speech's level in that band,
      // so pauses leave the bed alone and whoever is talking sets the depth.
      const lanes: HfAutomationLane[] = analyseCarveDynamics(
        voiceMix,
        DECODE_SAMPLE_RATE,
        bands,
      ).flatMap((dyn, i) => {
        const id = carvedNodes[i]?.id;
        return id ? laneFor(id, dyn.points) : [];
      });
      // The level envelope rides the gain stage, on the same clock as the bands.
      if (duckNode?.id && duck.length > 0) {
        lanes.push(...laneFor(duckNode.id, duck));
      }
      const carriedOver = withoutCarveLanes(automation, chain);
      if (lanes.length > 0 || carriedOver.lanes.length !== automation.lanes.length) {
        writeAutomation({ version: 1, lanes: [...carriedOver.lanes, ...lanes] });
      }
    } catch {
      // Leave the chain as it was; the button simply re-enables.
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <FxSection
      // Locked while the carve is measuring. `analyse` captures the chain and
      // the automation BEFORE its fetch and decode, then rewrites the whole
      // attribute from that snapshot — so an effect added, or a knob committed,
      // during those seconds was silently discarded when the analysis landed.
      // Only the Analyse button was disabled, so every other control in the rack
      // stayed live throughout. Refusing the edit is honest; merging it into a
      // measurement that did not account for it would not be.
      disabled={analysing}
      chain={chain}
      automatedTargets={automatedTargets}
      liveAutomationValues={liveAutomationValues}
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
      onLevel={() => void runLeveller()}
      onRemoveLevel={removeLeveller}
      levelled={chain.nodes.some((n) => n.fromLeveller)}
      carvedAgainstBy={carvedAgainstBy}
      analysing={analysing}
    />
  );
}
