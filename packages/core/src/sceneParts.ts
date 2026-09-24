// The preview's per-scene parts: shared by the bundler that tags them and the runtime that swaps them.

/** On a scene's top-level host and on its own <style> and <script>: the scene's runtime id. */
export const SCENE_PART_ATTR = "data-hf-scene";

/** `<meta name=...>` whose content is a {@link SceneParts} manifest of the served preview document. */
export const SCENE_PARTS_META = "hf-scene-parts";

/** Hashes of one preview document: everything outside the scene parts, and each scene's parts. */
export interface SceneParts {
  shared: string;
  scenes: Record<string, string>;
}
