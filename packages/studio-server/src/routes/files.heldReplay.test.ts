// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import { fileContentVersion } from "../helpers/fileVersion";
import { openProjectHistory } from "../history/projectHistory";
import type { StudioApiAdapter } from "../types";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Windows refusing every replace of `file` (EBUSY) for `ms`. */
function holdFor(file: string, ms: number) {
  const platform = process.platform;
  const realRenameSync = vi.mocked(fs.renameSync).getMockImplementation()!;
  const releaseAt = Date.now() + ms;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    if (to === file && Date.now() < releaseAt) {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    }
    return realRenameSync(from, to);
  });
  cleanups.push(() => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    vi.mocked(fs.renameSync).mockImplementation(realRenameSync);
  });
}

describe("an element edit sent again after Windows held the file", () => {
  it("applies once, keeps one backup and leaves one history entry", async () => {
    const projectDir = tempDir("hf-held-replay-");
    const index = join(projectDir, "index.html");
    const before = '<h1 id="title">A</h1>';
    writeFileSync(index, before);
    const history = await openProjectHistory({
      projectDir,
      historyRoot: tempDir("hf-held-replay-history-"),
    });
    cleanups.push(() => history.close());
    await history.flush();
    const api = createStudioApi({
      listProjects: () => [],
      resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
      history: () => history,
    } as unknown as StudioApiAdapter);
    const post = (path: string, body: object) =>
      api.request(`/projects/demo${path}`, { method: "POST", body: JSON.stringify(body) });

    holdFor(index, 200);
    const patched = await post("/file-mutations/patch-element/index.html", {
      target: { id: "title" },
      operations: [{ type: "inline-style", property: "z-index", value: "2" }],
    });
    expect(patched.status).toBe(200);
    await post("/history/claim", {
      label: "Moved Title",
      paths: ["index.html"],
      overwrote: { "index.html": fileContentVersion(before) },
    });
    await history.flush();

    expect(readFileSync(index, "utf8").match(/z-index/g)).toHaveLength(1);
    expect(readdirSync(join(projectDir, ".hyperframes", "backup"))).toHaveLength(1);
    expect(history.list().map((entry) => entry.label)).toEqual(["Moved Title"]);
  });
});
