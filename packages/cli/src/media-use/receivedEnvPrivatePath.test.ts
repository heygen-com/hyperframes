import { expect, it } from "vitest";
import { isStudioPrivatePath } from "@hyperframes/parsers/private-path";
import { isStudioPrivatePath as portedRule } from "./lib/received-env.mjs";

const MILLION = 1_000_000;
const PATHS = [
  ".hyperframes/studio-motion.json",
  ".hyperframes/app-history.jsonl",
  "sub/.hyperframes/studio-motion.json",
  ".media/take.mp4",
  "sub/.media/take.mp4",
  "/.hyperframes/studio-motion.json",
  "//.media/take.mp4",
  ".next/server.js",
  "scenes/intro.html",
  ".token",
  "/".repeat(MILLION),
  "a/".repeat(MILLION) + "clip.png",
  "/".repeat(MILLION) + ".hyperframes/studio-motion.json",
  "/".repeat(MILLION) + ".media/take.mp4",
  "a/".repeat(MILLION) + ".hyperframes/studio-motion.json",
];

it("the media-use copy of the private-path rule agrees with it, in linear time", () => {
  for (const path of PATHS) {
    const started = performance.now();
    expect(portedRule(path), path.slice(0, 40)).toBe(isStudioPrivatePath(path));
    expect(performance.now() - started).toBeLessThan(4_000);
  }
});
