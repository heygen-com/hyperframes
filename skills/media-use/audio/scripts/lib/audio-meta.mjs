import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";

// Keep the merge base and output on the same file even if its pathname changes
// while audio generation runs. The CLI owns this handle until write or exit.
export function openAudioMeta(path) {
  let fd;
  try {
    fd = openSync(path, "r+");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let value = {};
  if (fd !== undefined) {
    try {
      value = JSON.parse(readFileSync(fd, "utf8"));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  return {
    value,
    write(meta) {
      const bytes = Buffer.from(JSON.stringify(meta, null, 2));
      // Defer new-file creation until generation succeeds. Never overwrite a
      // file (or follow a link) that appeared since the missing merge base.
      if (fd === undefined) fd = openSync(path, "wx");
      try {
        let offset = 0;
        while (offset < bytes.length) {
          offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
        }
        ftruncateSync(fd, bytes.length);
      } finally {
        closeSync(fd);
      }
    },
  };
}

// A TTS run that re-voices only some lines must not drop the others. Voices merge by id: an
// unrequested voice stays in place, a re-voiced line replaces its entry and a new line is appended.
// A requested line that failed keeps its earlier entry only while that file exists, so the list
// never names a missing file. When every earlier id is requested, `fresh` is the whole result.
export function mergeVoices(previous, fresh, { requested, exists }) {
  const asked = new Set(requested);
  if (previous.every((voice) => asked.has(voice.id))) return fresh;
  const freshById = new Map(fresh.map((voice) => [voice.id, voice]));
  const merged = previous.flatMap((voice) => {
    if (!asked.has(voice.id)) return [voice];
    const next = freshById.get(voice.id);
    freshById.delete(voice.id);
    if (next) return [next];
    return exists(voice.path) ? [voice] : [];
  });
  return [...merged, ...freshById.values()];
}
