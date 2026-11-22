import { bundleScriptUrl } from "./sealed-runtime.js";

/** What the cjs and iife builds load for `@hyperframes/core/runtime-script`: the runtime file shipped beside them. */
export async function getHyperframeRuntimeScript(): Promise<string> {
  if (!bundleScriptUrl) throw new Error("The player's script URL is unknown");
  const response = await fetch(new URL("hyperframe.runtime.iife.js", bundleScriptUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
