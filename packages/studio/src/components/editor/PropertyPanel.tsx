import { memo } from "react";
import { Eye, Layers, MessageSquare, Move, X } from "../../icons/SystemIcons";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import {
  EMPTY_STYLES,
  formatPxMetricValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
} from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";
import { isMediaElement, MediaSection } from "./propertyPanelMediaSection";
import { TextSection, StyleSections } from "./propertyPanelSections";
import { GsapAnimationSection } from "./GsapAnimationSection";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { STUDIO_GSAP_PANEL_ENABLED, STUDIO_KEYFRAMES_ENABLED } from "./manualEditingAvailability";
import { usePlayerStore } from "../../player";
import { TimingSection } from "./propertyPanelTimingSection";
import { type PropertyPanelProps } from "./propertyPanelHelpers";

// Re-export helpers that external consumers import from this module
export {
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  getCssFilterFunctionPx,
  getClipPathInsetPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  normalizePanelPxValue,
  setCssFilterFunctionPx,
} from "./propertyPanelHelpers";

/* ------------------------------------------------------------------ */
/*  PropertyPanel                                                      */
/* ------------------------------------------------------------------ */

// fallow-ignore-next-line complexity
export const PropertyPanel = memo(function PropertyPanel({
  projectId,
  projectDir,
  assets,
  element,
  multiSelectCount = 0,
  copiedAgentPrompt,
  onClearSelection,
  onSetStyle,
  onSetAttribute,
  onSetHtmlAttribute,
  onSetManualOffset,
  onSetManualSize,
  onSetManualRotation,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent,
  onImportAssets,
  fontAssets = [],
  onImportFonts,
  previewIframeRef,
  gsapAnimations = [],
  gsapMultipleTimelines,
  gsapUnsupportedTimelinePattern,
  onUpdateGsapProperty,
  onUpdateGsapMeta,
  onDeleteGsapAnimation,
  onAddGsapProperty,
  onRemoveGsapProperty,
  onUpdateGsapFromProperty,
  onAddGsapFromProperty,
  onRemoveGsapFromProperty,
  onAddGsapAnimation,
  onSetArcPath,
  onUpdateArcSegment,
  onAddKeyframe,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onCommitAnimatedProperty,
  onSeekToTime,
}: PropertyPanelProps) {
  const styles = element?.computedStyles ?? EMPTY_STYLES;

  if (!element) {
    return (
      <div className="flex h-full flex-col bg-neutral-900">
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          {multiSelectCount > 1 ? (
            <>
              <Layers size={18} className="mb-3 text-neutral-600" />
              <p className="text-sm font-medium text-neutral-200">
                {multiSelectCount} elements selected
              </p>
              <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
                Select a single element to edit its properties. Click an element in the preview or
                use the timeline layer panel.
              </p>
            </>
          ) : (
            <>
              <Eye size={18} className="mb-3 text-neutral-600" />
              <p className="text-sm font-medium text-neutral-200">
                Select an element in the preview.
              </p>
              <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
                The inspector is tuned for element edits with safer geometry controls, color
                picking, and cleaner grouped layer controls.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const manualOffsetEditingDisabled = !element.capabilities.canApplyManualOffset;
  const manualSizeEditingDisabled = !element.capabilities.canApplyManualSize;
  const sourceLabel = element.id ? `#${element.id}` : element.selector;
  const showEditableSections = element.capabilities.canEditStyles;
  const manualOffset = readStudioPathOffset(element.element);
  const manualSize = readStudioBoxSize(element.element);
  const resolvedWidth =
    manualSize.width > 0
      ? manualSize.width
      : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
  const resolvedHeight =
    manualSize.height > 0
      ? manualSize.height
      : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);

  const commitManualOffset = (axis: "x" | "y", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null) return;
    if (onCommitAnimatedProperty && (gsapAnimId || gsapAnimations.length > 0)) {
      void onCommitAnimatedProperty(element, axis, parsed);
      return;
    }
    if (gsapKeyframes && gsapAnimId && onAddKeyframe) {
      const pct = Math.max(0, Math.min(100, Math.round(currentPct * 10) / 10));
      onAddKeyframe(gsapAnimId, pct, axis, parsed);
      return;
    }
    const current = readStudioPathOffset(element.element);
    onSetManualOffset(element, {
      x: axis === "x" ? parsed : current.x,
      y: axis === "y" ? parsed : current.y,
    });
  };

  // fallow-ignore-next-line complexity
  const commitManualSize = (axis: "width" | "height", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    const current = readStudioBoxSize(element.element);
    const width =
      current.width > 0
        ? current.width
        : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
    const height =
      current.height > 0
        ? current.height
        : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);
    onSetManualSize(element, {
      width: axis === "width" ? parsed : width,
      height: axis === "height" ? parsed : height,
    });
  };

  const manualRotation = readStudioRotation(element.element);
  const commitManualRotation = (nextValue: string) => {
    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) return;
    onSetManualRotation(element, { angle: parsed });
  };

  // Keyframe navigation state
  const elStart = Number.parseFloat(element?.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(element?.dataAttributes?.duration ?? "1") || 0;
  const currentTime = usePlayerStore((s) => s.currentTime);
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;

  const gsapKeyframes = gsapAnimations?.find((a) => a.keyframes)?.keyframes?.keyframes ?? null;
  const gsapAnimId =
    gsapAnimations?.find((a) => a.keyframes)?.id ?? gsapAnimations?.[0]?.id ?? null;

  // Read ALL GSAP-interpolated values at the current seek time.
  // Discovers animated properties from the animation's keyframes/tween vars.
  const gsapRuntimeValues: Record<string, number> | null = (() => {
    if (!gsapAnimId || gsapAnimations.length === 0) return null;
    const iframe = previewIframeRef?.current;
    if (!iframe?.contentWindow) return null;
    const selector = element.id ? `#${element.id}` : element.selector;
    if (!selector) return null;
    try {
      const gsap = (
        iframe.contentWindow as unknown as {
          gsap?: { getProperty: (el: Element, prop: string) => number | string };
        }
      ).gsap;
      if (!gsap?.getProperty) return null;
      const el = iframe.contentDocument?.querySelector(selector);
      if (!el) return null;
      const propKeys = new Set<string>();
      for (const anim of gsapAnimations) {
        if (anim.keyframes) {
          for (const kf of anim.keyframes.keyframes) {
            for (const p of Object.keys(kf.properties)) propKeys.add(p);
          }
        }
        for (const p of Object.keys(anim.properties)) propKeys.add(p);
      }
      const result: Record<string, number> = {};
      for (const prop of propKeys) {
        const v = Number(gsap.getProperty(el, prop));
        if (Number.isFinite(v)) result[prop] = Math.round(v * 100) / 100;
      }
      return Object.keys(result).length > 0 ? result : null;
    } catch {
      return null;
    }
  })();

  const gsapBorderRadius: { tl: number; tr: number; br: number; bl: number } | null = (() => {
    if (!gsapRuntimeValues || !("borderRadius" in gsapRuntimeValues)) {
      const hasBRProp = gsapAnimations.some(
        (a) =>
          "borderRadius" in a.properties ||
          a.keyframes?.keyframes.some((kf) => "borderRadius" in kf.properties),
      );
      if (!hasBRProp) return null;
    }
    const iframe = previewIframeRef?.current;
    const selector = element.id ? `#${element.id}` : element.selector;
    if (!iframe?.contentDocument || !selector) return null;
    try {
      const el = iframe.contentDocument.querySelector(selector);
      if (!el) return null;
      const cs = iframe.contentWindow!.getComputedStyle(el);
      const parse = (v: string) => Number.parseFloat(v) || 0;
      return {
        tl: parse(cs.borderTopLeftRadius),
        tr: parse(cs.borderTopRightRadius),
        br: parse(cs.borderBottomRightRadius),
        bl: parse(cs.borderBottomLeftRadius),
      };
    } catch {
      return null;
    }
  })();

  const displayX = gsapRuntimeValues?.x ?? manualOffset.x;
  const displayY = gsapRuntimeValues?.y ?? manualOffset.y;
  const displayW = gsapRuntimeValues?.width ?? resolvedWidth;
  const displayH = gsapRuntimeValues?.height ?? resolvedHeight;
  const displayR = gsapRuntimeValues?.rotation ?? manualRotation.angle;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-neutral-100">
              {element.label}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAskAgent}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
              title={copiedAgentPrompt ? "Prompt copied" : "Copy prompt to AI agent"}
            >
              <MessageSquare size={13} />
            </button>
            <button
              type="button"
              aria-label="Clear selection"
              onClick={onClearSelection}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TextSection
          element={element}
          styles={styles}
          fontAssets={fontAssets}
          onImportFonts={onImportFonts}
          onSetText={onSetText}
          onSetTextFieldStyle={onSetTextFieldStyle}
          onAddTextField={onAddTextField}
          onRemoveTextField={onRemoveTextField}
        />

        {element.dataAttributes.start != null && (
          <TimingSection element={element} onSetAttribute={onSetAttribute} />
        )}

        {isMediaElement(element) && (
          <MediaSection
            projectDir={projectDir}
            element={element}
            styles={styles}
            onSetStyle={onSetStyle}
            onSetAttribute={onSetAttribute}
            onSetHtmlAttribute={onSetHtmlAttribute}
          />
        )}

        <Section title="Layout" icon={<Move size={15} />}>
          <div className={RESPONSIVE_GRID}>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="X"
                  value={formatPxMetricValue(displayX)}
                  disabled={manualOffsetEditingDisabled}
                  scrub
                  onCommit={(next) => commitManualOffset("x", next)}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="x"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "x", displayX)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(gsapAnimId, pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(gsapAnimId)}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="Y"
                  value={formatPxMetricValue(displayY)}
                  disabled={manualOffsetEditingDisabled}
                  scrub
                  onCommit={(next) => commitManualOffset("y", next)}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="y"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "y", displayY)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(gsapAnimId, pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(gsapAnimId)}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="W"
                  value={formatPxMetricValue(displayW)}
                  disabled={manualSizeEditingDisabled}
                  scrub
                  onCommit={(next) => commitManualSize("width", next)}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="width"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "width", displayW)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(gsapAnimId, pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(gsapAnimId)}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="H"
                  value={formatPxMetricValue(displayH)}
                  disabled={manualSizeEditingDisabled}
                  scrub
                  onCommit={(next) => commitManualSize("height", next)}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="height"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "height", displayH)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(gsapAnimId, pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(gsapAnimId)}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="R"
                  value={`${displayR}°`}
                  onCommit={(next) => commitManualRotation(next.replace("°", ""))}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="rotation"
                  keyframes={gsapKeyframes}
                  currentPercentage={currentPct}
                  onSeek={(pct) => onSeekToTime?.(elStart + (pct / 100) * elDuration)}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "rotation", displayR)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(gsapAnimId, pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(gsapAnimId)}
                />
              )}
            </div>
          </div>
          {gsapRuntimeValues && (
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
                          void onCommitAnimatedProperty(
                            element,
                            "scale",
                            gsapRuntimeValues?.scale ?? 1,
                          );
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
          )}
          <div className="mt-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
              Stacking
            </div>
            <MetricField
              label="Z-index"
              value={String(parseInt(styles["z-index"] || "auto", 10) || 0)}
              scrub
              onCommit={(next) => onSetStyle("z-index", next)}
            />
          </div>
        </Section>

        {STUDIO_GSAP_PANEL_ENABLED &&
          onUpdateGsapProperty &&
          onUpdateGsapMeta &&
          onDeleteGsapAnimation &&
          onAddGsapProperty &&
          onAddGsapAnimation && (
            <GsapAnimationSection
              animations={gsapAnimations}
              multipleTimelines={gsapMultipleTimelines}
              unsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
              onUpdateProperty={onUpdateGsapProperty}
              onUpdateMeta={onUpdateGsapMeta}
              onDeleteAnimation={onDeleteGsapAnimation}
              onAddProperty={onAddGsapProperty}
              onRemoveProperty={onRemoveGsapProperty ?? (() => {})}
              onUpdateFromProperty={onUpdateGsapFromProperty}
              onAddFromProperty={onAddGsapFromProperty}
              onRemoveFromProperty={onRemoveGsapFromProperty}
              onAddAnimation={onAddGsapAnimation}
              onSetArcPath={onSetArcPath}
              onUpdateArcSegment={onUpdateArcSegment}
            />
          )}

        {showEditableSections && (
          <StyleSections
            projectId={projectId}
            element={element}
            styles={styles}
            assets={assets}
            onSetStyle={onSetStyle}
            onImportAssets={onImportAssets}
            gsapBorderRadius={gsapBorderRadius}
          />
        )}
      </div>
    </div>
  );
});
