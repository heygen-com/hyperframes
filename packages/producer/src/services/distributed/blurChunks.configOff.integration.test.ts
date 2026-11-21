// An explicit pageMotionBlur "off" in the distributed config still stands the page's blur down:
// the escape hatch behind `hyperframes render --page-motion-blur off`. Needs Chrome and ffmpeg:
// integration lane.

import { describe, expect, it } from "vitest";
import { RENDER_OUTSIDE_MAX_MAE } from "../../../../engine/src/services/__fixtures__/motionBlur/thresholds.js";
import {
  compareEveryFrame,
  expectEqualFrames,
  fixtureNamed,
  HAS_FFMPEG,
  RENDER_TIMEOUT_MS,
  renderChunked,
  renderWhole,
  useBlurScratch,
  WHOLE_WORKERS,
  worstMae,
} from "./__test_utils__/blurChunkRender.js";

describe.skipIf(!HAS_FFMPEG)("page motion blur in a distributed render: config off", () => {
  const root = useBlurScratch();

  it(
    "keeps pageMotionBlur off when the config says off",
    async () => {
      const f = fixtureNamed("held-card");
      const wholeOff = await renderWhole(root(), f, "off", WHOLE_WORKERS);
      const stoodDown = await renderChunked(root(), f, "on", "chunked-config-off", {
        pageMotionBlur: "off",
      });
      expectEqualFrames("config off", compareEveryFrame(wholeOff, stoodDown));

      const blurred = await renderChunked(root(), f, "on", "chunked-on");
      expect(
        worstMae(compareEveryFrame(wholeOff, blurred)),
        "blur on must differ from blur off, or the comparison above proves nothing",
      ).toBeGreaterThan(RENDER_OUTSIDE_MAX_MAE);
    },
    RENDER_TIMEOUT_MS,
  );
});
