import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");

function findTag(tagName, id) {
  const match = skill.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`, "i"));
  assert.ok(match, `expected <${tagName} id="${id}"> in the canonical composition`);
  return match[0];
}

function readAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`\\b${attribute}="([^"]+)"`, "i"));
  assert.ok(match, `expected ${attribute} on ${tag}`);
  return match[1];
}

test("canonical composition keeps the source program audio on the video", () => {
  const video = findTag("video", "bg-video");
  assert.doesNotMatch(video, /\bmuted\b/);
  assert.equal(readAttribute(video, "data-has-audio"), "true");
  assert.doesNotMatch(skill, /<audio\b[^>]*\bid="source-audio"/);
});
