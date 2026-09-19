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
  "skills/media-use/references/operations.md",
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

test("the Remotion translation docs do not claim volume ramps are unsupported", async () => {
  for (const path of [
    "skills/remotion-to-hyperframes/references/limitations.md",
    "skills/remotion-to-hyperframes/references/media.md",
  ]) {
    assert.doesNotMatch(await read(path), /static `data-volume` only/, path);
  }
});

test("the Studio skill's safe boxes equal the preview's", async () => {
  const src = await read("packages/studio/src/utils/previewSafeMargins.ts");
  const action = src.match(/ACTION_SAFE_PERCENT = (\d+)/)?.[1];
  const title = src.match(/TITLE_SAFE_PERCENT = (\d+)/)?.[1];
  const skill = await read(STUDIO_SKILL);
  assert.match(skill, new RegExp(`Action-safe\\s*\\|\\s*${action}%`));
  assert.match(skill, new RegExp(`Title-safe\\s*\\|\\s*${title}%`));
});

test("the add-media recipe matches Studio's own drop defaults", async () => {
  const helpers = await read("packages/studio/src/utils/studioHelpers.ts");
  const defaults = helpers.match(/DEFAULT_TIMELINE_ASSET_DURATION[^=]*=\s*\{([^}]*)\}/)?.[1] ?? "";
  const secs = (kind) => defaults.match(new RegExp(`${kind}:\\s*(\\d+(?:\\.\\d+)?)`))?.[1];
  const section = (await read(OWNER)).split("## Add media")[1]?.split("\n## ")[0] ?? "";
  assert.ok(secs("image"), "could not read Studio's image default");
  assert.match(section, new RegExp(`Image: \`data-duration="${secs("image")}"\``));
  assert.match(section, new RegExp(`\`${secs("video")}\` only when the length cannot be read`));
  const image = section.match(/<img[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(image, new RegExp(`data-duration="${secs("image")}"`));
  const dropOps = await read("packages/studio/src/hooks/useTimelineAssetDropOps.ts");
  assert.match(dropOps, /fitTimelineAssetGeometry\(\s*null,/, "Studio centres by natural size now; update the doc");
  assert.match(section, /fill the whole frame/);
  assert.match(image, /left: 0px; top: 0px; width: 1920px; height: 1080px/);
  const drop = await read("packages/studio/src/utils/timelineAssetDrop.ts");
  for (const attr of ["class=\"clip\"", "data-start", "data-duration", "data-track-index"]) {
    assert.ok(drop.includes(attr), `Studio no longer writes ${attr}`);
    assert.ok(image.includes(attr.split("=")[0]), `doc example lacks ${attr}`);
  }
});
