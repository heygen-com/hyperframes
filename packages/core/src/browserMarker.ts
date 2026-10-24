/** An inert Chrome switch on every browser HyperFrames launches, so orphan cleanup can tell its own from other tools'. */
export const HYPERFRAMES_BROWSER_MARKER_ARG = "--hyperframes-owned-browser";

export function withHyperframesBrowserMarker(args: readonly string[] = []): string[] {
  return args.includes(HYPERFRAMES_BROWSER_MARKER_ARG)
    ? [...args]
    : [...args, HYPERFRAMES_BROWSER_MARKER_ARG];
}
