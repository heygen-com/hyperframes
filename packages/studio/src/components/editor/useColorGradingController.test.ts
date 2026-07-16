// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import { useColorGradingController } from "./useColorGradingController";
import type { DomEditSelection } from "./domEditing";

function freshPopGrading() {
  const next = normalizeHfColorGrading({ preset: "fresh-pop", intensity: 1 });
  if (!next) throw new Error("expected fresh-pop preset to normalize");
  return next;
}

function naturalLiftGrading() {
  const next = normalizeHfColorGrading({ preset: "natural-lift", intensity: 1 });
  if (!next) throw new Error("expected natural-lift preset to normalize");
  return next;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    element: document.createElement("video"),
    id: "s1-bg",
    selector: "#s1-bg",
    label: "S1 Background",
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    ...overrides,
  } as DomEditSelection;
}

function HookHost({
  onState,
  onSetAttributeLive,
  element,
}: {
  onState: (state: ReturnType<typeof useColorGradingController>) => void;
  onSetAttributeLive: (attr: string, value: string | null) => void;
  element: DomEditSelection;
}) {
  const state = useColorGradingController({
    projectId: "proj",
    element,
    onSetAttributeLive,
  });
  onState(state);
  return null;
}

function renderHook(
  onSetAttributeLive: (attr: string, value: string | null) => void,
  initialElement: DomEditSelection = makeElement(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let latest: ReturnType<typeof useColorGradingController> | undefined;
  const renderWith = (element: DomEditSelection) => {
    act(() => {
      root.render(
        React.createElement(HookHost, {
          onState: (s: ReturnType<typeof useColorGradingController>) => (latest = s),
          onSetAttributeLive,
          element,
        }),
      );
    });
  };
  renderWith(initialElement);
  return {
    root,
    rerenderWithElement: renderWith,
    // A method, not a getter — `const { state } = renderHook(...)` would
    // destructure a getter into a one-time snapshot, silently going stale
    // after the first state change. Call `.getState()` fresh every time.
    getState(): ReturnType<typeof useColorGradingController> {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
  };
}

describe("useColorGradingController", () => {
  it("starts with the neutral (inactive) grading and idle compare state", () => {
    const { root, getState } = renderHook(vi.fn());
    expect(getState().grading.preset).toBe("neutral");
    expect(getState().compareEnabled).toBe(false);
    act(() => root.unmount());
  });

  it("commitColorGrading updates grading state synchronously and schedules a debounced persist", async () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const { root, getState } = renderHook(onSetAttributeLive);
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    expect(onSetAttributeLive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);
    const [attr, value] = onSetAttributeLive.mock.calls[0] as [string, string];
    expect(attr).toBe("color-grading");
    expect(value).toContain("fresh-pop");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("reverts to the last confirmed-good grading via the real onSettled(false) signal (matches runDomEditCommit, which never rejects)", async () => {
    // The actual Studio commit runner (runDomEditCommit) catches persist
    // failures internally and always resolves — it reports outcome only
    // through the onSettled callback passed as the 3rd argument. A mock
    // that only rejects would validate a path the real callback never takes.
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn(
      (_attr: string, _value: string | null, onSettled?: (ok: boolean) => void) => {
        onSettled?.(false);
        return Promise.resolve();
      },
    );
    const { root, getState } = renderHook(onSetAttributeLive);
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getState().grading.preset).toBe("neutral");
    expect(getState().runtimeStatus.state).toBe("unavailable");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("reverts to the last confirmed-good grading when a persist rejects (fallback for a non-onSettled implementation)", async () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn().mockRejectedValue(new Error("disk full"));
    const { root, getState } = renderHook(onSetAttributeLive);
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // The rejection settles on a microtask, not a timer — flush it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Reverted to "neutral" (the last confirmed-good value, from before this
    // commit) instead of permanently showing "fresh-pop" as if it had saved.
    expect(getState().grading.preset).toBe("neutral");
    expect(getState().runtimeStatus.state).toBe("unavailable");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("a stale in-flight persist result does not touch state after selection has moved on to a THIRD element", async () => {
    vi.useFakeTimers();
    let resolveA: (() => void) | undefined;
    let capturedOnSettledA: ((ok: boolean) => void) | undefined;
    const onSetAttributeLive = vi.fn(
      (_attr: string, _value: string | null, onSettled?: (ok: boolean) => void) => {
        capturedOnSettledA = onSettled;
        return new Promise<void>((resolve) => {
          resolveA = resolve;
        });
      },
    );
    const { root, getState, rerenderWithElement } = renderHook(
      onSetAttributeLive,
      makeElement({ id: "s1-bg" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    // Let the debounce fire while still on s1-bg — the persist call is now
    // genuinely in flight (its promise won't settle until resolveA() below).
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);

    // Selection moves twice more while s1-bg's persist is still pending.
    rerenderWithElement(makeElement({ id: "s2-bg" }));
    rerenderWithElement(makeElement({ id: "s3-bg" }));
    expect(getState().grading.preset).toBe("neutral"); // s3-bg's own fresh state

    // NOW the stale s1-bg persist finally settles as a failure.
    act(() => {
      capturedOnSettledA?.(false);
      resolveA?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // s3-bg's state must be untouched by a result that belongs to s1-bg.
    expect(getState().grading.preset).toBe("neutral");
    expect(getState().runtimeStatus.state).not.toBe("unavailable");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("a stale in-flight persist for edit A does not clobber edit B's state — SAME element, no selection change", async () => {
    vi.useFakeTimers();
    let resolveA: (() => void) | undefined;
    let capturedOnSettledA: ((ok: boolean) => void) | undefined;
    const onSetAttributeLive = vi
      .fn()
      // Edit A (fresh-pop): captures its onSettled and never resolves until
      // resolveA() is called below — simulates a slow persist.
      .mockImplementationOnce(
        (_attr: string, _value: string | null, onSettled?: (ok: boolean) => void) => {
          capturedOnSettledA = onSettled;
          return new Promise<void>((resolve) => {
            resolveA = resolve;
          });
        },
      )
      // Edit B (natural-lift): settles immediately and successfully.
      .mockImplementationOnce(
        (_attr: string, _value: string | null, onSettled?: (ok: boolean) => void) => {
          onSettled?.(true);
          return Promise.resolve();
        },
      );
    const { root, getState } = renderHook(onSetAttributeLive);

    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1); // A's persist now in flight

    // B commits on the SAME element before A's persist has settled.
    act(() => {
      getState().commitColorGrading(naturalLiftGrading());
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(2); // B's persist has already settled (mock resolves sync)
    expect(getState().grading.preset).toBe("natural-lift");

    // NOW A's stale persist finally settles as a FAILURE — must not revert
    // `grading` (which now correctly shows B's newer edit) back to the
    // pre-A baseline ("neutral"), and must not stamp confirmedGradingRef
    // with A's now-superseded attempt on success either.
    act(() => {
      capturedOnSettledA?.(false);
      resolveA?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getState().grading.preset).toBe("natural-lift");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("resetGrading returns to the neutral preset", () => {
    const { root, getState } = renderHook(vi.fn());
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    act(() => {
      getState().resetGrading();
    });
    expect(getState().grading.preset).toBe("neutral");
    act(() => root.unmount());
  });

  it("resets grading/compare state when selection changes to a different element", () => {
    const { root, getState, rerenderWithElement } = renderHook(
      vi.fn(),
      makeElement({ id: "s1-bg" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    // A different element, with no persisted grading of its own — without a
    // reset, this hook (unlike the legacy component it was extracted from,
    // which remounts via a `key={selectionIdentityKey}`) would keep showing
    // the previous element's grading.
    rerenderWithElement(makeElement({ id: "s2-bg" }));
    expect(getState().grading.preset).toBe("neutral");
    act(() => root.unmount());
  });

  it("also resets when the same local id/selector recurs in a different source file", () => {
    // Same id, same selector, same selectorIndex — only sourceFile differs.
    // Without sourceFile in the identity key, this would collide with the
    // first element (e.g. host composition vs. an inlined sub-composition,
    // or two unrelated sub-comps that happen to share a local id).
    const { root, getState, rerenderWithElement } = renderHook(
      vi.fn(),
      makeElement({ id: "bg", sourceFile: "index.html" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    rerenderWithElement(makeElement({ id: "bg", sourceFile: "sub-comp.html" }));
    expect(getState().grading.preset).toBe("neutral");
    act(() => root.unmount());
  });

  it("flushes — rather than discards — a pending persist for the previous element when selection changes before it fires", () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const { root, getState, rerenderWithElement } = renderHook(
      onSetAttributeLive,
      makeElement({ id: "s1-bg" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    // Switch selection before the 350ms debounce fires — the in-flight edit
    // must be written immediately (targeting the OUTGOING element's own
    // commit callback), not silently dropped just because a debounce timer
    // hadn't elapsed yet.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerenderWithElement(makeElement({ id: "s2-bg" }));
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);
    const [attr, value] = onSetAttributeLive.mock.calls[0] as [string, string];
    expect(attr).toBe("color-grading");
    expect(value).toContain("fresh-pop");
    // And it must not ALSO fire again once the (now-cleared) original timer
    // window would have elapsed.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("does not permanently cache a non-OK media/metadata response — the next mount retries", async () => {
    const videoWithSrc = () => {
      const el = document.createElement("video");
      el.setAttribute("src", "clip.mp4");
      return el;
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ metadata: { kind: "video", color: { dynamicRange: "hdr" } } }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(vi.fn(), makeElement({ id: "retry-asset", element: videoWithSrc() }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.getState().mediaMetadata).toBeNull();
    act(() => first.root.unmount());

    // A second, independent mount for the SAME asset path — if the failed
    // response had been cached, this would never re-fetch and mediaMetadata
    // would stay null forever.
    const second = renderHook(
      vi.fn(),
      makeElement({ id: "retry-asset-2", element: videoWithSrc() }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.getState().mediaMetadata?.color.dynamicRange).toBe("hdr");
    act(() => second.root.unmount());
    vi.unstubAllGlobals();
  });
});
