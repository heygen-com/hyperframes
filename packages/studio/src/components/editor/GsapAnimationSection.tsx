import { memo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { Film } from "../../icons/SystemIcons";
import { Section } from "./propertyPanelPrimitives";
import { ADD_METHODS, ADD_METHOD_LABELS, METHOD_TOOLTIPS } from "./gsapAnimationConstants";
import { AnimationCard } from "./AnimationCard";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";

interface GsapAnimationSectionProps extends GsapAnimationEditCallbacks {
  animations: GsapAnimation[];
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
}

export const GsapAnimationSection = memo(function GsapAnimationSection({
  animations,
  multipleTimelines,
  unsupportedTimelinePattern,
  onUpdateProperty,
  onUpdateMeta,
  onDeleteAnimation,
  onAddProperty,
  onRemoveProperty,
  onUpdateFromProperty,
  onAddFromProperty,
  onRemoveFromProperty,
  onAddAnimation,
  onLivePreview,
  onLivePreviewEnd,
  onSetArcPath,
  onUpdateArcSegment,
  onUpdateKeyframeEase,
  onSetAllKeyframeEases,
  onUnroll,
}: GsapAnimationSectionProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <Section title="Animation" icon={<Film size={15} />}>
      {multipleTimelines && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          This file has multiple GSAP timelines. Animation editing is disabled to prevent data loss
          — consolidate into a single timeline to enable editing.
        </p>
      )}
      {unsupportedTimelinePattern && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          This timeline uses a computed key (window.__timelines[variable]) the editor can&apos;t
          resolve statically. Use a string-literal key (window.__timelines[&quot;id&quot;]) or a
          variable declaration (const tl = gsap.timeline()) to enable editing.
        </p>
      )}
      {multipleTimelines || unsupportedTimelinePattern ? null : (
        <div className="space-y-2">
          {animations.map((anim, index) => (
            <AnimationCard
              key={anim.id}
              animation={anim}
              defaultExpanded={index === 0}
              onUpdateProperty={onUpdateProperty}
              onUpdateMeta={onUpdateMeta}
              onDeleteAnimation={onDeleteAnimation}
              onAddProperty={onAddProperty}
              onRemoveProperty={onRemoveProperty}
              onUpdateFromProperty={onUpdateFromProperty}
              onAddFromProperty={onAddFromProperty}
              onRemoveFromProperty={onRemoveFromProperty}
              onLivePreview={onLivePreview}
              onLivePreviewEnd={onLivePreviewEnd}
              onSetArcPath={onSetArcPath}
              onUpdateArcSegment={onUpdateArcSegment}
              onUpdateKeyframeEase={onUpdateKeyframeEase}
              onSetAllKeyframeEases={onSetAllKeyframeEases}
              onUnroll={onUnroll}
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
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
                  >
                    {ADD_METHOD_LABELS[method] ?? method}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(false)}
                  className="px-1.5 text-[11px] text-neutral-500 hover:text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddMenuOpen(true)}
                className="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200"
                title="Add a new animation effect to this element"
              >
                + Add effect
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
});
