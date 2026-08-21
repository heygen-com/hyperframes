import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHyperframeRuntimeSource } from "../src/inline-scripts/hyperframe";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const runtimeSource = loadHyperframeRuntimeSource();
assert(runtimeSource !== null, "loadHyperframeRuntimeSource() returned null — entry.ts not found");

const requiredSnippets = [
  "window.__player",
  "window.__playerReady",
  "window.__renderReady",
  "hf-preview",
  "hf-parent",
  "renderSeek",
  "__hyperframes",
  "fitTextFontSize",
];

for (const snippet of requiredSnippets) {
  assert(runtimeSource.includes(snippet), `Runtime contract snippet missing: ${snippet}`);
}

// Snippet checks cannot prove what `window.__hyperframes` ends up carrying.
// A name can reach the bundle through an unrelated import: `fitTextFontSize.ts`
// imports `prepare`/`layout` from `@chenglou/pretext`, so grepping for
// "pretext" stays green even if the attachment in entry.ts is deleted. Run the
// runtime and read the object back instead.
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "outside-only",
});
// The runtime's DOMContentLoaded path calls requestAnimationFrame. jsdom only
// provides it under `pretendToBeVisual`, which also starts a frame loop that
// keeps the process alive, so stub it instead. The stub never fires: we are
// asserting what the runtime attaches at evaluation time, not what it animates.
Object.defineProperty(dom.window, "requestAnimationFrame", {
  value: () => 0,
  configurable: true,
});
Object.defineProperty(dom.window, "cancelAnimationFrame", {
  value: () => {},
  configurable: true,
});
dom.window.eval(runtimeSource);

const hyperframes = (dom.window as unknown as { __hyperframes?: Record<string, unknown> })
  .__hyperframes;
assert(hyperframes, "Runtime did not attach window.__hyperframes");

// Each of these is an API the agent-facing docs tell composition authors to
// call. If one stops being attached, every composition written against the
// docs throws at render time, which no other check would catch.
const requiredHelpers = ["fitTextFontSize", "getVariables"];
for (const helper of requiredHelpers) {
  assert(
    typeof hyperframes[helper] === "function",
    `window.__hyperframes.${helper} is not attached`,
  );
}

const pretext = hyperframes.pretext as Record<string, unknown> | undefined;
assert(pretext, "window.__hyperframes.pretext is not attached");
const requiredPretextFns = [
  "prepare",
  "layout",
  "prepareWithSegments",
  "measureLineStats",
  "measureNaturalWidth",
];
for (const fn of requiredPretextFns) {
  assert(typeof pretext[fn] === "function", `window.__hyperframes.pretext.${fn} is not attached`);
}

// clearCache/setLocale mutate state shared across compositions. Keeping them
// off the surface is a deliberate determinism choice, so assert it holds.
for (const forbidden of ["clearCache", "setLocale"]) {
  assert(
    !(forbidden in pretext),
    `window.__hyperframes.pretext.${forbidden} must not be exposed (mutates shared state)`,
  );
}

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const manifestPath = resolve(scriptDir, "../dist/hyperframe.manifest.json");
try {
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as { artifacts?: { iife?: string; esm?: string } };
  assert(Boolean(manifest.artifacts?.iife), "Manifest is missing iife artifact");
  assert(Boolean(manifest.artifacts?.esm), "Manifest is missing esm artifact");
} catch {
  // Build may not have run yet; contract-only checks above still provide signal.
}

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_contract_verified",
    requiredSnippetsChecked: requiredSnippets.length,
  }),
);
