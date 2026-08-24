/**
 * `docs/schema/hyperframes.json` is authored by hand (sync-schemas.ts mirrors
 * only the registry schemas and skips this one), sets `additionalProperties:
 * false`, and is the schema every generated `hyperframes.json` points at. So a
 * new config key that lands in code but not in the schema turns a valid,
 * committed config into one that fails validation in any schema-aware editor,
 * with nothing in CI to notice.
 *
 * This pins the two together: every key the CLI can write must be declared.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DEFAULT_PROJECT_CONFIG, type ProjectConfig } from "./projectConfig.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "docs/schema/hyperframes.json");

interface ConfigSchema {
  additionalProperties?: boolean;
  properties: Record<string, unknown>;
}

/**
 * Every key the CLI writes into `hyperframes.json`. Listed as a `ProjectConfig`
 * so a field added to the interface without a schema entry fails to compile
 * here before it can fail validation on a user's disk.
 */
const EVERY_WRITTEN_KEY: Required<Omit<ProjectConfig, "$schema">> & { $schema: string } = {
  $schema: "",
  registry: "",
  paths: DEFAULT_PROJECT_CONFIG.paths,
  media: {},
  authoringSkill: "",
  registryItems: [],
};

describe("hyperframes.json schema", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as ConfigSchema;

  it("declares every key the CLI can write", () => {
    // Guard the guard: without this, a schema that stopped rejecting unknown
    // keys would make the assertion below meaningless rather than failing.
    expect(schema.additionalProperties).toBe(false);
    for (const key of Object.keys(EVERY_WRITTEN_KEY)) {
      expect(Object.keys(schema.properties)).toContain(key);
    }
  });
});
