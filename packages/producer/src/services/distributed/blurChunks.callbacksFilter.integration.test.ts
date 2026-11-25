// The default tier through plan() -> renderChunk() -> assemble() on `callbacks`: with no
// data-motion-blur-tier on the root, `auto` draws with the filter tier, and the frames a fan-out
// assembles equal a whole in-process render's. Needs Chrome and ffmpeg: integration lane.

import { describe, it } from "vitest";
import {
  expectChunksEqualWhole,
  HAS_FFMPEG,
  RENDER_TIMEOUT_MS,
  useBlurScratch,
} from "./__test_utils__/blurChunkRender.js";

describe.skipIf(!HAS_FFMPEG)(
  "page motion blur in a distributed render, auto tier: callbacks",
  () => {
    const root = useBlurScratch();

    it(
      "chunks of 20 frames assemble to the whole render's frames",
      () => expectChunksEqualWhole(root(), "callbacks", "auto"),
      RENDER_TIMEOUT_MS,
    );
  },
);
