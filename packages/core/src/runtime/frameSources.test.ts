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
const adapter = () => {
  const runtime = createFrameSourceAdapter({
    start: (element) => createRuntimeStartTimeResolver({}).resolveStartForElement(element, 0),
    duration: (element) => createRuntimeStartTimeResolver({}).resolveDurationForElement(element),
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
