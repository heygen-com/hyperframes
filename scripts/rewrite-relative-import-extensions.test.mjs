import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { rewriteRelativeImportExtensions } from "./rewrite-relative-import-extensions.mjs";

function withEmittedFiles(files, callback) {
  const dir = mkdtempSync(join(tmpdir(), "hyperframes-rewrite-test-"));
  try {
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), source);
    }
    callback(dir, (file) => readFileSync(join(dir, file), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("relative import extension rewrite", () => {
  it("points declaration imports at the JavaScript they describe", () => {
    withEmittedFiles(
      {
        "index.d.ts": [
          'import type { A } from "./types";',
          'export * from "./adapters";',
          'import "./side";',
          'export declare const c: import("./types").A;',
          'export type { D } from "./explicit.js";',
          "",
        ].join("\n"),
        "types.d.ts": "export type A = string;\n",
        "adapters/index.d.ts": "export {};\n",
        "b.d.ts": "export declare const b: number;\n",
        "nested/c.d.ts": 'export { b } from "../b";\n',
        "side.d.ts": "export {};\n",
      },
      (dir, read) => {
        assert.equal(rewriteRelativeImportExtensions(dir), 2);
        assert.equal(
          read("index.d.ts"),
          [
            'import type { A } from "./types.js";',
            'export * from "./adapters/index.js";',
            'import "./side.js";',
            'export declare const c: import("./types.js").A;',
            'export type { D } from "./explicit.js";',
            "",
          ].join("\n"),
        );
        assert.equal(read("nested/c.d.ts"), 'export { b } from "../b.js";\n');
      },
    );
  });

  it("fails the build when a declaration import has no declaration behind it", () => {
    withEmittedFiles({ "index.d.ts": 'export * from "./missing";\n' }, (dir) => {
      assert.throws(
        () => rewriteRelativeImportExtensions(dir),
        /index\.d\.ts imports \.\/missing, which has no declaration/,
      );
    });
  });

  it("resolves JavaScript against emitted JavaScript and leaves unmatched text alone", () => {
    withEmittedFiles(
      {
        "index.js": 'export * from "./util";\nconst snippet = \'import x from "./not-emitted"\';\n',
        "util.js": "export {};\n",
      },
      (dir, read) => {
        rewriteRelativeImportExtensions(dir);
        assert.equal(
          read("index.js"),
          'export * from "./util.js";\nconst snippet = \'import x from "./not-emitted"\';\n',
        );
      },
    );
  });

  it("leaves already-correct output untouched", () => {
    withEmittedFiles(
      { "index.d.ts": 'export * from "./a.js";\n', "a.d.ts": "export {};\n" },
      (dir) => assert.equal(rewriteRelativeImportExtensions(dir), 0),
    );
  });
});
