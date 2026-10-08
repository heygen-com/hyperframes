import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositionProbe } from "./composition-probe.js";

function mount(markup: string, globals: Record<string, unknown> = {}) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.contentDocument!.body.innerHTML = markup;
  Object.assign(iframe.contentWindow!, globals);
  const onReady = vi.fn();
  const onError = vi.fn();
  const probe = new CompositionProbe(iframe, { onReady, onError });
  probe.start();
  return { iframe, probe, onReady, onError };
}
const root =
  '<div data-composition-id="main" data-duration="6" data-width="1920" data-height="1080"></div>';
function timeline(duration: number) {
  return {
    duration: () => duration,
    time: () => 0,
    seek: () => {},
    play: () => {},
    pause: () => {},
  };
}

describe("composition probe readiness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it.each<[string, string, Record<string, unknown>]>([
    ["CSS-only", "<style>@keyframes fade { to { opacity: 0; } }</style>" + root, {}],
    ["bare render(t)", root, { render: (t: number) => t }],
    [
      "WAAPI",
      root +
        '<script>document.querySelector("div").animate([{opacity:1},{opacity:0}],6000)</script>',
      {},
    ],
  ])("loads a %s document with its authored duration", (_name, markup, globals) => {
    const { onReady, onError } = mount(markup, globals);
    vi.advanceTimersByTime(8000);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].duration).toBe(6);
    expect(onError).not.toHaveBeenCalled();
  });
  it("waits for a registered timeline to grow inside its initialization grace", () => {
    let duration = 0;
    const registered = { ...timeline(0), duration: () => duration };
    const { onReady, onError } = mount(root, { __timelines: { main: registered } });
    vi.advanceTimersByTime(600);
    expect(onReady).not.toHaveBeenCalled();
    duration = 9;
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].duration).toBe(9);
    expect(onReady.mock.calls[0][0].adapter.timeline).toBe(registered);
    expect(onError).not.toHaveBeenCalled();
  });
  it("uses document duration through the runtime fallback when a timeline stays zero", () => {
    const { iframe, onReady } = mount(root, { __timelines: { main: timeline(0) } });
    vi.advanceTimersByTime(999);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(iframe.contentDocument!.querySelector("script")).not.toBeNull();
    Object.assign(iframe.contentWindow!, { __player: { getDuration: () => 0 } });
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].duration).toBe(6);
    expect(onReady.mock.calls[0][0].adapter.kind).toBe("runtime");
    expect(onReady.mock.calls[0][0].adapter.getDuration()).toBe(6);
  });
  it("uses document clip ends when the runtime reports zero length", () => {
    const { onReady } = mount(
      '<div data-composition-id="main"><div data-start="2" data-duration="3"></div></div>',
      { __player: { getDuration: () => 0 } },
    );
    vi.advanceTimersByTime(8000);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].duration).toBe(5);
    expect(onReady.mock.calls[0][0].adapter.kind).toBe("runtime");
  });
  it("reports the first retained author error before accepting a positive adapter", () => {
    const { onReady, onError } = mount(root, {
      __player: { getDuration: () => 6 },
      __hfPreviewErrors: [
        null,
        "",
        "Uncaught ReferenceError: missingScene is not defined",
        "Uncaught Error: later",
      ],
    });
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      "Uncaught ReferenceError: missingScene is not defined",
    );
    expect(onReady).not.toHaveBeenCalled();
  });
  it("reports an author error even while runtime injection is pending", () => {
    const { iframe, onError } = mount(
      '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>',
    );
    vi.advanceTimersByTime(200);
    Object.assign(iframe.contentWindow!, {
      __hfPreviewErrors: ["Uncaught Error: child setup failed"],
    });
    vi.advanceTimersByTime(7800);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Uncaught Error: child setup failed");
  });
  it("times out pending runtime injection at eight seconds", () => {
    const { onReady, onError } = mount(
      '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>',
    );
    vi.advanceTimersByTime(7999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Composition timeline not found after 8s");
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledOnce();
  });
  it("does not invent duration for an unresolved document", () => {
    const { onReady, onError } = mount('<div data-composition-id="main"></div>');
    vi.advanceTimersByTime(8000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith("Composition timeline not found after 8s");
  });
  it("rejects initialization later than eight seconds", () => {
    const { iframe, onReady, onError } = mount('<div data-composition-id="main"></div>');
    vi.advanceTimersByTime(8000);
    Object.assign(iframe.contentWindow!, { __player: { getDuration: () => 6 } });
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
  it("accepts initialization inside the eight-second budget", () => {
    const { iframe, onReady, onError } = mount('<div data-composition-id="main"></div>');
    vi.advanceTimersByTime(7400);
    Object.assign(iframe.contentWindow!, { __player: { getDuration: () => 6 } });
    vi.advanceTimersByTime(600);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
  it("keeps a positive adapter duration over document fallback", () => {
    const { onReady } = mount(root, { __player: { getDuration: () => 9 } });
    vi.advanceTimersByTime(200);
    expect(onReady.mock.calls[0][0].duration).toBe(9);
  });
  it("ignores resource-event placeholders and reports the first author message", () => {
    const { onError } = mount(root, {
      __hfPreviewErrors: ["[object Event]", "Uncaught Error: author failed"],
    });
    vi.advanceTimersByTime(200);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Uncaught Error: author failed");
  });
  it("ignores a malformed error buffer and still loads a valid document", () => {
    const { onReady, onError } = mount(root, { __hfPreviewErrors: { message: "not the buffer" } });
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
  it("uses document duration when the adapter duration is not finite", () => {
    const { onReady } = mount(root, { __player: { getDuration: () => Infinity } });
    vi.advanceTimersByTime(200);
    expect(onReady.mock.calls[0][0].duration).toBe(6);
  });
  it("surfaces an adapter exception instead of masking it as a timeout", () => {
    const { onReady, onError } = mount(root, {
      __player: {
        getDuration: () => {
          throw new Error("adapter initialization failed");
        },
      },
    });
    vi.advanceTimersByTime(8000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith("adapter initialization failed");
  });
});
