import { describe, expect, it, vi } from "vitest";
import { readBoundedResponse } from "./readBoundedResponse.js";

describe("bounded capture responses", () => {
  it("shares a byte budget across concurrent responses", async () => {
    const budget = { remainingBytes: 5 };
    const result = await Promise.all([
      readBoundedResponse(new Response(new Uint8Array(3)), 4, budget),
      readBoundedResponse(new Response(new Uint8Array(3)), 4, budget),
    ]);
    expect(result.filter((value) => value !== null)).toHaveLength(1);
    expect(budget.remainingBytes).toBe(0);
  });
  it("preserves exact bytes at the limit across chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 255]));
        controller.enqueue(new Uint8Array([10, 13]));
        controller.close();
      },
    });
    expect(await readBoundedResponse(new Response(body), 4)).toEqual(Buffer.from([0, 255, 10, 13]));
  });

  it.each([undefined, "1"])(
    "cancels an oversized stream with declared length %s",
    async (length) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(3));
        },
        cancel,
      });
      const headers = new Headers();
      if (length !== undefined) headers.set("content-length", length);
      expect(await readBoundedResponse(new Response(body, { headers }), 4)).toBeNull();
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it("cancels a declared oversized response before reading", async () => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    expect(
      await readBoundedResponse(new Response(body, { headers: { "content-length": "5" } }), 4),
    ).toBeNull();
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("propagates a broken response and releases the reader", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection lost"));
      },
    });
    await expect(readBoundedResponse(new Response(body), 4)).rejects.toThrow("connection lost");
    expect(body.locked).toBe(false);
  });
});
