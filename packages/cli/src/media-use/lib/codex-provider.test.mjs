import test from "node:test";
import assert from "node:assert";
import { imageGenFlag } from "./codex-provider.mjs";

// Real `codex features list` output is three space-padded columns:
//   <name> <stage> <enabled>
const OLD_CLI = [
  "image_detail_original               removed            false",
  "image_generation                    stable             true",
  "imagegenext                         under development  false",
].join("\n");

const NEW_CLI = [
  "image_detail_original               removed            false",
  "image_generation                    stable             true",
].join("\n");

test("older CLIs keep the old flag — they reject --enable image_generation", () => {
  assert.equal(imageGenFlag(OLD_CLI), "imagegenext");
});

test("Codex CLI >=0.145 dropped the imagegenext row; fall back to its new name", () => {
  // The regression this guards: gating on `imagegenext` alone made the provider
  // report "unavailable" on every up-to-date CLI, without attempting a render.
  assert.equal(imageGenFlag(NEW_CLI), "image_generation");
});

test("no image feature at all is unavailable, not a silent default", () => {
  assert.equal(imageGenFlag("apps  stable  true\nhooks  stable  true"), null);
});

test("substring lookalikes do not count as the feature row", () => {
  assert.equal(imageGenFlag("image_generation_v2  stable  true"), null);
});
