import { memo, useCallback } from "react";
import { useCaptionStore } from "../store";
import type { CaptionStyle, CaptionContainerStyle } from "../types";

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mt-2 mb-1.5">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-neutral-600 w-14 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  italic,
  underline,
  strikethrough,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={[
        "w-7 h-7 flex items-center justify-center rounded border text-xs font-mono transition-colors",
        active
          ? "bg-studio-accent/20 border-studio-accent/50 text-studio-accent"
          : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200",
      ].join(" ")}
      style={{
        fontStyle: italic ? "italic" : undefined,
        textDecoration: underline ? "underline" : strikethrough ? "line-through" : undefined,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared input class
// ---------------------------------------------------------------------------

const inputCls =
  "w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-2xs text-neutral-200 font-mono outline-none focus:border-neutral-600";

// ---------------------------------------------------------------------------
// Color + text input combo
// ---------------------------------------------------------------------------

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value.startsWith("#") ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-neutral-700 bg-transparent cursor-pointer flex-shrink-0 p-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CaptionPropertyPanel = memo(function CaptionPropertyPanel() {
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectedGroupId = useCaptionStore((s) => s.selectedGroupId);
  const updateSelectedStyle = useCaptionStore((s) => s.updateSelectedStyle);
  const updateGroupStyle = useCaptionStore((s) => s.updateGroupStyle);
  const updateGroupContainer = useCaptionStore((s) => s.updateGroupContainer);

  // Empty state
  if (selectedSegmentIds.size === 0) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-center">
        <p className="text-xs text-neutral-500">Select caption words to edit their style</p>
      </div>
    );
  }

  // Resolve effective style for the first selected segment
  const firstSegmentId = [...selectedSegmentIds][0];
  const firstSegment = model?.segments.get(firstSegmentId ?? "");

  // Find the group that owns the first segment
  let ownerGroupId: string | null = null;
  if (model && firstSegmentId) {
    for (const [gid, group] of model.groups) {
      if (group.segmentIds.includes(firstSegmentId)) {
        ownerGroupId = gid;
        break;
      }
    }
  }

  const groupStyle = ownerGroupId ? model?.groups.get(ownerGroupId)?.style : undefined;
  const segmentOverrides = firstSegment?.style ?? {};

  // Merge group style with segment overrides for display
  const effectiveStyle: Partial<CaptionStyle> = {
    ...groupStyle,
    ...segmentOverrides,
  };

  // Container style for background section
  const activeGroupId = selectedGroupId ?? ownerGroupId;
  const containerStyle = activeGroupId
    ? model?.groups.get(activeGroupId)?.containerStyle
    : undefined;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleStyleChange = useCallback(
    (updates: Partial<CaptionStyle>) => {
      if (selectedGroupId) {
        updateGroupStyle(selectedGroupId, updates);
      } else {
        updateSelectedStyle(updates);
      }
    },
    [selectedGroupId, updateGroupStyle, updateSelectedStyle],
  );

  const handleContainerChange = useCallback(
    (updates: Partial<CaptionContainerStyle>) => {
      if (activeGroupId) {
        updateGroupContainer(activeGroupId, updates);
      }
    },
    [activeGroupId, updateGroupContainer],
  );

  // ---------------------------------------------------------------------------
  // Derived style values with fallbacks
  // ---------------------------------------------------------------------------

  const fontFamily = effectiveStyle.fontFamily ?? "sans-serif";
  const fontSize = effectiveStyle.fontSize ?? 48;
  const fontWeight =
    typeof effectiveStyle.fontWeight === "number"
      ? effectiveStyle.fontWeight
      : Number(effectiveStyle.fontWeight ?? 700);
  const isItalic = effectiveStyle.fontStyle === "italic";
  const textDecoration = effectiveStyle.textDecoration ?? "none";
  const isUnderline = textDecoration.includes("underline");
  const isStrikethrough = textDecoration.includes("line-through");
  const textTransform = effectiveStyle.textTransform ?? "none";
  const letterSpacing = effectiveStyle.letterSpacing ?? 0;
  const color = effectiveStyle.color ?? "#ffffff";
  const opacity = effectiveStyle.opacity ?? 1;
  const strokeWidth = effectiveStyle.strokeWidth ?? 0;
  const strokeColor = effectiveStyle.strokeColor ?? "#000000";
  const x = effectiveStyle.x ?? 0;
  const y = effectiveStyle.y ?? 0;
  const rotation = effectiveStyle.rotation ?? 0;
  const scaleX = effectiveStyle.scaleX ?? 1;

  // Compute combined textDecoration string
  const buildTextDecoration = (
    underline: boolean,
    strike: boolean,
  ): CaptionStyle["textDecoration"] => {
    if (underline && strike) return "underline line-through";
    if (underline) return "underline";
    if (strike) return "line-through";
    return "none";
  };

  // Count label
  const countLabel =
    selectedSegmentIds.size === 1
      ? "1 segment selected"
      : `${selectedSegmentIds.size} segments selected`;
  const groupLabel = selectedGroupId ? " (group)" : "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-neutral-800 flex-shrink-0">
        <span className="text-2xs text-neutral-500">
          {countLabel}
          {groupLabel}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Typography */}
        <Section label="Typography">
          <Row label="Family">
            <input
              type="text"
              value={fontFamily}
              onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
              className={inputCls}
            />
          </Row>

          <Row label="Size">
            <input
              type="number"
              value={fontSize}
              onChange={(e) => handleStyleChange({ fontSize: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>

          <Row label="Weight">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={100}
                max={900}
                step={100}
                value={fontWeight}
                onChange={(e) => handleStyleChange({ fontWeight: Number(e.target.value) })}
                className="flex-1 accent-studio-accent"
              />
              <span className="text-2xs text-neutral-400 font-mono w-8 text-right flex-shrink-0">
                {fontWeight}
              </span>
            </div>
          </Row>

          <Row label="Style">
            <div className="flex items-center gap-1">
              <ToggleButton
                active={isItalic}
                onClick={() => handleStyleChange({ fontStyle: isItalic ? "normal" : "italic" })}
                label="I"
                italic
              />
              <ToggleButton
                active={isUnderline}
                onClick={() =>
                  handleStyleChange({
                    textDecoration: buildTextDecoration(!isUnderline, isStrikethrough),
                  })
                }
                label="U"
                underline
              />
              <ToggleButton
                active={isStrikethrough}
                onClick={() =>
                  handleStyleChange({
                    textDecoration: buildTextDecoration(isUnderline, !isStrikethrough),
                  })
                }
                label="S"
                strikethrough
              />
            </div>
          </Row>

          <Row label="Transform">
            <select
              value={textTransform}
              onChange={(e) =>
                handleStyleChange({
                  textTransform: e.target.value as CaptionStyle["textTransform"],
                })
              }
              className={inputCls}
            >
              <option value="none">none</option>
              <option value="uppercase">uppercase</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">capitalize</option>
            </select>
          </Row>

          <Row label="Spacing">
            <input
              type="number"
              value={letterSpacing}
              step={0.5}
              onChange={(e) => handleStyleChange({ letterSpacing: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>
        </Section>

        {/* Color & Fill */}
        <Section label="Color & Fill">
          <Row label="Color">
            <ColorInput value={color} onChange={(v) => handleStyleChange({ color: v })} />
          </Row>

          <Row label="Opacity">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => handleStyleChange({ opacity: Number(e.target.value) })}
                className="flex-1 accent-studio-accent"
              />
              <span className="text-2xs text-neutral-400 font-mono w-8 text-right flex-shrink-0">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          </Row>

          <Row label="Stroke W">
            <input
              type="number"
              value={strokeWidth}
              step={1}
              min={0}
              onChange={(e) => handleStyleChange({ strokeWidth: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>

          <Row label="Stroke C">
            <ColorInput
              value={strokeColor}
              onChange={(v) => handleStyleChange({ strokeColor: v })}
            />
          </Row>
        </Section>

        {/* Transform */}
        <Section label="Transform">
          <Row label="X">
            <input
              type="number"
              value={x}
              onChange={(e) => handleStyleChange({ x: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>

          <Row label="Y">
            <input
              type="number"
              value={y}
              onChange={(e) => handleStyleChange({ y: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>

          <Row label="Rotation">
            <input
              type="number"
              value={rotation}
              onChange={(e) => handleStyleChange({ rotation: Number(e.target.value) })}
              className={inputCls}
            />
          </Row>

          <Row label="Scale">
            <input
              type="number"
              value={scaleX}
              step={0.1}
              onChange={(e) =>
                handleStyleChange({
                  scaleX: Number(e.target.value),
                  scaleY: Number(e.target.value),
                })
              }
              className={inputCls}
            />
          </Row>
        </Section>

        {/* Background — group-level only */}
        {activeGroupId && containerStyle && (
          <Section label="Background">
            <Row label="Color">
              <ColorInput
                value={containerStyle.backgroundColor}
                onChange={(v) => handleContainerChange({ backgroundColor: v })}
              />
            </Row>

            <Row label="Padding">
              <input
                type="number"
                value={containerStyle.paddingTop}
                min={0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  handleContainerChange({
                    paddingTop: v,
                    paddingRight: v,
                    paddingBottom: v,
                    paddingLeft: v,
                  });
                }}
                className={inputCls}
              />
            </Row>

            <Row label="Radius">
              <input
                type="number"
                value={containerStyle.borderRadius}
                min={0}
                onChange={(e) => handleContainerChange({ borderRadius: Number(e.target.value) })}
                className={inputCls}
              />
            </Row>
          </Section>
        )}
      </div>
    </div>
  );
});
