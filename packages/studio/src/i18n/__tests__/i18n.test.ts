import { describe, it, expect } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

type NestedRecord = {
  [key: string]: string | string[] | NestedRecord;
};

function flattenKeys(obj: NestedRecord, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as NestedRecord, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe("i18n translation files", () => {
  it("en.json should have all string values", () => {
    const enKeys = flattenKeys(en as NestedRecord);
    expect(enKeys.length).toBeGreaterThan(0);
    for (const key of enKeys) {
      const value = getNestedValue(en as NestedRecord, key);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("zh.json should have the same structure as en.json", () => {
    const enKeys = new Set(flattenKeys(en as NestedRecord));
    const zhKeys = new Set(flattenKeys(zh as NestedRecord));

    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const extraInZh = [...zhKeys].filter((k) => !enKeys.has(k));

    expect(missingInZh, `Keys missing in zh.json: ${missingInZh.join(", ")}`).toHaveLength(0);
    expect(extraInZh, `Extra keys in zh.json not in en.json: ${extraInZh.join(", ")}`).toHaveLength(
      0,
    );
  });

  it("zh.json should have all string values", () => {
    const zhKeys = flattenKeys(zh as NestedRecord);
    expect(zhKeys.length).toBeGreaterThan(0);
    for (const key of zhKeys) {
      const value = getNestedValue(zh as NestedRecord, key);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("en.json should have nested structure consistent with zh.json", () => {
    function getStructure(obj: unknown): unknown {
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        const struct: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as NestedRecord)) {
          struct[key] = getStructure(value);
        }
        return struct;
      }
      return typeof obj;
    }

    const enStruct = JSON.stringify(getStructure(en));
    const zhStruct = JSON.stringify(getStructure(zh));
    expect(zhStruct).toBe(enStruct);
  });
});

function getNestedValue(obj: NestedRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") {
      return (acc as NestedRecord)[part];
    }
    return undefined;
  }, obj);
}
