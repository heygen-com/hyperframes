import { basename } from "node:path";

/** The temp file an ffmpeg run writes, when its last argument is one: what to remove if the run is cut off. */
export function scratchOutputOf(spawnfile: string, args: readonly string[]): string | undefined {
  const last = args.at(-1);
  if (!/^ffmpeg(\.exe)?$/i.test(basename(spawnfile)) || !last) return undefined;
  return /\.tmp-\d+-[\w-]+$/.test(basename(last)) ? last : undefined;
}
