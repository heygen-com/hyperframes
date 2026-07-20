import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  descriptorFromManifest,
  exportsFromDescriptor,
  sourceAliasEntries,
} from "./package-subpaths.mjs";

describe("package subpath contracts", () => {
  const descriptor = {
    package: "@hyperframes/example",
    subpaths: {
      ".": {
        source: "./src/index.ts",
        runtime: "./dist/index.js",
        types: "./dist/index.d.ts",
        environments: ["browser", "bun", "node"],
      },
      "./browser": {
        source: "./src/browser.ts",
        runtime: "./dist/browser.js",
        types: "./dist/browser.d.ts",
        environments: ["browser", "bun"],
      },
      "./package.json": {
        source: "./package.json",
        runtime: "./package.json",
        types: null,
        environments: ["browser", "bun", "node"],
      },
      "./prebuilt": {
        source: "./dist/prebuilt.js",
        runtime: {
          import: "./dist/prebuilt.js",
          require: "./dist/prebuilt.cjs",
          script: "./dist/prebuilt.global.js",
        },
        types: "./dist/prebuilt.d.ts",
        environments: ["browser", "bun", "node"],
      },
    },
  };

  it("generates local and published exports from one descriptor", () => {
    assert.deepEqual(exportsFromDescriptor(descriptor), {
      local: {
        ".": {
          bun: "./src/index.ts",
          import: "./src/index.ts",
          types: "./src/index.ts",
        },
        "./browser": {
          browser: "./src/browser.ts",
          bun: "./src/browser.ts",
          import: "./src/browser.ts",
          types: "./src/browser.ts",
        },
        "./package.json": "./package.json",
        "./prebuilt": {
          types: "./dist/prebuilt.d.ts",
          import: "./dist/prebuilt.js",
          require: "./dist/prebuilt.cjs",
          script: "./dist/prebuilt.global.js",
        },
      },
      published: {
        ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
        "./browser": { import: "./dist/browser.js", types: "./dist/browser.d.ts" },
        "./package.json": "./package.json",
        "./prebuilt": {
          types: "./dist/prebuilt.d.ts",
          import: "./dist/prebuilt.js",
          require: "./dist/prebuilt.cjs",
          script: "./dist/prebuilt.global.js",
        },
      },
    });
  });

  it("derives exact build aliases from selected public subpaths", () => {
    assert.deepEqual(sourceAliasEntries(descriptor, "/repo/packages/example", ["./browser"]), [
      ["@hyperframes/example/browser", "/repo/packages/example/src/browser.ts"],
    ]);
  });

  it("preserves packages that intentionally resolve local Node imports from dist", () => {
    const nodeRuntimeDescriptor = { ...descriptor, localNodeRuntime: true };
    const generated = exportsFromDescriptor(nodeRuntimeDescriptor);
    assert.equal(generated.local["."].node, "./dist/index.js");
    assert.equal(
      descriptorFromManifest({
        name: nodeRuntimeDescriptor.package,
        exports: generated.local,
        publishConfig: { exports: generated.published },
      }).localNodeRuntime,
      true,
    );
  });

  it("round-trips an existing dual manifest into a descriptor", () => {
    const manifest = {
      name: "@hyperframes/example",
      exports: exportsFromDescriptor(descriptor).local,
      publishConfig: { exports: exportsFromDescriptor(descriptor).published },
    };
    assert.deepEqual(descriptorFromManifest(manifest), descriptor);
  });
});
