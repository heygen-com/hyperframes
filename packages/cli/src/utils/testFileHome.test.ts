import { homedir } from "node:os";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";
import { expect, it } from "vitest";

it("gives each test file its own home, so files never share the per-user render lock", () => {
  expect(homedir()).toMatch(/hf-test-file-home-/);
  expect(hyperframesCacheDir("locks", "render.lock").startsWith(homedir())).toBe(true);
});
