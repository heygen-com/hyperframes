import { useState } from "react";
import type { DomEditSelection } from "./domEditingTypes";
import { STUDIO_KEYFRAMES_ENABLED } from "./manualEditingAvailability";
import { MetricField } from "./propertyPanelPrimitives";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { formatPxMetricValue, parsePxMetricValue, RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { Transform3DCube, type CubePose } from "./Transform3DCube";

type KeyframeEntry = Array<{
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}> | null;

interface PropertyPanel3dTransformProps {
  gsapRuntimeValues: Record<string, number>;
  gsapAnimId: string | null;
  resolveAnimIdForProp?: (prop: string) => string | null;
  gsapKeyframes: KeyframeEntry;
  currentPct: number;
  elStart: number;
  elDuration: number;
  element: DomEditSelection;
  onCommitAnimatedProperty?: (
    element: DomEditSelection,
    property: string,
    value: number,
  ) => Promise<void>;
  /** Batched commit — several props into one keyframe (the cube's rotationX/Y/Z). */
  onCommitAnimatedProperties?: (
    element: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string, duration?: number) => void;
  /** Live-set props on the preview element during a cube drag (no source write). */
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
}

type CommitAnimatedProperty = (
  element: DomEditSelection,
  property: string,
  value: number,
) => Promise<void>;

/** The draggable cube + its commit/recenter/live-preview wiring. */
function Cube3dControl({
  element,
  gsapRuntimeValues,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onLivePreviewProps,
  onKeyframe,
  keyframed,
}: {
  element: DomEditSelection;
  gsapRuntimeValues: Record<string, number>;
  onCommitAnimatedProperty: CommitAnimatedProperty;
  onCommitAnimatedProperties?: (
    element: DomEditSelection,
    props: Record<string, number | string>,
  ) => Promise<void>;
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
  onKeyframe?: () => void;
  keyframed?: boolean;
}) {
  const pose: CubePose = {
    rotationX: gsapRuntimeValues.rotationX ?? 0,
    rotationY: gsapRuntimeValues.rotationY ?? 0,
    rotationZ: gsapRuntimeValues.rotationZ ?? 0,
  };
  // Commit only the rotation axes the drag actually changed (each rounded to a
  // whole degree). Reuses the keyframe-aware animated-property commit, so a drag
  // at the playhead writes/updates a keyframe just like the numeric fields.
  const commitPose = (next: CubePose) => {
    const changedProps: Record<string, number> = {};
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const rounded = Math.round(next[axis]);
      if (rounded !== Math.round(pose[axis])) changedProps[axis] = rounded;
    }
    const axes = Object.keys(changedProps);
    if (axes.length === 0) return;
    // ONE keyframe for the whole pose change — avoids per-axis commits racing into
    // adjacent duplicate keyframes. Fall back to per-axis if no batched commit.
    if (onCommitAnimatedProperties) {
      void onCommitAnimatedProperties(element, changedProps);
    } else {
      for (const [axis, v] of Object.entries(changedProps))
        onCommitAnimatedProperty(element, axis, v);
    }
  };
  const recenter = () => {
    // ONE commit for the whole reset — six per-axis commits meant six soft-reloads
    // (six flashes) for a single click. Batch like commitPose does.
    const identity = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      z: 0,
      scale: 1,
      transformPerspective: 0,
    };
    if (onCommitAnimatedProperties) {
      void onCommitAnimatedProperties(element, identity);
    } else {
      for (const [prop, v] of Object.entries(identity))
        void onCommitAnimatedProperty(element, prop, v);
    }
  };
  // Immediate element feedback while dragging — set the live transform without a
  // source write; the release commits via onCommitAnimatedProperty.
  const livePreview = (next: CubePose) =>
    onLivePreviewProps?.(element, {
      rotationX: next.rotationX,
      rotationY: next.rotationY,
      rotationZ: next.rotationZ,
    });

  return (
    <div className="mb-2 px-2">
      <div className="mx-auto max-w-[184px]">
        <Transform3DCube
          pose={pose}
          perspective={gsapRuntimeValues.transformPerspective ?? 0}
          onPoseDraft={livePreview}
          onPoseCommit={commitPose}
          onPerspectiveDraft={(px) => onLivePreviewProps?.(element, { transformPerspective: px })}
          onPerspectiveCommit={(px) =>
            void onCommitAnimatedProperty(element, "transformPerspective", px)
          }
          onRecenter={recenter}
          onKeyframe={onKeyframe}
          keyframed={keyframed}
        />
        <p className="mt-1 text-center text-[9px] leading-snug text-neutral-600">
          Drag to tilt · Shift-drag to roll
        </p>
      </div>
    </div>
  );
}

interface FieldCtx {
  element: DomEditSelection;
  gsapRuntimeValues: Record<string, number>;
  gsapKeyframes: KeyframeEntry;
  gsapAnimId: string | null;
  currentPct: number;
  elStart: number;
  elDuration: number;
  resolveAnimIdForProp?: (prop: string) => string | null;
  onCommitAnimatedProperty?: (
    element: DomEditSelection,
    property: string,
    value: number,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string, duration?: number) => void;
}

const parseDeg = (s: string): number | null => {
  const n = Number.parseFloat(s.replace("°", ""));
  return Number.isFinite(n) ? n : null;
};
const parseScale = (s: string): number | null => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const parsePxNonNeg = (s: string): number | null => {
  const v = parsePxMetricValue(s);
  return v != null && v >= 0 ? v : null;
};

