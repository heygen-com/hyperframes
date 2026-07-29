import { scopedElementKey } from "../../hooks/gsapKeyframeCacheHelpers";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";
import { slugifyDesignInput } from "../../utils/designInputTracking";
import { isTextEditableSelection } from "./domEditing";
import type { PropertyPanelFlatProps } from "./propertyPanelFlatProps";
import { formatPxMetricValue } from "./propertyPanelHelpers";
import { PropertyPanelFlatHeader } from "./PropertyPanelFlatHeader";
import { PropertyPanelFlatFooter } from "./PropertyPanelFlatFooter";
import { FlatGroupHeader } from "./propertyPanelFlatPrimitives";
import { FlatTextSection } from "./propertyPanelFlatTextSection";
import { FlatStyleSection } from "./propertyPanelFlatStyleSections";
import { FlatLayoutSection } from "./propertyPanelFlatLayoutSection";
import { FlatMotionSection } from "./propertyPanelFlatMotionSection";
import { FlatMediaSection } from "./propertyPanelFlatMediaSection";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";
import { createGsapLivePreview } from "./gsapLivePreview";
import { formatTextFieldPreview } from "./propertyPanelSections";
import { useColorGradingController } from "./useColorGradingController";
import { usePlayerStore } from "../../player";
import {
  FlatColorGradingAccessory,
  FlatColorGradingSection,
} from "./propertyPanelFlatColorGradingSection";
import {
  activeColorGradingEffectCount,
  FlatEffectsAccessory,
  FlatEffectsSection,
} from "./propertyPanelFlatEffectsSection";
import {
  deriveMediaOverlayPlacement,
  FlatOverlaysSection,
} from "./propertyPanelFlatOverlaysSection";

type FlatGroupDescriptor = {
  id: string;
  title: string;
  summary?: string;
  accessory?: ReactNode;
  content: ReactNode;
};

// Required callback shape for the gated-off Motion effect list.
const EMPTY_GSAP_EFFECT_HANDLERS = {
  onAddAnimation: () => {},
  onUpdateProperty: () => {},
  onUpdateMeta: () => {},
  onDeleteAnimation: () => {},
  onAddProperty: () => {},
  onRemoveProperty: () => {},
};

