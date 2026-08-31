import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  execSync: vi.fn(),
}));

import { isProcessDescendant, killProcessTree, processIdentity } from "./orphanCleanup.js";

describe("Windows orphan-cleanup child-process options", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "taskkill") return Buffer.alloc(0);
      const script = args.at(-1) ?? "";
      if (script.includes("CreationDate")) return "123456\n";
      if (script.includes("ProcessId = 400")) return "300\n";
      if (script.includes("ProcessId = 300")) return "200\n";
      return "1\n";
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.clearAllMocks();
  });

  it("hides taskkill and PowerShell console windows", () => {
    killProcessTree(4321);
    expect(processIdentity(4321)).toBe("windows:123456");
    expect(isProcessDescendant(400, 200)).toBe(true);

    expect(execFileSyncMock).toHaveBeenCalledTimes(4);
    for (const call of execFileSyncMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });
});
