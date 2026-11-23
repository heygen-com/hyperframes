export const bundleScriptUrl =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : null;

export async function runtimeBeside(scriptUrl: string | null): Promise<string> {
  if (!scriptUrl) throw new Error("The player's script URL is unknown");
  const response = await fetch(new URL("hyperframe.runtime.iife.js", scriptUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** What the cjs and iife builds load for `@hyperframes/core/runtime-script`. */
export const getHyperframeRuntimeScript = (): Promise<string> => runtimeBeside(bundleScriptUrl);
