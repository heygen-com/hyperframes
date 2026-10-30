import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lintHyperframeHtml } from "../packages/lint/src/index.ts";

const MIXING = "skills/media-use/references/mixing.md";
const FORMAT = "skills/hyperframes/references/format.md";
const ENTRY_SKILL = "skills/hyperframes/SKILL.md";
const VOLUME_TWEEN = /\.(?:to|from|fromTo|set)\(\s*["'`]#[\w-]+["'`]\s*,\s*\{[^}]*\bvolume\s*:/;
const TWEEN_SCANNED = [
  ENTRY_SKILL,
  FORMAT,
  "skills/hyperframes/references/runtimes.md",
  "skills/hyperframes/references/motion.md",
  "skills/hyperframes/references/film.md",
  "skills/media-use/references/operations.md",
  "packages/cli/src/docs/data-attributes.md",
];

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const htmlBlocks = (md) => [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]);

const wrap = (fragment) =>
  fragment.includes("<html")
    ? fragment
    : `<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="120" data-width="1920" data-height="1080">${fragment}</div><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script>window.__timelines = window.__timelines || {};</script></body></html>`;

test("every html example in the mixing doc lints with no errors and no volume double-automation", async () => {
  const blocks = htmlBlocks(await read(MIXING));
  assert.ok(blocks.length >= 1, "expected the mixing doc to keep its worked example");
  for (const [i, block] of blocks.entries()) {
    const { findings } = await lintHyperframeHtml(wrap(block), { filePath: "index.html" });
    const bad = findings.filter(
      (f) => f.severity === "error" || f.code.startsWith("audio_volume_"),
    );
    assert.deepEqual(
      bad.map((f) => `${f.code}: ${f.message}`),
      [],
      `example ${i + 1} in ${MIXING}`,
    );
  }
});

test("no other doc teaches a timeline tween as the way to fade volume", async () => {
  for (const path of TWEEN_SCANNED) {
    const lines = (await read(path)).split("\n");
    const hit = lines.findIndex((l) => VOLUME_TWEEN.test(l));
    assert.equal(hit, -1, `${path}:${hit + 1} teaches a volume tween; point at ${MIXING}`);
  }
});

test("the Remotion translation docs do not claim volume ramps are unsupported", async () => {
  for (const path of [
    "skills/remotion-to-hyperframes/references/limitations.md",
    "skills/remotion-to-hyperframes/references/media.md",
  ]) {
    assert.doesNotMatch(await read(path), /static `data-volume` only/, path);
  }
});

test("the entry skill's safe boxes equal the preview's", async () => {
  const src = await read("packages/studio/src/utils/previewSafeMargins.ts");
  const action = src.match(/ACTION_SAFE_PERCENT = (\d+)/)?.[1];
  const title = src.match(/TITLE_SAFE_PERCENT = (\d+)/)?.[1];
  const skill = await read(ENTRY_SKILL);
  assert.match(skill, new RegExp(`${action}% action-safe`));
  assert.match(skill, new RegExp(`${title}% title-safe`));
});

async function studioDefaultSeconds(kind) {
  const helpers = await read("packages/studio/src/utils/studioHelpers.ts");
  const block = helpers.match(/DEFAULT_TIMELINE_ASSET_DURATION[^=]*=\s*\{([^}]*)\}/);
  const defaults = block ? block[1] : "";
  const value = defaults.match(new RegExp(`${kind}:\\s*(\\d+(?:\\.\\d+)?)`));
  return value ? value[1] : undefined;
}

async function addMediaSection() {
  const doc = await read(FORMAT);
  const afterHeading = doc.split("## Adding media")[1] ?? "";
  return afterHeading.split("\n## ")[0];
}

test("an image without a duration lasts Studio's default image duration", async () => {
  const imageSecs = await studioDefaultSeconds("image");
  assert.ok(imageSecs, "could not read Studio's image default");
  assert.match(await read(FORMAT), new RegExp(`an \`<img>\` without one lasts ${imageSecs} s`));
});

test("the add-media recipe raises the root's duration and never probes the file", async () => {
  const section = await addMediaSection();
  assert.match(section, /Raise the root's `data-duration` to cover the new clip's end/);
  assert.doesNotMatch(section, /ffprobe/);
});

test("the add-media recipe uses Studio's full-frame geometry", async () => {
  const section = await addMediaSection();
  const dropOps = await read("packages/studio/src/hooks/useTimelineAssetDropOps.ts");
  assert.match(
    dropOps,
    /fitTimelineAssetGeometry\(\s*null,/,
    "Studio centres by natural size now; update the doc",
  );
  assert.match(section, /fill the frame/);
  assert.match(section, /left: 0; top: 0/);
  assert.match(section, /width and height equal to the canvas/);
});

test("the add-media recipe names every attribute Studio's drop writes, and no media duration", async () => {
  const section = await addMediaSection();
  const drop = await read("packages/studio/src/utils/timelineAssetDrop.ts");
  for (const attr of ['class="clip"', "data-start", "data-duration", "data-track-index"]) {
    assert.ok(drop.includes(attr), `Studio no longer writes ${attr}`);
  }
  const attributes = section.split("\n").find((line) => line.startsWith("- `id`")) ?? "";
  for (const attr of ["`id`", 'class="clip"', "data-start", "data-track-index"]) {
    assert.ok(attributes.includes(attr), `the add-media attributes lack ${attr}`);
  }
  assert.doesNotMatch(attributes, /data-duration/, "media must not author a duration");
});
