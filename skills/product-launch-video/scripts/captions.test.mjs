import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFromSkin } from "./captions.mjs";

const presetsDir = fileURLToPath(
  new URL("../../hyperframes-creative/frame-presets/", import.meta.url),
);
const skins = readdirSync(presetsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(
      new URL(
        `../../hyperframes-creative/frame-presets/${entry.name}/caption-skin.html`,
        import.meta.url,
      ),
      "utf8",
    ),
  }))
  .filter(({ source }) => source.includes(".caption-word.is-active"));

for (const canvas of ["#f7f3e8", "#111827"]) {
  for (const skin of skins) {
    test(`${skin.name} preserves word-state rules on ${canvas}`, () => {
      const active = skin.source.match(/\.caption-word\.is-active\s*\{[^}]*\}/s)?.[0];
      const spoken = skin.source.match(/\.caption-word\.is-spoken\s*\{[^}]*\}/s)?.[0];
      assert.ok(active, "skin must define an active-word rule");
      assert.ok(spoken, "skin must define a spoken-word rule");

      const output = buildFromSkin(
        skin.source,
        [],
        1,
        1920,
        1080,
        `:root { --cap-canvas: ${canvas}; --cap-ink: #111111; --cap-accent: #ffcc00; }`,
        (message) => {
          throw new Error(message);
        },
      );

      assert.ok(output.includes(active));
      assert.ok(output.includes(spoken));
      assert.equal(output.match(/\.caption-word\.is-active\s*\{/g)?.length, 1);
      assert.equal(output.match(/\.caption-word\.is-spoken\s*\{/g)?.length, 1);
    });
  }
}
