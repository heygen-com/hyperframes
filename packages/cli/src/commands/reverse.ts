import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  [
    "Open a reverse run: note it with HeyGen, then probe the video",
    "hyperframes reverse start ref.mp4 --dir my-rebuild",
  ],
];

export default defineCommand({
  meta: {
    name: "reverse",
    description: "Open a reverse-any-video run (start)",
  },
  subCommands: {
    start: () => import("./reverse/start.js").then((m) => m.default),
  },
});
