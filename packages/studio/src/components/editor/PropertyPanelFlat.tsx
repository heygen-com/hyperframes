import { useState } from "react";
import { resolveEditingSections } from "@hyperframes/core/editing";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import type { PropertyPanelProps } from "./propertyPanelHelpers";
import { PropertyPanelFlatHeader } from "./PropertyPanelFlatHeader";
import { PropertyPanelFlatFooter } from "./PropertyPanelFlatFooter";
import { FlatGroup } from "./propertyPanelFlatPrimitives";
import { FlatTextSection } from "./propertyPanelFlatTextSection";
import { formatTextFieldPreview, StyleSections } from "./propertyPanelSections";
import { TimingSection } from "./propertyPanelTimingSection";
import { ColorGradingSection } from "./propertyPanelColorGradingSection";
import { MediaSection } from "./propertyPanelMediaSection";

type EditingSections = ReturnType<typeof resolveEditingSections>;

/**
 * The flat "Ledger" inspector shell (design_handoff_studio_inspector).
 *
 * Extracted from PropertyPanel so that file stays under the 600-LOC gate
 * (same one-directional-import precedent as FlatTextSection). Rendered only
 * when STUDIO_FLAT_INSPECTOR_ENABLED is on; owns the one-open/pin group state.
 *
 * Intentionally omits the Layout `Section` and `GsapAnimationSection` (Motion)
 * — flattening those is Layout/Motion plan territory (plans 3–4). A text
 * element with the flag on will not show Layout/Motion controls; that
 * regression is scoped and acceptable for an unreleased, flag-gated feature.
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
  | "recordingState"
  | "recordingDuration"
  | "onToggleRecording"
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
}) {
  // Defaulting to "text" is harmless for a non-text element even though the
  // Text FlatGroup won't render (nothing else reads openGroupId yet) — this
  // only matters once a second FlatGroup exists (Plan 2+), at which point a
  // non-text element should default-open that group instead.
  const [openGroupId, setOpenGroupId] = useState<string>("text");
  const [pinnedGroupIds, setPinnedGroupIds] = useState<string[]>([]);

  const isTextEditable = isTextEditableSelection(element);
  const elementKind = sections.media ? "media" : element.textFields.length > 0 ? "text" : "other";

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
        {isTextEditable && (
          <FlatGroup
            title="Text"
            isOpen={openGroupId === "text" || pinnedGroupIds.includes("text")}
            isPinned={pinnedGroupIds.includes("text")}
            onToggleOpen={() => setOpenGroupId((current) => (current === "text" ? "" : "text"))}
            onTogglePin={() =>
              setPinnedGroupIds((current) =>
                current.includes("text")
                  ? current.filter((id) => id !== "text")
                  : [...current, "text"],
              )
            }
            summary={formatTextFieldPreview(element.textFields[0]?.value ?? "")}
          >
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
          </FlatGroup>
        )}

        {sections.timing && (
          <TimingSection
            element={element}
            animations={gsapAnimations}
            onSetAttribute={onSetAttribute}
          />
        )}
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
      <PropertyPanelFlatFooter
        onAskAgent={onAskAgent}
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        onToggleRecording={onToggleRecording}
      />
    </div>
  );
}
