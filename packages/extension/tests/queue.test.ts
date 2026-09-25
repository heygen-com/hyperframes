import { describe, expect, it } from "vitest";
import { SerialClipboardWriter } from "../src/clipboard/queue";

describe("SerialClipboardWriter", () => {
  it("writes one item at a time in FIFO order", async () => {
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writer = new SerialClipboardWriter(async (text) => {
      events.push(`start:${text}`);
      if (text === "first") await firstBlocked;
      events.push(`end:${text}`);
    });
    const first = writer.enqueue("first");
    const second = writer.enqueue("second");
    await Promise.resolve();
    expect(events).toEqual(["start:first"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("continues after a failed write", async () => {
    const written: string[] = [];
    const writer = new SerialClipboardWriter(async (text) => {
      if (text === "bad") throw new Error("blocked");
      written.push(text);
    });
    await expect(writer.enqueue("bad")).rejects.toThrow("blocked");
    await writer.enqueue("good");
    expect(written).toEqual(["good"]);
  });
});
