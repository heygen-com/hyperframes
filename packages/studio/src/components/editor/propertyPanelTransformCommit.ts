import type { DomEditSelection } from "./domEditingTypes";
import { readStudioBoxSize, readStudioPathOffset } from "./manualEdits";
import { parsePxMetricValue, type PropertyPanelProps } from "./propertyPanelHelpers";

interface TransformCommitDeps {
  element: DomEditSelection;
  styles: Record<string, string>;
  hasGsapAnimation: boolean;
  gsapAnimId: string | null;
  gsapKeyframes: unknown;
  currentPct: number;
  onCommitAnimatedProperty: PropertyPanelProps["onCommitAnimatedProperty"];
  onAddKeyframe: PropertyPanelProps["onAddKeyframe"];
  onSetManualOffset: PropertyPanelProps["onSetManualOffset"];
  onSetManualSize: PropertyPanelProps["onSetManualSize"];
  onSetManualRotation: PropertyPanelProps["onSetManualRotation"];
  showToast?: (message: string, tone?: "error" | "info") => void;
}

/**
 * Build the X/Y, W/H and rotation field commit handlers for the property panel.
 * Each handler routes the value into the GSAP animation when the element is
 * animated (matching the drag gesture and keyframe buttons), and otherwise
 * falls through to the manual transform setter.
 */
// fallow-ignore-next-line unit-size
export function createTransformCommitHandlers({
  element,
  styles,
  hasGsapAnimation,
  gsapAnimId,
  gsapKeyframes,
  currentPct,
  onCommitAnimatedProperty,
  onAddKeyframe,
  onSetManualOffset,
  onSetManualSize,
  onSetManualRotation,
  showToast,
}: TransformCommitDeps) {
  // Route a transform value into the GSAP animation (or a new keyframe) when the
  // element is animated. Returns true when handled, so callers fall through to
  // the manual-transform path only for non-animated elements.
  const commitAnimatedTransformValue = (
    property: string,
    value: number,
    noCallbacksMessage: string,
  ): boolean => {
    if (onCommitAnimatedProperty && hasGsapAnimation) {
      void onCommitAnimatedProperty(element, property, value);
      return true;
    }
    if (gsapKeyframes && gsapAnimId && onAddKeyframe) {
      const pct = Math.max(0, Math.min(100, Math.round(currentPct * 10) / 10));
      onAddKeyframe(gsapAnimId, pct, property, value);
      return true;
    }
    if (hasGsapAnimation) {
      showToast?.(noCallbacksMessage);
      return true;
    }
    return false;
  };

  const commitManualOffset = (axis: "x" | "y", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null) return;
    if (
      commitAnimatedTransformValue(
        axis,
        parsed,
        "Cannot edit position — animation callbacks not available",
      )
    )
      return;
    const current = readStudioPathOffset(element.element);
    void Promise.resolve(
      onSetManualOffset(element, {
        x: axis === "x" ? parsed : current.x,
        y: axis === "y" ? parsed : current.y,
      }),
    ).catch(() => undefined);
  };

  // fallow-ignore-next-line complexity
  const commitManualSize = (axis: "width" | "height", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    if (onCommitAnimatedProperty && hasGsapAnimation) {
      void onCommitAnimatedProperty(element, axis, parsed);
      return;
    }
    if (hasGsapAnimation) {
      showToast?.("Cannot edit size — animation callbacks not available");
      return;
    }
    const current = readStudioBoxSize(element.element);
    const width =
      current.width > 0
        ? current.width
        : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
    const height =
      current.height > 0
        ? current.height
        : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);
    void Promise.resolve(
      onSetManualSize(element, {
        width: axis === "width" ? parsed : width,
        height: axis === "height" ? parsed : height,
      }),
    ).catch(() => undefined);
  };

  const commitManualRotation = (nextValue: string) => {
    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) return;
    if (
      commitAnimatedTransformValue(
        "rotation",
        parsed,
        "Cannot edit rotation — animation callbacks not available",
      )
    )
      return;
    void Promise.resolve(onSetManualRotation(element, { angle: parsed })).catch(() => undefined);
  };

  return { commitManualOffset, commitManualSize, commitManualRotation };
}
