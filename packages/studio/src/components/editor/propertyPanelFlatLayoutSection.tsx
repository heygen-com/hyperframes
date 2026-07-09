import { FlatRow } from "./propertyPanelFlatPrimitives";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { formatPxMetricValue } from "./propertyPanelHelpers";
import { STUDIO_KEYFRAMES_ENABLED } from "./manualEditingAvailability";

type KeyframeEntry = Array<{
  percentage: number;
  tweenPercentage?: number;
  properties: Record<string, number | string>;
  ease?: string;
}> | null;

interface GeometryRowsProps {
  displayX: number;
  displayY: number;
  displayW: number;
  displayH: number;
  displayR: number;
  manualOffsetEditingDisabled: boolean;
  manualSizeEditingDisabled: boolean;
  manualRotationEditingDisabled: boolean;
  commitManualOffset: (axis: "x" | "y", value: string) => void;
  commitManualSize: (dimension: "width" | "height", value: string) => void;
  commitManualRotation: (value: string) => void;
  gsapAnimId: string | null;
  navKeyframes: KeyframeEntry;
  currentPct: number;
  seekFromKfPct: (pct: number) => void;
  animIdForProp: (prop: string) => string;
  onCommitAnimatedProperty?: (
    element: unknown,
    property: string,
    value: number,
  ) => void | Promise<void>;
  onRemoveKeyframe?: (animId: string, pct: number) => void;
  onConvertToKeyframes?: (animId: string) => void;
}

function KeyframeGutter({
  property,
  displayValue,
  gsapAnimId,
  navKeyframes,
  currentPct,
  seekFromKfPct,
  animIdForProp,
  onCommitAnimatedProperty,
  onRemoveKeyframe,
  onConvertToKeyframes,
}: {
  property: string;
  displayValue: number;
} & Pick<
  GeometryRowsProps,
  | "gsapAnimId"
  | "navKeyframes"
  | "currentPct"
  | "seekFromKfPct"
  | "animIdForProp"
  | "onCommitAnimatedProperty"
  | "onRemoveKeyframe"
  | "onConvertToKeyframes"
>) {
  if (!STUDIO_KEYFRAMES_ENABLED || !gsapAnimId) return null;
  const hasKeyframesOnProp = Boolean(navKeyframes?.some((kf) => property in kf.properties));
  return (
    <span data-flat-kf-gutter="true" style={{ opacity: hasKeyframesOnProp ? 1 : 0.3 }}>
      <KeyframeNavigation
        property={property}
        keyframes={navKeyframes}
        currentPercentage={currentPct}
        onSeek={seekFromKfPct}
        onAddKeyframe={() =>
          onCommitAnimatedProperty && void onCommitAnimatedProperty(null, property, displayValue)
        }
        onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp(property), pct)}
        onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp(property))}
      />
    </span>
  );
}

export function LayoutGeometryRows({
  displayX,
  displayY,
  displayW,
  displayH,
  displayR,
  manualOffsetEditingDisabled,
  manualSizeEditingDisabled,
  manualRotationEditingDisabled,
  commitManualOffset,
  commitManualSize,
  commitManualRotation,
  gsapAnimId,
  navKeyframes,
  currentPct,
  seekFromKfPct,
  animIdForProp,
  onCommitAnimatedProperty,
  onRemoveKeyframe,
  onConvertToKeyframes,
}: GeometryRowsProps) {
  const gutterProps = {
    gsapAnimId,
    navKeyframes,
    currentPct,
    seekFromKfPct,
    animIdForProp,
    onCommitAnimatedProperty,
    onRemoveKeyframe,
    onConvertToKeyframes,
  };
  return (
    <>
      <FlatRow
        label="X"
        value={formatPxMetricValue(displayX)}
        tier={displayX === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        onCommit={(next) => commitManualOffset("x", next)}
        suffix={<KeyframeGutter property="x" displayValue={displayX} {...gutterProps} />}
      />
      <FlatRow
        label="Y"
        value={formatPxMetricValue(displayY)}
        tier={displayY === 0 ? "default" : "explicitCustom"}
        disabled={manualOffsetEditingDisabled}
        onCommit={(next) => commitManualOffset("y", next)}
        suffix={<KeyframeGutter property="y" displayValue={displayY} {...gutterProps} />}
      />
      <FlatRow
        label="W"
        value={formatPxMetricValue(displayW)}
        tier="default"
        disabled={manualSizeEditingDisabled}
        onCommit={(next) => commitManualSize("width", next)}
        suffix={<KeyframeGutter property="width" displayValue={displayW} {...gutterProps} />}
      />
      <FlatRow
        label="H"
        value={formatPxMetricValue(displayH)}
        tier="default"
        disabled={manualSizeEditingDisabled}
        onCommit={(next) => commitManualSize("height", next)}
        suffix={<KeyframeGutter property="height" displayValue={displayH} {...gutterProps} />}
      />
      <FlatRow
        label="Angle"
        value={`${displayR}°`}
        tier="default"
        disabled={manualRotationEditingDisabled}
        onCommit={(next) => commitManualRotation(next.replace("°", ""))}
        suffix={<KeyframeGutter property="rotation" displayValue={displayR} {...gutterProps} />}
      />
    </>
  );
}
