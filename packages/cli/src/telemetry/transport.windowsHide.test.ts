import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { enqueue, flushSync } from "./transport.js";

describe("flushSync child-process options", () => {
  it("hides the flush-on-exit console window on Windows", () => {
    spawnMock.mockReturnValue({ unref: vi.fn() });
    enqueue("test_event", {});

    flushSync();

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
