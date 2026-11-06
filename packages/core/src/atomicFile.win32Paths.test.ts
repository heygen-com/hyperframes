// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";

vi.mock(
  "node:path",
  async () => (await vi.importActual<typeof import("node:path")>("node:path")).win32,
);
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  mkdtempSync: vi.fn((prefix: string) => `${prefix}ABC123`),
}));

const { createStagingDir } = await import("./atomicFile");

describe("createStagingDir with Windows parents", () => {
  it.each([
    ["a volume-GUID parent", "\\\\?\\Volume{11111111-1111-1111-1111-111111111111}\\project", ""],
    ["an already namespaced UNC parent", "\\\\?\\unc\\server\\share\\project", ""],
    ["a device drive parent", "\\\\.\\C:\\project", ""],
    [
      "a device volume-GUID parent",
      "\\\\.\\Volume{11111111-1111-1111-1111-111111111111}\\project",
      "",
    ],
    ["a drive parent", "C:\\project", "\\\\?\\C:\\project"],
    ["a UNC parent", "\\\\server\\share\\project", "\\\\?\\UNC\\server\\share\\project"],
  ])("returns the folder it made for %s", (_name, parent, longForm) => {
    vi.mocked(fs.mkdtempSync).mockClear();
    expect(createStagingDir(parent, ".stage-")).toBe(`${parent}\\.stage-ABC123`);
    expect(vi.mocked(fs.mkdtempSync).mock.calls).toEqual([[`${longForm || parent}\\.stage-`]]);
  });
});
