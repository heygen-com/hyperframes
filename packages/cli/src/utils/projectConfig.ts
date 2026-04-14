/**
 * Read and write `hyperframes.json` — the per-project config that tells
 * `hyperframes add` which registry to pull items from and where to drop them
 * in the user's project tree.
 *
 * The file is created by `hyperframes init` and optionally edited by users to
 * point at custom registries or reshape their project layout.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_REGISTRY_URL } from "../registry/index.js";

export const PROJECT_CONFIG_FILENAME = "hyperframes.json";
export const PROJECT_CONFIG_SCHEMA_URL = "https://hyperframes.heygen.com/schema/hyperframes.json";

export interface ProjectConfigPaths {
  /** Where `hyperframes:block` items land, relative to project root. */
  blocks: string;
  /** Where `hyperframes:component` items land, relative to project root. */
  components: string;
  /** Where asset files (images, fonts, videos) land, relative to project root. */
  assets: string;
}

export interface ProjectConfig {
  $schema?: string;
  /** Base URL of the registry to pull items from. */
  registry: string;
  /** Target paths for each item type. */
  paths: ProjectConfigPaths;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  $schema: PROJECT_CONFIG_SCHEMA_URL,
  registry: DEFAULT_REGISTRY_URL,
  paths: {
    blocks: "compositions",
    components: "compositions/components",
    assets: "assets",
  },
};

/** Path to the config file for a project rooted at `projectDir`. */
export function projectConfigPath(projectDir: string): string {
  return join(resolve(projectDir), PROJECT_CONFIG_FILENAME);
}

/** Read `hyperframes.json` from a project directory. */
export function readProjectConfig(projectDir: string): ProjectConfig | undefined {
  const path = projectConfigPath(projectDir);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<ProjectConfig>;
    return normalizeConfig(parsed);
  } catch {
    // Missing file or corrupt JSON → no config.
    return undefined;
  }
}

/**
 * Return a valid config — fills in any missing fields with defaults. Used
 * when a user's config file is present but partial (e.g. they only set
 * `registry` and rely on default paths).
 */
export function normalizeConfig(partial: Partial<ProjectConfig>): ProjectConfig {
  return {
    $schema: partial.$schema ?? DEFAULT_PROJECT_CONFIG.$schema,
    registry: partial.registry ?? DEFAULT_PROJECT_CONFIG.registry,
    paths: {
      blocks: partial.paths?.blocks ?? DEFAULT_PROJECT_CONFIG.paths.blocks,
      components: partial.paths?.components ?? DEFAULT_PROJECT_CONFIG.paths.components,
      assets: partial.paths?.assets ?? DEFAULT_PROJECT_CONFIG.paths.assets,
    },
  };
}

/** Write `hyperframes.json` to a project directory. Overwrites if present. */
export function writeProjectConfig(
  projectDir: string,
  config: ProjectConfig = DEFAULT_PROJECT_CONFIG,
): void {
  const path = projectConfigPath(projectDir);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Load the project config for the given directory, falling back to defaults
 * if missing. Mutates nothing on disk. Used by commands that want to operate
 * with or without an explicit config.
 */
export function loadProjectConfig(projectDir: string): ProjectConfig {
  return readProjectConfig(projectDir) ?? DEFAULT_PROJECT_CONFIG;
}
