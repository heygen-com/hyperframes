// pad-frame-duration.mjs — keeps a frame's own #root/clip data-duration in
// sync with the padded index.html wrapper duration transitions.mjs computes.
//
// The frame's OWN internal file declares its #root/clip data-duration to the
// STORYBOARD's content-only length (frame-worker.md: duration is "fixed
// upstream"). When an outgoing transition pads the index.html WRAPPER's
// data-duration to cover the transition tail, the frame's own internal
// duration is left short — the render engine clip-gates the sub-composition's
// visible content at that shorter value, so content vanishes abruptly at
// content-end instead of fading gracefully through the wrapper's extended
// fade-out tween. Pad the frame's own file to match so both durations agree.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function padFrameInternalDuration(hyperframesDir, frameSrc, frameId, newDuration) {
  const framePath = resolve(hyperframesDir, frameSrc);
  let html;
  try {
    html = readFileSync(framePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const tagRe = /<[a-z][\w:-]*\s[^<>]*?>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (!tag.includes(`data-composition-id="${frameId}"`)) continue;
    if (!/data-duration="[\d.]+"/.test(tag)) continue;
    const newTag = tag.replace(/data-duration="[\d.]+"/, `data-duration="${newDuration}"`);
    if (newTag === tag) return;
    writeFileSync(framePath, html.slice(0, m.index) + newTag + html.slice(m.index + tag.length));
    return;
  }
}
