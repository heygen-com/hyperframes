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

test("canonical composition preserves source audio as a root media track", () => {
  const video = findTag("video", "bg-video");
  const audio = findTag("audio", "source-audio");

  assert.match(video, /\bmuted\b/);
  assert.match(
    skill,
    /<\/div>\s*<!-- Preserve the source program audio[\s\S]*?<audio\b[^>]*\bid="source-audio"[^>]*>[\s\S]*?<\/audio>/,
  );
  assert.equal(readAttribute(audio, "src"), readAttribute(video, "src"));
  assert.equal(readAttribute(audio, "data-start"), readAttribute(video, "data-start"));
  assert.equal(readAttribute(audio, "data-duration"), readAttribute(video, "data-duration"));
  assert.notEqual(
    readAttribute(audio, "data-track-index"),
    readAttribute(video, "data-track-index"),
  );
});
