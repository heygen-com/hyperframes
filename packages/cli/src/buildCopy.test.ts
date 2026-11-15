import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const copySource = readFileSync(new URL("../scripts/build-copy.mjs", import.meta.url), "utf-8");

describe("build-copy bundled skills", () => {
  it("names only skills that exist in the repo's skills/ tree", () => {
    const list = copySource.match(/for \(const skill of \[([^\]]+)\]\)/)?.[1] ?? "";
    const skills = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(skills.length).toBeGreaterThan(0);
    const missing = skills.filter(
      (name) => !existsSync(new URL(`../../../skills/${name}/SKILL.md`, import.meta.url)),
    );
    expect(missing).toEqual([]);
  });
});
