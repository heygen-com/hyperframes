import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilmBridge, type FilmBridge } from "./filmBridge";

const bridges: FilmBridge[] = [];
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});
function setup() {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  document.body.appendChild(iframe);
  const send = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});
  const load = { script: "window.CUT = kit.scenes()", modules: [], assets: [] };
  const bridge = createFilmBridge({ iframe, runnerHtml: "<div>fixture runner</div>", load });
  bridges.push(bridge);
  const receive = (
    type: string,
    data: Record<string, unknown> = {},
    origin = "null",
    source = iframe.contentWindow,
  ) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        origin,
        data: { ...data, type: "appifact-film:" + type },
      }),
    );
  };
  const initialize = () => {
    receive("hello");
    receive("ready");
  };
  return { iframe, send, load, bridge, receive, initialize };
}

describe("film runner bridge", () => {
  it("loads the original protocol payload once and waits for the matching frame", async () => {
    const { iframe, bridge, receive, send, load, initialize } = setup();
    expect(iframe.srcdoc).toContain("fixture runner");
    initialize();
    receive("hello");
    await bridge.ready;
    const frame = bridge.render(3.25);
    await Promise.resolve();
    expect(send).toHaveBeenNthCalledWith(1, { ...load, type: "appifact-film:load" }, "*");
    expect(send).toHaveBeenNthCalledWith(2, { type: "appifact-film:frame", t: 3.25, seq: 1 }, "*");
    let complete = false;
    void frame.then(() => {
      complete = true;
    });
    receive("frame", { seq: 2 });
    await Promise.resolve();
    expect(complete).toBe(false);
    receive("frame", { seq: 1 });
    await frame;
    expect(complete).toBe(true);
  });

  it("rejects sandbox configurations that expose a same-origin document", () => {
    const iframe = document.createElement("iframe");
    for (const sandbox of ["", "allow-scripts allow-same-origin"]) {
      iframe.setAttribute("sandbox", sandbox);
      expect(() => createFilmBridge({ iframe, runnerHtml: "", load: {} })).toThrow("sandbox");
    }
  });

  it("ignores foreign sources, origins, and ready messages before hello", async () => {
    const { bridge, receive, send } = setup();
    let ready = false;
    void bridge.ready.then(() => {
      ready = true;
    });
    receive("hello", {}, "https://example.com");
    receive("hello", {}, "null", window);
    receive("ready");
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(send).not.toHaveBeenCalled();
    receive("hello");
    receive("ready");
    await bridge.ready;
  });

  it("can seek again after an individual frame error", async () => {
    const { bridge, initialize, receive } = setup();
    initialize();
    const failed = bridge.render(2);
    const rejection = expect(failed).rejects.toThrow("bad frame");
    await Promise.resolve();
    receive("frame-error", { seq: 1, message: "bad frame" });
    await rejection;
    const next = bridge.render(0);
    await Promise.resolve();
    receive("frame", { seq: 1 });
    receive("frame", { seq: 2 });
    await next;
  });

  it("propagates startup failures and keeps fatal errors for later seeks", async () => {
    const { bridge, receive } = setup();
    receive("error", { message: "module missing" });
    await expect(bridge.ready).rejects.toThrow("module missing");
    await expect(bridge.render(0)).rejects.toThrow("module missing");
    const second = setup();
    second.initialize();
    await second.bridge.ready;
    second.receive("error", { message: "runner crashed" });
    await expect(second.bridge.render(0)).rejects.toThrow("runner crashed");
  });

  it("rejects stalled initialization and frames with bounded timeouts", async () => {
    vi.useFakeTimers();
    const first = setup();
    const rejected = expect(first.bridge.ready).rejects.toThrow("20 s");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    const second = setup();
    second.initialize();
    const frame = second.bridge.render(0);
    const rejection = expect(frame).rejects.toThrow("15 s");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    await expect(second.bridge.render(1)).rejects.toThrow("15 s");
  });

  it("disposes before startup or during a frame and ignores late messages", async () => {
    const first = setup();
    first.bridge.dispose();
    first.bridge.dispose();
    first.initialize();
    await expect(first.bridge.ready).rejects.toThrow("disposed");
    expect(first.iframe.srcdoc).toBe("");
    expect(first.send).not.toHaveBeenCalled();
    const second = setup();
    second.initialize();
    const frame = second.bridge.render(0);
    await Promise.resolve();
    second.bridge.dispose();
    second.receive("frame", { seq: 1 });
    await expect(frame).rejects.toThrow("disposed");
    await expect(second.bridge.render(1)).rejects.toThrow("disposed");
  });
});
