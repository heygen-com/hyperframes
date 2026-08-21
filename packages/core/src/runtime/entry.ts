import { initSandboxRuntimeModular } from "./init";
import { installAuthoredOpacityCapture } from "./colorGrading";
import { fitTextFontSize } from "../text/fitTextFontSize";
import { pretext } from "../text/pretext";
import { getVariables } from "./getVariables";

type HyperframeWindow = Window & {
  __hyperframeRuntimeBootstrapped?: boolean;
  __hyperframes?: {
    fitTextFontSize: typeof fitTextFontSize;
    getVariables: typeof getVariables;
    pretext: typeof pretext;
  };
};

// Inline composition scripts can run before DOMContentLoaded.
// Ensure timeline registry exists at script evaluation time.
(window as HyperframeWindow).__timelines = (window as HyperframeWindow).__timelines || {};

// Stamp color-graded elements with their authored inline opacity BEFORE the
// composition's animation scripts (and the grading hide) mutate it — must run
// at script evaluation time, while the document is still parsing.
installAuthoredOpacityCapture();

// Expose runtime helpers immediately so composition scripts can use them
// before DOMContentLoaded (font sizing runs during script evaluation, and
// getVariables is read by composition setup before the timeline is built).
(window as HyperframeWindow).__hyperframes = {
  fitTextFontSize,
  getVariables,
  pretext,
};

function bootstrapHyperframeRuntime(): void {
  const win = window as HyperframeWindow;
  if (win.__hyperframeRuntimeBootstrapped) {
    return;
  }
  win.__hyperframeRuntimeBootstrapped = true;
  initSandboxRuntimeModular();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapHyperframeRuntime, { once: true });
} else {
  bootstrapHyperframeRuntime();
}
