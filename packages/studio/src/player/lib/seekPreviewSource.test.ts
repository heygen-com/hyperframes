// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createSeekPreviewSources } from "./seekPreviewSource";

const box = { width: 1024, height: 768 };
const source = new URL("/person.webm", location.href).href;
const owners: ReturnType<typeof createSeekPreviewSources>[] = [];
function owner() {
  const next = createSeekPreviewSources();
  owners.push(next);
  return next;
}
afterEach(() => {
  for (const next of owners.splice(0)) next.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces preparation, publishes the prepared URL, and avoids repeating a ready request", async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const next = owner();
  next.prepare(source, box);
  next.prepare(source, box);
  expect(fetcher).toHaveBeenCalledOnce();
  finish?.(new Response(null, { status: 206 }));
  await vi.waitFor(() => expect(next.get(source, box)).not.toBe(source));
  const url = new URL(next.get(source, box));
  expect(url.searchParams.get("hf-proxy")).toBe("auto");
  next.prepare(source, box);
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(["network", "HTTP"])(
  "allows a later preparation attempt after a transient %s failure",
  async (kind) => {
    const fetcher = vi.fn();
    if (kind === "network") fetcher.mockRejectedValueOnce(new TypeError("offline"));
    else fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 206 }));
    vi.stubGlobal("fetch", fetcher);
    const next = owner();
    next.prepare(source, box);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(next.get(source, box)).toBe(source);
    next.prepare(source, box);
    await vi.waitFor(() => expect(next.get(source, box)).not.toBe(source));
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it("cancels retry timers and never fetches again after disposal", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 202, headers: { "Retry-After": "2" } }));
  vi.stubGlobal("fetch", fetcher);
  const next = owner();
  next.prepare(source, box);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  next.dispose();
  await vi.advanceTimersByTimeAsync(10000);
  next.prepare(source, box);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
