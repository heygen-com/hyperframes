import { readMediaOffsetSeconds } from "@hyperframes/parsers/media-duration";

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
 * `hostStart` is the composition's origin. With no literal start, an auto-injected start, or an
 * origin at 0 there is nothing for the basis to disambiguate, so ordinary resolution applies. */
export function resolveMediaStartSeconds(
  input: MediaStartInput & { ordinaryStart: () => number },
): number {
  if (!hasLiteralNestedStart(input)) return input.ordinaryStart();
  return resolveAbsoluteMediaStartSeconds({
    authoredStart: input.authoredStart,
    hostStart: input.hostStart,
    basis: input.basis,
  });
}

/** True when the authored start is already root time, so no host offset applies. */
export function isRootGlobalMediaStart(input: MediaStartInput): boolean {
  return hasLiteralNestedStart(input) && readMediaStartBasis(input.basis) === "global";
}

export interface MediaStartInput {
  authoredStart: number | null;
  hostStart: number;
  hasAutoStart: boolean;
  basis?: string | null;
}

function hasLiteralNestedStart(
  input: MediaStartInput,
): input is MediaStartInput & { authoredStart: number } {
  return !input.hasAutoStart && input.authoredStart != null && input.hostStart !== 0;
}

/** A composition host's in-point; only a host with one shifts or cuts what it holds. */
export function hostInPointSeconds(host: Pick<Element, "getAttribute">): number {
  return readMediaOffsetSeconds((name) => host.getAttribute(name));
}

/** Main-timeline time of a sub-composition's local t=0: its host's start minus its in-point. */
export function compositionOriginSeconds(
  hostStart: number,
  host: Pick<Element, "getAttribute">,
): number {
  return hostStart - hostInPointSeconds(host);
}

export interface HostSlot {
  start: number;
  end: number;
}

/** Each in-point host cuts the span to its own window. */
export function cutToHostSlots(
  span: { start: number; end: number },
  hosts: readonly HostSlot[],
): { start: number; end: number } {
  return hosts.reduce((kept, host) => {
    const start = Math.max(kept.start, host.start);
    return { start, end: Math.max(start, Math.min(kept.end, host.end)) };
  }, span);
}
