import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const guidance = [
  {
    path: "packages/core/src/runtime/adapters/animejs.ts",
    required: ["anime.animate", "anime.createTimeline"],
  },
  {
    path: "skills/hyperframes-animation/adapters/animejs.md",
    required: ["anime.animate", "anime.createTimeline"],
  },
  {
    path: "skills/hyperframes-keyframes/references/keyframe-patterns.md",
    required: ["anime.createTimeline"],
  },
];

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function fencedCode(source) {
  const normalized = source.replace(/^\s*\* ?/gm, "");
  return [...normalized.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]).join("\n");
}

for (const { path, required } of guidance) {
  test(`${path} uses Anime.js v4 call sites in executable examples`, () => {
    const snippets = fencedCode(read(path));
    for (const call of required) {
      assert.match(snippets, new RegExp(`\\b${call.replace(".", "\\.")}\\s*\\(`));
    }
    assert.doesNotMatch(snippets, /\banime\s*\(\s*\{/);
    assert.doesNotMatch(snippets, /\banime\.timeline\s*\(/);
  });
}

test("the window anime global advertises the v4 namespace API", () => {
  const source = read("packages/core/src/runtime/window.d.ts");
  const global = source.match(/\n\s*anime\?: \{([\s\S]*?)\n\s*\};/);
  assert.ok(global, "found Window.anime declaration");
  assert.match(global[1], /\banimate\??:\s*\(/);
  assert.match(global[1], /\bcreateTimeline\??:\s*\(/);
  assert.doesNotMatch(global[1], /^\s*\(params:/m);
  assert.doesNotMatch(global[1], /\btimeline\??:/);
});

test("the adapter's local anime global shape matches v4 while retaining legacy discovery", () => {
  const source = read("packages/core/src/runtime/adapters/animejs.ts");
  const global = source.match(/interface AnimeGlobal \{([\s\S]*?)\n\}/);
  assert.ok(global, "found AnimeGlobal declaration");
  assert.match(global[1], /\banimate\??:\s*\(/);
  assert.match(global[1], /\bcreateTimeline\??:\s*\(/);
  assert.match(global[1], /\brunning\??:/);
  assert.doesNotMatch(global[1], /^\s*\(params:/m);
  assert.doesNotMatch(global[1], /\btimeline\??:/);
});
