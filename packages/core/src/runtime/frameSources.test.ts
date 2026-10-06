import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameSourceAdapter, hasFrameSources, registerFrameSource } from "./frameSources";
import { resetSeekDispatchState, waitForSeekCompletion } from "./adapters/seek-dispatch";
import { createRuntimeStartTimeResolver } from "./startResolver";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const adapters: ReturnType<typeof createFrameSourceAdapter>[] = [];
const adapter = (compositionDuration = 20) => {
  const runtime = createFrameSourceAdapter({
    start: (element) => createRuntimeStartTimeResolver({}).resolveStartForElement(element, 0),
    duration: (element) => createRuntimeStartTimeResolver({}).resolveDurationForElement(element),
    compositionDuration: () => compositionDuration,
  });
  adapters.push(runtime);
  return runtime;
};
const disposers: Array<() => void> = [];
function mount(start = "0", duration = "10") {
  const element = document.createElement("section");
  element.setAttribute("data-start", start);
  element.setAttribute("data-duration", duration);
  document.body.append(element);
  return element;
}
beforeEach(() => resetSeekDispatchState());
afterEach(() => {
  for (const runtime of adapters.splice(0)) runtime.revert?.();
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
  resetSeekDispatchState();
});

describe("frame sources", () => {
  it("holds capture through setup and asynchronous drawing", async () => {
    const setup = deferred();
    const frame = deferred();
    const render = vi.fn(() => frame.promise);
    disposers.push(registerFrameSource({ element: mount(), ready: setup.promise, render }));
    const runtime = adapter();
    runtime.seek({ time: 2 });
    let captured = false;
    const capture = waitForSeekCompletion().then(() => {
      captured = true;
    });
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();
    expect(captured).toBe(false);
    setup.resolve();
    await vi.waitFor(() => expect(render).toHaveBeenCalledWith(2, expect.any(AbortSignal)));
    expect(captured).toBe(false);
    frame.resolve();
    await capture;
    expect(captured).toBe(true);
  });

  it("serializes drawing and coalesces queued scrubs to the latest time", async () => {
    const frame = deferred();
    const render = vi.fn().mockImplementationOnce(() => frame.promise);
    disposers.push(registerFrameSource({ element: mount(), render }));
    const runtime = adapter();
    runtime.seek({ time: 1 });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    runtime.seek({ time: 2 });
    runtime.seek({ time: 3 });
    expect(render).toHaveBeenCalledTimes(1);
    frame.resolve();
    await waitForSeekCompletion();
    expect(render.mock.calls.map(([time]) => time)).toEqual([1, 3]);
  });

  it("renders every sequential export request, including repeated and reverse time", async () => {
    const render = vi.fn();
    disposers.push(registerFrameSource({ element: mount(), render }));
    const runtime = adapter();
    for (const time of [7, 2, 2, 0, 9]) {
      runtime.seek({ time });
      await waitForSeekCompletion();
    }
    expect(render.mock.calls.map(([time]) => time)).toEqual([7, 2, 2, 0, 9]);
  });

  it("rereads clip timing, trim inpoints and rates after edits", async () => {
    const element = mount("3", "4");
    element.setAttribute("data-playback-start", "1");
    element.setAttribute("data-playback-rate", "2");
    const render = vi.fn();
    disposers.push(registerFrameSource({ element, render }));
    const runtime = adapter();
    runtime.seek({ time: 4 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(3, expect.any(AbortSignal));
    element.setAttribute("data-start", "0");
    element.setAttribute("data-playback-start", "2");
    runtime.seek({ time: 1 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(4, expect.any(AbortSignal));
    runtime.seek({ time: 8 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("surfaces failed setup even when its clip has not started", async () => {
    const render = vi.fn();
    disposers.push(
      registerFrameSource({
        element: mount("5"),
        ready: Promise.reject(new Error("font failed")),
        render,
      }),
    );
    const runtime = adapter();
    runtime.discover();
    await expect(waitForSeekCompletion()).rejects.toThrow("font failed");
    expect(render).not.toHaveBeenCalled();
  });

  it("surfaces draw failure and allows the next seek to recover", async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error("draw failed"))
      .mockResolvedValue(undefined);
    disposers.push(registerFrameSource({ element: mount(), render }));
    const runtime = adapter();
    runtime.seek({ time: 2 });
    await expect(waitForSeekCompletion()).rejects.toThrow("draw failed");
    runtime.seek({ time: 3 });
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
    expect(render).toHaveBeenLastCalledWith(3, expect.any(AbortSignal));
  });

  it("unregisters stalled setup and allows replacing the same host", async () => {
    const element = mount();
    const cleanup = vi.fn();
    const unregister = registerFrameSource({
      element,
      ready: deferred().promise,
      render: vi.fn(),
      dispose: cleanup,
    });
    const runtime = adapter();
    runtime.seek({ time: 0 });
    expect(() => registerFrameSource({ element, render: vi.fn() })).toThrow("already has");
    unregister();
    unregister();
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const render = vi.fn();
    disposers.push(registerFrameSource({ element, render }));
    runtime.seek({ time: 1 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("removal aborts an active draw and releases capture", async () => {
    const element = mount();
    let signal: AbortSignal | undefined;
    const render = vi.fn((_time: number, abort: AbortSignal) => {
      signal = abort;
      return deferred().promise;
    });
    const cleanup = vi.fn();
    disposers.push(registerFrameSource({ element, render, dispose: cleanup }));
    const runtime = adapter();
    runtime.seek({ time: 0 });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    element.remove();
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps readiness promises stable and releases sources on teardown", async () => {
    const ready = deferred();
    const cleanup = vi.fn();
    disposers.push(
      registerFrameSource({
        element: mount(),
        ready: ready.promise,
        render: vi.fn(),
        dispose: cleanup,
      }),
    );
    const runtime = adapter();
    const first = runtime.getReadyPromise?.();
    expect(runtime.getReadyPromise?.()).toBe(first);
    runtime.revert?.();
    await expect(first).resolves.toBeDefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(runtime.getReadyPromise?.()).toBeNull();
  });

  it("draws overlapping independent sources without serializing them together", async () => {
    const a = deferred();
    const b = deferred();
    const renderA = vi.fn(() => a.promise);
    const renderB = vi.fn(() => b.promise);
    disposers.push(
      registerFrameSource({ element: mount(), render: renderA }),
      registerFrameSource({ element: mount(), render: renderB }),
    );
    adapter().seek({ time: 1 });
    await vi.waitFor(() => {
      expect(renderA).toHaveBeenCalled();
      expect(renderB).toHaveBeenCalled();
    });
    a.resolve();
    b.resolve();
    await waitForSeekCompletion();
  });
  it("keeps trimmed, sped-up and extended clips inside their original scene", async () => {
    const host = mount("5", "8");
    host.setAttribute("data-playback-start", "0.5");
    host.setAttribute("data-playback-rate", "2");
    const render = vi.fn();
    disposers.push(
      registerFrameSource({
        element: host,
        render,
        sourceRange: { start: 3, duration: 4, fps: 60 },
      }),
    );
    const runtime = adapter();
    runtime.seek({ time: 5 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(3.5, expect.any(AbortSignal));
    runtime.seek({ time: 6 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(5.5, expect.any(AbortSignal));
    runtime.seek({ time: 12 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(7 - 1 / 60, expect.any(AbortSignal));
    host.setAttribute("data-start", "0");
    host.setAttribute("data-playback-start", "0");
    runtime.seek({ time: 0 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenLastCalledWith(3, expect.any(AbortSignal));
  });

  it("uses half-open cut boundaries and holds the terminal scene's last source frame", async () => {
    const first = vi.fn();
    const last = vi.fn();
    disposers.push(registerFrameSource({ element: mount("0", "3"), render: first }));
    disposers.push(
      registerFrameSource({
        element: mount("3", "4"),
        render: last,
        sourceRange: { start: 10, duration: 4, fps: 60 },
      }),
    );
    const runtime = adapter(7);
    runtime.seek({ time: 3 });
    await waitForSeekCompletion();
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenLastCalledWith(10, expect.any(AbortSignal));
    runtime.seek({ time: 7 });
    await waitForSeekCompletion();
    expect(last.mock.lastCall?.[0]).toBeCloseTo(14 - 1 / 60, 10);
  });

  it("does not redraw an ended scene across a gap or seek backward before its start", async () => {
    const render = vi.fn();
    disposers.push(registerFrameSource({ element: mount("2", "2"), render }));
    const runtime = adapter(8);
    for (const time of [0, 1, 4, 6, 8]) runtime.seek({ time });
    await waitForSeekCompletion();
    expect(render).not.toHaveBeenCalled();
    runtime.seek({ time: 2 });
    await waitForSeekCompletion();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid original ranges before registering a source", () => {
    const element = mount();
    for (const sourceRange of [
      { start: -1, duration: 4, fps: 60 },
      { start: 0, duration: 0, fps: 60 },
      { start: 0, duration: 4, fps: NaN },
      { start: Infinity, duration: 4, fps: 60 },
    ]) {
      expect(() => registerFrameSource({ element, render: vi.fn(), sourceRange })).toThrow(
        "ranges",
      );
    }
    disposers.push(registerFrameSource({ element, render: vi.fn() }));
  });

  it("drains a queued seek after an earlier draw fails and retains the failure for capture", async () => {
    const first = deferred();
    const render = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const unregister = registerFrameSource({ element: mount(), render });
    disposers.push(unregister);
    expect(hasFrameSources()).toBe(true);
    const runtime = adapter();
    runtime.seek({ time: 1 });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    runtime.seek({ time: 2 });
    const capture = expect(waitForSeekCompletion()).rejects.toThrow("first draw failed");
    first.reject(new Error("first draw failed"));
    await capture;
    expect(render.mock.calls.map(([time]) => time)).toEqual([1, 2]);
    runtime.seek({ time: 3 });
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
    unregister();
    expect(hasFrameSources()).toBe(false);
  });
});
