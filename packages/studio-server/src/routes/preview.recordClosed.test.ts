// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { StudioApiAdapter } from "../types";

// A path that stops resolving between the private-file check and the read's record (a link swapped for a loop).
vi.mock("../helpers/previewReads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/previewReads.js")>()),
  recordPreviewReadsOff: () => Promise.reject(Object.assign(new Error("ELOOP"), { code: "ELOOP" })),
}));

const { createStudioApi } = await import("../createStudioApi");
let projectDir = "";
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

const adapter = (dir: string): StudioApiAdapter => ({
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => "/tmp/renders",
  startRender: () => ({
    id: "job-1",
    status: "rendering",
    progress: 0,
    outputPath: "/tmp/out.mp4",
  }),
});

// fails without the fix: the record's failure escaped the route, which answered a server error for the file.
it("an asset whose path stops resolving before its read is recorded answers not found", async () => {
  projectDir = mkdtempSync(join(tmpdir(), "preview-record-"));
  mkdirSync(join(projectDir, "assets"));
  writeFileSync(join(projectDir, "assets", "notes.txt"), "hello");
  const res = await createStudioApi(adapter(projectDir)).request(
    "http://localhost/projects/demo/preview/assets/notes.txt",
  );
  expect(res.status).toBe(404);
});
