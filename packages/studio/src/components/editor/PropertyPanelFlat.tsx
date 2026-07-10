import { type ReactNode, useState } from "react";
import { resolveEditingSections } from "@hyperframes/core/editing";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import type { PropertyPanelProps } from "./propertyPanelHelpers";
import { formatPxMetricValue } from "./propertyPanelHelpers";
import { PropertyPanelFlatHeader } from "./PropertyPanelFlatHeader";
import { PropertyPanelFlatFooter } from "./PropertyPanelFlatFooter";
import { FlatGroup, PinnedGroupRow, PinnedZoneDivider } from "./propertyPanelFlatPrimitives";
import { FlatTextSection } from "./propertyPanelFlatTextSection";
import { FlatStyleSection } from "./propertyPanelFlatStyleSections";
import { FlatLayoutSection } from "./propertyPanelFlatLayoutSection";
import { FlatMotionSection } from "./propertyPanelFlatMotionSection";
import { FlatMediaSection } from "./propertyPanelFlatMediaSection";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";
import { createGsapLivePreview } from "./gsapLivePreview";
import { formatTextFieldPreview, StyleSections } from "./propertyPanelSections";
import { STUDIO_GSAP_PANEL_ENABLED } from "./manualEditingAvailability";
import { ColorGradingSection } from "./propertyPanelColorGradingSection";
import { useColorGradingController } from "./useColorGradingController";
import { usePersistedPinnedGroups } from "../../hooks/usePersistedPinnedGroups";
import {
  FlatColorGradingAccessory,
  FlatColorGradingSection,
} from "./propertyPanelFlatColorGradingSection";

type EditingSections = ReturnType<typeof resolveEditingSections>;

type FlatGroupDescriptor = {
  id: string;
  title: string;
  summary?: string;
  accessory?: ReactNode;
  content: ReactNode;
};

// Type-only fallback for the Motion effect-card callbacks. Used solely to
// satisfy FlatMotionSection's required-callback shape when the effect list is
// gated off (showEffects === false, so none of these are ever invoked). Keeps
// the gated-off path free of `!` non-null assertions — the real, narrowed
// handlers flow through only when the double-gate below passes.
const EMPTY_GSAP_EFFECT_HANDLERS = {
  onAddAnimation: () => {},
  onUpdateProperty: () => {},
  onUpdateMeta: () => {},
  onDeleteAnimation: () => {},
  onAddProperty: () => {},
  onRemoveProperty: () => {},
};

/**
 * The flat "Ledger" inspector shell (design_handoff_studio_inspector).
 *
 * Extracted from PropertyPanel so that file stays under the 600-LOC gate
 * (same one-directional-import precedent as FlatTextSection). Rendered only
 * when STUDIO_FLAT_INSPECTOR_ENABLED is on; owns the one-open/pin group state.
 *
 * The Text/Style/Layout/Motion/Media groups share the one-open accordion. The
 * legacy Color-Grading section renders unchanged below the flat groups.
 */
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
  onSetAttribute,
  onSetAttributeLive,
  onApplyColorGradingScope,
  onSetHtmlAttribute,
  onRemoveBackground,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent,
  onToggleElementHidden,
  onImportAssets,
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
  // Renamed: PropertyPanel.tsx still computes/passes these for its own legacy
  // (non-flat) panel, but the flat path recomputes its own basis below via
  // deriveElementTiming so it agrees with Motion's Timing row — ignore the
  // parent's naive `elDuration ?? 1` fallback.
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
  onSetAllKeyframeEases,
}: Pick<
  PropertyPanelProps,
  | "projectId"
  | "projectDir"
  | "assets"
  | "previewIframeRef"
  | "onClearSelection"
  | "onUngroup"
  | "onSetStyle"
  | "onSetAttribute"
  | "onSetAttributeLive"
  | "onApplyColorGradingScope"
  | "onSetHtmlAttribute"
  | "onRemoveBackground"
  | "onSetText"
  | "onSetTextFieldStyle"
  | "onAddTextField"
  | "onRemoveTextField"
  | "onAskAgent"
  | "onToggleElementHidden"
  | "onImportAssets"
  | "onImportFonts"
  | "fontAssets"
  | "gsapAnimations"
  | "gsapMultipleTimelines"
  | "gsapUnsupportedTimelinePattern"
  | "onUpdateGsapProperty"
  | "onUpdateGsapMeta"
  | "onDeleteGsapAnimation"
  | "onAddGsapProperty"
  | "onRemoveGsapProperty"
  | "onUpdateGsapFromProperty"
  | "onAddGsapFromProperty"
  | "onRemoveGsapFromProperty"
  | "onAddGsapAnimation"
  | "onSetArcPath"
  | "onUpdateArcSegment"
  | "onUnroll"
  | "onUpdateKeyframeEase"
  | "onSetAllKeyframeEases"
  | "recordingState"
  | "recordingDuration"
  | "onToggleRecording"
