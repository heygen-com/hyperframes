export const MEDIA_START_BASIS_ATTR = "data-hf-media-start-basis";

export type MediaStartBasis = "local" | "global";

export function readMediaStartBasis(value: string | null | undefined): MediaStartBasis {
  return value?.trim().toLowerCase() === "global" ? "global" : "local";
}

/** Resolve authored media time onto the root timeline. Nested media is local
 * by default; only an explicit compatibility marker preserves a legacy
 * root-global value. */
export function resolveAbsoluteMediaStartSeconds(input: {
  authoredStart: number;
  hostStart: number;
  basis?: string | null;
}): number {
  return readMediaStartBasis(input.basis) === "global"
    ? input.authoredStart
    : input.hostStart + input.authoredStart;
}

/** The one rule for a media element's root-timeline start; the runtime and the CLI both call it.
 * With no literal start, an auto-injected start, or a host at t<=0 there is nothing for the basis
 * to disambiguate, so the ordinary start resolution applies. */
export function resolveMediaStartSeconds(input: {
  authoredStart: number | null;
  hostStart: number;
  hasAutoStart: boolean;
  basis?: string | null;
  ordinaryStart: () => number;
}): number {
  if (input.hasAutoStart || input.authoredStart == null || input.hostStart <= 0) {
    return input.ordinaryStart();
  }
  return resolveAbsoluteMediaStartSeconds({
    authoredStart: input.authoredStart,
    hostStart: input.hostStart,
    basis: input.basis,
  });
}
