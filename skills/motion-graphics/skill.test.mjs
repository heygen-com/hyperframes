import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("motion-graphics builds the composition at the CLI default target", async () => {
  const [skill, builder, finalize] = await Promise.all([
    read("./SKILL.md"),
    read("./agents/builder.md"),
    read("./agents/finalize.md"),
  ]);

  for (const content of [skill, builder, finalize]) {
    assert.doesNotMatch(content, /compositions\/index\.html/);
  }
  assert.match(skill, /Output `index\.html`/);
  assert.match(builder, /renderable HyperFrames composition \(`index\.html` at the project root\)/);
});
