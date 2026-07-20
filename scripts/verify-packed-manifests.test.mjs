import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  listPackedExportContracts,
  listPackedJavaScriptImportIssues,
  packageExportSpecifier,
  renderBrowserConsumer,
  verifyCliLicense,
} from "./verify-packed-manifests.mjs";

describe("packed manifest verifier", () => {
  it("requires the CLI package and tarball to declare Apache-2.0", () => {
    assert.throws(
      () => verifyCliLicense("packages/cli", {}, {}),
      /packages\/cli must declare license Apache-2\.0/,
    );
    assert.throws(
      () => verifyCliLicense("packages/cli", { license: "Apache-2.0" }, { license: "UNLICENSED" }),
      /packages\/cli packed manifest must preserve license Apache-2\.0/,
    );
    assert.doesNotThrow(() =>
      verifyCliLicense("packages/cli", { license: "Apache-2.0" }, { license: "Apache-2.0" }),
    );
  });

  it("keeps every browser package live even when it declares sideEffects false", () => {
    const consumer = renderBrowserConsumer(["@hyperframes/parsers", "@hyperframes/lint/browser"]);

    assert.match(consumer, /import \* as packedBrowserModule0 from "@hyperframes\/parsers";/);
    assert.match(consumer, /import \* as packedBrowserModule1 from "@hyperframes\/lint\/browser";/);
    assert.match(consumer, /packedBrowserModules\.map\(\(module\) => Object\.keys\(module\)\)/);
    assert.doesNotMatch(consumer, /import "@hyperframes\/parsers"/);
  });

  it("derives consumer specifiers from the packed export map", () => {
    assert.equal(packageExportSpecifier("@hyperframes/sdk", "."), "@hyperframes/sdk");
    assert.equal(
      packageExportSpecifier("@hyperframes/sdk", "./adapters/fs"),
      "@hyperframes/sdk/adapters/fs",
    );
    assert.deepEqual(
      listPackedExportContracts([
        {
          packedPackage: {
            name: "@hyperframes/example",
            exports: {
              ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
              "./runtime": "./dist/runtime.js",
            },
          },
        },
      ]),
      [
        {
          specifier: "@hyperframes/example",
          typechecked: true,
          environments: ["browser", "node"],
        },
        {
          specifier: "@hyperframes/example/runtime",
          typechecked: false,
          environments: ["browser", "node"],
        },
      ],
    );
  });

  it("uses descriptor environments to separate Node and browser promises", () => {
    assert.deepEqual(
      listPackedExportContracts([
        {
          packedPackage: {
            name: "@hyperframes/example",
            exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
          },
          descriptor: {
            subpaths: {
              ".": { environments: ["browser"] },
            },
          },
        },
      ]),
      [
        {
          specifier: "@hyperframes/example",
          typechecked: true,
          environments: ["browser"],
        },
      ],
    );
  });

  function withPackedFiles(files, packedFiles, callback) {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-pack-test-"));
    try {
      const packageDir = join(dir, "package");
      mkdirSync(packageDir, { recursive: true });
      for (const [file, source] of Object.entries(files)) {
        mkdirSync(dirname(join(packageDir, file)), { recursive: true });
        writeFileSync(join(packageDir, file), source, "utf8");
      }

      const tarball = join(dir, "package.tgz");
      execFileSync("tar", ["-czf", tarball, "-C", dir, "package"]);
      callback(tarball, new Set(packedFiles));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("passes explicit relative JavaScript imports whose target is packed", () => {
    withPackedFiles(
      {
        "dist/index.js": 'import { runtime } from "./generated/runtime-inline.js";\n',
        "dist/generated/runtime-inline.js": "export const runtime = 'ok';\n",
      },
      ["dist/index.js", "dist/generated/runtime-inline.js"],
      (tarball, packedFiles) => {
        assert.deepEqual(listPackedJavaScriptImportIssues(tarball, packedFiles), []);
      },
    );
  });

  it("reports explicit relative JavaScript imports whose target is missing from the tarball", () => {
    withPackedFiles(
      {
        "dist/index.js": 'import { runtime } from "./generated/runtime-inline.js";\n',
      },
      ["dist/index.js"],
      (tarball, packedFiles) => {
        assert.deepEqual(listPackedJavaScriptImportIssues(tarball, packedFiles), [
          "dist/index.js:1 imports missing ./generated/runtime-inline.js",
        ]);
      },
    );
  });

  it("checks export-from, dynamic import, require, and mjs/cjs files", () => {
    withPackedFiles(
      {
        "dist/index.js": 'export * from "./generated/exports.js";\n',
        "dist/dynamic.mjs": 'await import("./generated/dynamic.js");\n',
        "dist/require.cjs": 'require("./generated/require.js");\n',
      },
      ["dist/index.js", "dist/dynamic.mjs", "dist/require.cjs"],
      (tarball, packedFiles) => {
        assert.deepEqual(listPackedJavaScriptImportIssues(tarball, packedFiles), [
          "dist/index.js:1 imports missing ./generated/exports.js",
          "dist/dynamic.mjs:1 imports missing ./generated/dynamic.js",
          "dist/require.cjs:1 imports missing ./generated/require.js",
        ]);
      },
    );
  });

  it("reports extensionless relative imports", () => {
    withPackedFiles(
      {
        "dist/index.js": 'export {\n  runtime\n} from "./generated/runtime-inline";\n',
      },
      ["dist/index.js"],
      (tarball, packedFiles) => {
        assert.deepEqual(listPackedJavaScriptImportIssues(tarball, packedFiles), [
          "dist/index.js:1 imports ./generated/runtime-inline",
        ]);
      },
    );
  });

  it("reports side-effect imports whose target is missing from the tarball", () => {
    withPackedFiles(
      {
        "index.js": 'import "./missing.js";\n',
      },
      ["index.js"],
      (tarball, packedFiles) => {
        assert.deepEqual(listPackedJavaScriptImportIssues(tarball, packedFiles), [
          "index.js:1 imports missing ./missing.js",
        ]);
      },
    );
  });
});
