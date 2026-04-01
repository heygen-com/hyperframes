import { memo, useCallback, useState } from "react";
import { useCaptionStore } from "../store";
import type { CaptionStyle, CaptionContainerStyle } from "../types";
import { CaptionAnimationPanel } from "./CaptionAnimationPanel";

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

interface CaptionPropertyPanelProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export const CaptionPropertyPanel = memo(function CaptionPropertyPanel({
  iframeRef,
}: CaptionPropertyPanelProps) {
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectedGroupId = useCaptionStore((s) => s.selectedGroupId);
  const updateSelectedStyle = useCaptionStore((s) => s.updateSelectedStyle);
  const updateGroupStyle = useCaptionStore((s) => s.updateGroupStyle);
  const updateGroupContainer = useCaptionStore((s) => s.updateGroupContainer);

  const [activeTab, setActiveTab] = useState<"style" | "animation">("style");

  // Resolve effective style for the first selected segment
  const firstSegmentId = selectedSegmentIds.size > 0 ? [...selectedSegmentIds][0] : undefined;
  const firstSegment = model?.segments.get(firstSegmentId ?? "");

  // Find the group that owns the first segment
  let ownerGroupId: string | null = null;
  let ownerGroupIndex = -1;
  if (model && firstSegmentId) {
    for (let gi = 0; gi < model.groupOrder.length; gi++) {
      const gid = model.groupOrder[gi];
      const group = model.groups.get(gid);
      if (group && group.segmentIds.includes(firstSegmentId)) {
        ownerGroupId = gid;
        ownerGroupIndex = gi;
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

  /**
   * Apply a CSS style change to selected word elements in the iframe DOM in real time.
   * Maps CaptionStyle property names to CSS properties.
   */
  const applyToIframeDom = useCallback(
    (updates: Partial<CaptionStyle>) => {
      const iframe = iframeRef.current;
      if (!iframe || !model) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");

      // Build list of word elements to update
      const targetEls: HTMLElement[] = [];
      for (const segId of selectedSegmentIds) {
        // Find which group and word index
        for (let gi = 0; gi < model.groupOrder.length; gi++) {
          const group = model.groups.get(model.groupOrder[gi]);
          if (!group) continue;
          const wi = group.segmentIds.indexOf(segId);
          if (wi < 0) continue;
          const groupEl = groupEls[gi];
          if (!groupEl) continue;
          const wordEl = groupEl.querySelectorAll<HTMLElement>(":scope > span")[wi];
          if (wordEl) targetEls.push(wordEl);
          break;
        }
      }

      // Apply CSS updates
      for (const el of targetEls) {
        if (updates.fontFamily !== undefined) el.style.fontFamily = updates.fontFamily;
        if (updates.fontSize !== undefined) el.style.fontSize = `${updates.fontSize}px`;
        if (updates.fontWeight !== undefined) el.style.fontWeight = String(updates.fontWeight);
        if (updates.fontStyle !== undefined) el.style.fontStyle = updates.fontStyle;
        if (updates.textDecoration !== undefined) el.style.textDecoration = updates.textDecoration;
        if (updates.textTransform !== undefined) el.style.textTransform = updates.textTransform;
        if (updates.letterSpacing !== undefined) el.style.letterSpacing = `${updates.letterSpacing}px`;
        // For activeColor/dimColor, modify GSAP tweens on this element
        if (updates.activeColor !== undefined || updates.dimColor !== undefined) {
          try {
            const iframeGsap = (iframeRef.current?.contentWindow as unknown as {
              gsap?: { getTweensOf: (el: HTMLElement) => Array<{ vars: Record<string, unknown> }> };
            })?.gsap;
            if (iframeGsap) {
              const tweens = iframeGsap.getTweensOf(el);
              for (const tw of tweens) {
                if (tw.vars.color === undefined) continue;
                const colorVal = String(tw.vars.color);
                const isDim = colorVal.includes("0.25") || colorVal.includes("0.3") || colorVal.includes("0.2");
                if (isDim && updates.dimColor) {
                  tw.vars.color = updates.dimColor;
                } else if (!isDim && updates.activeColor) {
                  tw.vars.color = updates.activeColor;
                }
              }
            }
          } catch { /* cross-origin */ }
          // Set current visible color
          if (updates.dimColor) el.style.color = updates.dimColor;
          if (updates.activeColor) el.style.color = updates.activeColor;
        }
        if (updates.opacity !== undefined) el.style.opacity = String(updates.opacity);
        if (updates.strokeWidth !== undefined || updates.strokeColor !== undefined) {
          const sw = updates.strokeWidth ?? effectiveStyle.strokeWidth ?? 0;
          const sc = updates.strokeColor ?? effectiveStyle.strokeColor ?? "#000";
          el.style.setProperty("-webkit-text-stroke", `${sw}px ${sc}`);
        }
        if (updates.rotation !== undefined) {
          el.style.transform = `rotate(${updates.rotation}deg)`;
        }
        if (updates.scaleX !== undefined || updates.scaleY !== undefined) {
          const sx = updates.scaleX ?? effectiveStyle.scaleX ?? 1;
          const sy = updates.scaleY ?? effectiveStyle.scaleY ?? 1;
          el.style.transform = `scale(${sx}, ${sy})`;
        }
      }
    },
    [iframeRef, model, selectedSegmentIds, effectiveStyle.strokeWidth, effectiveStyle.strokeColor, effectiveStyle.scaleX, effectiveStyle.scaleY],
  );

  /**
   * Apply container style changes to the group element in the iframe DOM.
   */
  const applyContainerToIframeDom = useCallback(
    (updates: Partial<CaptionContainerStyle>) => {
      const iframe = iframeRef.current;
      if (!iframe || ownerGroupIndex < 0) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");
      const groupEl = groupEls[ownerGroupIndex];
      if (!groupEl) return;

      if (updates.backgroundColor !== undefined) groupEl.style.backgroundColor = updates.backgroundColor;
      if (updates.backgroundOpacity !== undefined) groupEl.style.opacity = String(updates.backgroundOpacity);
      if (updates.borderRadius !== undefined) groupEl.style.borderRadius = `${updates.borderRadius}px`;
      if (updates.paddingTop !== undefined || updates.paddingRight !== undefined ||
          updates.paddingBottom !== undefined || updates.paddingLeft !== undefined) {
        const pt = updates.paddingTop ?? containerStyle?.paddingTop ?? 0;
        const pr = updates.paddingRight ?? containerStyle?.paddingRight ?? 0;
        const pb = updates.paddingBottom ?? containerStyle?.paddingBottom ?? 0;
        const pl = updates.paddingLeft ?? containerStyle?.paddingLeft ?? 0;
        groupEl.style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
      }
    },
    [iframeRef, ownerGroupIndex, containerStyle],
  );

  // All hooks must be called before any early return
  const handleStyleChange = useCallback(
    (updates: Partial<CaptionStyle>) => {
      // Update model (for persistence)
      if (selectedGroupId) {
        updateGroupStyle(selectedGroupId, updates);
      } else {
        updateSelectedStyle(updates);
      }
      // Update iframe DOM (for real-time feedback)
      applyToIframeDom(updates);
    },
    [selectedGroupId, updateGroupStyle, updateSelectedStyle, applyToIframeDom],
  );

  const handleContainerChange = useCallback(
    (updates: Partial<CaptionContainerStyle>) => {
      if (activeGroupId) {
        updateGroupContainer(activeGroupId, updates);
      }
      applyContainerToIframeDom(updates);
    },
    [activeGroupId, updateGroupContainer, applyContainerToIframeDom],
  );

  // Empty state — after all hooks
  if (selectedSegmentIds.size === 0) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-center">
        <p className="text-xs text-neutral-500">Select caption words to edit their style</p>
      </div>
    );
  }

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
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-2xs text-neutral-500">
            {countLabel}
            {groupLabel}
          </span>
        </div>
        {/* Tab switcher */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("style")}
            className={[
              "flex-1 py-0.5 rounded text-2xs font-medium transition-colors",
              activeTab === "style"
                ? "bg-studio-accent/20 text-studio-accent border border-studio-accent/50"
                : "text-neutral-500 border border-neutral-800 hover:text-neutral-300 hover:border-neutral-600",
            ].join(" ")}
          >
            Style
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("animation")}
            className={[
              "flex-1 py-0.5 rounded text-2xs font-medium transition-colors",
              activeTab === "animation"
                ? "bg-studio-accent/20 text-studio-accent border border-studio-accent/50"
                : "text-neutral-500 border border-neutral-800 hover:text-neutral-300 hover:border-neutral-600",
            ].join(" ")}
          >
            Animation
          </button>
        </div>
      </div>

      {/* Animation tab */}
      {activeTab === "animation" && <CaptionAnimationPanel />}

      {/* Style tab — Scrollable content */}
      {activeTab === "style" && (
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
                  onClick={() =>
                    handleStyleChange({
                      fontStyle: isItalic ? "normal" : "italic",
                    })
                  }
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
            <Row label="Active">
              <ColorInput
                value={effectiveStyle.activeColor ?? "#ffffff"}
                onChange={(v) => handleStyleChange({ activeColor: v })}
              />
            </Row>

            <Row label="Dim">
              <ColorInput
                value={effectiveStyle.dimColor ?? "rgba(255,255,255,0.3)"}
                onChange={(v) => handleStyleChange({ dimColor: v })}
              />
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
                  onChange={(e) =>
                    handleContainerChange({
                      borderRadius: Number(e.target.value),
                    })
                  }
                  className={inputCls}
                />
              </Row>
            </Section>
          )}
        </div>
      )}
    </div>
  );
});
