import { memo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { Film } from "../../icons/SystemIcons";
import { Section } from "./propertyPanelPrimitives";
import { ADD_METHODS, ADD_METHOD_LABELS, METHOD_TOOLTIPS } from "./gsapAnimationConstants";
import { AnimationCard } from "./AnimationCard";
import {
  trackAnimationMetaUpdate,
  type GsapAnimationEditCallbacks,
} from "./gsapAnimationCallbacks";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";

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
  const track = useTrackDesignInput();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const trackProperty = (property: string) => {
    const control =
      property === "visibility"
        ? "toggle"
        : property === "filter" || property === "clipPath"
          ? "text"
          : "metric";
    track(control, property);
  };
  const updateMeta = (
    animationId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => {
    trackAnimationMetaUpdate(track, updates);
    onUpdateMeta(animationId, updates);
  };

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
              onUpdateProperty={(animationId, property, value) => {
                trackProperty(property);
                onUpdateProperty(animationId, property, value);
              }}
              onUpdateMeta={updateMeta}
              onDeleteAnimation={(animationId) => {
                track("button", "Remove animation");
                onDeleteAnimation(animationId);
              }}
              onAddProperty={(animationId, property) => {
                track("select", "Add effect property");
                onAddProperty(animationId, property);
              }}
              onRemoveProperty={(animationId, property) => {
                track("button", `Remove ${property}`);
                onRemoveProperty(animationId, property);
              }}
              onUpdateFromProperty={
                onUpdateFromProperty
                  ? (animationId, property, value) => {
                      trackProperty(property);
                      onUpdateFromProperty(animationId, property, value);
                    }
                  : undefined
              }
              onAddFromProperty={
                onAddFromProperty
                  ? (animationId, property) => {
                      track("select", "Add from property");
                      onAddFromProperty(animationId, property);
                    }
                  : undefined
              }
              onRemoveFromProperty={
                onRemoveFromProperty
                  ? (animationId, property) => {
                      track("button", `Remove from ${property}`);
                      onRemoveFromProperty(animationId, property);
                    }
                  : undefined
              }
              onLivePreview={onLivePreview}
              onLivePreviewEnd={onLivePreviewEnd}
              onSetArcPath={
                onSetArcPath
                  ? (animationId, config) => {
                      track(
                        "toggle",
                        config.autoRotate !== undefined ? "Auto rotate" : "Arc motion",
                      );
                      onSetArcPath(animationId, config);
                    }
                  : undefined
              }
              onUpdateArcSegment={
                onUpdateArcSegment
                  ? (animationId, segmentIndex, update) => {
                      if (update.curviness === undefined) {
                        track("button", `Reset arc segment ${segmentIndex + 1}`);
                      }
                      onUpdateArcSegment(animationId, segmentIndex, update);
                    }
                  : undefined
              }
              onUpdateKeyframeEase={
                onUpdateKeyframeEase
                  ? (animationId, percentage, ease) => {
                      track("select", "Keyframe ease");
                      onUpdateKeyframeEase(animationId, percentage, ease);
                    }
                  : undefined
              }
              onSetAllKeyframeEases={
                onSetAllKeyframeEases
                  ? (animationId, ease) => {
                      track("select", "All keyframe eases");
                      onSetAllKeyframeEases(animationId, ease);
                    }
                  : undefined
              }
              onUnroll={
                onUnroll
                  ? (animationId) => {
                      track("button", "Unroll animation");
                      onUnroll(animationId);
                    }
                  : undefined
              }
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
                      track("button", `Add ${method} animation`);
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
