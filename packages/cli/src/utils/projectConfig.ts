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
import { normalizeSkillSlug } from "../telemetry/skill.js";

export const PROJECT_CONFIG_FILENAME = "hyperframes.json";
const PROJECT_CONFIG_SCHEMA_URL = "https://hyperframes.heygen.com/schema/hyperframes.json";

export interface ProjectConfigPaths {
  /** Where `hyperframes:block` items land, relative to project root. */
  blocks: string;
  /** Where `hyperframes:component` items land, relative to project root. */
  components: string;
  /** Where asset files (images, fonts, videos) land, relative to project root. */
  assets: string;
}

export interface ProjectConfigMedia {
  /**
   * Auto-transcode browser-hostile video codecs (e.g. HEVC) to a cached
   * alpha-aware authoring proxy for supported preview surfaces. Render always uses the
   * original file regardless of this setting. Default true.
   */
  autoProxy?: boolean;
}

export interface ProjectConfig {
  $schema?: string;
  /** Base URL of the registry to pull items from. */
  registry: string;
  /** Target paths for each item type. */
  paths: ProjectConfigPaths;
  /** Media handling options (e.g. auto-proxying of browser-hostile codecs). */
  media?: ProjectConfigMedia;
  /**
   * Owning authoring-workflow skill slug (e.g. "product-launch-video"). Stamped
   * by `hyperframes init --skill` or seeded from the first `hyperframes render
   * --skill`, then read back so every later render of this project — re-render,
   * `npm run render`, `--batch`, preview — is attributed to it on anonymous
   * telemetry without the caller re-passing the flag.
   */
  authoringSkill?: string;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  $schema: PROJECT_CONFIG_SCHEMA_URL,
  registry: DEFAULT_REGISTRY_URL,
  paths: {
    blocks: "compositions",
    components: "compositions/components",
    assets: "assets",
  },
  media: {
    autoProxy: true,
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
    media: {
      autoProxy:
        typeof partial.media?.autoProxy === "boolean"
          ? partial.media.autoProxy
          : DEFAULT_PROJECT_CONFIG.media?.autoProxy,
    },
    // Slug-gate on read so a hand-edited or corrupt value never reaches the
    // telemetry stream; an invalid slug simply drops the attribution.
    authoringSkill: normalizeSkillSlug(partial.authoringSkill),
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

/**
 * Resolve whether auto-proxying of browser-hostile video codecs (HEVC, etc.)
 * is enabled for a project's live-preview surfaces. A caller's explicit
 * `--proxy`/`--no-proxy` flag always wins over the project config, in either
 * direction. Falls back to the committed `hyperframes.json`
 * `media.autoProxy` setting, and finally to `true` when neither is set.
 * Render is never affected by this setting: it always uses the original file.
 */
export function resolveAutoProxy(projectDir: string, flagValue: boolean | undefined): boolean {
  if (typeof flagValue === "boolean") {
    return flagValue;
  }
  return loadProjectConfig(projectDir).media?.autoProxy ?? true;
}

/** A parsed JSON value that can carry arbitrary keys — narrowed, not asserted. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a thrown filesystem error reports the path as absent. */
function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Persist the owning authoring-skill slug into `hyperframes.json` so every
 * later render of this project — re-render, `npm run render`, `--batch`,
 * preview — is attributed to the workflow that created it, without the caller
 * re-passing `--skill`.
 *
 * Seed-once: an existing stamp is never overwritten (the creating workflow owns
 * the identity; a one-off `--skill` on a later render still governs that
 * render's telemetry but does not rewrite the project's owner). An invalid or
 * empty slug is ignored. Best effort: a read-only or missing project directory
 * never fails the render it rode in on.
 *
 * This is the only writer that touches an ALREADY EXISTING `hyperframes.json`
 * (every other `writeProjectConfig` call site is guarded to write only when the
 * file is absent), so it must not round-trip through {@link normalizeConfig}:
 * that rebuilds the object from a field whitelist, which would drop keys it
 * does not know about and materialize defaults the user never wrote. The file
 * is normally committed, so a render must not introduce a diff beyond the one
 * key being added. Patch the parsed JSON in place instead, reusing the file's
 * own indentation.
 */
export function seedProjectAuthoringSkill(projectDir: string, rawSkill: unknown): void {
  const skill = normalizeSkillSlug(rawSkill);
  if (!skill) return;
  const path = projectConfigPath(projectDir);

  // Read once and branch on why the read failed, rather than testing for the
  // file first: an `existsSync`-then-write pair is a check-then-use race, and
  // only a genuinely absent config may be created from scratch — any other
  // read failure (permissions, I/O) must leave an existing file alone instead
  // of overwriting it with a default.
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if (isFileNotFound(error)) {
      try {
        writeProjectConfig(projectDir, { ...DEFAULT_PROJECT_CONFIG, authoringSkill: skill });
      } catch {
        // Read-only or missing project directory — best effort.
      }
    }
    return;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    // A malformed config is left untouched rather than clobbered by a render.
    if (!isJsonObject(parsed)) return;
    // Seed-once. Normalized so a hand-edited garbage slug neither reaches
    // telemetry nor wedges the seed — the next `--skill` render heals it.
    if (normalizeSkillSlug(parsed.authoringSkill)) return;
    parsed.authoringSkill = skill;
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
    writeFileSync(path, JSON.stringify(parsed, null, indent) + "\n", "utf-8");
  } catch {
    // Corrupt JSON, or a read-only file: attribution is best-effort telemetry,
    // never a render blocker.
  }
}