> &
  // Layout-group values (Plan 3a Task 5). All are derived locals or handlers in
  // PropertyPanel; compose their exact shapes from FlatLayoutSection's own props
  // via Pick so a signature change there propagates here instead of drifting.
  Pick<
    Parameters<typeof FlatLayoutSection>[0],
    | "displayX"
    | "displayY"
    | "displayW"
    | "displayH"
    | "displayR"
    | "manualOffsetEditingDisabled"
    | "manualSizeEditingDisabled"
    | "manualRotationEditingDisabled"
    | "commitManualOffset"
    | "commitManualSize"
    | "commitManualRotation"
    | "gsapAnimId"
    | "navKeyframes"
    | "animIdForProp"
    | "gsapRuntimeValues"
    | "elStart"
    | "elDuration"
    | "onCommitAnimatedProperty"
    | "onCommitAnimatedProperties"
    | "onSeekToTime"
    | "onRemoveKeyframe"
    | "onConvertToKeyframes"
  > & {
    element: DomEditSelection;
    styles: Record<string, string>;
    sections: EditingSections;
    sourceLabel: string;
    gsapBorderRadius: { tl: number; tr: number; br: number; bl: number } | null;
    showEditableSections: boolean;
    selectedElementHidden: boolean;
    selectedElementId: string | null;
    clipboardCopied: boolean;
    onCopyElementInfo: () => void;
    currentTime: number;
  }) {
  // Lazy initializer: pick whichever group actually renders for this element
  // (Text if text-editable, else Style if style-editable, else none open) so a
  // style-only element doesn't start with everything collapsed. Only runs on
  // mount — PropertyPanel.tsx keys <PropertyPanelFlat> by element identity so
  // switching the selection re-mounts this component and re-derives the
  // default instead of preserving stale state across unrelated elements.
  const [openGroupId, setOpenGroupId] = useState<string>(() =>
    isTextEditableSelection(element)
      ? "text"
      : showEditableSections
        ? "style"
        : sections.media
          ? "media"
          : "layout",
  );

  // Grade group state. Called unconditionally (React rules-of-hooks) even when
  // sections.colorGrading is false — unlike the legacy ColorGradingSection,
  // which is only mounted when the section is active, PropertyPanelFlat is not
  // remounted per-section so the hook must run every render. Shares one state
  // object between the group's header accessory (compare/status/reset) and its
  // body (the FlatColorGradingSection controls).
  const colorGradingController = useColorGradingController({
    projectId,
    element,
    previewIframeRef,
    onSetAttributeLive,
    onApplyScope: onApplyColorGradingScope,
  });

  const isTextEditable = isTextEditableSelection(element);
  const elementKind = sections.media ? "media" : element.textFields.length > 0 ? "text" : "other";
  const { pinnedGroupIds, togglePin } = usePersistedPinnedGroups(elementKind);
  const toggleOpen = (groupId: string) =>
    setOpenGroupId((current) => (current === groupId ? "" : groupId));
  // Basis for the Layout keyframe gutter (X/Y/W/H/Angle + 3D Transform) —
  // must agree with Motion's Timing row (FlatTimingRow), which infers the
  // range from animations when there's no explicit data-duration. Computed
  // here (not threaded from PropertyPanel) both to keep that file under its
  // 600-LOC gate and because element/gsapAnimations are already in scope.
  const { start: elStart, duration: elDuration } = deriveElementTiming(element, gsapAnimations);
  // Trivial percentage→time seek, derived here rather than threaded from
  // PropertyPanel (keeps that file under its 600-LOC gate).
  const seekFromKfPct = (pct: number) => onSeekToTime?.(elStart + (pct / 100) * elDuration);
  // Playhead position within the SAME corrected elStart/elDuration basis as
  // seekFromKfPct above — recomputed here (not threaded as `currentPct` from
  // PropertyPanel, which still derives it against its own naive basis for the
  // legacy panel) so KeyframeNavigation's diamond active-state and prev/next
  // arrow targeting agree with where a keyframe click actually seeks to
  // (follow-up fix to 684ec4e87, which corrected the seek basis but left this
  // one still naive).
  const currentPct = elDuration > 0 ? ((currentTime - elStart) / elDuration) * 100 : 0;

  // Motion group double-gate — reproduces the legacy PropertyPanel gate exactly:
  //  • Timing (sections.timing) shows via resolveEditingSections, same as today.
  //  • The effect-card list shows only when STUDIO_GSAP_PANEL_ENABLED is on AND
  //    all five edit handlers are present (identical to PropertyPanel's legacy
  //    `<GsapAnimationSection>` guard).
  // Computing the narrowed handler bundle inside the `&&`-guarded ternary lets
  // TypeScript prove each handler non-undefined without a `!` assertion; the
  // noop bundle only fills the type when the gate is off (never invoked, since
  // FlatMotionSection guards every call behind showEffects).
  const showMotionTiming = Boolean(sections.timing);
  const gsapEffectHandlers =
    STUDIO_GSAP_PANEL_ENABLED &&
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
          onSetAllKeyframeEases,
        }
      : null;
  const showMotionEffects = gsapEffectHandlers !== null;
  const showMotionGroup = showMotionTiming || showMotionEffects;

  // Ordered group descriptors — one per FlatGroup this panel renders, gated by
  // the same conditions the inline JSX used. Partitioned into pinned/unpinned
  // below so pinned groups render first (always open, no accordion) above the
  // PinnedZoneDivider, with the rest in the one-open accordion beneath it.
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
          onAddTextField={onAddTextField}
          onRemoveTextField={onRemoveTextField}
        />
      ),
    });
  }
  if (showEditableSections) {
    groups.push({
      id: "style",
      title: "Style",
      summary: `fill ${styles["background-image"] && styles["background-image"] !== "none" ? "image/gradient" : styles["background-color"] ? "set" : "none"} · ${Math.round((parseFloat(styles.opacity ?? "1") || 1) * 100)}%`,
      content: (
        <FlatStyleSection
          projectId={projectId}
          element={element}
          styles={styles}
          assets={assets}
          onSetStyle={onSetStyle}
          onImportAssets={onImportAssets}
          gsapBorderRadius={gsapBorderRadius}
        />
      ),
    });
  }
  groups.push({
    id: "layout",
    title: "Layout",
    accessory: <span className="text-[9px] text-panel-text-5">drag values to scrub</span>,
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
          applyScope={colorGradingController.applyScope}
          applyBusy={colorGradingController.applyBusy}
          onSetApplyScope={colorGradingController.setApplyScope}
          onApplyToScope={() => void colorGradingController.applyToScope()}
          onApplyScopeAvailable={Boolean(onApplyColorGradingScope)}
          mediaMetadata={colorGradingController.mediaMetadata}
        />
      ),
    });
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

  const pinned = groups.filter((g) => pinnedGroupIds.includes(g.id));
  const unpinned = groups.filter((g) => !pinnedGroupIds.includes(g.id));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1">
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
      <div className="flex-1 overflow-y-auto">
        {pinned.map((g) => (
          <PinnedGroupRow
            key={g.id}
            title={g.title}
            accessory={g.accessory}
            onUnpin={() => togglePin(g.id)}
          >
            {g.content}
          </PinnedGroupRow>
        ))}
        {pinned.length > 0 && unpinned.length > 0 && <PinnedZoneDivider />}
        {unpinned.map((g) => (
          <FlatGroup
            key={g.id}
            title={g.title}
            isOpen={openGroupId === g.id}
            isPinned={false}
            onToggleOpen={() => toggleOpen(g.id)}
            onTogglePin={() => togglePin(g.id)}
            summary={g.summary}
            accessory={g.accessory}
          >
            {g.content}
          </FlatGroup>
        ))}
        {sections.colorGrading && (
          <ColorGradingSection
            key={[
              element.id ?? "",
              element.hfId ?? "",
              element.selector ?? "",
              String(element.selectorIndex ?? ""),
            ].join("|")}
            projectId={projectId}
            element={element}
            assets={assets}
            previewIframeRef={previewIframeRef}
            onImportAssets={onImportAssets}
            onSetAttributeLive={onSetAttributeLive}
            onApplyScope={onApplyColorGradingScope}
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
            // Flex now lives in the flat Layout group (LayoutFlexBlock); suppress
            // the legacy StyleSections Flex `Section` so it renders exactly once.
            hideFlex
          />
        )}
      </div>
      <PropertyPanelFlatFooter
        onAskAgent={onAskAgent}
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        onToggleRecording={onToggleRecording}
      />
    </div>
  );
}
