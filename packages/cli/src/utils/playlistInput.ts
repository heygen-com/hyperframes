export const PLAYLIST_LEAVES_FOLDER =
  "is a playlist naming files outside its folder: pass the media file itself";

/**
 * The first named media file that is an HLS or ffconcat list naming a file outside its folder or private in it.
 * Check before anything reads, copies or uploads the files: ffmpeg would open what the list names, not the file.
 */
export async function playlistLeavingItsFolder(
  paths: readonly (string | undefined)[],
): Promise<string | undefined> {
  const { playlistLeavesItsFolder } = await import("@hyperframes/engine");
  for (const path of paths) if (path && (await playlistLeavesItsFolder(path))) return path;
  return undefined;
}

/** Throws for the first named file {@link playlistLeavingItsFolder} finds. */
export async function refusePlaylistLeavingItsFolder(
  paths: readonly (string | undefined)[],
): Promise<void> {
  const path = await playlistLeavingItsFolder(paths);
  if (path) throw new Error(`${path} ${PLAYLIST_LEAVES_FOLDER}`);
}
