import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Move } from "../../icons/SystemIcons";
import { InspectorHeaderActions } from "./InspectorHeaderActions";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import {
  buildElementInfoText,
  EMPTY_STYLES,
  formatPxMetricValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
  readGsapRuntimeValuesForPanel,
  readGsapBorderRadiusForPanel,
  isSelectedElementHidden,
  selectionIdentityKey,
} from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";
import { createTransformCommitHandlers } from "./propertyPanelTransformCommit";
import { classifyPropertyGroup } from "@hyperframes/core/gsap-parser";
import { resolveEditingSections } from "@hyperframes/core/editing";
import { MediaSection } from "./propertyPanelMediaSection";
import { ColorGradingSection } from "./propertyPanelColorGradingSection";
import { domEditSelectionToFacts } from "./domEditingLayers";
import { TextSection, StyleSections } from "./propertyPanelSections";
import { GsapAnimationSection } from "./GsapAnimationSection";
import { PropertyPanel3dTransform } from "./propertyPanel3dTransform";
import { KeyframeNavigation } from "./KeyframeNavigation";
import {
  STUDIO_FLAT_INSPECTOR_ENABLED,
  STUDIO_GSAP_PANEL_ENABLED,
  STUDIO_KEYFRAMES_ENABLED,
} from "./manualEditingAvailability";
import { PropertyPanelFlat } from "./PropertyPanelFlat";
import { createGsapLivePreview } from "./gsapLivePreview";
import { usePlayerStore, liveTime } from "../../player";
import { TimingSection } from "./propertyPanelTimingSection";
import { type PropertyPanelProps } from "./propertyPanelHelpers";
import { GestureRecordPanelButton } from "./GestureRecordControl";
import { PropertyPanelEmptyState } from "./PropertyPanelEmptyState";
import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";

// Re-export helpers that external consumers import from this module
export {
  buildInsetClipPathSides,
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  getCssFilterFunctionPx,
  getClipPathInsetPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  normalizePanelPxValue,
  parseInsetClipPathSides,
  setCssFilterFunctionPx,
} from "./propertyPanelHelpers";

