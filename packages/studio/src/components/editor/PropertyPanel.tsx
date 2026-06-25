import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Layers, Move, X } from "../../icons/SystemIcons";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import {
  EMPTY_STYLES,
  formatPxMetricValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
  readGsapRuntimeValuesForPanel,
  readGsapBorderRadiusForPanel,
} from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";
import { createTransformCommitHandlers } from "./propertyPanelTransformCommit";
import { classifyPropertyGroup } from "@hyperframes/core/gsap-parser";
import { isMediaElement, MediaSection } from "./propertyPanelMediaSection";
import {
  ColorGradingSection,
  isColorGradingCapableElement,
} from "./propertyPanelColorGradingSection";
import { TextSection, StyleSections } from "./propertyPanelSections";
import { GsapAnimationSection } from "./GsapAnimationSection";
import { PropertyPanel3dTransform } from "./propertyPanel3dTransform";
import { KeyframeNavigation } from "./KeyframeNavigation";
import {
  STUDIO_COLOR_GRADING_ENABLED,
  STUDIO_GSAP_PANEL_ENABLED,
  STUDIO_KEYFRAMES_ENABLED,
} from "./manualEditingAvailability";
import { usePlayerStore, liveTime } from "../../player";
import { TimingSection } from "./propertyPanelTimingSection";
import { type PropertyPanelProps } from "./propertyPanelHelpers";
import { GestureRecordPanelButton } from "./GestureRecordControl";

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

