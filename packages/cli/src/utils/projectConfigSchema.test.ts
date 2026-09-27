/**
 * `docs/schema/hyperframes.json` is authored by hand (sync-schemas.ts mirrors
 * only the registry schemas and skips this one), sets `additionalProperties:
 * false` at both levels, and is the schema every generated `hyperframes.json`
 * points at. So a new config key that lands in code but not in the schema turns
 * a valid, committed config into one that fails validation in any schema-aware
 * editor, with nothing in CI to notice.
 *
 * This pins the two together by validating a config that exercises every key
 * the CLI can write, nested objects included. A key-name check alone is not
 * enough: `registryItems` is an array of objects with their own
 * `additionalProperties: false`, so a fourth field on `RegistryItemRecord`
 * would recreate the same break one level down.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type RegistryItemRecord,
} from "./projectConfig.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "docs/schema/hyperframes.json");

/**
 * One record carrying every field the CLI writes. Typed, so a new field on
 * `RegistryItemRecord` is a compile error here until it is listed, and then a
 * validation failure until it is declared in the schema.
 */
const EVERY_RECORD_FIELD: Required<RegistryItemRecord> = {
  name: "data-chart",
  type: "hyperframes:block",
  target: "compositions/data-chart.html",
};

/** A config exercising every key the CLI can write, at every level. */
const EVERY_WRITTEN_KEY: Required<ProjectConfig> = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://example.test/registry",
  paths: DEFAULT_PROJECT_CONFIG.paths,
  media: { autoProxy: true },
  authoringSkill: "product-launch-video",
  registryItems: [EVERY_RECORD_FIELD],
};

describe("hyperframes.json schema", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as Record<string, unknown>;
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);

  it("accepts a config using every key the CLI can write", () => {
    // Guard the guard: without a closed schema at both levels the assertion
    // below would pass for an undeclared key rather than failing.
    expect(schema.additionalProperties).toBe(false);
    const items = (schema.properties as Record<string, { items?: Record<string, unknown> }>)
      .registryItems?.items;
    expect(items?.additionalProperties).toBe(false);

    expect(validate(EVERY_WRITTEN_KEY), JSON.stringify(validate.errors)).toBe(true);
  });

  // Proves the check above can fail, rather than passing because ajv was
  // handed something it never rejects.
  it("rejects a key the schema does not declare, at either level", () => {
    expect(validate({ ...EVERY_WRITTEN_KEY, unknownTopLevelKey: 1 })).toBe(false);
    expect(
      validate({
        ...EVERY_WRITTEN_KEY,
        registryItems: [{ ...EVERY_RECORD_FIELD, unknownItemKey: 1 }],
      }),
    ).toBe(false);
  });
});
