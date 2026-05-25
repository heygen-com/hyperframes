import { memo } from "react";
import { Clock, Eye, Layers, MessageSquare, Move, X } from "../../icons/SystemIcons";
import { type DomEditSelection } from "./domEditing";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import type { ImportedFontAsset } from "./fontAssets";
import {
  EMPTY_STYLES,
  formatPxMetricValue,
  LABEL,
  parsePxMetricValue,
  RESPONSIVE_GRID,
} from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";
import { isMediaElement, MediaSection } from "./propertyPanelMediaSection";
import { TextSection, StyleSections } from "./propertyPanelSections";

// Re-export helpers that external consumers import from this module
export {
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  clampPanelNumber,
  getCssFilterFunctionPx,
  getClipPathInsetPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  normalizePanelPxValue,
  setCssFilterFunctionPx,
} from "./propertyPanelHelpers";

interface PropertyPanelProps {
  projectId: string;
  projectDir: string | null;
  assets: string[];
  element: DomEditSelection | null;
  multiSelectCount?: number;
  copiedAgentPrompt: boolean;
  onClearSelection: () => void;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetHtmlAttribute: (attr: string, value: string | null) => void | Promise<void>;
  onSetManualOffset: (element: DomEditSelection, next: { x: number; y: number }) => void;
  onSetManualSize: (element: DomEditSelection, next: { width: number; height: number }) => void;
  onSetManualRotation: (element: DomEditSelection, next: { angle: number }) => void;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
  onAskAgent: () => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
  fontAssets?: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
}

/* ------------------------------------------------------------------ */
/*  TimingSection                                                      */
/* ------------------------------------------------------------------ */

function formatTimingValue(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0.00s";
  return `${seconds.toFixed(2)}s`;
}

function parseTimingValue(input: string): number | null {
  const cleaned = input.replace(/s$/i, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function TimingSection({
  element,
  onSetAttribute,
}: {
  element: DomEditSelection;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
}) {
  const start = Number.parseFloat(element.dataAttributes.start ?? "0") || 0;
  const duration =
    Number.parseFloat(
      element.dataAttributes.duration ?? element.dataAttributes["hf-authored-duration"] ?? "0",
    ) || 0;
  const end = start + duration;

  const commitStart = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    void onSetAttribute("start", parsed.toFixed(2));
  };

  const commitDuration = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    void onSetAttribute("duration", parsed.toFixed(2));
  };

  const commitEnd = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= start) return;
    void onSetAttribute("duration", (parsed - start).toFixed(2));
  };

  return (
    <Section title="Timing" icon={<Clock size={15} />}>
      <div className={RESPONSIVE_GRID}>
        <MetricField label="Start" value={formatTimingValue(start)} onCommit={commitStart} />
        <MetricField label="End" value={formatTimingValue(end)} onCommit={commitEnd} />
      </div>
      <div className="mt-3">
        <MetricField
          label="Duration"
          value={formatTimingValue(duration)}
          onCommit={commitDuration}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  PropertyPanel                                                      */
/* ------------------------------------------------------------------ */

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
    const current = readStudioPathOffset(element.element);
    onSetManualOffset(element, {
      x: axis === "x" ? parsed : current.x,
      y: axis === "y" ? parsed : current.y,
    });
  };

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="border-b border-neutral-800 px-4 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={LABEL}>Document</div>
            <div className="mt-3 truncate text-[12px] font-semibold text-neutral-100">
              {element.label}
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClearSelection}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-colors hover:border-neutral-600 hover:text-neutral-200"
          >
            <X size={13} />
          </button>
        </div>
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAskAgent}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 text-[11px] font-medium text-neutral-100 transition-colors hover:border-studio-accent/40 hover:text-studio-accent"
          >
            <MessageSquare size={15} />
            <span>{copiedAgentPrompt ? "Prompt copied" : "Ask agent"}</span>
          </button>
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
            <MetricField
              label="X"
              value={formatPxMetricValue(manualOffset.x)}
              disabled={manualOffsetEditingDisabled}
              scrub
              onCommit={(next) => commitManualOffset("x", next)}
            />
            <MetricField
              label="Y"
              value={formatPxMetricValue(manualOffset.y)}
              disabled={manualOffsetEditingDisabled}
              scrub
              onCommit={(next) => commitManualOffset("y", next)}
            />
            <MetricField
              label="W"
              value={formatPxMetricValue(resolvedWidth)}
              disabled={manualSizeEditingDisabled}
              scrub
              onCommit={(next) => commitManualSize("width", next)}
            />
            <MetricField
              label="H"
              value={formatPxMetricValue(resolvedHeight)}
              disabled={manualSizeEditingDisabled}
              scrub
              onCommit={(next) => commitManualSize("height", next)}
            />
            <MetricField
              label="R"
              value={`${manualRotation.angle}°`}
              onCommit={(next) => commitManualRotation(next.replace("°", ""))}
            />
          </div>
          <div className="mt-3">
            <MetricField
              label="Z-index"
              value={String(parseInt(styles["z-index"] || "auto", 10) || 0)}
              scrub
              onCommit={(next) => onSetStyle("z-index", next)}
            />
          </div>
        </Section>

        {showEditableSections && (
          <StyleSections
            projectId={projectId}
            element={element}
            styles={styles}
            assets={assets}
            onSetStyle={onSetStyle}
            onImportAssets={onImportAssets}
          />
        )}
      </div>
    </div>
  );
});
