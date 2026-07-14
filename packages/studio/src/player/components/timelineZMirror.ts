import type { TimelineElement } from "../store/playerStore";
import { classifyZone } from "./timelineZones";
import { isLaneFree, timeRangesOverlap } from "./timelineCollision";
import { authoredTrackForLane, sameSourceFile } from "./timelineClipDragCommit";

/**
 * Mirror a canvas z-order action (Bring to Front / Bring Forward / Send Backward /
 * Send to Back) into a timeline LANE move — the pure resolver, no UI wiring.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 * Track order is the DEFAULT paint order; authored z is the ADVANCED override.
 * Render truth stays z — the renderer never reads track index — and the studio
 * maintains z ↔ track consistency at EDIT time: a deliberate vertical lane move
 * syncs z (timelineStackingSync), and a z-order menu action calls THIS resolver
 * to compute the accompanying lane move. When the user authors z that diverges
 * from track order, the divergence is surfaced by a badge (computeZOverrideKeys
 * in timelineZOverride.ts, rendered by TimelineClip);
 * the mirror never fights an authored override, it only keeps the default in
 * step.
 *
 * ── Locked rules (agreed design — do not re-litigate here) ───────────────────
 * - The mirror computes a lane move to ACCOMPANY a z action on a timeline clip;
 *   it never replaces the z patch.
 * - Move the clip to the closest track in the action's direction that is FREE
 *   over the clip's whole [start, start + duration) span; if no free track
 *   exists in that direction, CREATE one adjacent to the reference neighbor
 *   (commitTrackInsert semantics).
 * - Direction: bring-forward/front = toward LOWER display lanes (up = above);
 *   send-backward/back = toward HIGHER lanes, but only within the visual zone —
 *   the audio zone is untouched and never crossed (a bottom-of-zone insert lands
 *   AT the visual/audio boundary, i.e. still a visual lane).
 * - Reference scope: same stacking context = same source file = same timeline
 *   lane space (matches the menu's sibling scoping). The comparison set for
 *   "which track is above/below me" is same-file clips; lane FREENESS is
 *   file-agnostic (any clip in the zone occupies its lane for everyone).
 * - Non-clip decorations (no timeline presence) are out of scope — callers keep
 *   z-only behavior for them. Audio elements never mirror (z on audio is
 *   meaningless); the resolver returns null.
 *
 * ── OPEN product question ────────────────────────────────────────────────────
 * send-to-back / bring-to-front scope: below/above EVERYTHING visual, or only
 * the clips that temporally overlap the moved clip? The default implemented
 * here is TEMPORAL-OVERLAP scope (the extreme is computed over same-file clips
 * that overlap the moved clip in time), pending M/Bin sign-off. A clip with no
 * temporal overlaps in the direction is "already at the extreme" → null.
 *
 * Deterministic: a pure function of its inputs — no Date, no randomness, no DOM.
 */

export type ZMirrorAction = "bring-to-front" | "bring-forward" | "send-backward" | "send-to-back";

export interface ZMirrorInput {
  action: ZMirrorAction;
  /** The clip acted on — store/display space (post-normalizeToZones lanes),
   *  carrying `authoredTrack` when the display lane diverges from the file. */
  element: TimelineElement;
  /** The expanded display element set (same set the drag commit reasons on). */
  elements: TimelineElement[];
  /** Timeline key of the neighbor the z action stepped over (forward/backward),
   *  when known — see resolveCrossedNeighbor in canvasContextMenuZOrder. */
  crossedKey?: string | null;
}

export type ZMirrorLaneMove =
  | {
      /** Land on an existing display lane. */
      kind: "move";
      /** Display lane to move to (store space). */
      displayTrack: number;
      /** Authored-space value to write (authoredTrackForLane translation). */
      persistTrack: number;
    }
  | {
      /** Create a new lane: boundary row compatible with commitTrackInsert's
       *  insertRow (index into the ascending display trackOrder; 0 = above the
       *  top lane, length = below the bottom). */
      kind: "insert";
      insertRow: number;
    }
  | null;

const keyOf = (el: TimelineElement): string => el.key ?? el.id;

/** Ascending unique display lanes of `elements` — identical to how Timeline.tsx
 *  builds `trackOrder`, so `insertRow` indexes the same boundary space. Exported
 *  so the mirror wiring can hand commitZMirrorLaneMove the matching trackOrder. */
