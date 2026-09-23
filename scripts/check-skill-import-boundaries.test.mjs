import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { it } from "node:test";
import { Transpiler } from "bun";

const parser = new Transpiler({ loader: "tsx" });
function moduleSpecifiers(source) {
  return parser.scanImports(source.replace(/^#![^\n]*/, "")).map((entry) => entry.path);
}

function scriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(path);
    return /\.(?:mjs|cjs|js|ts)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)
      ? [path]
      : [];
  });
}

it("shipped scripts keep literal relative imports inside their own skill", () => {
  const { skills } = JSON.parse(readFileSync("skills-manifest.json", "utf8"));
  const issues = [];
  let checked = 0;
  for (const name of Object.keys(skills)) {
    const root = resolve("skills", name);
    for (const file of scriptFiles(root)) {
      checked++;
      for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        const local = relative(root, target);
        if (local === ".." || local.startsWith(".." + sep)) {
          issues.push(relative(resolve("."), file) + ": " + specifier);
        }
      }
    }
  }
  assert.ok(checked > 0, "must inspect shipped scripts");
  assert.deepEqual(issues, []);
});

it("inspects static imports, re-exports, dynamic imports and require without reading comments", () => {
  assert.deepEqual(
    moduleSpecifiers(`
    // import "ignored";
    import "./side.mjs";
    import { x } from "./named.mjs";
    export { y } from "./export.mjs";
    export * from "./star.mjs";
    import("./dynamic.mjs");
    require("./common.cjs");
  `),
    ["./side.mjs", "./named.mjs", "./export.mjs", "./star.mjs", "./dynamic.mjs", "./common.cjs"],
  );
});
