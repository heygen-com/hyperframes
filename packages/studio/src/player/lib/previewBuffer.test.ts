import { describe, expect, it, vi } from "vitest";
import {
  inheritPreviewReloader,
  markPreviewBuffer,
  markPreviewReloader,
  promotePreviewBuffer,
  requestBufferedReload,
} from "./previewBuffer";

/** Minimal stand-in: the helpers only touch `style.visibility` and two hooks. */
function fakeIframe(): HTMLIFrameElement {
  return { style: { visibility: "" } } as unknown as HTMLIFrameElement;
}

describe("requestBufferedReload", () => {
  it("hands the next document to whoever owns the buffering", () => {
    const iframe = fakeIframe();
    const reload = vi.fn();
    markPreviewReloader(iframe, reload);
    expect(requestBufferedReload(iframe, "/preview?_t=2")).toBe(true);
    expect(reload).toHaveBeenCalledWith("/preview?_t=2");
  });

  it("reports no buffering so the caller can navigate in place instead", () => {
    // A standalone player mount has no Studio around it to build a buffer.
    expect(requestBufferedReload(fakeIframe(), "/preview")).toBe(false);
  });

  it("carries the ability to buffer across a swap", () => {
    const first = fakeIframe();
    const second = fakeIframe();
    const reload = vi.fn();
    markPreviewReloader(first, reload);
    inheritPreviewReloader(first, second);
    expect(requestBufferedReload(second, "/preview?_t=3")).toBe(true);
  });
});

describe("promotePreviewBuffer", () => {
  it("reveals the buffer and retires what it replaced, in one step", () => {
    const iframe = fakeIframe();
    iframe.style.visibility = "hidden";
    const retire = vi.fn();
    markPreviewBuffer(iframe, retire);
    promotePreviewBuffer(iframe);
    expect(iframe.style.visibility).toBe("");
    expect(retire).toHaveBeenCalledOnce();
  });

  it("retires once, however many times a reveal path runs", () => {
    // Every completion AND give-up path funnels through revealIframe.
    const iframe = fakeIframe();
    const retire = vi.fn();
    markPreviewBuffer(iframe, retire);
    promotePreviewBuffer(iframe);
    promotePreviewBuffer(iframe);
    expect(retire).toHaveBeenCalledOnce();
  });

  it("does nothing for an iframe that is not a buffer", () => {
    const iframe = fakeIframe();
    expect(() => promotePreviewBuffer(iframe)).not.toThrow();
    expect(() => promotePreviewBuffer(null)).not.toThrow();
  });
});
