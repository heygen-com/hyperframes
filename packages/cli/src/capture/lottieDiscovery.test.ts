import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverLottieResponse } from "./lottieDiscovery.js";

describe("bounded Lottie discovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([undefined, "1"])(
    "does not trust intercepted Content-Length %s or materialize Puppeteer bodies",
    async (length) => {
      const buffer = vi.fn(() => {
        throw new Error("unbounded body read");
      });
      const response = {
        url: () => "https://public.example/animation.json",
        headers: () => ({
          "content-type": "application/json",
          ...(length ? { "content-length": length } : {}),
        }),
        buffer,
      };
      const cancel = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new Uint8Array(4));
                },
                cancel,
              }),
              { headers: length ? { "content-length": length } : {} },
            ),
        ),
      );
      expect(await discoverLottieResponse(response, { remainingBytes: 5 })).toBeNull();
      expect(buffer).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it("retains valid discovered JSON with its existing byte accounting", async () => {
    const data = { v: "5.12.2", w: 100, h: 100, layers: [], fr: 30, ip: 0, op: 30 };
    const body = JSON.stringify(data);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );
    const budget = { remainingBytes: body.length };
    const found = await discoverLottieResponse(
      { url: () => "https://public.example/animation.json?version=1", headers: () => ({}) },
      budget,
    );
    expect(found?.data).toEqual(data);
    expect(found?.dataBudget).toBe(budget);
    expect(budget.remainingBytes).toBe(0);
  });
});
