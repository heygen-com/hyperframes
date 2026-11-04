import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));
vi.mock("node:os", () => ({ platform: () => "linux" }));

import { copyToClipboard } from "./clipboard.js";

describe("clipboard child-process options", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    // Exercise the `where`-based provider probe: os.platform() reports a
    // non-Windows OS (so the candidate loop runs) while the probe itself
    // resolves `where`, the branch taken on Windows.
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    spawnSyncMock.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.clearAllMocks();
  });

  it("hides console windows for provider probing and copying", () => {
    expect(copyToClipboard("snippet")).toBe(true);

    // One `where` probe plus the provider copy itself.
    expect(spawnSyncMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("where");
    for (const call of spawnSyncMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });
});
