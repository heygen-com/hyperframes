/** How long a composition is when nothing runs it: its authored `data-duration`, else the latest
 *  end among its clips. A clip whose length is not known yet is counted, never guessed. */

export type CompositionDurationSource = "authored" | "derived" | "unresolved";

export interface CompositionDurationResult {
  seconds: number | null;
  source: CompositionDurationSource;
  /** Clips whose end is not known yet; a `derived` length is a lower bound while this is above 0. */
  pendingClips: number;
  /** Set only when source is "unresolved". */
  reason?: string;
}

export interface ResolveCompositionDurationInput {
  authoredDurationSeconds: number | null;
  /** Each clip's end on the composition timeline, or null while its length is pending. */
  clipEndsSeconds: readonly (number | null)[];
}

const isPositiveFinite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

export function resolveCompositionDuration(
  input: ResolveCompositionDurationInput,
): CompositionDurationResult {
  const pendingClips = input.clipEndsSeconds.filter((end) => end === null).length;
  if (isPositiveFinite(input.authoredDurationSeconds)) {
    return { seconds: input.authoredDurationSeconds, source: "authored", pendingClips };
  }
  const known = input.clipEndsSeconds.filter(isPositiveFinite);
  if (known.length > 0) {
    return { seconds: Math.max(...known), source: "derived", pendingClips };
  }
  return {
    seconds: null,
    source: "unresolved",
    pendingClips,
    reason:
      pendingClips > 0
        ? "every clip's length is still pending"
        : "no authored duration and no clip with a length",
  };
}
