import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  execSync: vi.fn(),
}));

import { isProcessDescendant, processAncestorSnapshot, processIdentity } from "./orphanCleanup.js";

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

  it("hides PowerShell process-identity windows", () => {
    expect(processIdentity(4321)).toBe("windows:123456");
    expect(isProcessDescendant(400, 200)).toBe(true);

    expect(execFileSyncMock).toHaveBeenCalledTimes(3);
    for (const call of execFileSyncMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });

  it("captures the complete Windows ancestor chain with one hidden PowerShell lookup", () => {
    execFileSyncMock.mockImplementation((_command: string, args: string[]) => {
      const script = args.at(-1) ?? "";
      if (script.includes("Get-CimInstance Win32_Process |")) {
        return "400 300 444\n300 200 333\n200 1 222\n";
      }
      return "";
    });

    expect(processAncestorSnapshot(400)).toEqual([
      { pid: 300, identity: "windows:333" },
      { pid: 200, identity: "windows:222" },
    ]);
    expect(execFileSyncMock).toHaveBeenCalledOnce();
    expect(execFileSyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ windowsHide: true }),
    );
  });
});
