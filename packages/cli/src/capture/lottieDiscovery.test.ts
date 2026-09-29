import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverLottieResponse, LottieDiscovery } from "./lottieDiscovery.js";

describe("bounded Lottie discovery", () => {
  it("awaits delayed candidates and ignores response events after its save boundary", async () => {
    const discovery = new LottieDiscovery();
    const response = { url: () => "https://public.example/a.json", headers: () => ({}) };
    discovery.collect(response);
    discovery.collect(response);
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const budget = { remainingBytes: 1000 };
    let settled = false;
    const pending = discovery
      .run(budget, () => 10000)
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(
      new Response(JSON.stringify({ v: "5", w: 100, h: 100, fr: 30, ip: 0, op: 30, layers: [] })),
    );
    expect(await pending).toHaveLength(1);
    const remaining = budget.remainingBytes;
    discovery.collect({ url: () => "https://public.example/late.json", headers: () => ({}) });
    expect(await discovery.run(budget, () => 10000)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.remainingBytes).toBe(remaining);
  });

  it("caps ordinary JSON candidates and their aggregate byte consumption", async () => {
    const discovery = new LottieDiscovery();
    for (let n = 0; n < 100; n++)
      discovery.collect({
        url: () => `https://public.example/api/${n}`,
        headers: () => ({ "content-type": "application/json" }),
      });
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const budget = { remainingBytes: 1000 };
    expect(await discovery.run(budget, () => 10000)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(32);
    expect(budget.remainingBytes).toBe(936);
  });
  it("retains explicit JSON when a later archive displaces a generic candidate", async () => {
    const discovery = new LottieDiscovery();
    discovery.collect({ url: () => "https://public.example/real.json", headers: () => ({}) });
    for (let n = 0; n < 31; n++)
      discovery.collect({
        url: () => `https://public.example/api/${n}`,
        headers: () => ({ "content-type": "application/json" }),
      });
    discovery.collect({ url: () => "https://public.example/anim.lottie", headers: () => ({}) });
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await discovery.run({ remainingBytes: 1000 }, () => 10000);
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain("https://public.example/real.json");
    expect(urls).not.toContain("https://public.example/api/0");
    expect(urls).toHaveLength(31);
  });
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
