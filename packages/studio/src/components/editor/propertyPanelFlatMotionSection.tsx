import { useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./domEditing";
import { formatTimingValue, RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { parseTimingValue } from "./propertyPanelTimingSection";
import { CommitField } from "./propertyPanelPrimitives";
import { AnimationCard } from "./AnimationCard";
import { ADD_METHODS, ADD_METHOD_LABELS, METHOD_TOOLTIPS } from "./gsapAnimationConstants";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";
import { deriveElementTiming } from "./propertyPanelFlatTimingDerivation";

export function FlatTimingRow({
  element,
  animations = [],
  onSetAttribute,
}: {
  element: DomEditSelection;
  animations?: GsapAnimation[];
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
}) {
  const { start, duration, inferred: derived } = deriveElementTiming(element, animations);
  const end = start + duration;

  // While the range is inferred from animations, editing ONE field must pin the
  // WHOLE displayed range: writing only data-duration flips inference off and
  // drops start to data-start-or-0 (the clip silently shifts), and writing only
  // data-start is ignored while duration is still inferred (the edit looks
  // dead). Pin both attributes, sequentially, so the display never jumps.
  const pinRange = async (nextStart: number, nextDuration: number) => {
    await onSetAttribute("start", nextStart.toFixed(2));
    await onSetAttribute("duration", nextDuration.toFixed(2));
  };

  const commitStart = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    if (derived) {
      void pinRange(parsed, duration);
      return;
    }
    void onSetAttribute("start", parsed.toFixed(2));
  };

  const commitDuration = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    if (derived) {
      void pinRange(start, parsed);
      return;
    }
    void onSetAttribute("duration", parsed.toFixed(2));
  };

  const commitEnd = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= start) return;
    if (derived) {
      void pinRange(start, parsed - start);
      return;
    }
    void onSetAttribute("duration", (parsed - start).toFixed(2));
  };

  const cell = (label: string, value: string, onCommit: (next: string) => void) => (
    <div className="grid gap-px">
      <span className="text-[9px] text-panel-text-4">{label}</span>
      <span className="border-b border-transparent font-mono text-[11px] text-panel-text-0 hover:border-panel-border-input">
        <CommitField value={value} onCommit={onCommit} />
      </span>
    </div>
  );

  return (
    <div className={RESPONSIVE_GRID}>
      {cell("Start", formatTimingValue(start), commitStart)}
      {cell("End", formatTimingValue(end), commitEnd)}
      {cell("Duration", formatTimingValue(duration), commitDuration)}
      {derived && (
        <p className="col-span-3 mt-1 text-[10px] leading-snug text-panel-text-3">
          Inferred from this element's animation — edit to pin an explicit clip range.
        </p>
      )}
    </div>
  );
}

export function FlatMotionSection({
  element,
  animations,
  showTiming,
  showEffects,
  multipleTimelines,
  unsupportedTimelinePattern,
  onSetAttribute,
  onAddAnimation,
  ...callbacks
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  showTiming: boolean;
  showEffects: boolean;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
} & GsapAnimationEditCallbacks) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <div className="space-y-3">
      {showTiming && (
        <FlatTimingRow element={element} animations={animations} onSetAttribute={onSetAttribute} />
      )}
      {showEffects && (
        <>
          {multipleTimelines && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              This file has multiple GSAP timelines. Animation editing is disabled to prevent data
              loss — consolidate into a single timeline to enable editing.
            </p>
          )}
          {unsupportedTimelinePattern && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              This timeline uses a computed key the editor can&apos;t resolve statically.
            </p>
          )}
          {!multipleTimelines && !unsupportedTimelinePattern && (
            <div className="space-y-2">
              {animations.map((anim, index) => (
                <AnimationCard
                  key={anim.id}
                  animation={anim}
                  defaultExpanded={index === 0}
                  flat
                  {...callbacks}
                />
              ))}
              <div className="relative pt-1">
                {addMenuOpen ? (
                  <div className="flex gap-1.5">
                    {ADD_METHODS.map((method) => (
                      <button
                        key={method}
                        type="button"
                        title={METHOD_TOOLTIPS[method]}
                        onClick={() => {
                          onAddAnimation(method);
                          setAddMenuOpen(false);
                        }}
                        className="rounded-lg border border-panel-border-input bg-panel-input px-2.5 py-1.5 text-[11px] font-medium text-panel-text-2 transition-colors hover:border-panel-text-4 hover:text-panel-text-0"
                      >
                        {ADD_METHOD_LABELS[method] ?? method}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAddMenuOpen(false)}
                      className="px-1.5 text-[11px] text-panel-text-3 hover:text-panel-text-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddMenuOpen(true)}
                    className="text-[11px] font-medium text-panel-text-3 transition-colors hover:text-panel-text-1"
                    title="Add a new animation effect to this element"
                  >
                    + Add effect
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
