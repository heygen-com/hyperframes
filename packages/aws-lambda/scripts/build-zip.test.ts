import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("build-zip handler banner", () => {
  it("defines CommonJS path globals for inlined CJS dependencies", () => {
    const source = readFileSync(fileURLToPath(new URL("./build-zip.ts", import.meta.url)), "utf8");

    expect(source).toContain('import { fileURLToPath as __hf_fileURLToPath } from "url";');
    expect(source).toContain('import { dirname as __hf_dirname } from "path";');
    expect(source).toContain("const __filename = __hf_fileURLToPath(import.meta.url);");
    expect(source).toContain("const __dirname = __hf_dirname(__filename);");
  });
});
