import { memo, useCallback, useState } from "react";
import { useCaptionStore } from "../store";
import type { CaptionStyle } from "../types";
import { CaptionAnimationPanel } from "./CaptionAnimationPanel";
import { Section, Row, inputCls } from "./shared";

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

  const [activeTab, setActiveTab] = useState<"style" | "animation">("style");

  // Resolve effective style for the first selected segment
  const firstSegmentId = selectedSegmentIds.size > 0 ? [...selectedSegmentIds][0] : undefined;
  const firstSegment = model?.segments.get(firstSegmentId ?? "");

  // Find the group that owns the first segment
  let ownerGroupId: string | null = null;
  if (model && firstSegmentId) {
    for (const gid of model.groupOrder) {
      const group = model.groups.get(gid);
      if (group && group.segmentIds.includes(firstSegmentId)) {
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
        for (let gi = 0; gi < model.groupOrder.length; gi++) {
          const group = model.groups.get(model.groupOrder[gi]);
          if (!group) continue;
          const wi = group.segmentIds.indexOf(segId);
          if (wi < 0) continue;
          const groupEl = groupEls[gi];
          if (!groupEl) continue;
          // Resolve word span, handling wrappers
          const children = groupEl.children;
          let idx = 0;
          for (const child of children) {
            const c = child as HTMLElement;
            if (c.dataset.captionWrapper === "true") {
              const inner = c.querySelector<HTMLElement>(":scope > span");
              if (inner && idx === wi) {
                targetEls.push(inner);
                break;
              }
            } else if (c.tagName === "SPAN") {
              if (idx === wi) {
                targetEls.push(c);
                break;
              }
            }
            idx++;
          }
          break;
        }
      }

      // Apply transform updates via gsap.set on the WRAPPER (not the word span)
      const hasTransform =
        updates.x !== undefined ||
        updates.y !== undefined ||
        updates.scaleX !== undefined ||
        updates.scaleY !== undefined ||
        updates.rotation !== undefined;

      if (hasTransform) {
        try {
          const iframeGsap = (
            iframeRef.current?.contentWindow as unknown as {
              gsap?: {
                set: (el: HTMLElement, props: Record<string, unknown>) => void;
                getProperty: (el: HTMLElement, prop: string) => number;
              };
            }
          )?.gsap;
          if (iframeGsap) {
            for (const el of targetEls) {
              // Get or create wrapper
              let wrapper = el.parentElement;
              if (!wrapper || wrapper.dataset.captionWrapper !== "true") {
                wrapper = doc.createElement("span") as HTMLElement;
                wrapper.style.display = "inline-block";
                wrapper.dataset.captionWrapper = "true";
                el.parentNode?.insertBefore(wrapper, el);
                wrapper.appendChild(el);
              }
              // Read current wrapper state and merge with updates
              const curX = iframeGsap.getProperty(wrapper, "x") || 0;
              const curY = iframeGsap.getProperty(wrapper, "y") || 0;
              const curScale = iframeGsap.getProperty(wrapper, "scale") || 1;
              const curRotation = iframeGsap.getProperty(wrapper, "rotation") || 0;
              iframeGsap.set(wrapper, {
                x: updates.x ?? curX,
                y: updates.y ?? curY,
                scale: updates.scaleX ?? curScale,
                rotation: updates.rotation ?? curRotation,
              });
            }
          }
        } catch {
          /* cross-origin */
        }
      }
    },
    [iframeRef, model, selectedSegmentIds],
  );

  // All hooks must be called before any early return
  const handleStyleChange = useCallback(
    (updates: Partial<CaptionStyle>) => {
      if (selectedGroupId) {
        updateGroupStyle(selectedGroupId, updates);
      } else {
        updateSelectedStyle(updates);
      }
      applyToIframeDom(updates);
    },
    [selectedGroupId, updateGroupStyle, updateSelectedStyle, applyToIframeDom],
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

  const x = effectiveStyle.x ?? 0;
  const y = effectiveStyle.y ?? 0;
  const rotation = effectiveStyle.rotation ?? 0;
  const scaleX = effectiveStyle.scaleX ?? 1;

  // Count label
  const countLabel = selectedSegmentIds.size === 1 ? "1 word" : `${selectedSegmentIds.size} words`;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-2xs text-neutral-500">{countLabel}</span>
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

      {/* Style tab — Transform only */}
      {activeTab === "style" && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <Section label="Position">
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
          </Section>

          <Section label="Transform">
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
            <Row label="Rotation">
              <input
                type="number"
                value={rotation}
                onChange={(e) => handleStyleChange({ rotation: Number(e.target.value) })}
                className={inputCls}
              />
            </Row>
          </Section>
        </div>
      )}
    </div>
  );
});
