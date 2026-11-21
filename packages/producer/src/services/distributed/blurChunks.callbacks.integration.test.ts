// Page motion blur through plan() -> renderChunk() -> assemble() on `callbacks`: the frames a fan-out
// assembles equal the frames a whole in-process render draws, chunk boundaries included.
// Needs Chrome and ffmpeg: integration lane.

import { describe, it } from "vitest";
import {
  expectChunksEqualWhole,
  HAS_FFMPEG,
  RENDER_TIMEOUT_MS,
  useBlurScratch,
} from "./__test_utils__/blurChunkRender.js";

describe.skipIf(!HAS_FFMPEG)("page motion blur in a distributed render: callbacks", () => {
  const root = useBlurScratch();

  it(
    "chunks of 20 frames assemble to the whole render's frames",
    () => expectChunksEqualWhole(root(), "callbacks"),
    RENDER_TIMEOUT_MS,
  );
});