/**
 * One 3D-transform field: a number/scrub input plus its keyframe diamond, so
 * rotation / perspective / Z / scale can each be keyframed just like Layout's
 * X / Y — the diamond was previously missing on the rotation + perspective rows.
 */
function Transform3dField({
  label,
  prop,
  scrub,
  format,
  parse,
  defaultValue,
  ctx,
}: {
  label: string;
  prop: string;
  scrub?: boolean;
  format: (v: number) => string;
  parse: (s: string) => number | null;
  defaultValue: number;
  ctx: FieldCtx;
}) {
  const { gsapAnimId, onCommitAnimatedProperty } = ctx;
  const idFor = (p: string) => ctx.resolveAnimIdForProp?.(p) ?? gsapAnimId;
  const current = ctx.gsapRuntimeValues[prop] ?? defaultValue;
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1">
        <MetricField
          label={label}
          value={format(current)}
          scrub={scrub}
          onCommit={(next) => {
            const v = parse(next);
            if (v != null && onCommitAnimatedProperty) {
              void onCommitAnimatedProperty(ctx.element, prop, v);
            }
          }}
        />
      </div>
      {STUDIO_KEYFRAMES_ENABLED && (gsapAnimId || onCommitAnimatedProperty) && (
        <KeyframeNavigation
          property={prop}
          keyframes={ctx.gsapKeyframes}
          currentPercentage={ctx.currentPct}
          onSeek={(pct) => ctx.onSeekToTime?.(ctx.elStart + (pct / 100) * ctx.elDuration)}
          onAddKeyframe={() => {
            if (onCommitAnimatedProperty) void onCommitAnimatedProperty(ctx.element, prop, current);
          }}
          onRemoveKeyframe={(pct) => {
            const id = idFor(prop);
            if (id) ctx.onRemoveKeyframe?.(id, pct);
          }}
          onConvertToKeyframes={() => {
            const id = idFor(prop);
            // Pass the element's clip duration so a converted static 3D `set`
            // spans the whole clip (keyframes land in range at any playhead).
            if (id) ctx.onConvertToKeyframes?.(id, ctx.elDuration);
          }}
        />
      )}
    </div>
  );
}

export function PropertyPanel3dTransform({
  gsapRuntimeValues,
  gsapAnimId,
  resolveAnimIdForProp,
  gsapKeyframes,
  currentPct,
  elStart,
  elDuration,
  element,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onLivePreviewProps,
}: PropertyPanel3dTransformProps) {
  // Expanded by default — the cube gizmo is the headline of this panel, so show
  // it up front rather than hiding it behind a collapsed header.
  const [collapsed, setCollapsed] = useState(false);
  const ctx: FieldCtx = {
    element,
    gsapRuntimeValues,
    gsapKeyframes,
    gsapAnimId,
    currentPct,
    elStart,
    elDuration,
    resolveAnimIdForProp,
    onCommitAnimatedProperty,
    onSeekToTime,
    onRemoveKeyframe,
    onConvertToKeyframes,
  };

  return (
    <div className="mt-3 border-t border-neutral-800/40 pt-3">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-[10px] font-medium uppercase tracking-wider text-neutral-600 hover:text-neutral-400"
      >
        <span>3D Transform</span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
          {collapsed ? <path d="M3 2l4 3-4 3z" /> : <path d="M2 3l3 4 3-4z" />}
        </svg>
      </button>
      {collapsed ? null : (
        <>
          {onCommitAnimatedProperty && (
            <Cube3dControl
              element={element}
              gsapRuntimeValues={gsapRuntimeValues}
              onCommitAnimatedProperty={onCommitAnimatedProperty}
              onCommitAnimatedProperties={onCommitAnimatedProperties}
              onLivePreviewProps={onLivePreviewProps}
              keyframed={(gsapKeyframes ?? []).some(
                (kf) =>
                  "rotationX" in kf.properties ||
                  "rotationY" in kf.properties ||
                  "rotationZ" in kf.properties,
              )}
              onKeyframe={() => {
                // Convert the 3D ("other"-group) static set to keyframes so the
                // cube can animate; spans the element's clip via elDuration.
                const id = resolveAnimIdForProp?.("rotationX") ?? gsapAnimId;
                if (id) onConvertToKeyframes?.(id, elDuration);
              }}
            />
          )}
          <div className={RESPONSIVE_GRID}>
            <Transform3dField
              ctx={ctx}
              label="Z"
              prop="z"
              scrub
              format={formatPxMetricValue}
              parse={parsePxMetricValue}
              defaultValue={0}
            />
            <Transform3dField
              ctx={ctx}
              label="Scale"
              prop="scale"
              scrub
              format={(v) => String(v)}
              parse={parseScale}
              defaultValue={1}
            />
            <Transform3dField
              ctx={ctx}
              label="RotX"
              prop="rotationX"
              format={(v) => `${v}°`}
              parse={parseDeg}
              defaultValue={0}
            />
            <Transform3dField
              ctx={ctx}
              label="RotY"
              prop="rotationY"
              format={(v) => `${v}°`}
              parse={parseDeg}
              defaultValue={0}
            />
            <Transform3dField
              ctx={ctx}
              label="RotZ"
              prop="rotationZ"
              format={(v) => `${v}°`}
              parse={parseDeg}
              defaultValue={0}
            />
            <Transform3dField
              ctx={ctx}
              label="Perspective"
              prop="transformPerspective"
              scrub
              format={formatPxMetricValue}
              parse={parsePxNonNeg}
              defaultValue={0}
            />
          </div>
        </>
      )}
    </div>
  );
}
