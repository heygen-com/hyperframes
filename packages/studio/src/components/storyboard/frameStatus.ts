import type { FrameStatus } from "@hyperframes/core/storyboard";
import i18n from "../../i18n";

const FRAME_STATUS_STYLES: Record<FrameStatus, { chipClass: string; dotClass: string }> = {
  outline: {
    chipClass: "bg-neutral-800 text-neutral-300",
    dotClass: "bg-neutral-500",
  },
  built: {
    chipClass: "bg-sky-500/20 text-sky-300",
    dotClass: "bg-sky-400",
  },
  animated: {
    chipClass: "bg-emerald-500/20 text-emerald-300",
    dotClass: "bg-emerald-400",
  },
};

/**
 * Single source of truth for how each frame lifecycle status is presented —
 * label, tooltip, description, and the chip/dot color classes — so the tile
 * chip and the legend dot can't drift apart.
 */
export function getFrameStatusMeta(status: FrameStatus): {
  label: string;
  tooltip: string;
  description: string;
  chipClass: string;
  dotClass: string;
} {
  return {
    label: i18n.t(`storyboard.status.${status}.label`),
    tooltip: i18n.t(`storyboard.status.${status}.tooltip`),
    description: i18n.t(`storyboard.status.${status}.description`),
    ...FRAME_STATUS_STYLES[status],
  };
}

/** The lifecycle order an agent advances each frame through. */
export const FRAME_STATUS_ORDER: FrameStatus[] = ["outline", "built", "animated"];
