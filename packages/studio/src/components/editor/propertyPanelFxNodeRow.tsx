/**
 * One effect in the FX rack: its header controls, and its knobs when open.
 *
 * An entry in the chain, as opposed to a composite module — the carve and the
 * Tone EQ own several nodes each and have their own files.
 *
 * The row speaks the author's language, not the registry's. `EFFECT_COPY`
 * supplies the name and every knob's name, `SUMMARY` the sentence under it, and
 * the DSP name moves inside — it is a fact about the mechanism, so it belongs
 * with the mechanism. See `plans/audio-fx-ux/README.md` §Decided.
 */

import { useMemo, useState } from "react";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  type HfAudioFxDef,
  type HfAudioFxNode,
  type HfAudioFxParamValues,
} from "@hyperframes/core/audio-fx";
import { EFFECT_COPY, SUMMARY } from "@hyperframes/core/audio-fx-copy";
import { fxAutomationTarget } from "@hyperframes/core/audio-automation";
import { FxParams } from "./propertyPanelFxControls.js";
import { FxBandRuler } from "./propertyPanelFxBandRuler.js";

/**
 * The one control that carries the module, if it has one.
 *
 * "Two faces": a module opens on its name, a line about what it is for, and one
 * knob — the rest is one click away and never in the way. Nothing is hidden; it
 * is ordered.
 *
 * `primary` is either a real parameter key or the string "strength", which means
 * the module wants a single DERIVED control over several parameters — the
 * `PROFILES` idea, whose figures are proposed rather than measured and which has
 * not shipped. Until it does, those five effects (compressor, gate, saturate,
 * reverb, bitcrush) open on all of their controls, which is honest: the one knob
 * they want does not exist yet, and inventing one would be a knob that lies.
 */
function primaryParamOf(def: HfAudioFxDef): string | null {
  const primary = EFFECT_COPY[def.id]?.primary;
  // "strength" names no parameter, which is exactly what makes this work: the
  // day `PROFILES` ships and a derived `strength` knob really is in the
  // registry, this starts using it without being told.
  if (!primary) return null;
  return def.params.some((p) => p.key === primary) ? primary : null;
}

/**
 * The registry's definition with the plain names written over it.
 *
 * Over rather than instead of: the registry stays the authority on range, step,
 * unit and what is automatable, and only the words change. A parameter with no
 * copy keeps its own label rather than disappearing — `audioFxCopy.test.ts` is
 * what makes sure there is never one.
 */
function plainDef(def: HfAudioFxDef): HfAudioFxDef {
  const copy = EFFECT_COPY[def.id];
  if (!copy) return def;
  return {
    ...def,
    params: def.params.map((param) => {
      const plain = copy.params[param.key];
      if (!plain) return param;
      // The registry's hint explains the mechanism, which is still the better
      // tooltip than none — but the plain one wins where it exists.
      return { ...param, label: plain.label, ...(plain.hint ? { hint: plain.hint } : {}) };
    }),
  };
}

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
export function FxNodeRow({
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
  const registryDef = getAudioFxDef(node.type);
  const def = useMemo(() => (registryDef ? plainDef(registryDef) : null), [registryDef]);
  const primary = registryDef ? primaryParamOf(registryDef) : null;
  /** The same def cut down to the one knob, so the open face reuses every wire. */
  const onlyPrimary = useMemo(
    () => (def && primary ? { ...def, params: def.params.filter((p) => p.key === primary) } : def),
    [def, primary],
  );
  // Local, because nothing outside the row needs to know. Keyed by node id like
  // the row itself, so it stays with its effect across a reorder.
  const [details, setDetails] = useState(false);
  if (!registryDef || !def || !onlyPrimary) return null;
  const copy = EFFECT_COPY[node.type];
  const bypassed = node.enabled === false;
  const params = node.params ?? defaultAudioFxParams(node.type);
  // What this effect is doing to the sound, as a sentence. The rack is read top
  // to bottom far more often than any one module is opened, so this is the line
  // that decides whether an author can follow their own mix.
  const summary = SUMMARY[node.type]?.(params);
  return (
    <div
      className={`hf-fx-node rounded-[4px] border border-panel-border-input${bypassed ? " opacity-50" : ""}`}
      data-fx-node={node.type}
    >
      <FxNodeHeader
        // The node's own job name when a preset gave it one, because that is the
        // most specific truth available: a chain that cuts mud and then lifts
        // clarity must not show the same name twice. Then the plain name, and
        // the registry's only if an effect somehow has no copy.
        label={node.label ?? EFFECT_COPY[node.type]?.title ?? registryDef.label}
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
      {summary ? (
        <p className="hf-fx-node-summary truncate px-1.5 pb-1 text-[10px] text-panel-text-4">
          {summary}
        </p>
      ) : null}
      {open ? (
        <>
          {/* What it is for, before what it is made of. */}
          {copy?.does ? (
            <p className="hf-fx-node-does border-t border-panel-border-input px-1.5 py-1 text-[10px] text-panel-text-4">
              {copy.does}
            </p>
          ) : null}
          {primary && !details ? (
            <>
              <FxNodeParams
                node={node}
                def={onlyPrimary}
                index={index}
                disabled={Boolean(disabled) || bypassed}
                automatedTargets={automatedTargets}
                liveAutomationValues={liveAutomationValues}
                onUpdate={onUpdate}
                onPreview={onPreview}
                onAutomateParam={onAutomateParam}
                onRemoveParamAutomation={onRemoveParamAutomation}
              />
              {/* What the two ends of that knob sound like. A number tells an
                  author where the control is; this tells them which way to move
                  it, which is the question they actually have. */}
              {copy?.primaryEnds ? (
                <p className="hf-fx-node-ends flex justify-between gap-2 px-1.5 pb-1 text-[9px] text-panel-text-4">
                  <span className="truncate">{copy.primaryEnds.low}</span>
                  <span className="truncate text-right">{copy.primaryEnds.high}</span>
                </p>
              ) : null}
              {/* Where it is working, in the words the rack shares. Only for a
                  module that acts on a range at all — there is nothing spectral
                  about a limiter, and a ruler under one would be noise. */}
              {copy?.band && typeof params.frequency === "number" ? (
                <FxBandRuler band={copy.band} at={params.frequency} />
              ) : null}
            </>
          ) : null}
          {/* The DSP name lives on the disclosure, so it is read at the moment
              the author asks what this really is — and never before. */}
          {primary ? (
            <button
              type="button"
              className="hf-fx-node-details flex w-full items-center gap-1 border-t border-panel-border-input px-1.5 py-1 text-left font-mono text-[9px] uppercase tracking-wide text-panel-text-4 hover:text-panel-text-0"
              aria-expanded={details}
              onClick={() => setDetails((was) => !was)}
            >
              <span aria-hidden="true">{details ? "\u25BE" : "\u25B8"}</span>
              Details — {registryDef.label}
            </button>
          ) : (
            <p className="hf-fx-node-mechanism border-t border-panel-border-input px-1.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
              Details — {registryDef.label}
            </p>
          )}
          {details || !primary ? (
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
        </>
      ) : null}
    </div>
  );
}