// fallow-ignore-next-line complexity
export const PropertyPanel = memo(function PropertyPanel({
  projectId,
  projectDir,
  assets,
  element,
  multiSelectCount = 0,
  copiedAgentPrompt: _copiedAgentPrompt,
  onClearSelection,
  onSetStyle,
  onSetAttribute,
  onSetAttributeLive,
  onSetHtmlAttribute,
  onSetManualOffset,
  onSetManualSize,
  onSetManualRotation,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent: _onAskAgent,
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
  onUnroll,
  onUpdateKeyframeEase,
  onSetAllKeyframeEases,
  onAddKeyframe,
  onRemoveKeyframe,
  onConvertToKeyframes,
  onCommitAnimatedProperty,
  onSeekToTime,
  recordingState,
  recordingDuration,
  onToggleRecording,
}: PropertyPanelProps) {
  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const { showToast } = useStudioShellContext();
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const storeTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const liveTimeRef = useRef(storeTime);
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    let timerId: ReturnType<typeof setTimeout> | 0 = 0;
    const unsub = liveTime.subscribe((t) => {
      liveTimeRef.current = t;
      if (!timerId)
        timerId = setTimeout(() => {
          timerId = 0;
          forceRender((v) => v + 1);
        }, 33);
    });
    return () => {
      unsub();
      if (timerId) clearTimeout(timerId);
    };
  }, [isPlaying]);
  const currentTime = isPlaying ? liveTimeRef.current : storeTime;
  const cacheElementKey = element?.id ?? element?.selector ?? "";
  const cacheEntry = usePlayerStore((s) => s.keyframeCache.get(cacheElementKey));

  const iframeRef = previewIframeRef ?? { current: null };
  const gsapAnimIdForMemo = element
    ? (gsapAnimations?.find((a: { keyframes?: unknown }) => a.keyframes)?.id ??
      gsapAnimations?.[0]?.id ??
      null)
    : null;
  const gsapRuntimeValues = useMemo(
    () =>
      element
        ? readGsapRuntimeValuesForPanel(gsapAnimIdForMemo, gsapAnimations, element, iframeRef)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iframeRef is stable; currentTime drives re-reads during playback
    [gsapAnimIdForMemo, gsapAnimations, element, currentTime],
  );
  const gsapBorderRadius = useMemo(
    () =>
      element
        ? readGsapBorderRadiusForPanel(gsapRuntimeValues, gsapAnimations, element, iframeRef)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gsapRuntimeValues, gsapAnimations, element, currentTime],
  );

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
  const manualRotationEditingDisabled = !element.capabilities.canApplyManualRotation;
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

  const manualRotation = readStudioRotation(element.element);

  const elStart = Number.parseFloat(element?.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(element?.dataAttributes?.duration ?? "1") || 0;
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;

  const gsapKfAnim = gsapAnimations?.find((a) => a.keyframes) ?? null;
  const gsapKeyframes = gsapKfAnim?.keyframes?.keyframes ?? null;
  const gsapAnimId = gsapKfAnim?.id ?? gsapAnimations?.[0]?.id ?? null;
  const hasGsapAnimation = !!(gsapAnimId || gsapAnimations.length > 0);
  const { commitManualOffset, commitManualSize, commitManualRotation } =
    createTransformCommitHandlers({
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
    });
  const navKeyframes = cacheEntry?.keyframes ?? gsapKeyframes;
  const seekFromKfPct = (pct: number) => onSeekToTime?.(elStart + (pct / 100) * elDuration);

  const animIdForProp = (prop: string): string => {
    const group = classifyPropertyGroup(prop);
    const groupAnim = gsapAnimations?.find((a) => a.propertyGroup === group);
    if (groupAnim) return groupAnim.id;
    return gsapAnimId ?? "";
  };

  const displayX = gsapRuntimeValues?.x ?? manualOffset.x;
  const displayY = gsapRuntimeValues?.y ?? manualOffset.y;
  const displayW = gsapRuntimeValues?.width ?? resolvedWidth;
  const displayH = gsapRuntimeValues?.height ?? resolvedHeight;
  const displayR = gsapRuntimeValues?.rotation ?? manualRotation.angle;

  // fallow-ignore-next-line complexity
  const handleCopyElementInfo = () => {
    const file = element.sourceFile ?? "index.html";
    let lineNum: number | null = null;
    try {
      const src = previewIframeRef?.current?.contentDocument?.documentElement?.outerHTML ?? "";
      if (src && element.id) {
        const idx = src.indexOf(`id="${element.id}"`);
        if (idx > -1) lineNum = src.slice(0, idx).split("\n").length;
      }
      if (!lineNum && element.selector) {
        const tag = element.tagName.toLowerCase();
        const cls = element.selector.startsWith(".")
          ? element.selector.slice(1).split(".")[0]
          : null;
        const search = cls ? `class="${cls}` : `<${tag}`;
        const idx = src.indexOf(search);
        if (idx > -1) lineNum = src.slice(0, idx).split("\n").length;
      }
    } catch {}
    const fileLoc = lineNum ? `${file}:${lineNum}` : file;
    const lines = [
      `Element: ${element.label} (${sourceLabel})`,
      `File: ${fileLoc}`,
      `Position: x=${Math.round(element.boundingBox.x)}, y=${Math.round(element.boundingBox.y)}`,
      `Size: ${Math.round(element.boundingBox.width)}×${Math.round(element.boundingBox.height)}`,
      `Tag: <${element.tagName}>`,
    ];
    if (element.computedStyles["z-index"] && element.computedStyles["z-index"] !== "auto") {
      lines.push(`Z-index: ${element.computedStyles["z-index"]}`);
    }
    if (gsapAnimations.length > 0) {
      const anim = gsapAnimations[0];
      lines.push(
        `Animation: ${anim.method}() ${anim.duration}s at ${anim.position}s, ease: ${anim.ease ?? "default"}`,
      );
      const props = Object.entries(anim.properties)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      if (props) lines.push(`Properties: ${props}`);
    }
    const text = lines.join("\n");
    void navigator.clipboard.writeText(text);
    showToast(`Copied element info for ${element.label} — paste into any AI agent`, "info");
    setClipboardCopied(true);
    clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => setClipboardCopied(false), 1500);
  };

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
              onClick={handleCopyElementInfo}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                clipboardCopied
                  ? "text-studio-accent"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              }`}
              title={clipboardCopied ? "Copied!" : "Copy element info to clipboard"}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="5" y="5" width="9" height="9" rx="1.5" />
                <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
              </svg>
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
        {onToggleRecording && (
          <GestureRecordPanelButton
            recordingState={recordingState}
            recordingDuration={recordingDuration}
            onToggleRecording={onToggleRecording}
          />
        )}

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

        {(element.dataAttributes.start != null || gsapAnimations.length > 0) && (
          // Render whenever there's an authored clip range OR animations to infer
          // one from — a pure-GSAP element with no data-start still gets a Timing
          // range (TimingSection derives it from its tweens).
          <TimingSection
            element={element}
            animations={gsapAnimations}
            onSetAttribute={onSetAttribute}
          />
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

        {STUDIO_COLOR_GRADING_ENABLED && isColorGradingCapableElement(element) && (
          <ColorGradingSection
            key={[
              element.id ?? "",
              element.hfId ?? "",
              element.selector ?? "",
              String(element.selectorIndex ?? ""),
            ].join("|")}
            element={element}
            assets={assets}
            previewIframeRef={previewIframeRef}
            onImportAssets={onImportAssets}
            onSetAttributeLive={onSetAttributeLive}
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
                  keyframes={navKeyframes}
                  currentPercentage={currentPct}
                  onSeek={seekFromKfPct}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "x", displayX)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp("x"), pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp("x"))}
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
                  keyframes={navKeyframes}
                  currentPercentage={currentPct}
                  onSeek={seekFromKfPct}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "y", displayY)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp("y"), pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp("y"))}
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
                  keyframes={navKeyframes}
                  currentPercentage={currentPct}
                  onSeek={seekFromKfPct}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "width", displayW)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp("width"), pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp("width"))}
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
                  keyframes={navKeyframes}
                  currentPercentage={currentPct}
                  onSeek={seekFromKfPct}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "height", displayH)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp("height"), pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp("height"))}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <MetricField
                  label="R"
                  value={`${displayR}°`}
                  disabled={manualRotationEditingDisabled}
                  onCommit={(next) => commitManualRotation(next.replace("°", ""))}
                />
              </div>
              {STUDIO_KEYFRAMES_ENABLED && gsapAnimId && (
                <KeyframeNavigation
                  property="rotation"
                  keyframes={navKeyframes}
                  currentPercentage={currentPct}
                  onSeek={seekFromKfPct}
                  onAddKeyframe={() =>
                    onCommitAnimatedProperty &&
                    void onCommitAnimatedProperty(element, "rotation", displayR)
                  }
                  onRemoveKeyframe={(pct) => onRemoveKeyframe?.(animIdForProp("rotation"), pct)}
                  onConvertToKeyframes={() => onConvertToKeyframes?.(animIdForProp("rotation"))}
                />
              )}
            </div>
          </div>
          {gsapRuntimeValues && (
            <PropertyPanel3dTransform
              gsapRuntimeValues={gsapRuntimeValues}
              gsapAnimId={gsapAnimId}
              resolveAnimIdForProp={animIdForProp}
              gsapKeyframes={navKeyframes}
              currentPct={currentPct}
              elStart={elStart}
              elDuration={elDuration}
              element={element}
              onCommitAnimatedProperty={onCommitAnimatedProperty}
              onSeekToTime={onSeekToTime}
              onRemoveKeyframe={onRemoveKeyframe}
              onConvertToKeyframes={onConvertToKeyframes}
            />
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
              onUnroll={onUnroll}
              onUpdateKeyframeEase={onUpdateKeyframeEase}
              onSetAllKeyframeEases={onSetAllKeyframeEases}
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
