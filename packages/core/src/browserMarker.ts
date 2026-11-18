/** An inert Chrome switch on every browser HyperFrames launches, so orphan cleanup can tell its own from other tools'. */
export const HYPERFRAMES_BROWSER_MARKER_ARG = "--hyperframes-owned-browser";

/** Set by a caller that runs several renders at once, so each one's browsers and warm checks name it. */
export const HYPERFRAMES_OWNER_ENV = "HYPERFRAMES_OWNER";
export const HYPERFRAMES_OWNER_ARG = "--hyperframes-owner";

export function hyperframesOwnerArgs(source: NodeJS.ProcessEnv = process.env): string[] {
  const owner = source[HYPERFRAMES_OWNER_ENV];
  return owner && /^[\w.-]{1,64}$/.test(owner) ? [`${HYPERFRAMES_OWNER_ARG}=${owner}`] : [];
}

const isOwnerArg = (arg: string) => arg.startsWith(`${HYPERFRAMES_OWNER_ARG}=`);

export function withHyperframesBrowserMarker(
  args: readonly string[] = [],
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  const marked = args.includes(HYPERFRAMES_BROWSER_MARKER_ARG)
    ? [...args]
    : [...args, HYPERFRAMES_BROWSER_MARKER_ARG];
  return marked.some(isOwnerArg) ? marked : [...marked, ...hyperframesOwnerArgs(source)];
}

export const withoutHyperframesOwner = (args: readonly string[]): string[] =>
  args.filter((arg) => !isOwnerArg(arg));
