import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineClipIndex } from "../lib/timelineClipIndex";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { MarqueeSelectionMode, Rect } from "../../utils/marqueeGeometry";
import {
  computeMarqueeSelection,
  getMarqueeClipCandidates,
  survivingPrimary,
  type MarqueeClipInput,
} from "./timelineMarquee";

export interface MarqueeDragState {
  originX: number;
  originY: number;
  /** Pre-drag selection, restored on Escape-cancel. */
  baseIds: Set<string>;
  basePrimary: string | null;
  /** Base mode (cmd/ctrl at pointerdown adds); Shift or Alt held on the pointer override it. */
  mode: MarqueeSelectionMode;
  /** True once the pointer travelled past the click threshold. */
  active: boolean;
}

export function snapshotSelection(): { ids: Set<string>; primary: string | null } {
  const s = usePlayerStore.getState();
  const ids = new Set(s.selectedElementIds);
  if (s.selectedElementId) ids.add(s.selectedElementId);
  return { ids, primary: s.selectedElementId };
}

function toMarqueeClips(elements: TimelineElement[]): MarqueeClipInput[] {
  return elements.map((el) => ({
    id: el.key ?? el.id,
    start: el.start,
    duration: el.duration,
    track: el.track,
  }));
}

/** Computes the live selection for a marquee rect against the pre-drag base and commits it. */
export function commitMarqueeSelection(
  rect: Rect,
  mode: MarqueeSelectionMode,
  marquee: MarqueeDragState,
  clipIndex: TimelineClipIndex,
  rowGeometry: TimelineRowGeometry,
  pps: number,
  contentOrigin: number,
): void {
  const candidates = getMarqueeClipCandidates({
    clipIndex,
    rowGeometry,
    marquee: rect,
    pps,
    contentOrigin,
  });
  const { ids, primaryId } = computeMarqueeSelection({
    clips: toMarqueeClips([...candidates]),
    rowGeometry,
    pps,
    contentOrigin,
    marquee: rect,
    baseSelection: mode === "replace" ? undefined : marquee.baseIds,
    mode,
  });
  const store = usePlayerStore.getState();
  let primary = primaryId;
  if (mode === "add") primary ??= marquee.basePrimary;
  if (mode === "subtract") primary = survivingPrimary(ids, marquee.basePrimary);
  // Primary FIRST: setSelectedElementId collapses the multi-select set, so the set
  // must be written after it or the marquee selection would be wiped every frame.
  store.setSelectedElementId(primary);
  store.setSelectedElementIds(ids);
}
