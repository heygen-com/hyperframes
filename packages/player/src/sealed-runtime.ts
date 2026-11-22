import { escapeInlineScriptSource } from "@hyperframes/core/compiler/html-tokens";

/** The script this bundle ran from, read while it runs: the only moment `currentScript` names it. */
export const bundleScriptUrl =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : null;

let source: Promise<string> | undefined;

/** The runtime this player was built with, as inline script text, loaded only once a sealed frame needs it. */
export function sealedRuntimeSource(): Promise<string> {
  // The esm build splits this into its own chunk; the cjs and iife builds alias it to runtime-beside-bundle.
  source ??= import("@hyperframes/core/runtime-script")
    .then((runtime) => runtime.getHyperframeRuntimeScript())
    .then(escapeInlineScriptSource);
  // A failed load is not kept: the next sealed load tries again.
  source.catch(() => (source = undefined));
  return source;
}
