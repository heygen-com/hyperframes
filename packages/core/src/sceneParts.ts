// The preview's per-scene parts: shared by the bundler that tags them and the runtime that swaps them.

/** On a scene's top-level host and on its own <style> and <script>: the scene's runtime id. */
export const SCENE_PART_ATTR = "data-hf-scene";

/** `<meta name=...>` whose content is a {@link SceneParts} manifest of the served preview document. */
export const SCENE_PARTS_META = "hf-scene-parts";

/** On a scene's top-level host: why the scene cannot be swapped in place, so edits to it reload. */
export const SCENE_NO_SWAP_ATTR = "data-hf-scene-no-swap";

// Anything a scene script can leave running or registered outside its timeline. Only the timeline
// is torn down when a scene is swapped, so when unsure, refuse.
const SIDE_EFFECT_RE =
  /\b(addEventListener|requestAnimationFrame|setTimeout|setInterval|queueMicrotask|getContext|WebGL\w*|WebGPU|gpu|Worker|AudioContext|\w*Observer|fetch|import|eval|Function|lottie|THREE|__hf[A-Z]\w*)\b|\.on[a-z]+\s*=(?!=)/;

/** Why an authored scene script cannot be swapped out cleanly, or null when it can. */
export function sceneScriptSwapRefusal(script: string): string | null {
  const match = SIDE_EFFECT_RE.exec(script);
  return match ? `its script uses ${match[0].trim()}` : null;
}

/** Hashes of one preview document: everything outside the scene parts, and each scene's parts. */
export interface SceneParts {
  shared: string;
  scenes: Record<string, string>;
}
