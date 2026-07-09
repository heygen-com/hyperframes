import { initSandboxRuntimeModular } from "./init";
import { fitTextFontSize } from "../text/fitTextFontSize";
import { getDuration, getVariables } from "./getVariables";
import { resolvePhases } from "./phases";

type HyperframeWindow = Window & {
  __hyperframeRuntimeBootstrapped?: boolean;
  __hyperframes?: {
    fitTextFontSize: typeof fitTextFontSize;
    getDuration: typeof getDuration;
    getVariables: typeof getVariables;
    resolvePhases: typeof resolvePhases;
  };
};

// Inline composition scripts can run before DOMContentLoaded.
// Ensure timeline registry exists at script evaluation time.
(window as HyperframeWindow).__timelines = (window as HyperframeWindow).__timelines || {};

// Expose runtime helpers immediately so composition scripts can use them
// before DOMContentLoaded (font sizing runs during script evaluation, and
// getVariables/getDuration are read by composition setup before the timeline is built).
(window as HyperframeWindow).__hyperframes = {
  fitTextFontSize,
  getDuration,
  getVariables,
  resolvePhases,
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
