import { describe, expect, it } from "vitest";
import { validRegistryName, validRegistryManifest, validRegistryItem } from "./validation.js";

const item = {
  name: "demo",
  type: "hyperframes:component",
  title: "Demo",
  description: "Example",
  files: [{ path: "demo.html", target: "components/demo.html", type: "hyperframes:snippet" }],
};

describe("registry manifest boundary", () => {
  it("rejects cache-key traversal and marker breakouts", () => {
    for (const name of ["x/../../../.config/tool", "demo -->", "a".repeat(129)])
      expect(validRegistryName(name)).toBe(false);
    expect(validRegistryName("demo-2")).toBe(true);
  });
  it("validates the published item schema and requested identity", () => {
    expect(validRegistryItem(item, "demo", "hyperframes:component")).toBe(true);
    expect(validRegistryItem(item, "other", "hyperframes:component")).toBe(false);
    expect(validRegistryItem(item, "demo", "hyperframes:block")).toBe(false);
    expect(
      validRegistryItem(
        { ...item, files: [{ ...item.files[0], target: "../outside" }] },
        "demo",
        "hyperframes:component",
      ),
    ).toBe(false);
  });
  it("validates cached and remote top-level manifest shape and cardinality", () => {
    const manifest = {
      name: "registry",
      homepage: "https://registry.example",
      items: [{ name: "demo", type: "hyperframes:component" }],
    };
    expect(validRegistryManifest(manifest)).toBe(true);
    expect(validRegistryManifest({ ...manifest, items: [{ name: "../outside" }] })).toBe(false);
    expect(
      validRegistryManifest({ ...manifest, items: Array(10_001).fill(manifest.items[0]) }),
    ).toBe(false);
  });
});
