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
  onSeekToTime?: (time: number) => void;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string) => void;
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
  onLivePreviewProps,
}: {
  element: DomEditSelection;
  gsapRuntimeValues: Record<string, number>;
  onCommitAnimatedProperty: CommitAnimatedProperty;
  onLivePreviewProps?: (element: DomEditSelection, props: Record<string, number>) => void;
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
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const rounded = Math.round(next[axis]);
      if (rounded !== Math.round(pose[axis])) onCommitAnimatedProperty(element, axis, rounded);
    }
  };
  const recenter = () => {
    for (const [prop, identity] of [
      ["rotationX", 0],
      ["rotationY", 0],
      ["rotationZ", 0],
      ["z", 0],
      ["scale", 1],
      ["transformPerspective", 0],
    ] as const) {
      void onCommitAnimatedProperty(element, prop, identity);
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
          onPoseDraft={livePreview}
          onPoseCommit={commitPose}
          onRecenter={recenter}
        />
        <p className="mt-1 text-center text-[9px] leading-snug text-neutral-600">
          Drag to tilt · Shift-drag to roll
        </p>
      </div>
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
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onLivePreviewProps,
}: PropertyPanel3dTransformProps) {
  const idFor = (prop: string) => resolveAnimIdForProp?.(prop) ?? gsapAnimId;
  // Collapsed by default — the cube + fields are tall, so don't eat panel space
  // until the user opens 3D.
  const [collapsed, setCollapsed] = useState(true);

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
              onLivePreviewProps={onLivePreviewProps}
            />
          )}
          <div className={RESPONSIVE_GRID}>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="Z"
                  value={formatPxMetricValue(gsapRuntimeValues.z ?? 0)}
                  scrub
                  onCommit={(next) => {
                    const v = parsePxMetricValue(next);
                    if (v != null && onCommitAnimatedProperty) {
                      void onCommitAnimatedProperty(element, "z", v);
                    }
                  }}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && (gsapAnimId || onCommitAnimatedProperty) && (
                <KeyframeNavigation
                  property="z"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() => {
                    if (onCommitAnimatedProperty) {
                      void onCommitAnimatedProperty(element, "z", gsapRuntimeValues?.z ?? 0);
                    }
                  }}
                  onRemoveKeyframe={(pct) => {
                    const id = idFor("z");
                    if (id) onRemoveKeyframe?.(id, pct);
                  }}
                  onConvertToKeyframes={() => {
                    const id = idFor("z");
                    if (id) onConvertToKeyframes?.(id);
                  }}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="Scale"
                  value={String(gsapRuntimeValues.scale ?? 1)}
                  scrub
                  onCommit={(next) => {
                    const v = Number.parseFloat(next);
                    if (Number.isFinite(v) && onCommitAnimatedProperty) {
                      void onCommitAnimatedProperty(element, "scale", v);
                    }
                  }}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && (gsapAnimId || onCommitAnimatedProperty) && (
                <KeyframeNavigation
                  property="scale"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() => {
                    if (onCommitAnimatedProperty) {
                      void onCommitAnimatedProperty(
                        element,
                        "scale",
                        gsapRuntimeValues?.scale ?? 1,
                      );
                    }
                  }}
                  onRemoveKeyframe={(pct) => {
                    const id = idFor("scale");
                    if (id) onRemoveKeyframe?.(id, pct);
                  }}
                  onConvertToKeyframes={() => {
                    const id = idFor("scale");
                    if (id) onConvertToKeyframes?.(id);
                  }}
                />
              )}
            </div>
            <MetricField
              label="RotX"
              value={`${gsapRuntimeValues.rotationX ?? 0}°`}
              onCommit={(next) => {
                const v = Number.parseFloat(next.replace("°", ""));
                if (Number.isFinite(v) && onCommitAnimatedProperty) {
                  void onCommitAnimatedProperty(element, "rotationX", v);
                }
              }}
            />
            <MetricField
              label="RotY"
              value={`${gsapRuntimeValues.rotationY ?? 0}°`}
              onCommit={(next) => {
                const v = Number.parseFloat(next.replace("°", ""));
                if (Number.isFinite(v) && onCommitAnimatedProperty) {
                  void onCommitAnimatedProperty(element, "rotationY", v);
                }
              }}
            />
            <MetricField
              label="RotZ"
              value={`${gsapRuntimeValues.rotationZ ?? 0}°`}
              onCommit={(next) => {
                const v = Number.parseFloat(next.replace("°", ""));
                if (Number.isFinite(v) && onCommitAnimatedProperty) {
                  void onCommitAnimatedProperty(element, "rotationZ", v);
                }
              }}
            />
            <MetricField
              label="Perspective"
              value={formatPxMetricValue(gsapRuntimeValues.transformPerspective ?? 0)}
              scrub
              onCommit={(next) => {
                const v = parsePxMetricValue(next);
                if (v != null && v >= 0 && onCommitAnimatedProperty) {
                  void onCommitAnimatedProperty(element, "transformPerspective", v);
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
