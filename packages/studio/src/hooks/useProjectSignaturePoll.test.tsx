// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSignaturePoll } from "./useProjectSignaturePoll";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function HookHost({
  signature,
  onChange,
}: {
  signature: string | undefined;
  onChange: () => void;
}) {
  useProjectSignaturePoll("demo", signature, onChange);
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(signature: string | undefined, onChange: () => void): void {
  act(() => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    root.render(<HookHost signature={signature} onChange={onChange} />);
  });
}

function unmount(): void {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
}

function mockSignatureResponse(signature: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ signature }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useProjectSignaturePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires onChange when the polled signature moves past the loaded one", async () => {
    const fetchMock = mockSignatureResponse("sig-b");
    const onChange = vi.fn();
    mount("sig-a", onChange);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/demo/signature");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the polled signature matches", async () => {
    mockSignatureResponse("sig-a");
    const onChange = vi.fn();
    mount("sig-a", onChange);

    await vi.advanceTimersByTimeAsync(6000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not poll before a baseline signature exists", async () => {
    const fetchMock = mockSignatureResponse("sig-a");
    const onChange = vi.fn();
    mount(undefined, onChange);

    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-arms against the caller's refreshed signature without re-mounting", async () => {
    mockSignatureResponse("sig-b");
    const onChange = vi.fn();
    mount("sig-a", onChange);

    await vi.advanceTimersByTimeAsync(2000);
    expect(onChange).toHaveBeenCalledTimes(1);

    // The caller refetched and now holds the polled signature — no more firing.
    mount("sig-b", onChange);
    await vi.advanceTimersByTimeAsync(6000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while the tab is hidden and re-checks on visibility", async () => {
    const fetchMock = mockSignatureResponse("sig-b");
    const onChange = vi.fn();
    let hidden = true;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    mount("sig-a", onChange);

    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).not.toHaveBeenCalled();

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops polling after unmount", async () => {
    mockSignatureResponse("sig-b");
    const onChange = vi.fn();
    mount("sig-a", onChange);

    await vi.advanceTimersByTimeAsync(2000);
    expect(onChange).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