export function displayTrackOrder(elements: TimelineElement[]): number[] {
  return [...new Set(elements.map((el) => el.track))].sort((a, b) => a - b);
}

/**
 * Resolve the timeline lane move that mirrors a z-order action on `element`.
 * Returns null when no timeline mirror applies: audio / zero-length clips, no
 * reference neighbor in the action's direction (the menu action was likely
 * disabled or a no-op), or the clip is already laned where the action puts it.
 */
export function resolveZMirrorLaneMove(input: ZMirrorInput): ZMirrorLaneMove {
  const { action, element, elements } = input;
  if (classifyZone(element) === "audio") return null;
  if (!(element.duration > 0)) return null;

  const selfKey = keyOf(element);
  const start = element.start;
  const end = element.start + element.duration;
  const up = action === "bring-forward" || action === "bring-to-front";

  // Same stacking context (= same source file), visual, temporally overlapping.
  const overlapSet = elements.filter(
    (el) =>
      keyOf(el) !== selfKey &&
      classifyZone(el) === "visual" &&
      sameSourceFile(el, element) &&
      timeRangesOverlap(start, end, el.start, el.start + el.duration),
  );

  const referenceLane = resolveReferenceLane(input, overlapSet, up);
  if (referenceLane == null) return null;

  const order = displayTrackOrder(elements);
  const visualLanes = displayTrackOrder(elements.filter((el) => classifyZone(el) === "visual"));

  // Closest free lane strictly beyond the reference, lane-by-lane in direction,
  // whole-span freeness, same zone (visual lanes only — never into audio).
  const refIdx = visualLanes.indexOf(referenceLane);
  if (refIdx === -1) return null; // reference is not a visual lane — no mirror
  const step = up ? -1 : 1;
  for (let i = refIdx + step; i >= 0 && i < visualLanes.length; i += step) {
    const lane = visualLanes[i];
    if (isLaneFree(elements, lane, start, end, selfKey)) {
      // The closest free lane is the clip's OWN lane (possible only when z and
      // track had diverged): the clip already sits where the action puts it.
      if (lane === element.track) return null;
      return {
        kind: "move",
        displayTrack: lane,
        persistTrack: authoredTrackForLane(lane, elements, element),
      };
    }
  }

  // No free lane before the zone edge → create one adjacent to the reference:
  // the boundary between the reference lane and the next lane in direction.
  return { kind: "insert", insertRow: order.indexOf(referenceLane) + (up ? 0 : 1) };
}

/**
 * The lane the search starts from (the "reference neighbor"):
 * - forward/backward: the crossed neighbor when provided and valid (a visual
 *   clip in the set); otherwise the closest temporally-overlapping same-file
 *   clip in the direction. None → null (the menu was probably disabled).
 * - front/back: the extreme of the temporal-overlap set — topmost (lowest lane)
 *   for front, bottommost (highest lane) for back — restricted to overlaps
 *   strictly beyond the clip's own lane. None → already at the extreme → null.
 */
function resolveReferenceLane(
  input: ZMirrorInput,
  overlapSet: TimelineElement[],
  up: boolean,
): number | null {
  const stepAction = input.action === "bring-forward" || input.action === "send-backward";
  if (stepAction) {
    const crossedLane = crossedNeighborLane(input);
    // Unknown / absent / non-visual crossed key → the temporal neighbor below.
    if (crossedLane != null) return crossedLane;
  }

  // Overlapping same-file lanes strictly beyond the moved clip's lane, in direction.
  const lanes = overlapSet
    .map((el) => el.track)
    .filter((lane) => (up ? lane < input.element.track : lane > input.element.track));
  if (lanes.length === 0) return null;

  // Step actions want the CLOSEST lane in direction (max when up, min when
  // down); front/back want the EXTREME of the set (min when up, max when down).
  return (stepAction === up ? Math.max : Math.min)(...lanes);
}

/** The crossed neighbor's display lane, when the key names a visual clip in the set. */
function crossedNeighborLane({ elements, crossedKey }: ZMirrorInput): number | null {
  if (crossedKey == null) return null;
  const crossed = elements.find((el) => keyOf(el) === crossedKey);
  return crossed && classifyZone(crossed) === "visual" ? crossed.track : null;
}