// fallow-ignore-next-line complexity
export const PropertyPanel = memo(function PropertyPanel(props: PropertyPanelProps) {
  const {
    projectId,
    projectDir,
    assets,
    element,
    multiSelectCount = 0,
    multiSelectedElements,
    onGroupSelection,
    onHideAllSelected,
    copiedAgentPrompt: _copiedAgentPrompt,
    onClearSelection,
    onUngroup,
    onSetStyle,
    onSetAttribute,
    onSetAttributeLive,
    onApplyColorGradingScope,
    onSetHtmlAttribute,
    onRemoveBackground,
    onSetManualOffset,
    onSetManualSize,
    onSetManualRotation,
    onSetText,
    onSetTextFieldStyle,
    onAddTextField,
    onRemoveTextField,
    onToggleElementHidden,
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
    onCommitAnimatedProperties,
    onSeekToTime,
    recordingState,
    recordingDuration,
    onToggleRecording,
  } = props;
  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const { showToast } = useStudioShellContext();
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const storeTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const timelineElements = usePlayerStore((s) => s.elements);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementHidden = isSelectedElementHidden(timelineElements, selectedElementId);
  const visibilityToggleLabel = selectedElementHidden ? "Show element" : "Hide element";
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
  // The 3D Transform panel should be reachable on ANY element, not only ones GSAP is
  // already animating — otherwise you can't add depth/rotation to a fresh static
  // element (the panel never appears, the classic chicken-and-egg). Default to
  // identity when there are no runtime values yet; the first edit creates the
  // gsap.set via commitStaticSet, after which real runtime values flow in.
  const gsap3dValues: Record<string, number> = gsapRuntimeValues ?? {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    z: 0,
    scale: 1,
    transformPerspective: 0,
  };

  if (!element) {
    return (
      <PropertyPanelEmptyState
        flat={STUDIO_FLAT_INSPECTOR_ENABLED}
        multiSelectCount={multiSelectCount}
        multiSelectedElements={multiSelectedElements}
        onGroupSelection={onGroupSelection}
        onHideAllSelected={onHideAllSelected}
        onClearSelection={onClearSelection}
      />
    );
  }

  const manualOffsetEditingDisabled = !element.capabilities.canApplyManualOffset;
  const manualSizeEditingDisabled = !element.capabilities.canApplyManualSize;
  const manualRotationEditingDisabled = !element.capabilities.canApplyManualRotation;
  const sourceLabel = element.id ? `#${element.id}` : (element.selector ?? "");
  // Capabilities are already resolved on the selection; recompute only sections,
  // feeding the live GSAP tween count (arrives on the gsapAnimations prop, not the
  // selection) so the Timing section shows for pure-GSAP elements with no data-start.
  const sections = resolveEditingSections(domEditSelectionToFacts(element, gsapAnimations.length));
  const showEditableSections = element.capabilities.canEditStyles && sections.style;
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

  const handleCopyElementInfo = () => {
    const text = buildElementInfoText(element, sourceLabel, gsapAnimations, previewIframeRef);
    void navigator.clipboard.writeText(text);
    showToast(`Copied element info for ${element.label} — paste into any AI agent`, "info");
    setClipboardCopied(true);
    clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => setClipboardCopied(false), 1500);
  };

  if (STUDIO_FLAT_INSPECTOR_ENABLED) {
    // Forward the raw props (handlers, ids, assets, recording, fonts, etc.) and
    // the values the legacy path already computed above (so they aren't derived
    // twice). PropertyPanelFlat owns the one-open group state.
    return (
      <PropertyPanelFlat
        {...props}
        key={selectionIdentityKey(element)}
        element={element}
        styles={styles}
        sections={sections}
        sourceLabel={sourceLabel}
        gsapBorderRadius={gsapBorderRadius}
        showEditableSections={showEditableSections}
        selectedElementHidden={selectedElementHidden}
        selectedElementId={selectedElementId}
        clipboardCopied={clipboardCopied}
        onCopyElementInfo={handleCopyElementInfo}
        displayX={displayX}
        displayY={displayY}
        displayW={displayW}
        displayH={displayH}
        displayR={displayR}
        manualOffsetEditingDisabled={manualOffsetEditingDisabled}
        manualSizeEditingDisabled={manualSizeEditingDisabled}
        manualRotationEditingDisabled={manualRotationEditingDisabled}
        commitManualOffset={commitManualOffset}
        commitManualSize={commitManualSize}
        commitManualRotation={commitManualRotation}
        gsapAnimId={gsapAnimId}
        navKeyframes={navKeyframes}
        currentTime={currentTime}
        animIdForProp={animIdForProp}
        gsapRuntimeValues={gsap3dValues}
        elStart={elStart}
        elDuration={elDuration}
      />
    );
  }

  const classicPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1">
      <DesignPanelInputProvider section="header">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-neutral-100">
                {element.label}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
            </div>
            <InspectorHeaderActions
              element={element}
              copied={clipboardCopied}
              onCopy={handleCopyElementInfo}
              onClear={onClearSelection}
              onUngroup={onUngroup}
              selectedElementId={selectedElementId}
              selectedElementHidden={selectedElementHidden}
              visibilityLabel={visibilityToggleLabel}
              onToggleHidden={onToggleElementHidden}
            />
          </div>
        </div>
      </DesignPanelInputProvider>
      <div className="flex-1 overflow-y-auto">
        {onToggleRecording && (
          <DesignPanelInputProvider section="footer">
            <GestureRecordPanelButton
              recordingState={recordingState}
              recordingDuration={recordingDuration}
              onToggleRecording={onToggleRecording}
            />
          </DesignPanelInputProvider>
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

        {sections.timing && (
          // Render whenever there's an authored clip range OR animations to infer
          // one from — a pure-GSAP element with no data-start still gets a Timing
          // range (TimingSection derives it from its tweens).
          <TimingSection
            element={element}
            animations={gsapAnimations}
            onSetAttribute={onSetAttribute}
          />
        )}
        {sections.colorGrading && (
          <ColorGradingSection
            key={selectionIdentityKey(element)}
            projectId={projectId}
            element={element}
            assets={assets}
            previewIframeRef={previewIframeRef}
            onImportAssets={onImportAssets}
            onSetAttributeLive={onSetAttributeLive}
            onApplyScope={onApplyColorGradingScope}
          />
        )}

        {sections.media && (
          <MediaSection
            projectDir={projectDir}
            element={element}
            styles={styles}
            onSetStyle={onSetStyle}
            onSetAttribute={onSetAttribute}
            onSetHtmlAttribute={onSetHtmlAttribute}
            onRemoveBackground={onRemoveBackground}
          />
        )}

        {sections.layout && (
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
            <PropertyPanel3dTransform
              gsapRuntimeValues={gsap3dValues}
              gsapAnimId={gsapAnimId}
              resolveAnimIdForProp={animIdForProp}
              gsapKeyframes={navKeyframes}
              currentPct={currentPct}
              elStart={elStart}
              elDuration={elDuration}
              element={element}
              onCommitAnimatedProperty={onCommitAnimatedProperty}
              onCommitAnimatedProperties={onCommitAnimatedProperties}
              onSeekToTime={onSeekToTime}
              onRemoveKeyframe={onRemoveKeyframe}
              onConvertToKeyframes={onConvertToKeyframes}
              onLivePreviewProps={createGsapLivePreview(iframeRef)}
            />
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
        )}

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
  return <DesignPanelInputProvider ui="classic">{classicPanel}</DesignPanelInputProvider>;
});
