// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "./domSelectionTestHarness";
import { useGestureRecording } from "./useGestureRecording";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useGestureRecording", () => {
  it("releases the preview runtime when unmounted during a recording", () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 17),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const previewDocument = iframe.contentDocument!;
    const element = previewDocument.createElement("div");
    element.id = "card";
    element.style.visibility = "hidden";
    element.style.setProperty("translate", "10px 20px");
    element.style.setProperty("--hf-studio-offset-x", "12px");
    element.style.setProperty("--hf-studio-offset-y", "-8px");
    previewDocument.body.append(element);

    const set = vi.fn();
    const seek = vi.fn();
    Reflect.set(iframe.contentWindow!, "gsap", {
      getProperty: vi.fn(() => 0),
      set,
    });
    Reflect.set(iframe.contentWindow!, "__timelines", {
      main: { duration: () => 5, seek },
    });
    Reflect.set(iframe.contentWindow!, "__player", { getTime: () => 1 });

    let recording: ReturnType<typeof useGestureRecording> | null = null;
    function Harness() {
      recording = useGestureRecording();
      return null;
    }
    const root = mountReactHarness(<Harness />);

    act(() => recording?.startRecording(element, iframe, 4));
    expect(element.style.getPropertyValue("--hf-studio-offset-x")).toBe("0px");
    expect(element.style.getPropertyValue("--hf-studio-offset-y")).toBe("0px");

    act(() => root.unmount());

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(set).toHaveBeenCalledWith("#card", {
      clearProps: "x,y,scale,scaleX,scaleY,rotation,rotationX,rotationY,opacity,z",
    });
    expect(element.style.visibility).toBe("hidden");
    expect(element.style.getPropertyValue("translate")).toBe("10px 20px");
    expect(element.style.getPropertyValue("--hf-studio-offset-x")).toBe("12px");
    expect(element.style.getPropertyValue("--hf-studio-offset-y")).toBe("-8px");
  });
});
