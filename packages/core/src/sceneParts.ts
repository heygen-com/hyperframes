export const SCENE_PART_ATTR = "data-hf-scene";

export const SCENE_PARTS_META = "hf-scene-parts";

/** On a scene's top-level host: why the scene cannot be swapped in place, so edits to it reload. */
export const SCENE_NO_SWAP_ATTR = "data-hf-scene-no-swap";

export const SCENE_EAGER_ATTR = "data-hf-scene-eager";

export const REACHED_BY_ROOT_REASON = "a script outside the scene selects";

export const READ_BY_SCENE_REASON = "reads it";

/** Hashes of one preview document: everything outside the scene parts, and each scene's parts. */
export interface SceneParts {
  shared: string;
  scenes: Record<string, string>;
}
