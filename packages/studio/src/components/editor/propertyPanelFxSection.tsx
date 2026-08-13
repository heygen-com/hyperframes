/**
 * The FX section for an audio element: the chain, plus the voiceover carve.
 *
 * The carve is its own module — see `propertyPanelFxCarveModule.tsx` for why it
 * is not an entry in the chain.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  HF_AUDIO_FX,
  mintAudioFxNodeId,
  type HfAudioFxChain,
  type HfAudioFxGroup,
  type HfAudioFxNode,
  type HfAudioFxParam,
  type HfAudioFxParamValues,
} from "@hyperframes/core/audio-fx";
import { DEFAULT_CARVE, type HfCarveSettings } from "@hyperframes/core/audio-carve";
import { applyAudioFxPreset, getAudioFxPreset } from "@hyperframes/core/audio-fx-presets";
import {
  addAudioEq,
  audioEqIds,
  readAudioEqBands,
  removeAudioEq,
  setAudioEqBandGain,
} from "@hyperframes/core/audio-fx-eq";
import { EFFECT_COPY } from "@hyperframes/core/audio-fx-copy";
import { applyAudioFxProfile, getAudioFxProfile } from "@hyperframes/core/audio-fx-profiles";
import {
  audioFxJobNode,
  HF_AUDIO_FX_JOBS,
  HF_AUDIO_FX_JOB_TYPES,
  type HfAudioFxJob,
} from "@hyperframes/core/audio-fx-jobs";
import { FxParamRow } from "./propertyPanelFxControls.js";
import { FxPresetMenu } from "./propertyPanelFxPresetMenu.js";
import { FxEqModule } from "./propertyPanelFxEqModule.js";
import { FxCarveModule, type AudioTrackOption } from "./propertyPanelFxCarveModule.js";
import { FxNodeRow } from "./propertyPanelFxNodeRow.js";

export type { AudioTrackOption };

const GROUP_ORDER: HfAudioFxGroup[] = ["filter", "dynamics", "nonlinear", "time"];
const GROUP_LABEL: Record<HfAudioFxGroup, string> = {
  filter: "Filters",
  dynamics: "Dynamics",
  nonlinear: "Non-linear",
  time: "Time",
};

/**
 * The one control over a whole preset: how much of it is applied.
 *
 * Not in the effect registry — a preset is not an effect — so the row is
 * fabricated the same way the derived one-knob control is, and rendered by the
 * ordinary controls.
 */
const PRESET_AMOUNT_PARAM: HfAudioFxParam = {
  kind: "number",
  key: "amount",
  label: "Amount",
  unit: "",
  min: 0,
  max: 1,
  step: 0.01,
  default: 1,
  hint: "How much of this preset is applied. Automate it to bring the whole preset in or out over time.",
};
export interface FxSectionProps {
  chain: HfAudioFxChain;
  /** Targets this track already automates, as `fx.<nodeId>.<param>` strings. */
  automatedTargets?: ReadonlySet<string>;
  /**
   * What each automated target is worth at the playhead, by the same key.
   *
   * An automated parameter's stored number is only the seed the lane replaced, so
   * a rack that shows it stands still while the carve is audibly working. Absent,
   * or missing a key, means there is no playhead over this clip and the stored
   * value is the honest one.
   */
  liveAutomationValues?: ReadonlyMap<string, number>;
  /** Add a lane for one effect parameter, seeded at its current value. */
  onAutomateParam?(nodeId: string, paramKey: string): void;
  /** Delete one effect parameter's lane. */
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
  /** Delete every lane belonging to a node that is being removed. */
  onRemoveNodeAutomation?(nodeId: string): void;
  /** Add a lane for a whole preset's amount, seeded where it sits now. */
  onAutomatePreset?(presetId: string, amount: number): void;
  /** Delete that lane. */
  onRemovePresetAutomation?(presetId: string): void;
  /** Presets whose amount a lane already drives. */
  automatedPresets?: ReadonlySet<string>;
  /** Measure this track and write the levelling lane. Absent when unavailable. */
  onLevel?(): void;
  /** Take the levelling stage and its lane back out. */
  onRemoveLevel?(): void;
  /** Whether a levelling stage is already on the track. */
  levelled?: boolean;
  /**
   * Hover-audition of the levelling script: measure this track and play the
   * result without persisting it, and put it back on `false`.
   *
   * Separate from `onChainPreview` because it is the one audition that cannot be
   * synthesised from the chain in hand — the numbers do not exist until the
   * audio has been decoded and measured.
   */
  onAuditionLevel?(on: boolean): void;
  /** Whether that measurement is running, so the button can say so. */
  auditioningLevel?: boolean;
  /** Structural edits and gesture-end writes; this is the one that persists. */
  onChainChange(chain: HfAudioFxChain): void;
  /** Continuous updates while a control is being dragged. */
  onChainPreview?(chain: HfAudioFxChain): void;
  carve: HfCarveSettings | null;
  /** Gesture-end write; this is the one that persists. */
  onCarveChange(carve: HfCarveSettings | null): void;
  /** Continuous updates while a carve slider is dragged. Without this every
   *  pointermove patched the source file and resynced the selection. */
  onCarvePreview?(carve: HfCarveSettings): void;
  /**
   * Set when another track's carve listens to this one, naming it. The carve block
   * is then not offered here at all: this track is the voice, not the bed.
   */
  carvedAgainstBy?: string | null;
  /** Other audio elements that could act as the carve source. */
  sourceOptions: AudioTrackOption[];
  analysing?: boolean;
  disabled?: boolean;
}

