import type { DomEditSelection } from "./domEditingTypes";
import { STUDIO_KEYFRAMES_ENABLED } from "./manualEditingAvailability";
import { MetricField } from "./propertyPanelPrimitives";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { formatPxMetricValue, parsePxMetricValue, RESPONSIVE_GRID } from "./propertyPanelHelpers";

type KeyframeEntry = Array<{
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}> | null;

interface PropertyPanel3dTransformProps {
  gsapRuntimeValues: Record<string, number>;
  gsapAnimId: string | null;
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
}

export function PropertyPanel3dTransform({
  gsapRuntimeValues,
  gsapAnimId,
  gsapKeyframes,
  currentPct,
  elStart,
  elDuration,
  element,
  onCommitAnimatedProperty,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
}: PropertyPanel3dTransformProps) {
  return (
    <div className="mt-3 border-t border-neutral-800/40 pt-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
        3D Transform
      </div>
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
              onRemoveKeyframe={(pct) => gsapAnimId && onRemoveKeyframe?.(gsapAnimId, pct)}
              onConvertToKeyframes={() => gsapAnimId && onConvertToKeyframes?.(gsapAnimId)}
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
                  void onCommitAnimatedProperty(element, "scale", gsapRuntimeValues?.scale ?? 1);
                }
              }}
              onRemoveKeyframe={(pct) => gsapAnimId && onRemoveKeyframe?.(gsapAnimId, pct)}
              onConvertToKeyframes={() => gsapAnimId && onConvertToKeyframes?.(gsapAnimId)}
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
      </div>
    </div>
  );
}
