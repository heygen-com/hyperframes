// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NLEPreview } from "./NLEPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("keeps a shadow reload whose runtime boots after 8 s, and its player comes ready", async () => {
  await import("@hyperframes/player");
  vi.useFakeTimers();
  const onShadowError = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(NLEPreview, {
        projectId: "p",
        iframeRef: createRef<HTMLIFrameElement>(),
        onIframeLoad: () => {},
        previewSlots: [
          { gen: 0, role: "live" },
          { gen: 1, role: "shadow", url: "/api/projects/p/preview?_t=1" },
        ],
        onShadowIframeLoad: () => {},
        onShadowReadyChange: () => {},
        onShadowError,
        setShadowIframeNode: () => {},
        resetPreviewSlots: () => {},
      }),
    );
  });

  const shadow = host.querySelectorAll<
    HTMLElement & { iframeElement: HTMLIFrameElement; ready: boolean }
  >("hyperframes-player")[1];
  const iframe = shadow.iframeElement;
  act(() => {
    iframe.dispatchEvent(new Event("load"));
  });
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(onShadowError).not.toHaveBeenCalled();

  Object.assign(iframe.contentWindow!, { __player: { getDuration: () => 9 } });
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(onShadowError).not.toHaveBeenCalled();
  expect(shadow.ready).toBe(true);
  // The live slot keeps the player's own 8 s deadline.
  expect(host.querySelector("hyperframes-player")?.hasAttribute("no-load-timeout")).toBe(false);
  act(() => root.unmount());
});

// fails without the fix: the live player kept its own 8 s deadline and a sealed film that came up later had errored.
it("hands the live preview's load deadline to a host that owns it, so a sealed film booting after 8 s comes ready", async () => {
  await import("@hyperframes/player");
  const frameToken = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ token: "T".repeat(43) }) } as Response);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(NLEPreview, {
        projectId: "p",
        iframeRef: createRef<HTMLIFrameElement>(),
        onIframeLoad: () => {},
        previewSlots: [{ gen: 0, role: "live" }],
        onShadowIframeLoad: () => {},
        onShadowReadyChange: () => {},
        onShadowError: () => {},
        setShadowIframeNode: () => {},
        resetPreviewSlots: () => {},
        sandboxOrigin: "opaque",
        noLoadTimeout: true,
      }),
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

  const live = host.querySelector<
    HTMLElement & { iframeElement: HTMLIFrameElement; ready: boolean }
  >("hyperframes-player")!;
  const errors: unknown[] = [];
  live.addEventListener("error", (event) => errors.push((event as CustomEvent).detail));
  const iframe = live.iframeElement;
  act(() => {
    iframe.dispatchEvent(new Event("load"));
  });
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(errors).toEqual([]);

  Object.assign(iframe.contentWindow!, { __player: { getDuration: () => 9 } });
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(errors).toEqual([]);
  expect(live.ready).toBe(true);
  expect(live.hasAttribute("sandbox-origin")).toBe(true);
  act(() => root.unmount());
  frameToken.mockRestore();
});
