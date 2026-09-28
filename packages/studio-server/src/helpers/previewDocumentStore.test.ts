import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPreviewDocumentStore } from "./previewDocumentStore";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("stores a built document inside the project", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-store-"));
  dirs.push(projectDir);
  const store = createPreviewDocumentStore(projectDir, "salt");
  store.write("key", "<html></html>");
  expect(store.read("key")).toBe("<html></html>");
});

it("does not recreate a project folder renamed away while its preview is open", () => {
  const parent = mkdtempSync(join(tmpdir(), "hf-preview-store-"));
  dirs.push(parent);
  const projectDir = join(parent, "film");
  const store = createPreviewDocumentStore(projectDir, "salt");
  store.write("key", "<html></html>");
  expect(existsSync(projectDir)).toBe(false);
});
