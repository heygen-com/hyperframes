import { defineBlurRenderSuite } from "./__test_utils__/blurRender.js";

defineBlurRenderSuite("page motion blur through a multi-worker render, once-only callbacks", [
  "once-guard-label",
]);
