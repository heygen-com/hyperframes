import { buildHyperframesRuntimeScript } from "../src/inline-scripts/hyperframesRuntime.engine";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const baseline = buildHyperframesRuntimeScript();
assert(baseline !== null, "buildHyperframesRuntimeScript() returned null — entry.ts not found");
const parityEnabled = buildHyperframesRuntimeScript({ defaultParityMode: true });
assert(parityEnabled !== null, "Parity-enabled build returned null");
const parityDisabled = buildHyperframesRuntimeScript({ defaultParityMode: false });
assert(parityDisabled !== null, "Parity-disabled build returned null");
const withSourceUrl = buildHyperframesRuntimeScript({
  sourceUrl: "hyperframe.runtime.iife.js",
});
assert(withSourceUrl !== null, "Build with sourceUrl returned null");

assert(baseline.includes("window.__player"), "Baseline runtime should include player contract");
assert(parityEnabled.length > 0, "Parity-enabled build should produce non-empty runtime source");
assert(parityDisabled.length > 0, "Parity-disabled build should produce non-empty runtime source");
assert(
  withSourceUrl.includes("//# sourceURL=hyperframe.runtime.iife.js"),
  "Build with sourceUrl should append sourceURL comment",
);

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_behavior_verified",
    baselineBytes: baseline.length,
    parityEnabledBytes: parityEnabled.length,
    parityDisabledBytes: parityDisabled.length,
    sourceUrlBytes: withSourceUrl.length,
  }),
);
