import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("background-removal native dependency compatibility", () => {
  it("pins onnxruntime-node to the last release with an Intel macOS binary", () => {
    const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["onnxruntime-node"]).toBe("1.23.2");

    const bindingEntry = require.resolve("onnxruntime-node");
    const packageRoot = join(dirname(bindingEntry), "..");
    expect(existsSync(join(packageRoot, "bin/napi-v6/darwin/x64/onnxruntime_binding.node"))).toBe(
      true,
    );
  });
});
