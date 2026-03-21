import { initSandboxRuntimeModular } from "./init";

type HyperframeWindow = Window & {
  __hyperframeRuntimeBootstrapped?: boolean;
};

// Inline composition scripts can run before DOMContentLoaded.
// Ensure timeline registry exists at script evaluation time.
(window as HyperframeWindow).__timelines = (window as HyperframeWindow).__timelines || {};

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
