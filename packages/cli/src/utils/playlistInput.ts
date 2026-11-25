export const PLAYLIST_LEAVES_FOLDER =
  "is a playlist naming files outside its folder: pass the media file itself";

/** The first path that is an HLS or ffconcat list naming a file outside its folder; check before any read or copy. */
export async function playlistLeavingItsFolder(
  paths: readonly (string | undefined)[],
): Promise<string | undefined> {
  const { playlistLeavesItsFolder } = await import("@hyperframes/engine");
  for (const path of paths) if (path && (await playlistLeavesItsFolder(path))) return path;
  return undefined;
}

export async function refusePlaylistLeavingItsFolder(
  paths: readonly (string | undefined)[],
): Promise<void> {
  const path = await playlistLeavingItsFolder(paths);
  if (path) throw new Error(`${path} ${PLAYLIST_LEAVES_FOLDER}`);
}
