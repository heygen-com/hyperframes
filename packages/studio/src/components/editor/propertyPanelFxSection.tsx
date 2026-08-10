/**
 * The FX section for an audio element: the chain, plus the voiceover carve.
 *
 * The carve is its own module — see `propertyPanelFxCarveModule.tsx` for why it
 * is not an entry in the chain.
 */

import { useCallback, useMemo, useState } from "react";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  HF_AUDIO_FX,
  mintAudioFxNodeId,
  type HfAudioFxChain,
  type HfAudioFxDef,
  type HfAudioFxGroup,
  type HfAudioFxNode,
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
import { fxAutomationTarget } from "@hyperframes/core/audio-automation";
import { FxParams } from "./propertyPanelFxControls.js";
import { FxPresetMenu } from "./propertyPanelFxPresetMenu.js";
import { FxEqModule } from "./propertyPanelFxEqModule.js";
import { FxCarveModule, type AudioTrackOption } from "./propertyPanelFxCarveModule.js";

export type { AudioTrackOption };

const GROUP_ORDER: HfAudioFxGroup[] = ["filter", "dynamics", "nonlinear", "time"];
const GROUP_LABEL: Record<HfAudioFxGroup, string> = {
  filter: "Filters",
  dynamics: "Dynamics",
  nonlinear: "Non-linear",
  time: "Time",
};

interface FxNodeRowProps {
  node: HfAudioFxNode;
  index: number;
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
  onAutomateParam?(nodeId: string, paramKey: string): void;
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
  open: boolean;
  /** Last in the chain, so it cannot move further down. */
  last: boolean;
  disabled?: boolean;
  onToggleOpen(): void;
  onUpdate(index: number, patch: Partial<HfAudioFxNode>): void;
  onMove(index: number, delta: number): void;
  onRemove(index: number): void;
  onPreview(index: number, params: HfAudioFxParamValues): void;
}

/** Reorder arrow. Disabled at the end of the chain it would move past. */
function FxMoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="hf-fx-move px-1 font-mono text-[10px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-25"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
}

