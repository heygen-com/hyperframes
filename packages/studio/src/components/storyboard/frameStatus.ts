import type { FrameStatus } from "@hyperframes/core/storyboard";

/**
 * Single source of truth for how each frame lifecycle status is presented —
 * label, tooltip, description, and the chip/dot color classes — so the tile
 * chip and the legend dot can't drift apart.
 */
export const FRAME_STATUS_META: Record<
  FrameStatus,
  { label: string; tooltip: string; description: string; chipClass: string; dotClass: string }
> = {
  outline: {
    label: "Outline",
    tooltip: "Planned in text — no HTML frame built yet.",
    description: "Planned in text. Story and intent exist; the visual isn’t built.",
    chipClass: "bg-neutral-800 text-neutral-300",
    dotClass: "bg-neutral-500",
  },
  built: {
    label: "Built",
    tooltip: "Static HTML frame built — not animated yet.",
    description: "The HTML frame exists as a static key moment. Look is locked; motion isn’t.",
    chipClass: "bg-sky-500/20 text-sky-300",
    dotClass: "bg-sky-400",
  },
  animated: {
    label: "Animated",
    tooltip: "Keyframed and animated — plays in the final cut.",
    description: "Keyframed into motion. This is the file stitched into the final video.",
    chipClass: "bg-emerald-500/20 text-emerald-300",
    dotClass: "bg-emerald-400",
  },
};

/** The lifecycle order an agent advances each frame through. */
export const FRAME_STATUS_ORDER: FrameStatus[] = ["outline", "built", "animated"];
