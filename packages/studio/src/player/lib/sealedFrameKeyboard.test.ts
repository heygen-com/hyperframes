// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { holdSealedFrameKeyboard, keepKeyboardOutOfSealedFrame } from "./sealedFrameKeyboard";

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

/** A loaded frame on the page, kept out of the DOM so no load fires on its own; the test sets focus and placement. */
function sealedFrame() {
  const iframe = document.createElement("iframe");
  const state = { focused: false, onPage: true };
  Object.defineProperty(iframe, "isConnected", { get: () => state.onPage });
  iframe.getRootNode = () => ({ activeElement: state.focused ? iframe : document.body }) as never;
  iframe.blur = vi.fn(() => void (state.focused = false));
  const takesFocus = async () => {
    state.focused = true;
    window.dispatchEvent(new Event("blur"));
    await nextTask();
  };
  return { iframe, state, takesFocus };
}

describe("a sealed frame's keyboard", () => {
  it("is taken back when the frame takes focus with no text edit holding it", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    keepKeyboardOutOfSealedFrame(iframe);
    await takesFocus();
    expect(state.focused).toBe(false);
  });

  it("stays in the frame while a text edit holds it, and comes back once the edit releases it", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    keepKeyboardOutOfSealedFrame(iframe);
    const release = holdSealedFrameKeyboard(iframe);
    await takesFocus();
    expect(state.focused).toBe(true);
    release();
    await nextTask();
    expect(state.focused).toBe(false);
  });

  it("is taken back when focus moves into the frame after the edit released it", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    keepKeyboardOutOfSealedFrame(iframe);
    holdSealedFrameKeyboard(iframe)();
    await takesFocus();
    expect(state.focused).toBe(false);
  });

  it("stays held for a newer edit when an older edit's release comes late", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    keepKeyboardOutOfSealedFrame(iframe);
    const older = holdSealedFrameKeyboard(iframe);
    const newer = holdSealedFrameKeyboard(iframe);
    older();
    older();
    await takesFocus();
    expect(state.focused).toBe(true);
    newer();
    await nextTask();
    expect(state.focused).toBe(false);
  });

  it("is let go and taken back when the frame reloads under an edit that never ended", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    keepKeyboardOutOfSealedFrame(iframe);
    holdSealedFrameKeyboard(iframe);
    await takesFocus();
    iframe.dispatchEvent(new Event("load"));
    await nextTask();
    expect(state.focused).toBe(false);
  });

  it("keeps an edit's hold when Studio re-attaches to the same frame", async () => {
    const { iframe, state, takesFocus } = sealedFrame();
    const detach = keepKeyboardOutOfSealedFrame(iframe);
    holdSealedFrameKeyboard(iframe);
    await takesFocus();
    detach();
    keepKeyboardOutOfSealedFrame(iframe);
    await nextTask();
    expect(state.focused).toBe(true);
  });

  it("drops the hold of a frame that left the page when Studio detaches from it", async () => {
    const { iframe, state } = sealedFrame();
    const detach = keepKeyboardOutOfSealedFrame(iframe);
    holdSealedFrameKeyboard(iframe);
    state.onPage = false;
    detach();
    state.onPage = true;
    state.focused = true;
    keepKeyboardOutOfSealedFrame(iframe);
    await nextTask();
    expect(state.focused).toBe(false);
  });
});
