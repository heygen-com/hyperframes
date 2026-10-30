import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  [
    "Size, frame rate and what to fix before rebuilding a video",
    "hyperframes measure probe ref.mp4",
  ],
  [
    "Everything that changes when, with the sound's hits",
    "hyperframes measure events ref.mp4 --map",
  ],
  ["The frames around every event, as strips", "hyperframes measure frames ref.mp4 --events"],
  [
    "One element's box, colours, text lines and moves",
    "hyperframes measure box ref.mp4 --start 1 --end 2.5 --roi 200,300,600,200 --track",
  ],
];

export default defineCommand({
  meta: {
    name: "measure",
    description:
      "Measure a video file as JSON: clock, cuts, events, frames, motion trails, crops, element boxes, eases, text, rhythm, look, tracking, flow, faces, lip sync, continuity",
  },
  subCommands: {
    probe: () => import("./measure/probe.js").then((m) => m.default),
    cuts: () => import("./measure/cuts.js").then((m) => m.default),
    events: () => import("./measure/events.js").then((m) => m.default),
    frames: () => import("./measure/frames.js").then((m) => m.default),
    trail: () => import("./measure/trail.js").then((m) => m.default),
    extract: () => import("./measure/extract.js").then((m) => m.default),
    box: () => import("./measure/box.js").then((m) => m.default),
    ink: () => import("./measure/ink.js").then((m) => m.default),
    curve: () => import("./measure/curve.js").then((m) => m.default),
    rhythm: () => import("./measure/rhythm.js").then((m) => m.default),
    objects: () => import("./measure/objects.js").then((m) => m.default),
    energy: () => import("./measure/energy.js").then((m) => m.default),
    look: () => import("./measure/look.js").then((m) => m.default),
    track: () => import("./measure/track.js").then((m) => m.default),
    flow: () => import("./measure/flow.js").then((m) => m.default),
    face: () => import("./measure/face.js").then((m) => m.default),
    sync: () => import("./measure/sync.js").then((m) => m.default),
    continuity: () => import("./measure/continuity.js").then((m) => m.default),
  },
});
