import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const itemDir = dirname(fileURLToPath(import.meta.url));

describe("liquid-glass-widgets registry item", () => {
  it("installs every local script referenced by the composition", () => {
    const manifest = JSON.parse(readFileSync(join(itemDir, "registry-item.json"), "utf8")) as {
      files: Array<{ path: string; target: string }>;
    };
    const html = readFileSync(join(itemDir, "liquid-glass-widgets.html"), "utf8");
    const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
      .map((match) => match[1] ?? "")
      .filter((src) => src && !/^(?:https?:)?\/\//i.test(src));

    expect(manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining(localScripts));
  });
});