/** Name, bypass, reorder and remove for one effect. */
function FxNodeHeader({
  label,
  open,
  bypassed,
  first,
  last,
  disabled,
  onToggleOpen,
  onToggleBypass,
  onMove,
  onRemove,
}: {
  label: string;
  open: boolean;
  bypassed: boolean;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  onToggleOpen(): void;
  onToggleBypass(): void;
  onMove(delta: number): void;
  onRemove(): void;
}) {
  return (
    <div className="hf-fx-node-head flex min-h-7 items-center gap-1 px-1.5">
      <button
        type="button"
        className="hf-fx-node-name flex-1 truncate text-left text-[11px] font-semibold text-panel-text-1 hover:text-panel-text-0"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        {label}
      </button>
      <button
        type="button"
        className="hf-fx-bypass rounded-[3px] border border-panel-border-input px-1.5 py-0.5 font-mono text-[9px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
        aria-pressed={bypassed}
        title={bypassed ? "Enable" : "Bypass"}
        disabled={disabled}
        onClick={onToggleBypass}
      >
        {bypassed ? "Off" : "On"}
      </button>
      <FxMoveButton
        label="Move up"
        glyph="&uarr;"
        disabled={Boolean(disabled) || first}
        onClick={() => onMove(-1)}
      />
      <FxMoveButton
        label="Move down"
        glyph="&darr;"
        disabled={Boolean(disabled) || last}
        onClick={() => onMove(1)}
      />
      <button
        type="button"
        className="hf-fx-remove px-1 font-mono text-[11px] text-panel-text-4 hover:text-red-400 disabled:opacity-40"
        title="Remove"
        disabled={disabled}
        onClick={onRemove}
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Which of an effect's knobs already have a lane.
 *
 * A lane addresses a node by id, so a node the panel has not yet given one
 * cannot be automated at all. Adding an effect mints the id, so this only
 * affects chains written before ids existed.
 */
function automatedKeysOf(
  node: HfAudioFxNode,
  params: readonly { key: string }[],
  automatedTargets: ReadonlySet<string> | undefined,
): Set<string> {
  if (!node.id || !automatedTargets) return new Set();
  const nodeId = node.id;
  return new Set(
    params.filter((p) => automatedTargets.has(fxAutomationTarget(nodeId, p.key))).map((p) => p.key),
  );
}

/** An open effect's knobs, with whatever automation surface applies to them. */
function FxNodeParams({
  node,
  def,
  index,
  disabled,
  automatedTargets,
  liveAutomationValues,
  onUpdate,
  onPreview,
  onAutomateParam,
  onRemoveParamAutomation,
}: {
  node: HfAudioFxNode;
  def: HfAudioFxDef;
  index: number;
  disabled: boolean;
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
  onUpdate(index: number, patch: Partial<HfAudioFxNode>): void;
  onPreview(index: number, params: HfAudioFxParamValues): void;
  onAutomateParam?(nodeId: string, paramKey: string): void;
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
}) {
  const nodeId = node.id;
  // Lanes address a node by id; the controls know their own parameter keys. This
  // is the one place that translation belongs.
  const liveValues = ((): Map<string, number> | undefined => {
    if (!nodeId || !liveAutomationValues?.size) return undefined;
    const byKey = new Map<string, number>();
    for (const param of def.params) {
      const live = liveAutomationValues.get(fxAutomationTarget(nodeId, param.key));
      if (live !== undefined) byKey.set(param.key, live);
    }
    return byKey;
  })();
  return (
    <FxParams
      def={def}
      params={node.params ?? defaultAudioFxParams(node.type)}
      liveValues={liveValues}
      disabled={disabled}
      onChange={(params: HfAudioFxParamValues) => onPreview(index, params)}
      onCommit={(params: HfAudioFxParamValues) => onUpdate(index, { params })}
      automatedKeys={automatedKeysOf(node, def.params, automatedTargets)}
      onAutomate={nodeId && onAutomateParam ? (key) => onAutomateParam(nodeId, key) : undefined}
      onRemoveAutomation={
        nodeId && onRemoveParamAutomation
          ? (key) => onRemoveParamAutomation(nodeId, key)
          : undefined
      }
    />
  );
}

/** One effect in the chain: its header controls, and its knobs when open. */
function FxNodeRow({
  node,
  index,
  automatedTargets,
  liveAutomationValues,
  onAutomateParam,
  onRemoveParamAutomation,
  open,
  last,
  disabled,
  onToggleOpen,
  onUpdate,
  onMove,
  onRemove,
  onPreview,
}: FxNodeRowProps) {
  const def = getAudioFxDef(node.type);
  if (!def) return null;
  const bypassed = node.enabled === false;
  return (
    <div
      className={`hf-fx-node rounded-[4px] border border-panel-border-input${bypassed ? " opacity-50" : ""}`}
      data-fx-node={node.type}
    >
      <FxNodeHeader
        // The node's own job name when a preset gave it one: a chain that cuts
        // mud and then lifts clarity must not show "Peaking EQ" twice.
        label={node.label ?? def.label}
        open={open}
        bypassed={bypassed}
        first={index === 0}
        last={last}
        disabled={disabled}
        onToggleOpen={onToggleOpen}
        onToggleBypass={() => onUpdate(index, { enabled: bypassed })}
        onMove={(delta) => onMove(index, delta)}
        onRemove={() => onRemove(index)}
      />
      {open ? (
        <FxNodeParams
          node={node}
          def={def}
          index={index}
          disabled={Boolean(disabled) || bypassed}
          automatedTargets={automatedTargets}
          liveAutomationValues={liveAutomationValues}
          onUpdate={onUpdate}
          onPreview={onPreview}
          onAutomateParam={onAutomateParam}
          onRemoveParamAutomation={onRemoveParamAutomation}
        />
      ) : null}
    </div>
  );
}

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
  /** Measure this track and write the levelling lane. Absent when unavailable. */
  onLevel?(): void;
  /** Take the levelling stage and its lane back out. */
  onRemoveLevel?(): void;
  /** Whether a levelling stage is already on the track. */
  levelled?: boolean;
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
}: FxSectionProps) {
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

  const grouped = useMemo(
    () => GROUP_ORDER.map((g) => ({ group: g, defs: HF_AUDIO_FX.filter((d) => d.group === g) })),
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

  const applyPreset = useCallback(
    (id: string) => {
      const preset = getAudioFxPreset(id);
      if (!preset) return;
      // Appends. Stacking a character preset onto an already-cleaned voice is a
      // real thing to want, and replacing silently would throw work away — so
      // the destructive option is a separate gesture, not the default one.
      const next = applyAudioFxPreset(chain, preset);
      mutate(next.nodes);
      // Land on the first node the preset wrote, so the author can hear what
      // arrived and immediately see what it is made of.
      setOpenNode(next.nodes.findIndex((n) => n.fromPreset === preset.id));
      setPicking(false);
    },
    [chain, mutate],
  );

  const addEffect = useCallback(
    (type: string) => {
      mutate([
        ...chain.nodes,
        { type, id: mintAudioFxNodeId(chain), enabled: true, params: defaultAudioFxParams(type) },
      ]);
      setOpenNode(chain.nodes.length);
      setAdding(false);
    },
    [chain, mutate],
  );

  const updateNode = useCallback(
    (index: number, patch: Partial<HfAudioFxNode>) =>
      mutate(chain.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n))),
    [chain.nodes, mutate],
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

  const eqIds = useMemo(() => audioEqIds(chain), [chain]);
  const [openEq, setOpenEq] = useState<string | null>(null);

  const addEq = useCallback(() => {
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
          handBuilt.map(({ node, i }) => {
            return (
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
            );
          })
        )}
      </div>

      {adding ? (
        <div className="hf-fx-add-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5">
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
              >
                {levelled ? "Remove levelling" : "Even Out Levels"}
              </button>
            ) : null}
            <button
              type="button"
              // Not hf-fx-add-item: Tone is a composite over several filters,
              // not an entry in the effect registry, and a count of the registry
              // must not include it.
              className="hf-fx-add-composite rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
              title="Bass, middle and treble on one set of faders."
              onClick={addEq}
            >
              Tone (EQ)
            </button>
          </div>
          {grouped.map(({ group, defs }) => (
            <div key={group} className="hf-fx-add-group flex flex-wrap items-center gap-1">
              <span className="hf-fx-add-group-label w-full font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
                {GROUP_LABEL[group]}
              </span>
              {defs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="hf-fx-add-item rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
                  title={d.description}
                  onClick={() => addEffect(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {picking ? <FxPresetMenu onPick={applyPreset} /> : null}

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
