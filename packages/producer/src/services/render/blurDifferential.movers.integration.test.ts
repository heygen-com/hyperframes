import { describe } from "vitest";
import { defineBlurRenderSuite } from "./__test_utils__/blurRender.js";

defineBlurRenderSuite(
  describe,
  "page motion blur through a multi-worker render, held and overflowing movers",
  ["held-card", "overflow-wordmark"],
);
