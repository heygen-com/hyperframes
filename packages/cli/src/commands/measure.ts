import { defineCommand } from "../utils/defineCommand.js";
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
];

export default defineCommand({
  meta: {
    name: "measure",
    description:
      "Measure a video file as JSON: clock, cuts, events, frames, crops, eases, motion energy, look, faces, lip sync",
  },
  subCommands: {
    probe: () => import("./measure/probe.js").then((m) => m.default),
    cuts: () => import("./measure/cuts.js").then((m) => m.default),
    events: () => import("./measure/events.js").then((m) => m.default),
    frames: () => import("./measure/frames.js").then((m) => m.default),
    extract: () => import("./measure/extract.js").then((m) => m.default),
    curve: () => import("./measure/curve.js").then((m) => m.default),
    energy: () => import("./measure/energy.js").then((m) => m.default),
    look: () => import("./measure/look.js").then((m) => m.default),
    face: () => import("./measure/face.js").then((m) => m.default),
    sync: () => import("./measure/sync.js").then((m) => m.default),
  },
});