/** The flat inspector shell with one shared open-group state. */
// fallow-ignore-next-line complexity
export function PropertyPanelFlat({
  element,
  styles,
  sections,
  sourceLabel,
  gsapAnimations = [],
  gsapBorderRadius,
  fontAssets = [],
  showEditableSections,
  selectedElementHidden,
  selectedElementId,
  clipboardCopied,
  onCopyElementInfo,
  projectId,
  projectDir,
  assets,
  previewIframeRef,
  onClearSelection,
  onUngroup,
  onSetStyle,
  onPreviewStyle,
  onSetAttribute,
  onSetAttributes,
  onSetAttributeLive,
  onApplyColorGradingScope,
  onSetHtmlAttribute,
  onRemoveBackground,
  onSetText,
  onSetTextFieldStyle,
  onPreviewTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent,
  onToggleElementHidden,
  onImportAssets,
  onAddMediaOverlay,
  onImportFonts,
  recordingState,
  recordingDuration,
  onToggleRecording,
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
  currentTime,
  animIdForProp,
  gsapRuntimeValues,
  // The flat path derives timing consistently with its Motion section.
  elStart: _elStart,
  elDuration: _elDuration,
  onCommitAnimatedProperty,
  onCommitAnimatedProperties,
  onSeekToTime,
  onRemoveKeyframe,
  onConvertToKeyframes,
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
  onUpdateSegmentEase,
  onSetAllKeyframeEases,
}: PropertyPanelFlatProps) {
  // PropertyPanel keys this component by selection, so the default is per element.
  const [openGroupId, setOpenGroupId] = useState<string>(() =>
    isTextEditableSelection(element)
      ? "text"
      : showEditableSections
        ? "style"
        : sections.media
          ? "media"
          : "layout",
  );

  // Tracks which group(s) are actively transitioning this toggle cycle, so
  // their header/body gets the fast entrance animation (hf-flat-group-enter)
  // and no one else's does. Deliberately NOT derived from remounting alone:
  // FlatGroupHeader instances are keyed by group id and React normally
  // preserves them across re-renders, but toggling a non-adjacent group still
  // shifts the untouched collapsed siblings between the before/after-open
  // slices below, and Chromium restarts a CSS animation on that kind of
  // position shift even though nothing about the sibling actually changed.
  // Gating on these ids (cleared shortly after the 120ms CSS animation
  // finishes) keeps the animation scoped to only the groups that actually
  // just toggled. Two ids, not one: the clicked (newly-opening/closing) group
  // AND whichever group was open immediately before the click and got
  // implicitly closed by it — both freshly-mounted headers need to animate.
  // When the inline timeline ease button focuses a segment on this element,
  // force the Motion group open so its AnimationCard (which only mounts while
  // the group is expanded) can consume the focus and reveal the ease editor.
  const focusedEaseSegment = usePlayerStore((s) => s.focusedEaseSegment);
  // The element THIS panel renders, not the store's selectedElementId: that
  // flips synchronously while the panel still renders its predecessor, so a
  // stale panel would consume a request meant for its successor whenever the
  // two share a class-selector animation id.
  const renderedElementId = scopedElementKey(element);
  // Adjusted during render (not an effect) so the card mounts on the same
  // commit the request lands on. Keyed on request identity: a group the user
  // closes afterwards stays closed.
  const [consumedFocus, setConsumedFocus] = useState(focusedEaseSegment);
  if (focusedEaseSegment !== consumedFocus) {
    setConsumedFocus(focusedEaseSegment);
    const focusesThisPanel =
      focusedEaseSegment?.elementId === renderedElementId &&
      gsapAnimations.some((a) => a.id === focusedEaseSegment.animationId);
    if (focusesThisPanel) setOpenGroupId("motion");
  }

  const [justToggledIds, setJustToggledIds] = useState<string[]>([]);
  const justToggledTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      if (justToggledTimeoutRef.current) clearTimeout(justToggledTimeoutRef.current);
    };
  }, []);

  const colorGradingController = useColorGradingController({
    projectId,
    element,
    previewIframeRef,
    onSetAttributeLive,
    onApplyScope: onApplyColorGradingScope,
  });

  const isTextEditable = isTextEditableSelection(element);
  const elementKind = sections.media ? "media" : element.textFields.length > 0 ? "text" : "other";
  const toggleOpen = (groupId: string) => {
    const isOpening = openGroupId !== groupId;
    const previousOpenGroupId = openGroupId;
    setOpenGroupId((current) => (current === groupId ? "" : groupId));
    const implicitlyClosedId =
      previousOpenGroupId && previousOpenGroupId !== groupId ? previousOpenGroupId : null;
    setJustToggledIds(implicitlyClosedId ? [groupId, implicitlyClosedId] : [groupId]);
    if (justToggledTimeoutRef.current) clearTimeout(justToggledTimeoutRef.current);
    justToggledTimeoutRef.current = setTimeout(() => setJustToggledIds([]), 200);
    if (isOpening) {
      requestAnimationFrame(() =>
        panelBodyRef.current
          ?.querySelector<HTMLElement>('[data-flat-group-open="true"]')
          ?.scrollIntoView?.({ block: "start" }),
      );
    }
  };
  const { start: elStart, duration: elDuration } = deriveElementTiming(element, gsapAnimations);
  const seekFromKfPct = (pct: number) => onSeekToTime?.(elStart + (pct / 100) * elDuration);
  // Use the same timing basis for seeking and active keyframe state.
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;

  // Match the legacy Motion gate while preserving TypeScript narrowing.
  const showMotionTiming = Boolean(sections.timing);
  const gsapEffectHandlers =
    onUpdateGsapProperty &&
    onUpdateGsapMeta &&
    onDeleteGsapAnimation &&
    onAddGsapProperty &&
    onAddGsapAnimation
      ? {
          onAddAnimation: onAddGsapAnimation,
          onUpdateProperty: onUpdateGsapProperty,
          onUpdateMeta: onUpdateGsapMeta,
          onDeleteAnimation: onDeleteGsapAnimation,
          onAddProperty: onAddGsapProperty,
          onRemoveProperty: onRemoveGsapProperty ?? (() => {}),
          onUpdateFromProperty: onUpdateGsapFromProperty,
          onAddFromProperty: onAddGsapFromProperty,
          onRemoveFromProperty: onRemoveGsapFromProperty,
          onSetArcPath,
          onUpdateArcSegment,
          onUnroll,
          onUpdateKeyframeEase,
          onUpdateSegmentEase,
          onSetAllKeyframeEases,
        }
      : null;
  const showMotionEffects = gsapEffectHandlers !== null;
  const showMotionGroup = showMotionTiming || showMotionEffects;

  const groups: FlatGroupDescriptor[] = [];
  if (isTextEditable) {
    groups.push({
      id: "text",
      title: "Text",
      summary: formatTextFieldPreview(element.textFields[0]?.value ?? ""),
      content: (
        <FlatTextSection
          element={element}
          styles={styles}
          fontAssets={fontAssets}
          onImportFonts={onImportFonts}
          onSetText={onSetText}
          onSetTextFieldStyle={onSetTextFieldStyle}
          onPreviewTextFieldStyle={onPreviewTextFieldStyle}
          onAddTextField={onAddTextField}
          onRemoveTextField={onRemoveTextField}
        />
      ),
    });
  }
  if (showEditableSections) {
    const opacityValue = parseFloat(styles.opacity ?? "1");
    const opacityPct = Math.round((Number.isFinite(opacityValue) ? opacityValue : 1) * 100);
    groups.push({
      id: "style",
      title: "Style",
      summary: `fill ${styles["background-image"] && styles["background-image"] !== "none" ? "image/gradient" : styles["background-color"] ? "set" : "none"} · ${opacityPct}%`,
      content: (
        <FlatStyleSection
          projectId={projectId}
          element={element}
          styles={styles}
          assets={assets}
          onSetStyle={onSetStyle}
          onPreviewStyle={onPreviewStyle}
          onImportAssets={onImportAssets}
          gsapBorderRadius={gsapBorderRadius}
        />
      ),
    });
  }
  if (sections.layout) {
    groups.push({
      id: "layout",
      title: "Layout",
      summary: `${formatPxMetricValue(displayX)},${formatPxMetricValue(displayY)} · ${Math.round(displayW)}×${Math.round(displayH)}`,
      content: (
        <FlatLayoutSection
          element={element}
          styles={styles}
          onSetStyle={onSetStyle}
          disabled={!element.capabilities.canEditStyles}
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
          currentPct={currentPct}
          seekFromKfPct={seekFromKfPct}
          animIdForProp={animIdForProp}
          resolveAnimIdForProp={animIdForProp}
          gsapRuntimeValues={gsapRuntimeValues}
          gsapKeyframes={navKeyframes}
          elStart={elStart}
          elDuration={elDuration}
          onCommitAnimatedProperty={onCommitAnimatedProperty}
          onCommitAnimatedProperties={onCommitAnimatedProperties}
          onSeekToTime={onSeekToTime}
          onRemoveKeyframe={onRemoveKeyframe}
          onConvertToKeyframes={onConvertToKeyframes}
          onLivePreviewProps={createGsapLivePreview(previewIframeRef ?? { current: null })}
        />
      ),
    });
  }
  if (showMotionGroup) {
    groups.push({
      id: "motion",
      title: "Motion",
      summary: `${gsapAnimations.length} effect${gsapAnimations.length === 1 ? "" : "s"}`,
      content: (
        <FlatMotionSection
          element={element}
          animations={gsapAnimations}
          showTiming={showMotionTiming}
          showEffects={showMotionEffects}
          multipleTimelines={gsapMultipleTimelines}
          unsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
          onSetAttribute={onSetAttribute}
          onSetAttributes={onSetAttributes}
          {...(gsapEffectHandlers ?? EMPTY_GSAP_EFFECT_HANDLERS)}
        />
      ),
    });
  }
  if (sections.colorGrading) {
    groups.push({
      id: "grade",
      title: "Grade",
      accessory: <FlatColorGradingAccessory state={colorGradingController} />,
      summary: `${colorGradingController.grading.preset ?? "neutral"} · ${Math.round(colorGradingController.grading.intensity * 100)}%`,
      content: (
        <FlatColorGradingSection
          grading={colorGradingController.grading}
          assets={assets}
          onImportAssets={onImportAssets}
          onCommitColorGrading={colorGradingController.commitColorGrading}
          onPreviewColorGrading={colorGradingController.previewColorGrading}
          applyScope={colorGradingController.applyScope}
          applyBusy={colorGradingController.applyBusy}
          onSetApplyScope={colorGradingController.setApplyScope}
          onApplyToScope={() => void colorGradingController.applyToScope()}
          onApplyScopeAvailable={Boolean(onApplyColorGradingScope)}
          mediaMetadata={colorGradingController.mediaMetadata}
          presetPreviews={colorGradingController.presetPreviews}
          onRequestPresetPreviews={colorGradingController.requestPresetPreviews}
          captureGradedFrame={colorGradingController.captureGradedFrame}
        />
      ),
    });
    const activeEffects = activeColorGradingEffectCount(colorGradingController.grading);
    const effectsProps = {
      grading: colorGradingController.grading,
      onCommitColorGrading: colorGradingController.commitColorGrading,
    };
    groups.push({
      id: "effects",
      title: "Effects",
      accessory: <FlatEffectsAccessory {...effectsProps} />,
      summary: activeEffects ? `${activeEffects} active` : "none",
      content: (
        <FlatEffectsSection
          {...effectsProps}
          previews={colorGradingController.effectPreviews}
          presetPreviews={colorGradingController.presetPreviews}
          onPreviewColorGrading={colorGradingController.previewColorGrading}
          onRequestEffectPreviews={colorGradingController.requestEffectPreviews}
          onRequestPresetPreviews={colorGradingController.requestPresetPreviews}
        />
      ),
    });
    if (onAddMediaOverlay) {
      groups.push({
        id: "overlays",
        title: "Overlays",
        summary: "add layer",
        content: (
          <FlatOverlaysSection
            onAddOverlay={(blockName) =>
              onAddMediaOverlay(
                blockName,
                deriveMediaOverlayPlacement(element, { start: elStart, duration: elDuration }),
              )
            }
          />
        ),
      });
    }
  }
  if (sections.media) {
    groups.push({
      id: "media",
      title: "Media",
      summary: element.tagName,
      content: (
        <FlatMediaSection
          projectDir={projectDir}
          element={element}
          styles={styles}
          onSetStyle={onSetStyle}
          onSetAttribute={onSetAttribute}
          onSetHtmlAttribute={onSetHtmlAttribute}
          onRemoveBackground={onRemoveBackground}
        />
      ),
    });
  }

  const openIndex = groups.findIndex((g) => g.id === openGroupId);
  const beforeOpen = openIndex === -1 ? groups : groups.slice(0, openIndex);
  const openGroup = openIndex === -1 ? null : groups[openIndex];
  const afterOpen = openIndex === -1 ? [] : groups.slice(openIndex + 1);
  const renderClosedGroup = (group: FlatGroupDescriptor) => (
    <DesignPanelInputProvider key={group.id} section={slugifyDesignInput(group.title)}>
      <FlatGroupHeader
        title={group.title}
        isOpen={false}
        onToggleOpen={() => toggleOpen(group.id)}
        summary={group.summary}
        animateEntrance={justToggledIds.includes(group.id)}
      />
    </DesignPanelInputProvider>
  );

  return (
    <DesignPanelInputProvider ui="flat">
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1">
        <DesignPanelInputProvider section="header">
          <PropertyPanelFlatHeader
            name={element.label}
            meta={`${sourceLabel} · ${element.tagName}`}
            elementKind={elementKind}
            hidden={selectedElementHidden}
            onToggleHidden={
              selectedElementId && onToggleElementHidden
                ? () => void onToggleElementHidden(selectedElementId, !selectedElementHidden)
                : undefined
            }
            copied={clipboardCopied}
            onCopy={onCopyElementInfo}
            onClear={onClearSelection}
            onUngroup={onUngroup}
            showUngroup={Boolean(onUngroup && element.dataAttributes["hf-group"] != null)}
          />
        </DesignPanelInputProvider>
        <div
          ref={panelBodyRef}
          data-flat-panel-body="true"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {beforeOpen.map(renderClosedGroup)}
          {openGroup && (
            <DesignPanelInputProvider section={slugifyDesignInput(openGroup.title)}>
              <div data-flat-group-open="true" className="flex min-h-[180px] flex-none flex-col">
                <FlatGroupHeader
                  title={openGroup.title}
                  isOpen
                  onToggleOpen={() => toggleOpen(openGroup.id)}
                  accessory={openGroup.accessory}
                  animateEntrance={justToggledIds.includes(openGroup.id)}
                />
                <div
                  className={`${justToggledIds.includes(openGroup.id) ? "hf-flat-group-enter " : ""}min-h-0 flex-1 overflow-y-auto border-b border-panel-hairline bg-panel-bg-inset px-4 py-3 shadow-[inset_0_2px_4px_-1px_rgba(0,0,0,0.5)]`}
                >
                  {openGroup.content}
                </div>
              </div>
            </DesignPanelInputProvider>
          )}
          {afterOpen.map(renderClosedGroup)}
        </div>
        <DesignPanelInputProvider section="footer">
          <PropertyPanelFlatFooter
            onAskAgent={onAskAgent}
            recordingState={recordingState}
            recordingDuration={recordingDuration}
            onToggleRecording={onToggleRecording}
          />
        </DesignPanelInputProvider>
      </div>
    </DesignPanelInputProvider>
  );
}
