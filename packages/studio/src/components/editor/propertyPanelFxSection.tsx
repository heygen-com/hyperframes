/**
 * The FX section for an audio element: the chain, plus the voiceover carve.
 *
 * Carve is deliberately not an entry in the chain. It is a relationship between
 * two tracks — it analyses a voice and dips *this* bed where that voice sits —
 * so it gets its own block with a source picker, the way a sidechain control
 * lives on the track being processed. What it produces is an ordinary chain of
 * peaking filters, so it composes with whatever else is on the track.
 */

import { useCallback, useMemo, useState } from "react";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  HF_AUDIO_FX,
  type HfAudioFxChain,
  type HfAudioFxGroup,
  type HfAudioFxNode,
  type HfAudioFxParamValues,
} from "@hyperframes/core/audio-fx";
import { DEFAULT_CARVE, type HfCarveSettings } from "@hyperframes/core/audio-carve";
import { FxParams, FxParamRow } from "./propertyPanelFxControls.js";

const GROUP_ORDER: HfAudioFxGroup[] = ["filter", "dynamics", "nonlinear", "time"];
const GROUP_LABEL: Record<HfAudioFxGroup, string> = {
  filter: "Filters",
  dynamics: "Dynamics",
  nonlinear: "Non-linear",
  time: "Time",
};

export interface AudioTrackOption {
  id: string;
  label: string;
}

interface FxNodeRowProps {
  node: HfAudioFxNode;
  index: number;
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

/** One effect in the chain: its header controls, and its knobs when open. */
function FxNodeRow({
  node,
  index,
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
        label={def.label}
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
        <FxParams
          def={def}
          params={node.params ?? defaultAudioFxParams(node.type)}
          disabled={disabled || bypassed}
          onChange={(params: HfAudioFxParamValues) => onPreview(index, params)}
          onCommit={(params: HfAudioFxParamValues) => onUpdate(index, { params })}
        />
      ) : null}
    </div>
  );
}

export interface FxSectionProps {
  chain: HfAudioFxChain;
  /** Structural edits and gesture-end writes; this is the one that persists. */
  onChainChange(chain: HfAudioFxChain): void;
  /** Continuous updates while a control is being dragged. */
  onChainPreview?(chain: HfAudioFxChain): void;
  carve: HfCarveSettings | null;
  onCarveChange(carve: HfCarveSettings | null): void;
  /** Other audio elements that could act as the carve source. */
  sourceOptions: AudioTrackOption[];
  /** Re-run analysis against the current source audio. */
  onAnalyseCarve?(): void;
  analysing?: boolean;
  disabled?: boolean;
}

export function FxSection({
  chain,
  onChainChange,
  onChainPreview,
  carve,
  onCarveChange,
  sourceOptions,
  onAnalyseCarve,
  analysing,
  disabled,
}: FxSectionProps) {
  const [adding, setAdding] = useState(false);
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

  const addEffect = useCallback(
    (type: string) => {
      mutate([...chain.nodes, { type, enabled: true, params: defaultAudioFxParams(type) }]);
      setOpenNode(chain.nodes.length);
      setAdding(false);
    },
    [chain.nodes, mutate],
  );

  const updateNode = useCallback(
    (index: number, patch: Partial<HfAudioFxNode>) =>
      mutate(chain.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n))),
    [chain.nodes, mutate],
  );

  const removeNode = useCallback(
    (index: number) => {
      mutate(chain.nodes.filter((_, i) => i !== index));
      setOpenNode(null);
    },
    [chain.nodes, mutate],
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
        {chain.nodes.length === 0 ? (
          <p className="hf-fx-empty py-1 text-[11px] text-panel-text-4">
            No effects on this track.
          </p>
        ) : (
          chain.nodes.map((node, i) => (
            <FxNodeRow
              key={`${node.type}-${i}`}
              node={node}
              index={i}
              open={openNode === i}
              last={i === chain.nodes.length - 1}
              disabled={disabled}
              onToggleOpen={() => setOpenNode(openNode === i ? null : i)}
              onUpdate={updateNode}
              onMove={moveNode}
              onRemove={removeNode}
              onPreview={previewNode}
            />
          ))
        )}
      </div>

      {adding ? (
        <div className="hf-fx-add-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5">
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
      ) : (
        <button
          type="button"
          className="hf-fx-add w-full rounded-[4px] border border-dashed border-panel-border-input py-1 text-[11px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          Add effect
        </button>
      )}

      <div className="hf-fx-carve space-y-1 rounded-[4px] border border-panel-border-input p-1.5">
        <div className="hf-fx-carve-head flex min-h-6 items-center justify-between">
          <span className="hf-fx-carve-title text-[11px] font-semibold text-panel-text-1">
            Voiceover carve
          </span>
          <button
            type="button"
            className="hf-fx-bypass rounded-[3px] border border-panel-border-input px-1.5 py-0.5 font-mono text-[9px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
            aria-pressed={carve !== null}
            disabled={disabled}
            onClick={() => onCarveChange(carve ? null : { ...DEFAULT_CARVE })}
          >
            {carve ? "On" : "Off"}
          </button>
        </div>
        {carve ? (
          <>
            <label className="hf-fx-row flex min-h-6 items-center gap-2">
              <span className="hf-fx-label w-[86px] flex-shrink-0 truncate text-[10px] text-panel-text-4">
                Listen to
              </span>
              <select
                className="hf-fx-select min-w-0 flex-1 rounded-[3px] bg-panel-surface px-1 py-0.5 font-mono text-[10px] text-panel-text-0"
                value={carve.source}
                disabled={disabled}
                onChange={(e) => onCarveChange({ ...carve, source: e.target.value })}
              >
                <option value="">Select a voice track…</option>
                {sourceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <FxParamRow
              param={{
                kind: "number",
                key: "maxCutDb",
                label: "Depth",
                unit: "dB",
                min: 0,
                max: 24,
                step: 0.5,
                default: DEFAULT_CARVE.maxCutDb,
              }}
              value={carve.maxCutDb}
              disabled={disabled}
              onChange={(_k, v) => onCarveChange({ ...carve, maxCutDb: Number(v) })}
            />
            <FxParamRow
              param={{
                kind: "number",
                key: "bands",
                label: "Bands",
                unit: "",
                min: 1,
                max: 6,
                step: 1,
                default: DEFAULT_CARVE.bands,
              }}
              value={carve.bands}
              disabled={disabled}
              onChange={(_k, v) => onCarveChange({ ...carve, bands: Number(v) })}
            />
            <FxParamRow
              param={{
                kind: "number",
                key: "intelligibilityBias",
                label: "Speech bias",
                unit: "",
                min: 0,
                max: 1,
                step: 0.05,
                default: DEFAULT_CARVE.intelligibilityBias,
                hint: "At 0 the deepest cuts follow raw voice energy, which lands on the fundamental. Higher weights selection toward 1-3 kHz, where a bed actually masks a voice.",
              }}
              value={carve.intelligibilityBias}
              disabled={disabled}
              onChange={(_k, v) => onCarveChange({ ...carve, intelligibilityBias: Number(v) })}
            />
            <button
              type="button"
              className="hf-fx-analyse mt-1 w-full rounded-[3px] bg-panel-surface py-1 text-[10px] text-panel-text-1 hover:text-panel-text-0 disabled:opacity-40"
              disabled={disabled || analysing || !carve.source || !onAnalyseCarve}
              onClick={() => onAnalyseCarve?.()}
            >
              {analysing ? "Analysing…" : "Analyse and apply"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
