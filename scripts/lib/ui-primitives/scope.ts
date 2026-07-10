import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const APPROVED_ITEMS_SHA256 = "b43bb3a9bcacb5258de86edd3687fcef6d36954f91bbef0977bac837bd14cfb7";

export interface UiPrimitiveScope {
  version: 1;
  name: "operator-black";
  comparisonBase: string;
  featureBaseline: string;
  items: string[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], source: string): void {
  const actual = Object.keys(value).sort(compareCodePoints);
  const wanted = [...expected].sort(compareCodePoints);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${source} keys must be exactly: ${wanted.join(", ")}`);
  }
}

function requireSha(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${source} ${field} must be a full lowercase Git SHA`);
  }
  return value;
}

export function parseUiPrimitiveScope(value: unknown, source = "scope"): UiPrimitiveScope {
  if (!isRecord(value)) throw new Error(`${source} must be an object`);
  assertExactKeys(value, ["version", "name", "comparisonBase", "featureBaseline", "items"], source);
  if (value.version !== 1) throw new Error(`${source} version must be 1`);
  if (value.name !== "operator-black") throw new Error(`${source} name must be operator-black`);
  if (!Array.isArray(value.items) || !value.items.every((item) => typeof item === "string")) {
    throw new Error(`${source} items must contain only strings`);
  }

  const items = [...value.items];
  if (items.length !== 66) throw new Error(`${source} must contain exactly 66 items`);
  if (new Set(items).size !== items.length) throw new Error(`${source} items must be unique`);
  if (JSON.stringify(items) !== JSON.stringify([...items].sort(compareCodePoints))) {
    throw new Error(`${source} items must be sorted`);
  }
  const itemsSha = createHash("sha256").update(items.join("\n")).digest("hex");
  if (itemsSha !== APPROVED_ITEMS_SHA256) {
    throw new Error(`${source} items do not match the approved frozen allowlist`);
  }

  return {
    version: 1,
    name: "operator-black",
    comparisonBase: requireSha(value.comparisonBase, "comparisonBase", source),
    featureBaseline: requireSha(value.featureBaseline, "featureBaseline", source),
    items,
  };
}

export function loadUiPrimitiveScope(path: string): UiPrimitiveScope {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parseUiPrimitiveScope(parsed, path);
}
