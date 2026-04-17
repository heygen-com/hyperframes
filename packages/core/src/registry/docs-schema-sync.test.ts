import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(here, "..", "..", "schemas");
const docsSchemaDir = resolve(here, "..", "..", "..", "..", "docs", "public", "schema");

const SCHEMA_FILES = ["hyperframes.json", "registry.json", "registry-item.json"] as const;

describe("docs/public/schema/ stays in sync with packages/core/schemas/", () => {
  for (const file of SCHEMA_FILES) {
    it(`${file} in docs matches the canonical copy in core`, () => {
      const canonical = readFileSync(resolve(schemasDir, file), "utf-8");
      const mirrored = readFileSync(resolve(docsSchemaDir, file), "utf-8");
      expect(mirrored).toBe(canonical);
    });

    it(`${file} declares the public URL as its $id`, () => {
      const parsed = JSON.parse(readFileSync(resolve(schemasDir, file), "utf-8")) as Record<string, unknown>;
      expect(parsed.$id).toBe(`https://hyperframes.heygen.com/schema/${file}`);
    });
  }
});
