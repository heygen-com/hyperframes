// Audio the host app supplied survives every pass that rebuilds audio_meta.json from the storyboard: an entry
// marked "source": "host" whose file exists. A frame the host scored takes no looked-up cue sound.
const isHost = (entry, path, exists) =>
  entry?.source === "host" && typeof path === "string" && exists(path);

/** The host's own entries in an earlier audio_meta.json, and the host-marked paths dropped because their file is
 *  gone; `exists` resolves a path from the project root. A frame written as "1" is frame 1. */
export function hostAudio(previous, exists) {
  const marked = [previous?.bgm?.path, ...(previous?.sfx ?? []).map((s) => s.file)];
  const bgm = isHost(previous?.bgm, previous?.bgm?.path, exists) ? previous.bgm : null;
  const sfx = (previous?.sfx ?? [])
    .filter((s) => isHost(s, s.file, exists))
    .map((s) => ({ ...s, frame: Number(s.frame) }));
  const hostMarked = [previous?.bgm, ...(previous?.sfx ?? [])].filter((e) => e?.source === "host");
  const dropped = hostMarked.map((e) => e.path ?? e.file).filter((path) => !exists(path));
  return { bgm, sfx, frames: new Set(sfx.map((s) => s.frame)), dropped };
}

/** `rebuilt` with the host's bed and sounds put back; the host's bed wins over a looked-up one. */
export function keepHostAudio(rebuilt, host) {
  const looked = (rebuilt.sfx ?? []).filter((s) => !host.frames.has(s.frame));
  return { ...rebuilt, bgm: host.bgm ?? rebuilt.bgm, sfx: [...host.sfx, ...looked] };
}
