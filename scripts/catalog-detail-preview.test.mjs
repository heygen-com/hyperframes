import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDetailPreview } from "./docs-catalog-shared.mjs";

const source = "/public/catalog/blocks/character.json";
const payload = { html: "<html><body>character</body></html>" };

test("a playable payload must be wired into its detail page", () => {
  assert.throws(
    () => assertDetailPreview('<CatalogDetail\n  video="character.mp4"\n>', payload, source),
    /detail previewSrc must match/,
  );
});

test("a detail page cannot mount another item's payload", () => {
  assert.throws(
    () => assertDetailPreview('<CatalogDetail\n  previewSrc="/other.json"\n>', payload, source),
    /detail previewSrc must match/,
  );
});

test("a recorded clip cannot preempt a playable non-WebGPU composition", () => {
  assert.throws(
    () =>
      assertDetailPreview(
        `<CatalogDetail\n  previewSrc="${source}"\n  video="character.mp4"\n>`,
        payload,
        source,
      ),
    /recorded video hides/,
  );
});

test("a matching playable preview is accepted", () => {
  assertDetailPreview(`<CatalogDetail\n  previewSrc="${source}"\n>`, payload, source);
});

test("a WebGPU preview can keep its recorded fallback", () => {
  assertDetailPreview(
    `<CatalogDetail\n  previewSrc="${source}"\n  video="character.mp4"\n  webgpu\n>`,
    { html: "navigator.gpu.requestAdapter()" },
    source,
  );
});

test("a WebGPU recorded fallback must enable the adapter check", () => {
  assert.throws(
    () =>
      assertDetailPreview(
        `<CatalogDetail\n  previewSrc="${source}"\n  video="character.mp4"\n>`,
        { html: "navigator.gpu.requestAdapter()" },
        source,
      ),
    /recorded video hides/,
  );
});

test("an unsupported preview keeps its recorded clip without mounting a payload", () => {
  assertDetailPreview(
    '<CatalogDetail\n  video="character.mp4"\n>',
    { unsupported: "canvas-draw-element" },
    source,
  );
});

test("a page cannot mount a missing payload", () => {
  assert.throws(
    () => assertDetailPreview(`<CatalogDetail\n  previewSrc="${source}"\n>`, {}, source),
    /detail previewSrc must match/,
  );
});

test("the CI command rejects a stale published page and accepts its repaired wiring", (t) => {
  const docs = mkdtempSync(join(tmpdir(), "catalog-preview-check-"));
  t.after(() => rmSync(docs, { recursive: true, force: true }));
  for (const directory of ["catalog/blocks", "catalog/components", "public/catalog/blocks"]) {
    mkdirSync(join(docs, directory), { recursive: true });
  }
  const page = join(docs, "catalog/blocks/character.mdx");
  writeFileSync(join(docs, source.slice(1)), JSON.stringify(payload));
  writeFileSync(page, '<CatalogDetail\n  video="character.mp4"\n>');
  const check = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-catalog-detail-previews.mjs", import.meta.url)), docs],
      { encoding: "utf8" },
    );
  const stale = check();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /detail previewSrc must match/);
  writeFileSync(page, `<CatalogDetail\n  previewSrc="${source}"\n>`);
  const repaired = check();
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.match(repaired.stdout, /PASS 1 catalog detail previews/);
});
