import { escapeInlineScriptSource } from "@hyperframes/core/compiler/html-tokens";
import { runtimeBeside } from "./runtime-beside-bundle.js";

let source: Promise<string> | undefined;

export function sealedRuntimeSource(): Promise<string> {
  // esm: the bundler resolves this, else the file beside the module; cjs/iife alias it.
  source ??= import("@hyperframes/core/runtime-script")
    .then(
      (runtime) => runtime.getHyperframeRuntimeScript(),
      (error: unknown) =>
        import.meta.url ? runtimeBeside(import.meta.url) : Promise.reject(error),
    )
    .then(escapeInlineScriptSource);
  source.catch(() => (source = undefined));
  return source;
}
