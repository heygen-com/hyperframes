/**
 * `deploySite` unit tests — content-addressed siteId, existence
 * short-circuit, and the upload path over `FakeGcs`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asStorage, FakeGcs } from "../__fixtures__/fakeGcs.js";
import { deploySite } from "./deploySite.js";

const tmpDirs: string[] = [];
function mkProject(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-site-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, "index.html"), content);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("deploySite", () => {
  it("uploads and returns a content-addressed handle", async () => {
    const gcs = new FakeGcs();
    const dir = mkProject("<html>v1</html>");
    const handle = await deploySite({ projectDir: dir, bucketName: "b", storage: asStorage(gcs) });
    expect(handle.uploaded).toBe(true);
    expect(handle.projectGcsUri).toBe(`gs://b/sites/${handle.siteId}/project.tar.gz`);
    expect(gcs.objects.has(handle.projectGcsUri)).toBe(true);
  });

  it("produces a stable siteId for identical content", async () => {
    const a = await deploySite({
      projectDir: mkProject("<html>same</html>"),
      bucketName: "b",
      storage: asStorage(new FakeGcs()),
    });
    const b = await deploySite({
      projectDir: mkProject("<html>same</html>"),
      bucketName: "b",
      storage: asStorage(new FakeGcs()),
    });
    expect(a.siteId).toBe(b.siteId);
  });

  it("produces different siteIds for different content", async () => {
    const a = await deploySite({
      projectDir: mkProject("<html>one</html>"),
      bucketName: "b",
      storage: asStorage(new FakeGcs()),
    });
    const b = await deploySite({
      projectDir: mkProject("<html>two</html>"),
      bucketName: "b",
      storage: asStorage(new FakeGcs()),
    });
    expect(a.siteId).not.toBe(b.siteId);
  });

  it("short-circuits the upload when the object already exists", async () => {
    const gcs = new FakeGcs();
    const dir = mkProject("<html>cache</html>");
    const first = await deploySite({ projectDir: dir, bucketName: "b", storage: asStorage(gcs) });
    expect(first.uploaded).toBe(true);

    const second = await deploySite({ projectDir: dir, bucketName: "b", storage: asStorage(gcs) });
    expect(second.uploaded).toBe(false);
    expect(second.siteId).toBe(first.siteId);
    // Only one upload op total.
    expect(gcs.ops.filter((o) => o.kind === "upload").length).toBe(1);
  });

  it("honours an explicit siteId override", async () => {
    const gcs = new FakeGcs();
    const handle = await deploySite({
      projectDir: mkProject("<html></html>"),
      bucketName: "b",
      siteId: "my-git-sha",
      storage: asStorage(gcs),
    });
    expect(handle.siteId).toBe("my-git-sha");
    expect(handle.projectGcsUri).toBe("gs://b/sites/my-git-sha/project.tar.gz");
  });
});
