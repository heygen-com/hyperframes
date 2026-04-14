import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  FILE_TYPES,
  ITEM_TYPES,
  isBlockItem,
  isComponentItem,
  isExampleItem,
  type BlockItem,
  type ComponentItem,
  type ExampleItem,
  type FileType,
  type ItemType,
  type RegistryItem,
  type RegistryManifest,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(here, "..", "..", "schemas");

function readSchema(name: string): Record<string, unknown> {
  const raw = readFileSync(resolve(schemasDir, name), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// Walk a JSON schema and collect every `enum` array found under a property
// with the given name. Visits each node exactly once; no cycles in parsed JSON.
function collectEnums(schema: unknown, propName: string): string[][] {
  const results: string[][] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    const props = obj.properties;
    if (props && typeof props === "object") {
      const target = (props as Record<string, unknown>)[propName];
      if (target && typeof target === "object") {
        const e = (target as Record<string, unknown>).enum;
        if (Array.isArray(e)) results.push(e.map(String));
      }
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(schema);
  return results;
}

function setKey(values: readonly string[]): string {
  return [...values].sort().join("|");
}

function setEquals(a: readonly string[], b: readonly string[]): boolean {
  return setKey(a) === setKey(b);
}

describe("registry types", () => {
  const registrySchema = readSchema("registry.json");
  const registryItemSchema = readSchema("registry-item.json");

  describe("type guards", () => {
    const baseFiles = [
      { path: "x.html", target: "compositions/x.html", type: "hyperframes:composition" as const },
    ];
    const example: ExampleItem = {
      name: "demo",
      type: "hyperframes:example",
      title: "Demo",
      description: "d",
      dimensions: { width: 1920, height: 1080 },
      duration: 5,
      files: baseFiles,
    };
    const block: BlockItem = {
      name: "demo-block",
      type: "hyperframes:block",
      title: "Demo Block",
      description: "d",
      dimensions: { width: 1080, height: 1350 },
      duration: 6,
      files: baseFiles,
    };
    const component: ComponentItem = {
      name: "demo-component",
      type: "hyperframes:component",
      title: "Demo Component",
      description: "d",
      files: baseFiles,
    };

    it("discriminates item types", () => {
      expect(isExampleItem(example)).toBe(true);
      expect(isExampleItem(block)).toBe(false);
      expect(isBlockItem(block)).toBe(true);
      expect(isBlockItem(component)).toBe(false);
      expect(isComponentItem(component)).toBe(true);
      expect(isComponentItem(example)).toBe(false);
    });

    it("narrows to the discriminant's shape", () => {
      const items: RegistryItem[] = [example, block, component];
      for (const item of items) {
        if (isExampleItem(item) || isBlockItem(item)) {
          // dimensions and duration are required on examples and blocks.
          expect(item.dimensions.width).toBeGreaterThan(0);
          expect(item.duration).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("constants match schema enums (drift guard)", () => {
    it("registry.json has exactly one `type` enum, equal to ITEM_TYPES", () => {
      const enums = collectEnums(registrySchema, "type");
      expect(enums).toHaveLength(1);
      expect(setEquals(enums[0]!, ITEM_TYPES)).toBe(true);
    });

    it("registry-item.json has exactly two `type` enums: one ITEM_TYPES, one FILE_TYPES", () => {
      const enums = collectEnums(registryItemSchema, "type");
      const distinct = new Set(enums.map(setKey));
      // Two semantically distinct enums — the item's `type` and each file's `type`.
      expect(distinct.size).toBe(2);
      expect(enums.some((e) => setEquals(e, ITEM_TYPES))).toBe(true);
      expect(enums.some((e) => setEquals(e, FILE_TYPES))).toBe(true);
    });
  });

  describe("schema files", () => {
    it("registry.json has the expected $id", () => {
      expect(registrySchema.$id).toBe("https://hyperframes.heygen.com/schema/registry.json");
    });

    it("registry-item.json has the expected $id", () => {
      expect(registryItemSchema.$id).toBe(
        "https://hyperframes.heygen.com/schema/registry-item.json",
      );
    });
  });

  describe("type-level sanity", () => {
    it("RegistryManifest accepts well-formed shape", () => {
      const m: RegistryManifest = {
        $schema: "https://hyperframes.heygen.com/schema/registry.json",
        name: "hyperframes",
        homepage: "https://hyperframes.heygen.com",
        items: [
          { name: "warm-grain", type: "hyperframes:example" },
          { name: "linkedin-post-card", type: "hyperframes:block" },
          { name: "shader-wipe", type: "hyperframes:component" },
        ],
      };
      expect(m.items).toHaveLength(3);
    });

    it("ItemType and FileType are assignable from their constants", () => {
      const _it: ItemType = ITEM_TYPES[0];
      const _ft: FileType = FILE_TYPES[0];
      expect(_it).toBeDefined();
      expect(_ft).toBeDefined();
    });

    it("components cannot carry dimensions or duration (compile-time)", () => {
      // @ts-expect-error — ComponentItem forbids `dimensions`.
      const _bad1: ComponentItem = {
        name: "bad",
        type: "hyperframes:component",
        title: "Bad",
        description: "d",
        files: [],
        dimensions: { width: 1, height: 1 },
      };
      // @ts-expect-error — ComponentItem forbids `duration`.
      const _bad2: ComponentItem = {
        name: "bad",
        type: "hyperframes:component",
        title: "Bad",
        description: "d",
        files: [],
        duration: 1,
      };
      void _bad1;
      void _bad2;
      expect(true).toBe(true);
    });

    it("examples and blocks require dimensions and duration (compile-time)", () => {
      // @ts-expect-error — ExampleItem requires `dimensions`.
      const _bad1: ExampleItem = {
        name: "bad",
        type: "hyperframes:example",
        title: "Bad",
        description: "d",
        duration: 5,
        files: [],
      };
      // @ts-expect-error — BlockItem requires `duration`.
      const _bad2: BlockItem = {
        name: "bad",
        type: "hyperframes:block",
        title: "Bad",
        description: "d",
        dimensions: { width: 1, height: 1 },
        files: [],
      };
      void _bad1;
      void _bad2;
      expect(true).toBe(true);
    });

    it("optional metadata fields are accepted (author, license, deprecated, minCliVersion)", () => {
      const item: ComponentItem = {
        name: "shader-wipe",
        type: "hyperframes:component",
        title: "Shader Wipe",
        description: "d",
        author: "heygen",
        license: "Apache-2.0",
        minCliVersion: "0.4.0",
        deprecated: "Use `shader-wipe-v2` instead.",
        files: [
          {
            path: "shader-wipe.html",
            target: "compositions/components/shader-wipe/shader-wipe.html",
            type: "hyperframes:snippet",
          },
        ],
      };
      expect(item.author).toBe("heygen");
    });
  });
});
