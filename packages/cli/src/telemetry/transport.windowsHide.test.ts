import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: "anon-test-123", telemetryEnabled: true }),
}));

import { enqueue, flushSync } from "./transport.js";

describe("telemetry flushSync child-process options", () => {
  it("hides the detached Node console window on Windows", () => {
    spawnMock.mockReturnValue({ unref: vi.fn() });

    enqueue("test_event", {});
    flushSync();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[0]).toBe(process.execPath);
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ detached: true }));
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
