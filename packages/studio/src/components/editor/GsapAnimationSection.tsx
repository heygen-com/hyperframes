import { memo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { Film } from "../../icons/SystemIcons";
import { Section } from "./propertyPanelPrimitives";
import { AnimationCard } from "./AnimationCard";
import {
  type GsapAnimationEditCallbacks,
  withTrackedGsapAnimationCallbacks,
} from "./gsapAnimationCallbacks";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { usePlayerStore } from "../../player";
import { GsapAddAnimationControl } from "./GsapAddAnimationControl";

interface GsapAnimationSectionProps extends GsapAnimationEditCallbacks {
  elementId: string;
  animations: GsapAnimation[];
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
}

export const GsapAnimationSection = memo(function GsapAnimationSection({
  elementId,
  animations,
  multipleTimelines,
  unsupportedTimelinePattern,
  onAddAnimation,
  ...callbacks
}: GsapAnimationSectionProps) {
  const track = useTrackDesignInput();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const trackedCallbacks = withTrackedGsapAnimationCallbacks(callbacks, track);
  const focusedEaseSegment = usePlayerStore((s) => s.focusedEaseSegment);
  const setFocusedEaseSegment = usePlayerStore((s) => s.setFocusedEaseSegment);

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
              {...trackedCallbacks}
              key={anim.id}
              animation={anim}
              defaultExpanded={index === 0}
              focusedSegment={
                focusedEaseSegment?.elementId === elementId &&
                focusedEaseSegment.animationId === anim.id
                  ? focusedEaseSegment
                  : null
              }
              onFocusSegmentConsumed={() => {
                const focused = usePlayerStore.getState().focusedEaseSegment;
                if (focused?.elementId === elementId && focused.animationId === anim.id) {
                  setFocusedEaseSegment(null);
                }
              }}
            />
          ))}

          <GsapAddAnimationControl
            open={addMenuOpen}
            setOpen={setAddMenuOpen}
            onAddAnimation={onAddAnimation}
            track={track}
            variant="classic"
          />
        </div>
      )}
    </Section>
  );
});
