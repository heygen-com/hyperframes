import { describe, expect, it, vi } from "vitest";
import {
  bumpDomEditCommitMapVersion,
  claimTextWrite,
  runDomEditCommit,
  textWriteOrder,
} from "./domEditCommitRunner";

function commitConfig(overrides: Partial<Parameters<typeof runDomEditCommit>[0]> = {}) {
  return {
    capture: vi.fn(),
    apply: vi.fn(),
    persist: vi.fn(async () => undefined),
    shouldRevert: vi.fn(() => true),
    revert: vi.fn(),
    onError: vi.fn(),
    shouldResync: vi.fn(() => false),
    resync: vi.fn(),
    ...overrides,
  };
}

describe("DOM edit commit version cleanup", () => {
  it("releases a settled target without deleting a newer target version", () => {
    const versions = new Map<string, symbol>();
    const first = bumpDomEditCommitMapVersion(versions, "headline");
    const second = bumpDomEditCommitMapVersion(versions, "headline");

    first.release();
    expect(versions.size).toBe(1);
    expect(second()).toBe(true);

    second.release();
    expect(versions.size).toBe(0);
  });

  it("never lets an old commit become latest again after cleanup and reuse", () => {
    const versions = new Map<string, symbol>();
    const first = bumpDomEditCommitMapVersion(versions, "headline");
    const second = bumpDomEditCommitMapVersion(versions, "headline");
    second.release();

    const third = bumpDomEditCommitMapVersion(versions, "headline");

    expect(first()).toBe(false);
    expect(third()).toBe(true);
  });

  it("runs settlement cleanup even when capture throws", async () => {
    const onFinally = vi.fn();
    await expect(
      runDomEditCommit(
        commitConfig({
          capture: () => {
            throw new Error("capture failed");
          },
          onFinally,
        }),
      ),
    ).rejects.toThrow("capture failed");

    expect(onFinally).toHaveBeenCalledOnce();
  });

  it("opens the next text write's turn only after a failed write's revert, even one that throws", async () => {
    const order = textWriteOrder();
    const failed = claimTextWrite(order, "title", 1, undefined, true)!;
    const next = claimTextWrite(order, "title", 2, undefined, true)!;
    const events: string[] = [];
    const failing = runDomEditCommit(
      commitConfig({
        persist: () =>
          failed.write(async () => {
            throw new Error("disk full");
          }),
        revert: () => {
          events.push("revert");
          throw new Error("revert failed");
        },
        onFinally: failed.release,
      }),
    );
    const landing = next.write(async () => void events.push("next write"));
    await expect(failing).rejects.toThrow("revert failed");
    await landing;
    expect(events).toEqual(["revert", "next write"]);
  });
});
