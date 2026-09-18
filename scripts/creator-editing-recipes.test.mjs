import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lintHyperframeHtml } from "../packages/lint/src/index.ts";

const OWNER = "skills/hyperframes-core/references/creator-editing-recipes.md";
const STUDIO_SKILL = "skills/hyperframes-studio/SKILL.md";
const VOLUME_TWEEN = /\.(?:to|from|fromTo|set)\(\s*["'`]#[\w-]+["'`]\s*,\s*\{[^}]*\bvolume\s*:/;
const TWEEN_SCANNED = [
  "skills/hyperframes-core/references/variables-and-media.md",
  "skills/hyperframes-core/references/data-attributes.md",
  "skills/hyperframes-animation/adapters/gsap.md",
  "skills/hyperframes-audio/SKILL.md",
  "skills/hyperframes-audio/references/attributes.md",
  "skills/music-to-video/references/montage.md",
  "packages/cli/src/docs/data-attributes.md",
];

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const htmlBlocks = (md) => [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]);

const wrap = (fragment) =>
  fragment.includes("<html")
    ? fragment
    : `<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="120" data-width="1920" data-height="1080">${fragment}</div><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script>window.__timelines = window.__timelines || {};</script></body></html>`;

test("every html example in the owner doc lints with no errors and no volume double-automation", async () => {
  const blocks = htmlBlocks(await read(OWNER));
  assert.ok(blocks.length >= 10, "expected the owner doc to keep its worked examples");
  for (const [i, block] of blocks.entries()) {
    const { findings } = await lintHyperframeHtml(wrap(block), { filePath: "index.html" });
    const bad = findings.filter(
      (f) => f.severity === "error" || f.code.startsWith("audio_volume_"),
    );
    assert.deepEqual(
      bad.map((f) => `${f.code}: ${f.message}`),
      [],
      `example ${i + 1} in ${OWNER}`,
    );
  }
});

test("no other doc teaches a timeline tween as the way to fade volume", async () => {
  for (const path of TWEEN_SCANNED) {
    const lines = (await read(path)).split("\n");
    const hit = lines.findIndex((l) => VOLUME_TWEEN.test(l));
    assert.equal(hit, -1, `${path}:${hit + 1} teaches a volume tween; point at ${OWNER}`);
  }
});

test("the Studio skill holds conventions only and points at the owner doc for edits", async () => {
  const skill = await read(STUDIO_SKILL);
  assert.match(skill, /creator-editing-recipes\.md/);
  assert.equal(htmlBlocks(skill).length, 0, "a recipe restated in the Studio skill will drift");
});
