// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openProjectHistory } from "./projectHistory";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

it("names the bytes the next restore point would copy in: changed files the store lacks, no media", async () => {
  const projectDir = tempDir("hf-history-project-");
  const historyRoot = tempDir("hf-history-root-");
  writeFileSync(join(projectDir, "index.html"), "<h1>Hello</h1>");
  const history = await openProjectHistory({ projectDir, historyRoot });
  cleanup.push(() => history.close());
  await (await history.beginWindow({ kind: "person", name: "You" }, "first")).close();
  expect(await history.unsavedBlobBytes()).toBe(0);

  writeFileSync(join(projectDir, "scene.html"), "x".repeat(1000));
  // The same bytes as a stored file are already in the store.
  writeFileSync(join(projectDir, "copy.html"), "<h1>Hello</h1>");
  writeFileSync(join(projectDir, "clip.mp4"), "v".repeat(5000));
  expect(await history.unsavedBlobBytes()).toBe(1000);

  // Two new files with the same bytes are one blob.
  writeFileSync(join(projectDir, "b1.html"), "y".repeat(2000));
  writeFileSync(join(projectDir, "b2.html"), "y".repeat(2000));
  expect(await history.unsavedBlobBytes()).toBe(3000);
});
