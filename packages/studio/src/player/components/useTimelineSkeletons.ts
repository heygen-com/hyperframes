import { useMemo } from "react";
import { useDomEditSelectionContextOptional } from "../../contexts/DomEditContext";
import type { AgentJob } from "../../components/editor/agentGlyphs";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { laneForAuthoredTrack } from "./timelineAuthoredTrack";

/**
 * Where the timeline should show clips that do not exist yet.
 *
 * An agent that is about to add clips says so (see the `hf:timeline`
 * declaration in the Studio skill), and this turns those declarations into
 * rows to draw. Nothing here infers anything: a run that declared nothing
 * contributes nothing, however busy it is.
 */

export interface PlacedSkeleton {
  key: string;
  start: number;
  end: number;
  label?: string;
  /**
   * The display lane it draws on, or the authored track it is waiting for when
   * that track has no clips yet.
   */
  lane: number;
}

export interface TimelineSkeletonLayout {
  /** Skeletons landing on a lane the timeline already shows. */
  placed: PlacedSkeleton[];
  /** Skeletons whose track does not exist yet; drawn in the incoming band. */
  incoming: PlacedSkeleton[];
  /** The distinct not-yet-existing tracks, ascending, for sizing the band. */
  incomingTracks: number[];
}

const EMPTY: TimelineSkeletonLayout = { placed: [], incoming: [], incomingTracks: [] };

/** A run still going is the only kind that can be about to add anything. */
const SETTLED = ["done", "failed", "cancelled"];

export function useTimelineSkeletons(): TimelineSkeletonLayout {
  // Optional: a standalone player mount has no project and no agent, and must
  // render exactly as it does today.
  const jobs = useDomEditSelectionContextOptional()?.agentJobs;
  const elements = usePlayerStore((state) => state.elements);

  return useMemo(() => (jobs ? place(jobs, elements) : EMPTY), [jobs, elements]);
}

/** Turn every live run's declarations into rows to draw. */
function place(jobs: readonly AgentJob[], elements: readonly TimelineElement[]) {
  const placed: PlacedSkeleton[] = [];
  const incoming: PlacedSkeleton[] = [];
  const incomingTracks = new Set<number>();

  for (const job of jobs) {
    if (SETTLED.includes(job.status)) continue;
    for (const [index, clip] of (job.skeletons ?? []).entries()) {
      const at = laneForAuthoredTrack(clip.track, elements, clip.file ?? null);
      const skeleton = {
        key: `${job.id}:${index}`,
        start: clip.start,
        end: clip.end,
        label: clip.label,
        lane: at.kind === "lane" ? at.lane : clip.track,
      };
      if (at.kind === "lane") {
        placed.push(skeleton);
      } else {
        incoming.push(skeleton);
        incomingTracks.add(clip.track);
      }
    }
  }

  if (placed.length === 0 && incoming.length === 0) return EMPTY;
  return { placed, incoming, incomingTracks: [...incomingTracks].sort((a, b) => a - b) };
}
