// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { TimelineClipFades, useClipFadeDraft } from "./TimelineClipFades";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  usePlayerStore.setState({ currentTime: 0, elements: [], timelineSnapEnabled: true });
});

/** TimelineClip owns the draft; this stands in for it. */
function Fades(props: { el: TimelineElement; showHandles: boolean; focusable?: boolean }) {
  const fade = useClipFadeDraft(props.el);
  return <TimelineClipFades {...props} pps={100} widthPx={props.el.duration * 100} fade={fade} />;
}

const clip: TimelineElement = {
  id: "music",
  tag: "audio",
  src: "assets/music.wav",
  start: 2,
  duration: 10,
  track: 1,
  fadeIn: 1,
  fadeOut: 2,
};

function render(
  el: TimelineElement,
  options: {
    showHandles?: boolean;
    provide?: boolean;
    focusable?: boolean;
    onClipPointerDown?: () => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  const onSetElementAttributeLive = vi.fn();
  const onSetElementAttributeQuiet = vi.fn().mockResolvedValue(undefined);
  const onRevertElementAttributeLive = vi.fn();
  // Stands in for the TimelineClip button the handles live inside.
  const node = (
    <div data-testid="clip" onPointerDown={options.onClipPointerDown}>
      <Fades el={el} showHandles={options.showHandles ?? true} focusable={options.focusable} />
    </div>
  );
  act(() => {
    root.render(
      options.provide === false ? (
        node
      ) : (
        <TimelineEditProvider
          value={{
            onSetElementAttributeLive,
            onSetElementAttributeQuiet,
            onRevertElementAttributeLive,
          }}
        >
          {node}
        </TimelineEditProvider>
      ),
    );
  });
  return {
    host,
    root,
    onSetElementAttributeLive,
    onSetElementAttributeQuiet,
    onRevertElementAttributeLive,
  };
}

function pointer(type: string, clientX: number, pointerId = 1, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function armCapture(handle: HTMLElement) {
  let captured = false;
  Object.defineProperty(handle, "setPointerCapture", { value: () => (captured = true) });
  Object.defineProperty(handle, "releasePointerCapture", { value: () => (captured = false) });
  Object.defineProperty(handle, "hasPointerCapture", { value: () => captured });
}

describe("TimelineClipFades", () => {
  it("shades the fade-in and fade-out as ramps sized by pps", () => {
    const { host, root } = render(clip, { showHandles: false, provide: false });
    const fadeIn = host.querySelector('[data-testid="clip-fade-in"]');
    const fadeOut = host.querySelector('[data-testid="clip-fade-out"]');
    // 1 s in at 100 px/s: the wedge spans 0..100; 2 s out on a 1000 px clip: 800..1000.
    expect(fadeIn?.getAttribute("points")).toBe("0,0 100,0 0,100");
    expect(fadeOut?.getAttribute("points")).toBe("800,0 1000,0 1000,100");
    // Outside a provider there is nothing to write to, so no handles either.
    expect(host.querySelector('[data-testid="clip-fade-handle-in"]')).toBeNull();
    act(() => root.unmount());
  });

  it("clips the ramps to the clip's rounded corners", () => {
    const { host, root } = render(clip, { showHandles: false, provide: false });
    const ramps = host.querySelector<SVGElement>('[data-testid="clip-fade-ramps"]');
    expect(ramps?.style.overflow).toBe("hidden");
    expect(ramps?.style.borderRadius).toBe("inherit");
    act(() => root.unmount());
  });

  it("renders nothing for a clip without fades when the handles are hidden", () => {
    const { host, root } = render(
      { ...clip, fadeIn: undefined, fadeOut: undefined },
      {
        showHandles: false,
      },
    );
    expect(host.querySelector('[data-testid="clip"]')?.innerHTML).toBe("");
    act(() => root.unmount());
  });

  it("drags the fade-in dot to the right, previewing live and committing once on release", () => {
    const { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    // 150 px of rightward travel adds 1.5 s to the 1 s fade-in, wherever the press lands.
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 200)));
    act(() => handle.dispatchEvent(pointer("pointermove", 250)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "2.5");
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
    // The ramp follows the pointer before anything is persisted.
    expect(host.querySelector('[data-testid="clip-fade-in"]')?.getAttribute("points")).toBe(
      "0,0 250,0 0,100",
    );
    act(() => handle.dispatchEvent(pointer("pointerup", 250)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-in", "2.5", "Fade in");
    act(() => root.unmount());
  });

  it("drags the fade-out dot to the left, growing the fade, and never past the fade-in", () => {
    const { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    if (!handle) throw new Error("expected a fade-out handle");
    armCapture(handle);
    // 300 px of leftward travel adds 3 s to the 2 s fade-out, wherever the press lands.
    act(() => handle.dispatchEvent(pointer("pointerdown", 1000)));
    act(() => handle.dispatchEvent(pointer("pointermove", 700)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "5");
    // Way past the start: clamps to duration − fadeIn = 9 s.
    act(() => handle.dispatchEvent(pointer("pointermove", 0)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "9");
    act(() => handle.dispatchEvent(pointer("pointerup", 0)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-out", "9", "Fade out");
    act(() => root.unmount());
  });

  it("removes the attribute when dragged back to zero", () => {
    const { host, root, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 200)));
    act(() => handle.dispatchEvent(pointer("pointermove", 0)));
    act(() => handle.dispatchEvent(pointer("pointerup", 0)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-in", null, "Fade in");
    act(() => root.unmount());
  });

  it("puts the live value back and writes nothing when the gesture is cancelled", () => {
    const {
      host,
      root,
      onSetElementAttributeLive,
      onRevertElementAttributeLive,
      onSetElementAttributeQuiet,
    } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 300)));
    act(() => handle.dispatchEvent(pointer("pointercancel", 300)));
    // Written back live for a host without the revert, then ended through the lanes' revert.
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "1");
    expect(onRevertElementAttributeLive).toHaveBeenCalledWith(clip, "data-fade-in");
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("cancels a drag on Escape pressed while focus is elsewhere, and saves nothing", () => {
    const { host, onSetElementAttributeQuiet, onRevertElementAttributeLive } = render(clip);
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 300)));
    expect(document.activeElement).toBe(elsewhere);
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    act(() => handle.dispatchEvent(pointer("pointerup", 300)));
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
    expect(onRevertElementAttributeLive).toHaveBeenCalledWith(clip, "data-fade-in");
    expect(host.querySelector('[data-testid="clip-fade-in"]')?.getAttribute("points")).toBe(
      "0,0 100,0 0,100",
    );
  });

  it.each([
    ["above the window", 300, -40],
    ["on the window's right edge", window.innerWidth, 10],
  ])("restores the fade and saves nothing when released %s", (_, clientX, clientY) => {
    const { host, root, onSetElementAttributeLive, onRevertElementAttributeLive, ...rest } =
      render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 300)));
    act(() => handle.dispatchEvent(pointer("pointerup", clientX, 1, clientY)));
    expect(rest.onSetElementAttributeQuiet).not.toHaveBeenCalled();
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "1");
    expect(onRevertElementAttributeLive).toHaveBeenCalledWith(clip, "data-fade-in");
    expect(host.querySelector('[data-testid="clip-fade-in"]')?.getAttribute("points")).toBe(
      "0,0 100,0 0,100",
    );
    act(() => root.unmount());
  });

  it.each([
    ["in", "Fade in 0.25 s"],
    ["out", "Fade out 0.4 s"],
  ])(
    "gives the fade-%s handle a 24 px target and a tooltip naming its length",
    async (edge, text) => {
      const { host, root } = render({ ...clip, fadeIn: 0.25, fadeOut: 0.4 });
      const handle = host.querySelector<HTMLElement>(`[data-testid="clip-fade-handle-${edge}"]`);
      if (!handle) throw new Error(`expected a fade-${edge} handle`);
      expect(parseFloat(handle.style.width)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(handle.style.height)).toBeGreaterThanOrEqual(24);
      expect(handle.getAttribute("title")).toBe("");
      act(() => handle.focus());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(text);
      act(() => root.unmount());
    },
  );

  it.each([
    [0.3, "18px"],
    [3, "288px"],
  ])("puts the fade-in tab at the end of a %s s fade", (fadeIn, left) => {
    const { host } = render({ ...clip, fadeIn, fadeOut: 0.4 });
    const inHandle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    const outHandle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    // The 24 px box centres on the fade's end: 0.4 s out of a 1000 px clip ends at 960.
    expect(inHandle?.style.left).toBe(left);
    expect(outHandle?.style.left).toBe("948px");
    const tab = inHandle?.firstElementChild as HTMLElement;
    expect(tab.style.left).toBe("10px");
  });

  it("keeps the tab off the rounded end when there is no fade", () => {
    const { host } = render({ ...clip, fadeIn: undefined, fadeOut: undefined });
    const inHandle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    const outHandle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    expect(inHandle?.style.left).toBe("0px");
    expect(outHandle?.style.left).toBe("976px");
  });

  it("lengthens a fade by the pointer's inward travel from wherever the press lands", () => {
    const { host, onSetElementAttributeLive } = render(clip);
    const fadeIn = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    const fadeOut = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    if (!fadeIn || !fadeOut) throw new Error("expected both handles");
    armCapture(fadeIn);
    armCapture(fadeOut);
    act(() => fadeIn.dispatchEvent(pointer("pointerdown", 12)));
    act(() => fadeIn.dispatchEvent(pointer("pointermove", 162)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "2.5");
    act(() => fadeIn.dispatchEvent(pointer("pointerup", 162)));
    act(() => fadeOut.dispatchEvent(pointer("pointerdown", 988, 2)));
    act(() => fadeOut.dispatchEvent(pointer("pointermove", 888, 2)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "3");
  });

  it("paints the handles above the clip's waveform and thumbnail layers", () => {
    const { host } = render(clip);
    const layer = host.querySelector<HTMLElement>('[data-testid="clip"]')?.firstElementChild;
    expect(Number((layer as HTMLElement).style.zIndex)).toBeGreaterThan(10);
  });

  it("splits a clip narrower than two targets between the handles", () => {
    const { host } = render({ ...clip, duration: 0.3, fadeIn: 0.1, fadeOut: 0.1 });
    const fadeIn = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    const fadeOut = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    expect([fadeIn?.style.left, fadeIn?.style.width]).toEqual(["0px", "15px"]);
    expect([fadeOut?.style.left, fadeOut?.style.width]).toEqual(["15px", "15px"]);
    const tab = fadeIn?.firstElementChild as HTMLElement;
    expect([tab.style.width, tab.style.height]).toEqual(["4px", "15px"]);
    // Layout is not real here; tests/e2e/fade-handles.mjs measures the tab in Chrome.
    expect(tab.style.pointerEvents).toBe("none");
  });

  it("snaps the fade's end to the playhead within the timeline's snap radius", () => {
    usePlayerStore.setState({ currentTime: 4.5 });
    const { host, onSetElementAttributeLive } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    // 146 px makes a 2.46 s fade ending at 4.46 s, 4 px from the playhead: it lands on 4.5.
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 246)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "2.5");
  });

  it("leaves the fade unsnapped when the timeline's snapping is off", () => {
    usePlayerStore.setState({ currentTime: 4.5, timelineSnapEnabled: false });
    const { host, onSetElementAttributeLive } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 246)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "2.46");
  });

  it("snaps to another clip's edge", () => {
    usePlayerStore.setState({
      elements: [clip, { id: "title", tag: "div", start: 6, duration: 2, track: 0 }],
    });
    const { host, onSetElementAttributeLive } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    if (!handle) throw new Error("expected a fade-out handle");
    armCapture(handle);
    // The 2 s fade-out starts at 10 s; 395 px left moves that to 6.05 s, onto the title's start.
    act(() => handle.dispatchEvent(pointer("pointerdown", 1000)));
    act(() => handle.dispatchEvent(pointer("pointermove", 605)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "6");
  });

  it.each([
    [1, null],
    [undefined, "0.5"],
  ])("double-click on a %s s fade-in saves %s", (fadeIn, saved) => {
    const { host, onSetElementAttributeQuiet } = render({ ...clip, fadeIn });
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    act(() => handle?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(
      { ...clip, fadeIn },
      "data-fade-in",
      saved,
      "Fade in",
    );
  });

  it.each([
    [{ key: "ArrowRight" }, "1.1"],
    [{ key: "ArrowRight", shiftKey: true }, "2"],
    [{ key: "ArrowLeft" }, "0.9"],
    [{ key: "Home" }, null],
    [{ key: "End" }, "8"],
  ])("saves one step per key press: %o", (init, saved) => {
    const outer = vi.fn();
    const { host, onSetElementAttributeQuiet } = render(clip, { focusable: true });
    document.body.addEventListener("keydown", outer);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    expect(handle?.tabIndex).toBe(0);
    act(() => {
      handle?.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
    });
    expect(onSetElementAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-in", saved, "Fade in");
    // The timeline's own arrow-key handling never sees a key the handle used.
    expect(outer).not.toHaveBeenCalled();
  });

  it("keeps an unselected clip's handles out of the tab order", () => {
    const { host } = render(clip);
    expect(host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]')?.tabIndex).toBe(
      -1,
    );
  });

  it("does not let a press on the dot start the clip's own move gesture", () => {
    const outer = vi.fn();
    const { host, root } = render(clip, { onClipPointerDown: outer });
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    expect(outer).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
