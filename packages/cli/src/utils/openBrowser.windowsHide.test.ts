import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { openBrowser } from "./openBrowser.js";

describe("openBrowser child-process options", () => {
  it("hides the spawned browser's console window on Windows", () => {
    // `browserPath` takes the direct-spawn path, so the `open` package is
    // never imported here.
    const proc = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnMock.mockReturnValue(proc);

    openBrowser("http://localhost:3002", { browserPath: "/usr/bin/chromium" });

    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
