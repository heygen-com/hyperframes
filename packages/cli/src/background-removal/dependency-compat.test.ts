import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("background-removal native dependency compatibility", () => {
  it("keeps CLI native dependencies above their patched security floors", () => {
    const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toMatchObject({
      "adm-zip": "^0.6.0",
      sharp: "^0.35.0",
    });
  });

  it("keeps every Node server consumer above the patched security floor", () => {
    for (const manifest of [
      "../../package.json",
      "../../../engine/package.json",
      "../../../producer/package.json",
      "../../../gcp-cloud-run/package.json",
    ]) {
      const packageJson = JSON.parse(
        readFileSync(fileURLToPath(new URL(manifest, import.meta.url)), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
      };
      expect(packageJson.dependencies?.["@hono/node-server"], manifest).toBe("^2.0.5");
    }
  });

  it("pins the newest clean-audit ONNX release that retains Intel macOS", () => {
    const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    // 1.22+ pulls vulnerable adm-zip <0.6.0, while later releases also drop
    // the Intel macOS binary. Return to a newer ONNX release once it satisfies
    // both the clean dependency graph and the six-platform binary contract.
    expect(packageJson.dependencies?.["onnxruntime-node"]).toBe("1.21.1");

    const bindingEntry = require.resolve("onnxruntime-node");
    const packageRoot = join(dirname(bindingEntry), "..");
    const onnxPackageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(onnxPackageJson.dependencies).not.toHaveProperty("adm-zip");

    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "arm64"],
      ["linux", "x64"],
      ["win32", "arm64"],
      ["win32", "x64"],
    ] as const) {
      expect(
        existsSync(join(packageRoot, "bin/napi-v3", platform, arch, "onnxruntime_binding.node")),
        `${platform}/${arch} binding should be published`,
      ).toBe(true);
    }
  });
});
