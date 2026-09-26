export const SCENE_PART_ATTR = "data-hf-scene";

export const SCENE_PARTS_META = "hf-scene-parts";

export const SCENE_NO_SWAP_ATTR = "data-hf-scene-no-swap";

/** Hashes of one preview document: everything outside the scene parts, and each scene's parts. */
export interface SceneParts {
  shared: string;
  scenes: Record<string, string>;
}
