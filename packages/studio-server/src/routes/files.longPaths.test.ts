import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { registerFileRoutes } from "./files";
import { stubAdapter } from "./stubAdapter.test-helpers";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each([
  "campaigns/2026/autumn-product-launch/client-review/round-03/approved-deliverables/social-media/vertical/english-united-kingdom/subtitles-enabled/product-onboarding/introduction.txt",
  `${"字幕".repeat(32)}.txt`,
])("saves and deletes %s with recoverable backups", async (path) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-long-path-"));
  tempDirs.push(dir);
  const app = new Hono();
  registerFileRoutes(app, stubAdapter(dir));
  const url = `/projects/demo/files/${path.split("/").map(encodeURIComponent).join("/")}`;

  const created = await app.request(url, { method: "POST", body: "before" });
  expect(created.status).toBe(201);
  const opened = await app.request(url);
  expect(opened.status).toBe(200);
  const version = opened.headers.get("ETag");
  if (!version) throw new Error("File read did not return a version");

  const saved = await app.request(url, {
    method: "PUT",
    headers: { "If-Match": version },
    body: "after",
  });
  expect(saved.status).toBe(200);
  const save: { backupPath: string } = await saved.json();
  expect(readFileSync(join(dir, path), "utf8")).toBe("after");
  expect(readFileSync(join(dir, save.backupPath), "utf8")).toBe("before");

  const deleted = await app.request(url, { method: "DELETE" });
  expect(deleted.status).toBe(200);
  const deletion: { backupPath: string } = await deleted.json();
  expect(existsSync(join(dir, path))).toBe(false);
  expect(readFileSync(join(dir, deletion.backupPath), "utf8")).toBe("after");
});
