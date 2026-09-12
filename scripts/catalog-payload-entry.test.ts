import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderEntry } from "./generate-catalog-payloads.ts";

test("interactive previews preserve a demo that mounts its snippet", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "catalog-mounted-demo-"));
  try {
    writeFileSync(
      join(sourceDir, "registry-item.json"),
      JSON.stringify({
        name: "test-effect",
        variables: [{ id: "text", type: "string", default: "Hello" }],
        files: [{ path: "effect.html", type: "hyperframes:snippet" }],
      }),
    );
    writeFileSync(
      join(sourceDir, "effect.html"),
      "<template><script>window.__timelines.effect = gsap.timeline({ paused: true });</script></template>",
    );
    const item = {
      name: "test-effect",
      kind: "component" as const,
      sourceDir,
      entryFile: "demo.html",
    };
    writeFileSync(join(sourceDir, "demo.html"), '<div data-composition-src="./effect.html"></div>');
    assert.deepEqual(renderEntry(item, true), { entry: item, fromSnippet: false });

    // A copied demo or a demo mounting another component cannot supply this snippet's variables.
    for (const demo of [
      "<div>Hello</div>",
      '<div data-composition-src="./other/effect.html"></div>',
    ]) {
      writeFileSync(join(sourceDir, "demo.html"), demo);
      assert.deepEqual(renderEntry(item, true), {
        entry: { ...item, entryFile: "effect.html" },
        fromSnippet: true,
      });
    }
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
  }
});
