// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWaveformViewport } from "./useWaveformViewport";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function Waveform({ draw }: { draw: (canvas: HTMLCanvasElement) => void }) {
  const ref = useWaveformViewport(draw);
  return (
    <div>
      <canvas ref={ref} />
    </div>
  );
}

function rect(left: number, width: number): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("useWaveformViewport", () => {
  it("coalesces scroll changes and skips a repaint inside the overscan window", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => callbacks.delete(id));
    const viewport = document.createElement("div");
    viewport.setAttribute("data-timeline-scroll-viewport", "true");
    const passenger = document.createElement("div");
    const host = document.createElement("div");
    passenger.append(host);
    viewport.append(passenger);
    document.body.append(viewport);
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 800 });
    const root = createRoot(host);
    const initialDraw = vi.fn();
    act(() => root.render(<Waveform draw={initialDraw} />));
    const container = host.querySelector("div");
    if (!container) throw new Error("Waveform container missing");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 4_000 });
    let clipLeft = 0;
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => rect(clipLeft, 4_000));
    vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => rect(0, 800));
    const draw = vi.fn();
    act(() => root.render(<Waveform draw={draw} />));
    draw.mockClear();

    await act(async () => {
      clipLeft = -100;
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(callbacks.size).toBe(1);
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(0)));
    expect(draw).not.toHaveBeenCalled();

    clipLeft = -300;
    await act(async () => {
      passenger.style.transform = "translateX(1px)";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(callbacks.size).toBe(1);
    const geometryCallbacks = [...callbacks.values()];
    callbacks.clear();
    act(() => geometryCallbacks.forEach((callback) => callback(0)));
    expect(draw).toHaveBeenCalledTimes(1);

    viewport.dispatchEvent(new Event("scroll"));
    expect(callbacks.size).toBe(1);
    act(() => root.unmount());
    expect(callbacks.size).toBe(0);
    viewport.dispatchEvent(new Event("scroll"));
    expect(callbacks.size).toBe(0);
  });

  it("does not repaint a short clip while it remains fully visible", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    const viewport = document.createElement("div");
    viewport.setAttribute("data-timeline-scroll-viewport", "true");
    const host = document.createElement("div");
    viewport.append(host);
    document.body.append(viewport);
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 800 });
    const root = createRoot(host);
    const initialDraw = vi.fn();
    act(() => root.render(<Waveform draw={initialDraw} />));
    const container = host.querySelector("div");
    if (!container) throw new Error("Waveform container missing");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 120 });
    let clipLeft = 0;
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => rect(clipLeft, 120));
    vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => rect(0, 800));
    const draw = vi.fn();
    act(() => root.render(<Waveform draw={draw} />));
    draw.mockClear();

    act(() => {
      clipLeft = -400;
      viewport.dispatchEvent(new Event("scroll"));
      callbacks.forEach((callback) => callback(0));
      callbacks.clear();
    });
    expect(draw).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("draws new props without replacing the viewport subscription", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const first = vi.fn();
    const second = vi.fn();
    act(() => root.render(<Waveform draw={first} />));
    act(() => root.render(<Waveform draw={second} />));
    expect(second).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("forces a repaint after a viewport resize or theme change", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    const viewport = document.createElement("div");
    viewport.setAttribute("data-timeline-scroll-viewport", "true");
    const host = document.createElement("div");
    viewport.append(host);
    document.body.append(viewport);
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 800 });
    const root = createRoot(host);
    const initialDraw = vi.fn();
    act(() => root.render(<Waveform draw={initialDraw} />));
    const container = host.querySelector("div");
    if (!container) throw new Error("Waveform container missing");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 4_000 });
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => rect(0, 4_000));
    vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => rect(0, 800));
    const draw = vi.fn();
    act(() => root.render(<Waveform draw={draw} />));
    draw.mockClear();

    act(() => {
      window.dispatchEvent(new Event("resize"));
      callbacks.forEach((callback) => callback(0));
      callbacks.clear();
    });
    expect(draw).toHaveBeenCalledTimes(1);

    draw.mockClear();
    await act(async () => {
      document.documentElement.classList.toggle("theme-change");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    callbacks.forEach((callback) => callback(0));
    callbacks.clear();
    expect(draw).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
