import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPreviewDocumentStore } from "./previewDocumentStore";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-store-"));
  dirs.push(dir);
  return dir;
}

/** The one file a write left in the store, so a test can replace it the way a shipped project would. */
function storedFile(projectDir: string): string {
  const dir = join(projectDir, ".hyperframes", "preview");
  const [name] = readdirSync(dir);
  if (!name) throw new Error("nothing stored");
  return join(dir, name);
}

it("stores a built document inside the project", async () => {
  const projectDir = tempDir();
  const store = createPreviewDocumentStore(projectDir, "salt", "secret");
  store.write("key", "<html></html>");
  expect(await store.read("key")).toBe("<html></html>");
});

it("does not recreate a project folder renamed away while its preview is open", async () => {
  const projectDir = join(tempDir(), "film");
  const store = createPreviewDocumentStore(projectDir, "salt", "secret");
  store.write("key", "<html></html>");
  expect(existsSync(projectDir)).toBe(false);
});

it("never serves a document written under another user's secret", async () => {
  const projectDir = tempDir();
  createPreviewDocumentStore(projectDir, "salt", "the author's secret").write(
    "key",
    "<p>shipped</p>",
  );
  expect(await createPreviewDocumentStore(projectDir, "salt", "secret").read("key")).toBeNull();
});

it("never serves a document the project shipped at a store name", async () => {
  const projectDir = tempDir();
  const store = createPreviewDocumentStore(projectDir, "salt", "secret");
  store.write("key", "<html></html>");
  writeFileSync(storedFile(projectDir), `${"0".repeat(64)}\n<p>shipped</p>`);
  expect(await store.read("key")).toBeNull();
});

it.skipIf(process.platform === "win32")("never reads through a link at a store name", async () => {
  const projectDir = tempDir();
  const outside = join(tempDir(), "document.html");
  const store = createPreviewDocumentStore(projectDir, "salt", "secret");
  store.write("key", "<html></html>");
  // The outside file is a valid document, so only the link check can refuse it.
  const file = storedFile(projectDir);
  renameSync(file, outside);
  symlinkSync(outside, file);
  expect(await store.read("key")).toBeNull();
});

it.skipIf(process.platform === "win32")("never reads through a linked preview folder", async () => {
  const projectDir = tempDir();
  const elsewhere = tempDir();
  const store = createPreviewDocumentStore(projectDir, "salt", "secret");
  store.write("key", "<html></html>");
  // The moved folder still holds a valid document, so only the link check can refuse it.
  const preview = join(projectDir, ".hyperframes", "preview");
  renameSync(preview, join(elsewhere, "preview"));
  symlinkSync(join(elsewhere, "preview"), preview);
  expect(await store.read("key")).toBeNull();
});

it("keeps nothing without a secret", async () => {
  const projectDir = tempDir();
  const store = createPreviewDocumentStore(projectDir, "salt", "");
  store.write("key", "<html></html>");
  expect(await store.read("key")).toBeNull();
  expect(existsSync(join(projectDir, ".hyperframes"))).toBe(false);
});
