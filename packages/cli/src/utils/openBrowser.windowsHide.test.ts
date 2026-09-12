import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { openBrowser } from "./openBrowser.js";

describe("openBrowser child-process options", () => {
  it("hides the detached browser console window", () => {
    const proc = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    proc.unref = vi.fn();
    spawnMock.mockReturnValue(proc);

    openBrowser("http://localhost:3002", { browserPath: "/usr/bin/chromium" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
    expect(proc.unref).toHaveBeenCalledOnce();
  });
});
