import type { TimelineElement } from "../store/playerStore";

const keyOf = (element: TimelineElement) => element.key ?? element.id;

/** Authored track numbers only compare within one source file. */
export const sameSourceFile = (a: TimelineElement, b: TimelineElement): boolean =>
  (a.sourceFile ?? null) === (b.sourceFile ?? null);

/** Translate a display lane into the source-file track to persist. */
export function authoredTrackForLane(
  lane: number,
  elements: TimelineElement[],
  dragged: TimelineElement,
): number {
  const dragKey = keyOf(dragged);
  const peers = elements.filter((element) => {
    return keyOf(element) !== dragKey && sameSourceFile(element, dragged);
  });
  const occupant = peers.find((element) => element.track === lane);
  if (occupant) return occupant.authoredTrack ?? occupant.track;

  let nearest: TimelineElement | null = null;
  for (const peer of peers) {
    if (!nearest || Math.abs(peer.track - lane) < Math.abs(nearest.track - lane)) nearest = peer;
  }
  if (!nearest) return lane;
  // Synthetic expanded-child display rows can be fractional; authored tracks cannot.
  return Math.round((nearest.authoredTrack ?? nearest.track) + (lane - nearest.track));
}

/**
 * Where a declared authored track should draw, or that it has nowhere yet.
 *
 * `provisional` is not an error: an agent adding a whole new track is the most
 * interesting thing it can say, and it must be drawable before the clips that
 * would give it a lane exist.
 */
export type AuthoredTrackLane = { kind: "lane"; lane: number } | { kind: "provisional" };

/**
 * Translate a source-file track index into the display lane it belongs on.
 *
 * The inverse of `authoredTrackForLane`, and kept beside it so the two stay
 * readable against each other. An agent only ever knows `data-track-index`;
 * Studio packs those onto contiguous lanes, so on any composition with gaps
 * the number the agent writes is not the row the user sees.
 *
 * `file` scopes the search the way `sameSourceFile` scopes the forward
 * direction: an expanded sub-composition's rows carry authored numbers from
 * their OWN file, and matching one of those would put the skeleton on a row
 * belonging to a different composition entirely.
 */
export function laneForAuthoredTrack(
  authoredTrack: number,
  elements: readonly TimelineElement[],
  file: string | null,
): AuthoredTrackLane {
  const peers = elements.filter((element) => (element.sourceFile ?? null) === file);
  if (peers.length === 0) return { kind: "provisional" };

  const occupant = peers.find((peer) => (peer.authoredTrack ?? peer.track) === authoredTrack);
  if (occupant) return { kind: "lane", lane: occupant.track };

  // No clip on that track yet. The nearest peer gives an offset, the same
  // nearest-neighbour rule the forward direction uses, but the answer is only
  // trusted when it lands on a lane this file actually occupies: anything else
  // would draw the skeleton on top of an unrelated track and quietly lie.
  let nearest: TimelineElement | null = null;
  for (const peer of peers) {
    const peerTrack = peer.authoredTrack ?? peer.track;
    const nearestTrack = nearest ? (nearest.authoredTrack ?? nearest.track) : 0;
    if (!nearest || Math.abs(peerTrack - authoredTrack) < Math.abs(nearestTrack - authoredTrack)) {
      nearest = peer;
    }
  }
  if (!nearest) return { kind: "provisional" };

  const lane = nearest.track + (authoredTrack - (nearest.authoredTrack ?? nearest.track));
  return peers.some((peer) => peer.track === lane)
    ? { kind: "lane", lane }
    : { kind: "provisional" };
}
