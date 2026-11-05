const KINDS: ReadonlyArray<[RegExp, string]> = [
  [/(^|[\\/])hfcache-/, "extract_cache"],
  [/(^|[\\/])__hyperframes_video_frames([\\/]|$)/, "video_frames"],
  [/(^|[\\/])captured-frames([\\/]|$)/, "captured_frames"],
  [
    /(^|[\\/])(capture-attempt-\d+|retry-\d+-batch-\d+-worker-\d+|worker-\d+)([\\/]|$)/,
    "worker_frames",
  ],
  [/(^|[\\/])capture-calibration/, "calibration"],
  [/(^|[\\/])compiled([\\/]|$)/, "compiled"],
  [/(^|[\\/])(hf-render-|work-[0-9a-f]{8}-)/, "work_dir"],
];

const quotedPath = (text: string) => /'([^']+)'/.exec(text)?.[1] ?? "";

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let seen = error; seen instanceof Error && chain.length < 5; seen = seen.cause)
    chain.push(seen);
  return chain;
}

function missingPathOf(error: unknown): string | undefined {
  const enoent = errorChain(error).find(
    (seen) => (seen as NodeJS.ErrnoException).code === "ENOENT",
  );
  if (enoent) return (enoent as NodeJS.ErrnoException).path ?? quotedPath(enoent.message);
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b/.test(message) ? quotedPath(message) : undefined;
}

/** Which kind of file a render found missing (a fixed name, never the path), or undefined when nothing was missing. */
export function missingPathKind(error: unknown): string | undefined {
  const path = missingPathOf(error);
  if (path === undefined) return undefined;
  return KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}
