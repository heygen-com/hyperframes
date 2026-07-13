import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extensionForBundledSfxFile } from "./bundled-sfx-provider.mjs";

test("derives bundled SFX extension from the manifest filename", () => {
  assert.equal(extensionForBundledSfxFile("impact.wav"), ".wav");
  assert.equal(extensionForBundledSfxFile("whoosh.ogg"), ".ogg");
  assert.equal(extensionForBundledSfxFile("extensionless"), ".mp3");
});
