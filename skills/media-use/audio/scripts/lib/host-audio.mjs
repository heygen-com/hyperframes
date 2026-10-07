// Audio the host app supplied survives every pass that rebuilds audio_meta.json from the storyboard: an entry
// marked "source": "host" whose file exists. A frame the host scored takes no looked-up cue sound.
const isHost = (entry, path, exists) =>
  entry?.source === "host" && typeof path === "string" && exists(path);

/** The host's own entries in an earlier audio_meta.json; `exists` resolves a path from the project root. */
export function hostAudio(previous, exists) {
  const bgm = isHost(previous?.bgm, previous?.bgm?.path, exists) ? previous.bgm : null;
  const sfx = (previous?.sfx ?? []).filter((s) => isHost(s, s.file, exists));
  return { bgm, sfx, frames: new Set(sfx.map((s) => s.frame)) };
}

/** `rebuilt` with the host's bed and sounds put back; the host's bed wins over a looked-up one. */
export function keepHostAudio(rebuilt, host) {
  const looked = (rebuilt.sfx ?? []).filter((s) => !host.frames.has(s.frame));
  return { ...rebuilt, bgm: host.bgm ?? rebuilt.bgm, sfx: [...host.sfx, ...looked] };
}
