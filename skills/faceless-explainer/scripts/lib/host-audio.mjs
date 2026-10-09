// Audio the host app supplied survives every pass that rebuilds audio_meta.json from the storyboard: an entry
// marked "source": "host" whose file exists. A frame the host scored takes no looked-up cue sound.
/** The host's own entries in an earlier audio_meta.json, and why any other host-marked entry was dropped; `exists`
 *  resolves a path from the project root. A frame written as "1" is frame 1. */
export function hostAudio(previous, exists) {
  const marked = [[previous?.bgm, "path"], ...(previous?.sfx ?? []).map((s) => [s, "file"])].filter(
    ([entry]) => entry?.source === "host",
  );
  const kept = new Set();
  const dropped = [];
  for (const [entry, key] of marked) {
    const path = entry[key];
    if (typeof path !== "string") dropped.push(`a host entry has no "${key}"`);
    else if (!exists(path)) dropped.push(`${path} is not on disk`);
    else kept.add(entry);
  }
  const bgm = kept.has(previous?.bgm) ? previous.bgm : null;
  const sfx = (previous?.sfx ?? [])
    .filter((s) => kept.has(s))
    .map((s) => ({ ...s, frame: Number(s.frame) }));
  return { bgm, sfx, frames: new Set(sfx.map((s) => s.frame)), dropped };
}

/** `rebuilt` with the host's bed and sounds put back; the host's bed wins over a looked-up one. */
export function keepHostAudio(rebuilt, host) {
  const looked = (rebuilt.sfx ?? []).filter((s) => !host.frames.has(s.frame));
  return { ...rebuilt, bgm: host.bgm ?? rebuilt.bgm, sfx: [...host.sfx, ...looked] };
}
