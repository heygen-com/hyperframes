import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, findTrustedExecutable } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  findTrustedExecutable: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));
vi.mock("@hyperframes/parsers/ff-binaries", () => ({ findTrustedExecutable }));
vi.mock("node:os", () => ({ platform: () => "win32" }));

import { copyToClipboard } from "./clipboard.js";

describe("clipboard child-process options", () => {
  beforeEach(() => {
    spawnSyncMock.mockReturnValue({ status: 0 });
    findTrustedExecutable.mockReturnValue("C:\\Windows\\System32\\clip.exe");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("copies with the trusted clip.exe and hides its console window", () => {
    expect(copyToClipboard("snippet")).toBe(true);

    expect(findTrustedExecutable).toHaveBeenCalledWith("clip");
    expect(spawnSyncMock.mock.calls).toHaveLength(1);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("C:\\Windows\\System32\\clip.exe");
    expect(spawnSyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ windowsHide: true }),
    );
  });
});
