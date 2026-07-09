import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const registryRoot = resolve(repoRoot, "registry");

const pilotMotionPrimitives = [
  "soft-blur-in",
  "tracking-in",
  "bottom-up-letters",
  "inline-highlight",
  "number-wheel",
  "simulated-cursor",
  "fade-through",
  "dynamic-grid",
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

describe("motion primitives catalog slice", () => {
  it("registers the pilot motion primitives as tagged components", () => {
    const registry = readJson<{ items: { name: string; type: string }[] }>(
      resolve(registryRoot, "registry.json"),
    );
    const componentEntries = new Map(
      registry.items
        .filter((item) => item.type === "hyperframes:component")
        .map((item) => [item.name, item]),
    );

    for (const name of pilotMotionPrimitives) {
      expect(componentEntries.has(name)).toBe(true);

      const componentDir = resolve(registryRoot, "components", name);
      const manifest = readJson<{
        type: string;
        tags?: string[];
        files?: { path: string; target: string; type: string }[];
      }>(resolve(componentDir, "registry-item.json"));
      expect(manifest.type).toBe("hyperframes:component");
      expect(manifest.tags).toContain("motion-primitive");
      expect(manifest.files).toEqual([
        {
          path: `${name}.html`,
          target: `compositions/components/${name}.html`,
          type: "hyperframes:snippet",
        },
      ]);
      expect(existsSync(resolve(componentDir, `${name}.html`))).toBe(true);
      expect(existsSync(resolve(componentDir, "demo.html"))).toBe(true);
    }
  });
});
