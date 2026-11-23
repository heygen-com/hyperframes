import { escapeInlineScriptSource } from "@hyperframes/core/compiler/html-tokens";

export const bundleScriptUrl =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : null;

let source: Promise<string> | undefined;

export function sealedRuntimeSource(): Promise<string> {
  // The esm build leaves this import to the app's bundler; the cjs and iife builds alias it to runtime-beside-bundle.
  source ??= import("@hyperframes/core/runtime-script")
    .then((runtime) => runtime.getHyperframeRuntimeScript())
    .then(escapeInlineScriptSource);
  source.catch(() => (source = undefined));
  return source;
}
