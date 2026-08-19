/**
 * The voiceover carve: candidate voices, the relationship to another track's
 * carve, and the measurement that turns a voice into peaking filters and
 * ducking envelopes on this track.
 *
 * Split out of `propertyPanelAudioFxGroup.tsx`, which owned all of this before
 * the file grew past a size where "the carve" was still one thing to read.
 */

import { useEffect } from "react";
import {
  defaultAudioFxParams,
  HF_AUDIO_FX_ATTR,
  mintAudioFxNodeId,
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
  clipsOverlap,
  DEFAULT_CARVE,
  mixCarveSources,
  HF_AUDIO_CARVE_ATTR,
  type HfCarveSettings,
} from "@hyperframes/core/audio-carve";
import { resolveAudioGroups, resolveCarveSourceIds } from "@hyperframes/core/audio-groups";
import {
  carveBedRoles,
  carverAgainst,
  collectCarveCandidates,
  CARVE_ABORTED,
  isPromiseLike,
  resolveNextCarveSettings,
} from "./useFxCarveGrouping.js";
import {
  fxAutomationTarget,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { automationAttrValue, HF_AUDIO_AUTOMATION_ATTR } from "./propertyPanelAutomation";
import { trackCarveChanged } from "./audioFxTelemetry.js";
import type { DomEditSelection } from "./domEditingTypes";
import { usePlayerStore } from "../../player";
import { clipStart, spanOf } from "./propertyPanelAudioFxGroupUtils.js";
import type { AudioTrackOption } from "./propertyPanelFxCarveModule.js";

/**
 * Rate the carve source is decoded at. Analysis is self-consistent because it
 * reads the decoded buffer's own rate, so this only has to be a sane audio rate.
 */
const DECODE_SAMPLE_RATE = 48000;

/**
 * Which carve setting actually moved, by comparing the two snapshots.
 *
 * On/off is checked before the rest: switching a carve off also strands its
 * sources and strength, and reporting that as a "strength" change would be
 * describing the wreckage instead of the decision.
 */
function carveAction(
  before: HfCarveSettings | null,
  after: HfCarveSettings | null,
): "enabled" | "disabled" | "strength" | "sources" {
  if (!after?.enabled) return "disabled";
  if (!before?.enabled) return "enabled";
  if (before.sources.length !== after.sources.length) return "sources";
  return "strength";
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
 * Every setting here describes the filters, so changing one rebuilds them.
 * There is no apply button: a carve naming a voice with no filters behind it
 * is a setting nobody applied, and the panel already knows everything it needs
 * to. Picking the voice is what starts it; strength and dynamic re-derive what
 * is already there. A carve with no source yet has nothing to analyse.
 */
function carveNeedsReanalysis(
  before: HfCarveSettings | null,
  after: HfCarveSettings | null,
): after is HfCarveSettings {
  if (!after?.enabled || after.sources.length === 0) return false;
  if (!before || !before.enabled) return true;
  // Switching it back on is a change like any other: the filters went with the
  // switch, so there is nothing left to hear until they are rebuilt. Without
  // this, On restored the setting and left the bed uncarved.
  return (
    before.sources.join("\0") !== after.sources.join("\0") || before.strength !== after.strength
  );
}

/**
 * Every named voice that is actually there with something to decode. A source
 * naming a deleted track is skipped rather than failing the whole analysis.
 *
 * Read out to plain values here rather than carrying elements around: it is
 * what lets the src and the start be non-null by construction downstream
 * instead of by assertion.
 */
function resolveCarveVoices(
  doc: Document,
  sources: readonly string[],
): { src: string; start: string | null }[] {
  const voices: { src: string; start: string | null }[] = [];
  for (const id of sources) {
    const el = doc.getElementById(id);
    // By tag name, not `instanceof HTMLAudioElement`: these elements belong to
    // the composition's iframe document, so the constructor they were made
    // from is not this realm's and the instanceof is false for every one.
    if (el?.tagName !== "AUDIO") continue;
    const src = el.getAttribute("src");
    if (!src) continue;
    voices.push({ src, start: el.getAttribute("data-start") });
  }
  return voices;
}

/**
 * Turns the analysed bands (and, if the carve is asked to match levels, a
 * ducking envelope) into chain nodes — tagged so a re-run replaces them
 * instead of stacking, and minted against the nodes already claiming an id
 * because a dynamic carve automates these filters and a lane addresses its
 * node by id.
 */
function mintCarveNodes(
  chain: HfAudioFxChain,
  carved: HfAudioFxChain,
  duck: { t: number; v: number }[],
): { next: HfAudioFxChain; carvedNodes: HfAudioFxNode[]; duckNode: HfAudioFxNode | null } {
  const kept = chain.nodes.filter((n) => !n.fromCarve);
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
      ? mint({ type: "gain", enabled: true, params: { ...defaultAudioFxParams("gain"), gain: 0 } })
      : null;
  return {
    next: { version: 1, nodes: [...carvedNodes, ...(duckNode ? [duckNode] : []), ...kept] },
    carvedNodes,
    duckNode,
  };
}

/**
 * Decode every voice, mix them onto the bed's own clock, and measure the
 * bands (and, if the profile calls for it, the ducking envelope) from that
 * mix. Null on anything that leaves nothing to build a carve from — the
 * platform lacking an offline context, or a mix that decoded to silence.
 */
async function measureCarve(
  doc: Document,
  voices: { src: string; start: string | null }[],
  strength: number,
  bedStartAttr: string | null | undefined,
  bedSrc: string | null | undefined,
): Promise<{
  bands: ReturnType<typeof analyseCarveBands>;
  carved: HfAudioFxChain;
  duck: { t: number; v: number }[];
  voiceMix: Float32Array;
} | null> {
  // Decoded in an OfflineAudioContext, not a live one. Opening a second output
  // device mid-playback makes the running track glitch while the hardware is
  // reconfigured; an offline context touches no device.
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctor) return null;
  const decode = async (relative: string): Promise<AudioBuffer> => {
    const res = await fetch(new URL(relative, doc.baseURI).href);
    return new Ctor(1, 1, DECODE_SAMPLE_RATE).decodeAudioData(await res.arrayBuffer());
  };
  const bedStart = clipStart(bedStartAttr);
  // Every voice, summed onto the bed's own clock. One question — where and
  // when is speech masking this bed — with one answer, even when the answer
  // comes from three people talking at different times. Doing this before the
  // analysis is also what lets the bands and the envelopes stay a single set:
  // the chain is fixed, so there is no per-voice filter to switch between.
  const decoded = await Promise.all(
    voices.map(async (voice) => ({
      samples: (await decode(voice.src)).getChannelData(0),
      offsetSeconds: clipStart(voice.start) - bedStart,
    })),
  );
  const voiceMix = mixCarveSources(decoded, DECODE_SAMPLE_RATE);
  if (voiceMix.length === 0) return null;
  // Strength is what the author set; these are the numbers it means.
  const profile = carveProfile(strength);
  // The bed as well as the voice, when the carve is asked to match levels:
  // "how far over the voice is this bed" cannot be answered by listening to
  // one of them.
  const bedBuffer = profile.duckDb > 0 && bedSrc ? await decode(bedSrc).catch(() => null) : null;
  const bands = analyseCarveBands(voiceMix, DECODE_SAMPLE_RATE, profile);
  // The level half of the carve, measured against the speech it has to sit
  // under. No offset to apply: the mix is already on the bed's clock.
  const duck = bedBuffer
    ? analyseCarveDuck(voiceMix, bedBuffer.getChannelData(0), DECODE_SAMPLE_RATE, profile, 0)
    : [];
  return { bands, carved: carveBandsToChain(bands), duck, voiceMix };
}

/** Each filter's depth as an envelope, plus the level envelope if there is one. */
function carveLanes(
  carvedNodes: HfAudioFxNode[],
  duckNode: HfAudioFxNode | null,
  duck: { t: number; v: number }[],
  voiceMix: Float32Array,
  bands: ReturnType<typeof analyseCarveBands>,
): HfAutomationLane[] {
  // Each filter's depth becomes an envelope of the speech's level in that
  // band, so pauses leave the bed alone and whoever is talking sets the depth.
  const lanes = analyseCarveDynamics(voiceMix, DECODE_SAMPLE_RATE, bands).flatMap((dyn, i) => {
    const id = carvedNodes[i]?.id;
    return id ? carveLaneFor(id, dyn.points) : [];
  });
  // The level envelope rides the gain stage, on the same clock as the bands.
  if (duckNode?.id && duck.length > 0) lanes.push(...carveLaneFor(duckNode.id, duck));
  return lanes;
}

/**
 * One carve envelope as a lane on this bed's clock.
 *
 * No shifting: the voices were summed onto the bed's clock before the analysis
 * ran, so what comes back is already in the bed's own time. A lane does hold
 * its first value backwards to the start of its clip, so an envelope that
 * begins later needs an explicit "no cut" at zero or the bed starts out ducked.
 */
function carveLaneFor(id: string, points: { t: number; v: number }[]): HfAutomationLane[] {
  const timed = points.map((p) => ({ t: Number(p.t.toFixed(3)), v: p.v })).filter((p) => p.t >= 0);
  if ((timed[0]?.t ?? 0) > 0) timed.unshift({ t: 0, v: 0 });
  return timed.length > 1 ? [{ target: fxAutomationTarget(id, "gain"), points: timed }] : [];
}

/**
 * What the carve generated is only justified by the voices it was measured
 * from: switched off, or left naming none — every source deleted, say — there
 * is nothing those filters are making room for. Left behind they keep dipping
 * the bed with nothing in the panel to explain them.
 */
async function dropCarveOutput(
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

export function useFxCarve(
  element: DomEditSelection,
  chain: HfAudioFxChain,
  carve: HfCarveSettings | null,
  automation: HfAutomation,
  onSetAttributeQuiet: (attr: string, value: string | null) => void | Promise<void>,
  writeAutomation: (next: HfAutomation) => void,
  setAnalysing: (value: boolean) => void,
  /**
   * Write `data-audio-group` on every named clip, atomically, one undo entry.
   * Absent in a harness with no such capability (or the flag off): the
   * auto-group step is then skipped and a multi-voice pick keeps naming plain
   * clip ids, exactly like before this existed.
   */
  onAutoGroupCarveSources?: (clipIds: readonly string[], groupId: string) => Promise<void>,
) {
  const carvedAgainstBy = carverAgainst(element.element?.ownerDocument, element.id);

  // Can this be a bed at all, and may one be applied unasked. See carveBedRoles.
  const { couldBeBed, autoBed } = carveBedRoles(element.id, element.element);

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
   *
   * Empty on a track that cannot be a bed at all, which is what withholds the
   * whole module: `showCarve` already asks "is there anything to carve against",
   * so the near-end rule rides that rather than a second flag to thread.
   */
  const { sourceOptions, autoSourceIds } = ((): {
    sourceOptions: AudioTrackOption[];
    autoSourceIds: string[];
  } => {
    const doc = element.element?.ownerDocument;
    if (!doc || !couldBeBed) return { sourceOptions: [], autoSourceIds: [] };
    const others = Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[id]")).filter(
      (a) => a.id !== element.id,
    );
    // Only tracks that are actually playing while this bed is. A voice somewhere
    // else on the timeline cannot mask it, so including it would contribute silence
    // to the analysis and leave the author wondering why it changed nothing.
    const bedSpan = spanOf(element.dataAttributes?.["start"], element.dataAttributes?.["duration"]);
    const overlapsBed = (a: Element): boolean =>
      clipsOverlap(bedSpan, spanOf(a.getAttribute("data-start"), a.getAttribute("data-duration")));

    const described = collectCarveCandidates(doc, others, overlapsBed, element.id ?? undefined);
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
    // A group id is never in `present` — it's not a timeline element — so it
    // needs its own existence check: a group survives as long as it still has
    // at least one member, checked against the live document the same way the
    // picker resolves groups above.
    const doc = element.element?.ownerDocument;
    const groupIds = doc ? new Set(resolveAudioGroups(doc).map((g) => g.id)) : new Set<string>();
    return carve.sources.filter((id) => present.has(id) || groupIds.has(id));
  })();

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
  // fallow-ignore-next-line complexity
  const setCarve = async (nextRaw: HfCarveSettings | null): Promise<void> => {
    const doc = element.element?.ownerDocument;
    // Plural voiceover ⇒ carve targets a group, always — auto-created here if
    // picking the second voice clip is what just named it. Not unconditionally
    // awaited: see resolveNextCarveSettings's own contract.
    const resolved = resolveNextCarveSettings(nextRaw, doc, onAutoGroupCarveSources);
    const next = isPromiseLike(resolved) ? await resolved : resolved;
    if (next === CARVE_ABORTED) return;
    // Which of the carve's settings moved. One event per change with the action
    // named, rather than a single "carve touched" — enabling a carve and nudging
    // its strength are different decisions and the interesting question (do
    // people leave it at the default?) needs them apart.
    trackCarveChanged(carveAction(carve, next), {
      strength: next?.strength,
      sourceCount: next?.sources.length,
    });
    const generatedOutputStands = Boolean(next?.enabled) && (next?.sources.length ?? 0) > 0;
    if (!generatedOutputStands) await dropCarveOutput(chain, automation, onSetAttributeQuiet);
    await onSetAttributeQuiet(HF_AUDIO_CARVE_ATTR, next ? JSON.stringify(next) : null);

    if (carveNeedsReanalysis(carve, next)) await analyse(next);
  };

  // Voice resolution, measurement, node-minting and lane-building are already
  // their own functions (resolveCarveVoices, measureCarve, mintCarveNodes,
  // carveLanes); what is left is the orchestration between them, including the
  // two-attribute write order the comments below explain the reason for.
  // fallow-ignore-next-line complexity
  const analyse = async (active: HfCarveSettings | null = carve): Promise<void> => {
    if (!active?.sources.length) return;
    const doc = element.element?.ownerDocument;
    if (!doc) return;
    // Membership resolves fresh at analysis time, never frozen into `sources`:
    // a group named here expands to whoever is in it right now, so a fourth
    // voice added to an already-carved group is heard on the next analysis
    // without anyone editing the carve itself.
    const voices = resolveCarveVoices(doc, resolveCarveSourceIds(doc, active.sources));
    if (voices.length === 0) return;
    setAnalysing(true);
    try {
      const bedSrc = element.element?.getAttribute("src");
      const measured = await measureCarve(
        doc,
        voices,
        active.strength,
        element.dataAttributes?.["start"],
        bedSrc,
      );
      if (!measured) return;
      const { bands, carved, duck, voiceMix } = measured;

      const { next, carvedNodes, duckNode } = mintCarveNodes(chain, carved, duck);
      // Live, like every other chain write: the runtime swaps the graph in
      // place, so a reload would only interrupt the audio to reach the same
      // filters.
      //
      // Awaited, because the automation write below is a second read-modify-write
      // against the same file — fired together the later one would drop the
      // earlier — and because a lane naming a node the chain does not have yet is
      // pruned when it is read back.
      await onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));

      const lanes = carveLanes(carvedNodes, duckNode, duck, voiceMix, bands);
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
  const candidateIds = autoSourceIds.join("\0");
  useEffect(() => {
    // Exactly one candidate is the sibling effect's case below, not this one's:
    // both guards passing for a single candidate fired two setCarve calls with
    // the same result — two decodes, two FFT runs, two concurrent attribute
    // writes.
    if (carvedAgainstBy || !autoBed || autoSourceIds.length <= 1) return;
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
  }, [carve, carvedAgainstBy, autoBed, candidateIds]);

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
    if (carvedAgainstBy || !autoBed || autoSourceIds.length !== 1) return;
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
  }, [carve, carvedAgainstBy, autoBed, autoSourceIds.length, autoSourceIds[0]]);

  return { carvedAgainstBy, sourceOptions, setCarve };
}
