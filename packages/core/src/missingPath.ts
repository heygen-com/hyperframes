const quotedPath = (text: string) => /'([^']+)'/.exec(text)?.[1] ?? "";

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let seen = error; seen instanceof Error && chain.length < 5; seen = seen.cause)
    chain.push(seen);
  return chain;
}

/** The path an ENOENT in `error` (or its causes) names, or undefined when nothing was missing. */
export function missingPathOf(error: unknown): string | undefined {
  const enoent = errorChain(error).find(
    (seen) => (seen as NodeJS.ErrnoException).code === "ENOENT",
  );
  if (enoent) return (enoent as NodeJS.ErrnoException).path ?? quotedPath(enoent.message);
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b/.test(message) ? quotedPath(message) : undefined;
}

export function errnoMissingPathOf(error: unknown): string | undefined {
  const enoent = errorChain(error).find(
    (seen) => (seen as NodeJS.ErrnoException).code === "ENOENT",
  ) as NodeJS.ErrnoException | undefined;
  return enoent?.path;
}
