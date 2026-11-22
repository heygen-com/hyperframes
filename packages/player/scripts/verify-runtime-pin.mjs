#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expected = `@hyperframes/core@${version}/dist/hyperframe.runtime.iife.js`;
const bundles = [
  "dist/hyperframes-player.js",
  "dist/hyperframes-player.cjs",
  "dist/hyperframes-player.global.js",
];

for (const bundle of bundles) {
  const source = readFileSync(join(root, bundle), "utf8");
  if (!source.includes(expected)) {
    throw new Error(`${bundle} does not pin the injected runtime to ${version}`);
  }
  if (source.includes("@hyperframes/core/dist/hyperframe.runtime.iife.js")) {
    throw new Error(`${bundle} still contains an unversioned runtime URL`);
  }
}

// A sealed player carries the runtime itself: the exact files the core it was built with emits.
const coreDist = join(
  dirname(createRequire(import.meta.url).resolve("@hyperframes/core/package.json")),
  "dist",
);
const read = (path) => readFileSync(path, "utf8");
if (
  read(join(root, "dist/hyperframe.runtime.iife.js")) !==
  read(join(coreDist, "hyperframe.runtime.iife.js"))
) {
  throw new Error("dist/hyperframe.runtime.iife.js is not the runtime core built");
}
const chunk = read(join(root, "dist/hyperframes-player.js")).match(
  /import\("\.\/(runtime-inline-[\w-]+\.js)"\)/,
)?.[1];
if (!chunk) throw new Error("the ESM build does not import the runtime as its own chunk");
const shipped = (
  await import(pathToFileURL(join(root, "dist", chunk)).href)
).getHyperframeRuntimeScript();
const built = (
  await import(pathToFileURL(join(coreDist, "generated/runtime-inline.js")).href)
).getHyperframeRuntimeScript();
if (shipped !== built) throw new Error(`dist/${chunk} is not the runtime core built`);
// A run of the runtime's code that survives being embedded as a string: no quotes or backslashes.
const marker = built.match(/[\w.(){};=,!&|+-]{80}/)?.[0];
if (!marker || !read(join(root, "dist", chunk)).includes(marker)) {
  throw new Error("the inlined-runtime check would not see a runtime embedded in a bundle");
}
for (const bundle of ["dist/hyperframes-player.cjs", "dist/hyperframes-player.global.js"]) {
  if (read(join(root, bundle)).includes(marker)) {
    throw new Error(`${bundle} inlines the runtime instead of loading the file beside it`);
  }
}

console.log(`Verified Player runtime injection is pinned to @hyperframes/core@${version}.`);