export function FxSection({
  chain,
  automatedTargets,
  liveAutomationValues,
  onAutomateParam,
  onRemoveParamAutomation,
  onRemoveNodeAutomation,
  onChainChange,
  onChainPreview,
  carve,
  carvedAgainstBy,
  onCarveChange,
  onCarvePreview,
  sourceOptions,
  analysing,
  disabled,
  onLevel,
  onRemoveLevel,
  levelled,
  onAuditionLevel,
  auditioningLevel,
  onAutomatePreset,
  onRemovePresetAutomation,
  automatedPresets,
}: FxSectionProps) {
  const presetAutomated = automatedPresets ?? new Set<string>();
  // Falls back to the persisting write when no preview handler is supplied, which
  // keeps the control working rather than going dead.
  const previewCarve = onCarvePreview ?? onCarveChange;

  // Nothing to carve against means nothing to show — see the block below.
  // Not offered on the voice another track is already carving against — that
  // track is the far end of someone else's relationship, and a carve of its own
  // could only name a source it must not.
  const showCarve = !carvedAgainstBy && (sourceOptions.length > 0 || carve !== null);

  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [openNode, setOpenNode] = useState<number | null>(0);

  /**
   * The add menu, with the jobs standing in for the effect they are made of.
   *
   * `peaking` is not offered as itself: picking it is picking a machine and
   * leaving the real decision — which range — for afterwards. The jobs are that
   * decision, already made. See `audioFxJobs.ts`.
   */
  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((g) => ({
        group: g,
        defs: HF_AUDIO_FX.filter((d) => d.group === g && !HF_AUDIO_FX_JOB_TYPES.has(d.id)),
        jobs: HF_AUDIO_FX_JOBS.filter((job) => getAudioFxDef(job.type)?.group === g),
      })),
    [],
  );

  const mutate = useCallback(
    (nodes: HfAudioFxNode[]) => onChainChange({ ...chain, nodes }),
    [chain, onChainChange],
  );

  // Dragging a knob previews without persisting; releasing it commits once.
  const previewNode = useCallback(
    (index: number, params: HfAudioFxParamValues) =>
      onChainPreview?.({
        ...chain,
        nodes: chain.nodes.map((n, i) => (i === index ? { ...n, params } : n)),
      }),
    [chain, onChainPreview],
  );

  /**
   * The chain as it is really stored, captured when an audition starts.
   *
   * Auditioning writes through the preview channel, which does not persist and
   * does not come back as a new `chain` prop — so reverting has to remember what
   * was there rather than read it back. Null means nothing is being auditioned,
   * which is also what makes a stray leave a no-op instead of a write.
   */
  const auditionBase = useRef<HfAudioFxChain | null>(null);

  /**
   * Play something without committing to it, and put it back on the way out.
   *
   * Hearing a preset before choosing it is the strongest affordance in this
   * panel — see `plans/audio-fx-ux/README.md` §Decided. It costs nothing new:
   * the preview channel a slider drag already uses rebuilds the running graph
   * without touching the document.
   */
  const audition = useCallback(
    (make: ((base: HfAudioFxChain) => HfAudioFxChain) | null) => {
      if (!onChainPreview) return;
      if (make) {
        auditionBase.current ??= chain;
        onChainPreview(make(auditionBase.current));
      } else if (auditionBase.current) {
        onChainPreview(auditionBase.current);
        auditionBase.current = null;
      }
    },
    [chain, onChainPreview],
  );

  /**
   * The preview handler as of the last render, held rather than closed over.
   *
   * The teardown below must run on teardown and at no other time, so its deps
   * have to be empty — and `onChainPreview` is an inline arrow in the group,
   * which re-renders on every playhead tick to move the automation readouts. A
   * dep on it made React tear down and re-run the effect on every one of those
   * ticks, so an audition reverted itself about 30 times a second while the
   * pointer was still on the button: the preset was heard for a frame during
   * playback, which is the exact case the whole affordance exists for.
   */
  const previewRef = useRef(onChainPreview);
  previewRef.current = onChainPreview;

  // Leaving by any route other than the pointer — the element deselected, the
  // panel closed — would otherwise leave the audition playing over a chain the
  // document does not have.
  useEffect(
    () => () => {
      if (auditionBase.current) previewRef.current?.(auditionBase.current);
    },
    [],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = getAudioFxPreset(id);
      if (!preset) return;
      // Appends. Stacking a character preset onto an already-cleaned voice is a
      // real thing to want, and replacing silently would throw work away — so
      // the destructive option is a separate gesture, not the default one.
      const next = applyAudioFxPreset(chain, preset);
      // The audition WAS this, so there is nothing to put back — and putting the
      // old chain back over the write that just landed is a race the author
      // hears as the preset arriving and then leaving again.
      auditionBase.current = null;
      mutate(next.nodes);
      // Land on the first node the preset wrote, so the author can hear what
      // arrived and immediately see what it is made of.
      setOpenNode(next.nodes.findIndex((n) => n.fromPreset === preset.id));
      setPicking(false);
    },
    [chain, mutate],
  );

  /**
   * One effect appended, at the values its module opens on.
   *
   * For most effects that is the registry's defaults. For the five with a
   * derived knob it is NOT: the registry defaults are not a point on the
   * profile's curve, so the module opened reading a strength it was not set to —
   * a compressor arrived showing Evenness 0.67 with its make-up gain at 0 dB,
   * which is the "quieter as you turn it up" bug the profiles exist to prevent,
   * on the very first frame. Seeding through the profile puts the knob and the
   * mechanism in agreement from the start.
   */
  const withEffect = useCallback(
    (base: HfAudioFxChain, type: string): HfAudioFxChain => ({
      ...base,
      nodes: [
        ...base.nodes,
        {
          type,
          id: mintAudioFxNodeId(base),
          enabled: true,
          params: getAudioFxProfile(type)
            ? applyAudioFxProfile(type, 0.5, defaultAudioFxParams(type))
            : defaultAudioFxParams(type),
        },
      ],
    }),
    [],
  );

  /** The same, for a job — an ordinary node that arrives already named and aimed. */
  const withJob = useCallback(
    (base: HfAudioFxChain, job: HfAudioFxJob): HfAudioFxChain => ({
      ...base,
      nodes: [...base.nodes, audioFxJobNode(job, base)],
    }),
    [],
  );

  const addJob = useCallback(
    (job: HfAudioFxJob) => {
      auditionBase.current = null;
      mutate(withJob(chain, job).nodes);
      setOpenNode(chain.nodes.length);
      setAdding(false);
    },
    [chain, mutate, withJob],
  );

  const addEffect = useCallback(
    (type: string) => {
      auditionBase.current = null;
      mutate(withEffect(chain, type).nodes);
      setOpenNode(chain.nodes.length);
      setAdding(false);
    },
    [chain, mutate, withEffect],
  );

  const updateNode = useCallback(
    (index: number, patch: Partial<HfAudioFxNode>) =>
      mutate(chain.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n))),
    [chain.nodes, mutate],
  );

  /**
   * How much of a preset is applied, 0..1.
   *
   * The switch and the lane are the same value, not two ways of silencing a
   * preset: `presetAmount` drives the wet/dry blend the graph wraps the run in,
   * so Off is amount 0 and a lane ramping 0 → 1 is the same control moving
   * continuously. Writing `enabled` instead would take the nodes out of the
   * graph, which a lane cannot do part-way and cannot do without a rebuild.
   *
   * On every node of the run because that is where the chain can hold it — see
   * `HfAudioFxNode.presetAmount`.
   */
  const setRunAmount = useCallback(
    (items: { node: HfAudioFxNode; i: number }[], amount: number, persist = true) => {
      const slots = new Set(items.map((item) => item.i));
      const next = {
        ...chain,
        nodes: chain.nodes.map((n, i) => (slots.has(i) ? { ...n, presetAmount: amount } : n)),
      };
      if (persist) mutate(next.nodes);
      else onChainPreview?.(next);
    },
    [chain, mutate, onChainPreview],
  );

  /**
   * Take a preset back out whole, lanes and all.
   *
   * Same contract as removing one node — an orphaned lane keeps driving a
   * parameter that is no longer in the graph, and with ids minted lowest-free
   * the next effect added inherits it.
   */
  const removeRun = useCallback(
    (items: { node: HfAudioFxNode; i: number }[]) => {
      for (const { node } of items) {
        if (node.id) onRemoveNodeAutomation?.(node.id);
      }
      const slots = new Set(items.map((item) => item.i));
      mutate(chain.nodes.filter((_, i) => !slots.has(i)));
      setOpenNode(null);
    },
    [chain.nodes, mutate, onRemoveNodeAutomation],
  );

  const removeNode = useCallback(
    (index: number) => {
      // The node's lanes go with it. `resolveAutomation` only hides an orphan at
      // read time; left in the attribute, and with ids minted lowest-free, the
      // next effect added takes the same id and inherits the dead envelope —
      // arriving with its control disabled and "Automated" without the author
      // ever automating it, and baked into the render.
      const removedId = chain.nodes[index]?.id;
      if (removedId) onRemoveNodeAutomation?.(removedId);
      mutate(chain.nodes.filter((_, i) => i !== index));
      setOpenNode(null);
    },
    [chain.nodes, mutate, onRemoveNodeAutomation],
  );

  // Open by default: the module is the carve's whole control surface now, and a
  // collapsed card would hide the knob the author came here for.
  const [carveOpen, setCarveOpen] = useState(true);
  const carveNodes = useMemo(() => chain.nodes.filter((n) => n.fromCarve), [chain.nodes]);
  /** Everything the author added, with the chain index every edit addresses. */
  const handBuilt = useMemo(
    () =>
      chain.nodes
        .map((node, i) => ({ node, i }))
        // Carve and EQ bands belong to their own modules; showing them here too
        // would put the same filter on screen twice with two ways to edit it.
        .filter(({ node }) => !node.fromCarve && !node.fromEq),
    [chain.nodes],
  );

  /**
   * The hand-built list cut into runs, so a preset reads as one thing.
   *
   * Applying a preset drops five rows into the rack with nothing saying they
   * arrived together — which is the same failure the carve module was built to
   * fix, one level down. Consecutive only: a preset whose nodes have been pulled
   * apart by a reorder is no longer a unit, and drawing a bracket around the gap
   * would claim an adjacency the signal path does not have.
   */
  const runs = useMemo(() => {
    const out: { preset?: string; items: { node: HfAudioFxNode; i: number }[] }[] = [];
    for (const item of handBuilt) {
      const preset = item.node.fromPreset;
      const last = out.at(-1);
      if (last && last.preset === preset) last.items.push(item);
      else out.push({ ...(preset ? { preset } : {}), items: [item] });
    }
    return out;
  }, [handBuilt]);

  const eqIds = useMemo(() => audioEqIds(chain), [chain]);

  /**
   * The number each row wears, counted over what the rack actually shows.
   *
   * Not the chain index: the carve's filters and an EQ's bands are inside their
   * own modules, so counting raw nodes would leave the visible rack jumping from
   * 02 to 07 and the numbers would look like a bug rather than a position.
   */
  const positions = useMemo(() => {
    const map = new Map<number, number>();
    let at = (showCarve ? 1 : 0) + eqIds.length;
    for (const { i } of handBuilt) map.set(i, ++at);
    return map;
  }, [handBuilt, eqIds.length, showCarve]);
  const [openEq, setOpenEq] = useState<string | null>(null);

  const addEq = useCallback(() => {
    auditionBase.current = null;
    const { chain: next, eqId } = addAudioEq(chain);
    mutate(next.nodes);
    setOpenEq(eqId);
    setAdding(false);
  }, [chain, mutate]);

  // Dragging a fader is heard immediately and written once on release, the same
  // split every other control in the rack uses.
  const previewEqBand = useCallback(
    (eqId: string, band: string, gain: number) =>
      onChainPreview?.(setAudioEqBandGain(chain, eqId, band, gain)),
    [chain, onChainPreview],
  );
  const commitEqBand = useCallback(
    (eqId: string, band: string, gain: number) =>
      mutate(setAudioEqBandGain(chain, eqId, band, gain).nodes),
    [chain, mutate],
  );
  const removeEq = useCallback(
    (eqId: string) => {
      for (const node of chain.nodes) {
        if (node.fromEq === eqId && node.id) onRemoveNodeAutomation?.(node.id);
      }
      mutate(removeAudioEq(chain, eqId).nodes);
    },
    [chain, mutate, onRemoveNodeAutomation],
  );

  const moveNode = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= chain.nodes.length) return;
      const next = [...chain.nodes];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      mutate(next);
      setOpenNode(target);
    },
    [chain.nodes, mutate],
  );

  return (
    <div className="hf-fx-section space-y-2">
      <div className="hf-fx-chain space-y-1">
        {/* The rack IS the signal path, and saying so costs two lines. Without
            them the order reads as a list, which is the one reading that makes
            "move up" look cosmetic — it is the most consequential control here. */}
        <p className="hf-fx-term flex items-baseline gap-1.5 px-1.5 font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
          <span className="hf-fx-term-cap text-panel-text-1">In</span>
          <span>this track</span>
        </p>
        {/* Carve leads the rack, which is also where its effects sit in the signal
            path — corrective work before anything the author added. Present
            whenever there is a voice for it to listen to, rather than appearing
            only once it has already produced something: a control that materialises
            after the fact cannot be the thing you reach for to start. */}
        {showCarve ? (
          <FxCarveModule
            nodes={carveNodes}
            carve={carve ?? { ...DEFAULT_CARVE }}
            sourceOptions={sourceOptions}
            automatedTargets={automatedTargets}
            liveAutomationValues={liveAutomationValues}
            open={carveOpen}
            disabled={disabled}
            analysing={analysing}
            onToggleOpen={() => setCarveOpen((was) => !was)}
            onCarveChange={onCarveChange}
            onCarvePreview={previewCarve}
          />
        ) : null}
        {eqIds.map((eqId) => (
          <FxEqModule
            key={eqId}
            eqId={eqId}
            bands={readAudioEqBands(chain, eqId)}
            open={openEq === eqId}
            disabled={disabled}
            onToggleOpen={() => setOpenEq((was) => (was === eqId ? null : eqId))}
            onPreview={(band, gain) => previewEqBand(eqId, band, gain)}
            onCommit={(band, gain) => commitEqBand(eqId, band, gain)}
            onRemove={() => removeEq(eqId)}
          />
        ))}
        {handBuilt.length === 0 && eqIds.length === 0 ? (
          <p className="hf-fx-empty py-1 text-[11px] text-panel-text-4">
            {showCarve ? "No other effects on this track." : "No effects on this track."}
          </p>
        ) : (
          runs.map((run) => {
            const rows = run.items.map(({ node, i }) => (
              <FxNodeRow
                // Keyed by id, as the carve module's list above already is.
                // On `${type}-${index}` two effects of the same type keep their
                // keys through a reorder, so React reuses each row where it
                // stands — and the controls hold real state (a half-typed
                // number, an in-flight drag), which then lands on whichever
                // effect moved into that slot.
                key={node.id ?? `${node.type}-${i}`}
                node={node}
                index={i}
                position={positions.get(i)}
                automatedTargets={automatedTargets}
                liveAutomationValues={liveAutomationValues}
                onAutomateParam={onAutomateParam}
                onRemoveParamAutomation={onRemoveParamAutomation}
                open={openNode === i}
                last={i === chain.nodes.length - 1}
                disabled={disabled}
                onToggleOpen={() => setOpenNode(openNode === i ? null : i)}
                onUpdate={updateNode}
                onMove={moveNode}
                onRemove={removeNode}
                onPreview={previewNode}
              />
            ));
            const preset = run.preset ? getAudioFxPreset(run.preset) : null;
            if (!preset) return rows;
            // On unless every node in it is bypassed: one switched back on means
            // the preset is doing something, and the switch has to offer to stop
            // it rather than claiming it has already stopped.
            // How much of it is applied. Any node of the run carries it, and the
            // first is the one the graph reads.
            const amount = run.items[0]?.node.presetAmount;
            const runAmount = typeof amount === "number" ? amount : 1;
            const runOn = runAmount > 0;
            return (
              <div
                key={`preset-${run.preset}-${run.items[0]?.i}`}
                className="hf-fx-preset-run space-y-1 rounded-[4px] border border-dashed border-panel-border-input p-1"
                data-fx-preset={run.preset}
              >
                <div className="hf-fx-preset-run-head flex min-h-6 items-center gap-1 px-0.5">
                  <span className="hf-fx-preset-run-label min-w-0 flex-1 truncate font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
                    {preset.label}
                  </span>
                  {/* The whole preset, on or off. Partly-bypassed reads as off,
                      because "some of it is running" is not a state an author
                      set — it is one they arrived at, and the switch is how they
                      get back out of it. */}
                  <button
                    type="button"
                    className="hf-fx-preset-run-toggle rounded-[3px] border border-panel-border-input px-1.5 py-0.5 font-mono text-[9px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
                    aria-pressed={runOn}
                    title={runOn ? `Switch ${preset.label} off` : `Switch ${preset.label} back on`}
                    disabled={disabled}
                    onClick={() => setRunAmount(run.items, runOn ? 0 : 1)}
                  >
                    {runOn ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    className="hf-fx-preset-run-remove px-1 font-mono text-[11px] text-panel-text-4 hover:text-red-400 disabled:opacity-40"
                    title={`Remove ${preset.label}`}
                    disabled={disabled}
                    onClick={() => removeRun(run.items)}
                  >
                    &times;
                  </button>
                </div>
                {/* The same value the switch sets, so an author can put the
                    preset half in — and the lane below ramps it continuously. */}
                <FxParamRow
                  param={PRESET_AMOUNT_PARAM}
                  value={runAmount}
                  disabled={disabled || presetAutomated.has(run.preset ?? "")}
                  automated={presetAutomated.has(run.preset ?? "")}
                  onChange={(_k, v) => setRunAmount(run.items, Number(v), false)}
                  onCommit={(_k, v) => setRunAmount(run.items, Number(v))}
                  onAutomate={
                    run.preset && onAutomatePreset && !presetAutomated.has(run.preset)
                      ? () => onAutomatePreset(run.preset ?? "", runAmount)
                      : undefined
                  }
                  onRemoveAutomation={
                    run.preset && onRemovePresetAutomation && presetAutomated.has(run.preset)
                      ? () => onRemovePresetAutomation(run.preset ?? "")
                      : undefined
                  }
                />
                {rows}
              </div>
            );
          })
        )}
        <p className="hf-fx-term hf-fx-term-out flex items-baseline gap-1.5 px-1.5 font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
          <span className="hf-fx-term-cap text-panel-text-1">Out</span>
          <span>to mix</span>
        </p>
      </div>

      {adding ? (
        <div
          className="hf-fx-add-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5"
          // On the shelf, not on each button: moving between two of them passes
          // through the gap, and a per-button leave would revert on the way.
          onMouseLeave={() => {
            audition(null);
            onAuditionLevel?.(false);
          }}
          // The keyboard's version of leaving. Tabbing between two entries fires
          // this and then the next one's focus, so it reverts and re-auditions.
          onBlur={() => {
            audition(null);
            onAuditionLevel?.(false);
          }}
        >
          <div className="hf-fx-add-group flex flex-wrap items-center gap-1">
            <span className="hf-fx-add-group-label w-full font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
              Tone
            </span>
            {onLevel ? (
              <button
                type="button"
                className="hf-fx-add-composite rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
                title="Listen to this track and even out its loud and quiet parts."
                disabled={disabled || analysing}
                onClick={() => {
                  if (levelled) onRemoveLevel?.();
                  else onLevel();
                  setAdding(false);
                }}
                // The one module here that cannot answer instantly: it has to
                // decode the track and measure it before there is anything to
                // hear. So it says it is working rather than doing nothing
                // visible, and whoever handles this must drop a result that
                // arrives after the pointer has gone.
                onMouseEnter={
                  levelled
                    ? undefined
                    : () => {
                        audition(null);
                        onAuditionLevel?.(true);
                      }
                }
                onFocus={levelled ? undefined : () => onAuditionLevel?.(true)}
              >
                {levelled ? "Remove levelling" : "Even Out Levels"}
                {auditioningLevel ? <span className="hf-fx-add-working"> measuring…</span> : null}
              </button>
            ) : null}
            <button
              type="button"
              // Not hf-fx-add-item: Tone is a composite over several filters,
              // not an entry in the effect registry, and a count of the registry
              // must not include it.
              className="hf-fx-add-composite rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
              title="Bass, middle and treble on one set of faders."
              // No audition of its own: a Tone module arrives with every band at
              // 0 dB, so there is nothing to hear until a fader moves, and a
              // hover that changes nothing teaches that hovering does nothing.
              // It still has to call the neighbours' auditions off.
              onMouseEnter={() => {
                audition(null);
                onAuditionLevel?.(false);
              }}
              onClick={addEq}
            >
              Tone (EQ)
            </button>
          </div>
          {grouped.map(({ group, defs, jobs }) => (
            <div key={group} className="hf-fx-add-group flex flex-wrap items-center gap-1">
              <span className="hf-fx-add-group-label w-full font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
                {GROUP_LABEL[group]}
              </span>
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  // Same class as any other entry: a job IS an effect, and one
                  // that looked special would read as a preset rather than as
                  // the thing the author is about to add.
                  className="hf-fx-add-item rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
                  title={job.does}
                  onClick={() => addJob(job)}
                  onMouseEnter={() => {
                    onAuditionLevel?.(false);
                    audition((base) => withJob(base, job));
                  }}
                  onFocus={() => audition((base) => withJob(base, job))}
                >
                  {job.label}
                </button>
              ))}
              {defs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="hf-fx-add-item rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
                  // The menu that adds it has to call it what the rack will call
                  // it, or the author picks "High-pass" and a module named
                  // "Remove Rumble" appears. The registry's own description
                  // stays as the tooltip beside the plain one: the mechanism is
                  // taught here rather than withheld.
                  title={
                    EFFECT_COPY[d.id] ? `${EFFECT_COPY[d.id]?.does} (${d.label})` : d.description
                  }
                  onClick={() => addEffect(d.id)}
                  // Cancels the levelling audition as well as starting its own.
                  // The shelf's leave handler only fires on the way OUT of the
                  // menu, so sliding from Even Out Levels straight to here left a
                  // measurement in flight — and it landed on top of this one, a
                  // levelled version of the chain as it was, written through a
                  // channel the document never sees.
                  onMouseEnter={() => {
                    onAuditionLevel?.(false);
                    audition((base) => withEffect(base, d.id));
                  }}
                  onFocus={() => audition((base) => withEffect(base, d.id))}
                >
                  {EFFECT_COPY[d.id]?.title ?? d.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {picking ? (
        <FxPresetMenu
          onPick={applyPreset}
          onAudition={
            onChainPreview
              ? (id) => {
                  const preset = id ? getAudioFxPreset(id) : null;
                  audition(preset ? (base) => applyAudioFxPreset(base, preset) : null);
                }
              : undefined
          }
        />
      ) : null}

      {adding || picking ? null : (
        <div className="flex gap-1">
          <button
            type="button"
            className="hf-fx-preset w-full rounded-[4px] border border-dashed border-panel-border-input py-1 text-[11px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
            disabled={disabled}
            onClick={() => setPicking(true)}
          >
            Presets
          </button>
          <button
            type="button"
            className="hf-fx-add w-full rounded-[4px] border border-dashed border-panel-border-input py-1 text-[11px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            Add effect
          </button>
        </div>
      )}
    </div>
  );
}
