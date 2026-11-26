// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FONT_FACES, MAX_QUERY_MATCHES } from "@hyperframes/core/runtime/editing-port";
import { MAX_FRAME_CLIPS } from "./manifestClips";
import {
  AGENT_PROBE_MS,
  holdRefreshReadsWhile,
  PREVIEW_REJECTED,
  releaseEndedGestureHolds,
  previewAnswer,
  previewComputedStylesOfEvery,
  previewConsoleErrors,
  previewFontFaces,
  previewClipManifest,
  previewClipParents,
  previewEditingClient,
  previewFrameOpaque,
  previewRequest,
  previewSeekPainted,
  setFrameLoopStart,
} from "./previewChannel";
import { bridgePlaybackAdapter, watchPreviewFrame } from "./bridgePlayback";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import { resolveFramePlaybackAdapter } from "../hooks/playbackAdapterResolution";
import { detachedFakeIframe, serveEditingRequests } from "../hooks/timelinePlayerTestHarness";

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

/** A frame on another origin: any read of its window throws, as a browser's does. */
function opaqueFrame() {
  const posted: unknown[] = [];
  const postMessage = (message: unknown) => posted.push(message);
  const frame = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      if (key === "postMessage") return postMessage;
      throw new DOMException(`blocked read of ${String(key)}`, "SecurityError");
    },
  });
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  Object.defineProperty(iframe, "contentDocument", { value: null });
  return { iframe, frame, posted };
}

/** Posts from `frame` as its runtime does, from an opaque origin unless told otherwise. */
function fromFrame(frame: object, data: Record<string, unknown>, origin = "null") {
  const source = frame as Window;
  window.dispatchEvent(
    new MessageEvent("message", { source, origin, data: { source: "hf-preview", ...data } }),
  );
}

/** A fake frame, same-origin unless `opaque`, whose runtime answers editing requests with `answer`. */
function servedFrame(answer: (kind: string, params: unknown) => unknown, opaque = false) {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  if (opaque) {
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(frame, "document", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  }
  const handed = vi.fn(answer);
  closers.push(serveEditingRequests(frame, handed));
  return { iframe, frame, handed };
}

describe("previewFrameOpaque", () => {
  it("is true only for a frame whose window refuses a read", () => {
    expect(previewFrameOpaque(document.body.appendChild(document.createElement("iframe")))).toBe(
      false,
    );
    expect(previewFrameOpaque(document.createElement("iframe"))).toBe(false);
    expect(previewFrameOpaque(opaqueFrame().iframe)).toBe(true);
    // A window that answers reads is not opaque, even with no document to hand.
    const readable = document.createElement("iframe");
    Object.defineProperty(readable, "contentWindow", { value: {} });
    expect(previewFrameOpaque(readable)).toBe(false);
  });
});

describe("previewEditingClient", () => {
  it("keeps one client per frame load and opens a fresh one after the frame loads again", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: false }));
    const first = previewEditingClient(iframe);
    expect(previewEditingClient(iframe)).toBe(first);
    iframe.dispatchEvent(new Event("load"));
    await expect(first.request("wait-for-seek", {})).rejects.toMatchObject({ code: "disposed" });
    const second = previewEditingClient(iframe);
    expect(second).not.toBe(first);
    await expect(second.request("wait-for-seek", {})).resolves.toEqual({ waited: false });
    expect(handed).toHaveBeenCalledOnce();
  });

  it("hands a load handler attached before the client the new load's client", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: false }));
    let asked: Promise<unknown> | undefined;
    iframe.addEventListener("load", () => {
      asked = previewEditingClient(iframe).request("wait-for-seek", {});
    });
    const first = previewEditingClient(iframe);
    iframe.dispatchEvent(new Event("load"));
    expect(previewEditingClient(iframe)).not.toBe(first);
    await expect(asked).resolves.toEqual({ waited: false });
    expect(handed).toHaveBeenCalledOnce();
  });

  it("sends an opaque frame's loop start over the port, only when it changes", async () => {
    const seen: unknown[] = [];
    const { iframe } = servedFrame((_kind, params) => {
      seen.push((params as { seconds: unknown }).seconds);
      return { applied: true };
    }, true);
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, null);
    await vi.waitFor(() => expect(seen).toEqual([2, null]));
  });

  it("calls a scriptable frame's own loop-start hook and never opens a port", async () => {
    const { iframe, frame, handed } = servedFrame(() => ({ applied: true }));
    const setLoopStart = vi.fn();
    frame.__hf = { setLoopStart };
    setFrameLoopStart(iframe, 2);
    setFrameLoopStart(iframe, 2);
    expect(setLoopStart.mock.calls).toEqual([[2], [2]]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handed).not.toHaveBeenCalled();
    delete frame.__hf;
    expect(() => setFrameLoopStart(iframe, null)).not.toThrow();
  });

  it("waits for the runtime's seek to paint, and settles anyway when no runtime answers", async () => {
    const { iframe, handed } = servedFrame(() => ({ waited: true }));
    await previewSeekPainted(iframe);
    expect(handed).toHaveBeenCalledWith("wait-for-seek", {});
    const started = Date.now();
    await previewSeekPainted(opaqueFrame().iframe, 15_000);
    expect(Date.now() - started).toBeLessThan(AGENT_PROBE_MS + 500);
  });

  it("answers a frame whose runtime never came at once, rather than after another probe", async () => {
    const { iframe } = opaqueFrame();
    const started = Date.now();
    await previewSeekPainted(iframe, 15_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(AGENT_PROBE_MS - 50);
    const again = Date.now();
    await previewSeekPainted(iframe, 15_000);
    expect(Date.now() - again).toBeLessThan(100);
  });

  // fails without the fix: the request waited on the known agent first, and a re-render queued in that
  // step ran before it went out (a sealed Delete's removal left 80 ms late at 4x CPU).
  it("posts a request to a frame whose agent it knows in the caller's own step", async () => {
    const { iframe, handed } = servedFrame((_kind, params) => params);
    await previewRequest(iframe, "set-loop-start", { seconds: 0 });
    handed.mockClear();
    // The client's own request waits on nothing, so it leaves first unless previewRequest's went out at once.
    const asked = previewRequest(iframe, "set-loop-start", { seconds: 1 });
    const direct = previewEditingClient(iframe).request("set-loop-start", { seconds: 2 });
    await Promise.all([asked, direct]);
    expect(handed.mock.calls.map(([, params]) => params)).toEqual([{ seconds: 1 }, { seconds: 2 }]);
  });

  it("sends requests in call order when one is asked in the step the frame's agent connects", async () => {
    const { iframe, handed } = servedFrame((_kind, params) => params);
    const first = previewRequest(iframe, "set-loop-start", { seconds: 1 });
    const second = previewEditingClient(iframe).ready.then(() =>
      previewRequest(iframe, "set-loop-start", { seconds: 2 }),
    );
    await Promise.all([first, second]);
    expect(handed.mock.calls.map(([, params]) => params)).toEqual([{ seconds: 1 }, { seconds: 2 }]);
  });

  it("keeps call order for requests asked in each microtask while the agent's probe settles", async () => {
    const { iframe, handed } = servedFrame((_kind, params) => params);
    const asked = [previewRequest(iframe, "set-loop-start", { seconds: 0 })];
    await new Promise<void>((done) => {
      void previewEditingClient(iframe).ready.then(async () => {
        for (let seconds = 1; seconds <= 12; seconds++) {
          asked.push(previewRequest(iframe, "set-loop-start", { seconds }));
          await Promise.resolve();
        }
        done();
      });
    });
    await Promise.all(asked);
    const order = handed.mock.calls.map(([, params]) => (params as { seconds: number }).seconds);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("sends a request asked while a reply is handled after that handling, with each answer its own", async () => {
    const log: string[] = [];
    const { iframe } = servedFrame((_kind, params) => {
      log.push(`frame ${(params as { seconds: number }).seconds}`);
      return params;
    });
    await previewRequest(iframe, "set-loop-start", { seconds: 0 });
    log.length = 0;
    const answers = await previewRequest(iframe, "set-loop-start", { seconds: 1 }).then((first) => {
      const second = previewRequest(iframe, "set-loop-start", { seconds: 2 });
      log.push("first handled");
      return Promise.all([first, second]);
    });
    expect(log).toEqual(["frame 1", "first handled", "frame 2"]);
    expect(answers).toEqual([{ seconds: 1 }, { seconds: 2 }]);
  });

  it("keeps a frame's error answer apart from no answer; previewRequest answers null for both", async () => {
    const frame: Record<string, unknown> = {};
    const iframe = detachedFakeIframe(frame);
    const answerWithError = (port: MessagePort) =>
      queueMicrotask(() => {
        port.onmessage = (event: MessageEvent<{ id: number; kind: string }>) => {
          if (event.data.kind === "runtime-snapshot") return;
          const error = { code: "invalid-params", message: "timing value too long" };
          port.postMessage({ v: 1, id: event.data.id, ok: false, error });
        };
      });
    closers.push(serveEditingRequests(frame, () => null, answerWithError));
    expect(await previewAnswer(iframe, "wait-for-seek", {})).toBe(PREVIEW_REJECTED);
    expect(await previewRequest(iframe, "wait-for-seek", {})).toBeNull();
    expect(await previewAnswer(iframe, "runtime-snapshot", {}, 50)).toBeNull();
  });

  it("returns the runtime's manifest only when its reply has the manifest's shape", async () => {
    const manifest = { clips: [], durationInFrames: 30, scenes: [] };
    let reply: unknown = { clipManifest: manifest };
    const { iframe } = servedFrame(() => reply);
    expect(await previewClipManifest(iframe)).toEqual(manifest);
    for (const bad of [
      null,
      { clipManifest: "x" },
      { clipManifest: { clips: {}, durationInFrames: 30 } },
      { clipManifest: { clips: [], durationInFrames: "30" } },
    ]) {
      reply = bad;
      expect(await previewClipManifest(iframe)).toBeNull();
    }
    reply = { clipManifest: { clips: [], durationInFrames: Infinity } };
    expect(await previewClipManifest(iframe)).toBeNull();
  });
});

describe("the clip lists in a runtime snapshot", () => {
  const pair = ["child", "parent"];
  const manifest = (clips: unknown[]) => ({ clipManifest: { clips, durationInFrames: 30 } });

  it("are read up to the clip cap", async () => {
    const { iframe } = servedFrame(() => ({ clipParents: Array(MAX_FRAME_CLIPS).fill(pair) }));
    expect(await previewClipParents(iframe)).toEqual(new Map([["child", "parent"]]));
  });

  it("are refused past the clip cap or with a gap", async () => {
    let clipParents: unknown[] = Array(MAX_FRAME_CLIPS + 1).fill(pair);
    let clips: unknown[] = [];
    const { iframe } = servedFrame(() => ({ ...manifest(clips), clipParents }));
    expect(await previewClipParents(iframe)).toEqual(new Map());
    clipParents = [pair, pair, pair];
    delete clipParents[1];
    clips = [{}, {}];
    delete clips[0];
    expect(await previewClipParents(iframe)).toEqual(new Map());
    expect(await previewClipManifest(iframe)).toBeNull();
  });

  it("hand on a manifest's scenes only when they are a list Studio can bound", async () => {
    const scene = { id: "s", label: "S", start: 0, duration: 1 };
    let scenes: unknown[] = [scene];
    const { iframe } = servedFrame(() => ({
      clipManifest: { clips: [], durationInFrames: 30, scenes },
    }));
    expect((await previewClipManifest(iframe))?.scenes).toEqual([scene]);
    scenes = [scene, scene, scene];
    delete scenes[1];
    expect((await previewClipManifest(iframe))?.scenes).toEqual([]);
    scenes = new Array(2 ** 32 - 1);
    const started = performance.now();
    expect((await previewClipManifest(iframe))?.scenes).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("are refused at once when their length has no entries", async () => {
    const empty = new Array(2 ** 32 - 1);
    const { iframe } = servedFrame(() => ({ ...manifest(empty), clipParents: empty }));
    const started = performance.now();
    expect(await previewClipParents(iframe)).toEqual(new Map());
    expect(await previewClipManifest(iframe)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("a list in a frame's runtime reply", () => {
  const face = { family: "A", src: "url(a.woff2)" };
  const readers = [
    {
      name: "console errors",
      cap: MAX_QUERY_MATCHES,
      entry: "boom",
      reply: (list: unknown[]) => ({ errors: list, truncated: false }),
      read: (iframe: HTMLIFrameElement) => previewConsoleErrors(iframe, 0),
    },
    {
      name: "every match's styles",
      cap: MAX_QUERY_MATCHES,
      entry: { color: "red" },
      reply: (list: unknown[]) => ({ styles: null, matches: list, truncated: false }),
      read: (iframe: HTMLIFrameElement) => previewComputedStylesOfEvery(iframe, "p", ["color"]),
    },
    {
      name: "font families",
      cap: MAX_FONT_FACES,
      entry: "A",
      reply: (list: unknown[]) => ({ families: list, ownFaces: [face] }),
      read: (iframe: HTMLIFrameElement) => previewFontFaces(iframe),
    },
    {
      name: "the frame's own faces",
      cap: MAX_FONT_FACES,
      entry: face,
      reply: (list: unknown[]) => ({ families: ["A"], ownFaces: list }),
      read: (iframe: HTMLIFrameElement) => previewFontFaces(iframe),
    },
  ];

  it.each(readers)("for $name is read up to the frame's own cap", async (r) => {
    const { iframe } = servedFrame(() => r.reply(Array(r.cap).fill(r.entry)));
    expect(await r.read(iframe)).not.toBeNull();
  });

  it.each(readers)("for $name is refused past the frame's cap or with a gap", async (r) => {
    let list: unknown[] = Array(r.cap + 1).fill(r.entry);
    const { iframe } = servedFrame(() => r.reply(list));
    expect(await r.read(iframe)).toBeNull();
    list = Array(r.cap).fill(r.entry);
    delete list[1];
    expect(await r.read(iframe)).toBeNull();
  });

  it.each(readers)("for $name is refused at once when its length has no entries", async (r) => {
    const { iframe } = servedFrame(() => r.reply(new Array(2 ** 32 - 1)));
    const started = performance.now();
    expect(await r.read(iframe)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

// fails without the fix: the reader turned each entry into a string, walking a nested list's every slot.
it("refuses a frame's console errors at once when an entry is not a string", async () => {
  const { iframe } = servedFrame(() => ({
    errors: ["boom", new Array(2 ** 32 - 1)],
    truncated: false,
  }));
  const started = performance.now();
  expect(await previewConsoleErrors(iframe, 0)).toBeNull();
  expect(performance.now() - started).toBeLessThan(1000);
});

describe("bridge playback for a frame Studio cannot script", () => {
  const refs = () => ({ cache: { current: null }, warned: { current: false } });

  it("drives the runtime with control messages and never reads the frame's window", () => {
    const { iframe, posted } = opaqueFrame();
    const adapter = resolveFramePlaybackAdapter(iframe, refs());
    expect(adapter).not.toBeNull();
    adapter!.play();
    adapter!.seek(4);
    adapter!.pause();
    expect(posted).toEqual([
      expect.objectContaining({ source: "hf-parent", type: "control", action: "play" }),
      expect.objectContaining({ action: "seek", timeSeconds: 4 }),
      expect.objectContaining({ action: "pause" }),
    ]);
    expect(adapter!.getTime()).toBe(4);
    expect(adapter!.isPlaying()).toBe(false);
  });

  it("keeps a seek until the runtime confirms it, so a state posted before it cannot undo it", () => {
    const { iframe, frame } = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    try {
      adapter.seek(4);
      fromFrame(frame, { type: "state", currentTime: 1, isPlaying: false });
      expect(adapter.getTime()).toBe(4);
      fromFrame(frame, { type: "state", currentTime: 4, isPlaying: false });
      fromFrame(frame, { type: "state", currentTime: 4.5, isPlaying: true });
      expect(adapter.getTime()).toBe(4.5);
      adapter.seek(99);
      clock.mockReturnValue(2_000);
      fromFrame(frame, { type: "state", currentTime: 12, isPlaying: false });
      expect(adapter.getTime()).toBe(12);
    } finally {
      clock.mockRestore();
    }
  });

  it("takes a seek the runtime landed on the frame before it, and plays on", () => {
    const { iframe, frame } = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    const at30fps = runtimeProtocolMetadata(30);
    adapter.seek(4.01);
    fromFrame(frame, { type: "state", currentTime: 4, isPlaying: true, ...at30fps });
    expect(adapter.getTime()).toBe(4);
    expect(adapter.isPlaying()).toBe(true);
    fromFrame(frame, { type: "state", currentTime: 4.3, isPlaying: true, ...at30fps });
    expect(adapter.getTime()).toBe(4.3);
  });

  it("ignores a post from a window it was not built for, or from an origin its frame cannot have", () => {
    const opaque = opaqueFrame();
    const adapter = bridgePlaybackAdapter(opaque.iframe)!;
    const stranger = opaqueFrame();
    fromFrame(stranger.frame, { type: "state", currentTime: 9, isPlaying: true });
    fromFrame(opaque.frame, { type: "state", currentTime: 8, isPlaying: true }, location.origin);
    fromFrame(
      opaque.frame,
      { type: "state", currentTime: 7, isPlaying: true },
      "https://example.com",
    );
    expect(adapter.getTime()).toBe(0);
    // A post from a frame nobody registered is dropped, not kept for a later adapter.
    expect(bridgePlaybackAdapter(stranger.iframe)!.getTime()).toBe(0);
    fromFrame(opaque.frame, { type: "state", currentTime: 2, isPlaying: false });
    expect(adapter.getTime()).toBe(2);

    const sameOrigin = document.createElement("iframe");
    sameOrigin.src = "/preview/index.html";
    const frame = {};
    Object.defineProperty(sameOrigin, "contentWindow", { value: frame });
    watchPreviewFrame(sameOrigin);
    const own = bridgePlaybackAdapter(sameOrigin)!;
    fromFrame(frame, { type: "state", currentTime: 5, isPlaying: false }, "null");
    expect(own.getTime()).toBe(0);
    fromFrame(frame, { type: "state", currentTime: 5, isPlaying: false }, location.origin);
    expect(own.getTime()).toBe(5);
  });

  it("accepts a frame its server sandboxed, which posts as null though its frame has no sandbox", () => {
    const { iframe, frame } = opaqueFrame();
    iframe.removeAttribute("sandbox");
    iframe.setAttribute("src", "/api/projects/demo/preview");
    watchPreviewFrame(iframe);
    const adapter = bridgePlaybackAdapter(iframe)!;
    fromFrame(frame, { type: "state", currentTime: 6, isPlaying: false }, "https://example.com");
    fromFrame({}, { type: "state", currentTime: 7, isPlaying: false }, "null");
    expect(adapter.getTime()).toBe(0);
    fromFrame(frame, { type: "state", currentTime: 6, isPlaying: false }, "null");
    expect(adapter.getTime()).toBe(6);
  });

  it.each([
    ["srcdoc", (f: HTMLIFrameElement) => f.setAttribute("srcdoc", "<p>x</p>"), location.origin],
    [
      "about:blank",
      (f: HTMLIFrameElement) => f.setAttribute("src", "about:blank"),
      location.origin,
    ],
    ["a data: URL", (f: HTMLIFrameElement) => f.setAttribute("src", "data:text/html,x"), "null"],
    [
      "another origin",
      (f: HTMLIFrameElement) => f.setAttribute("src", "https://a.test/p"),
      "https://a.test",
    ],
  ])("accepts a frame loading %s only from the origin it has", (_name, load, origin) => {
    const iframe = document.createElement("iframe");
    load(iframe);
    const frame = {};
    Object.defineProperty(iframe, "contentWindow", { value: frame });
    const adapter = bridgePlaybackAdapter(iframe)!;
    const wrong = origin === "null" ? location.origin : "null";
    fromFrame(frame, { type: "state", currentTime: 3, isPlaying: false }, wrong);
    expect(adapter.getTime()).toBe(0);
    fromFrame(frame, { type: "state", currentTime: 3, isPlaying: false }, origin);
    expect(adapter.getTime()).toBe(3);
  });

  it("takes time, play state and duration from its own frame's state and timeline messages", () => {
    const { iframe, frame } = opaqueFrame();
    const other = opaqueFrame();
    const adapter = bridgePlaybackAdapter(iframe)!;
    fromFrame(frame, { type: "timeline", durationSeconds: 12, clips: [] });
    fromFrame(frame, { type: "state", currentTime: 3.5, isPlaying: true });
    fromFrame(other.frame, { type: "state", currentTime: 9, isPlaying: false });
    fromFrame(frame, { type: "state", currentTime: Number.NaN, isPlaying: true });
    expect(adapter.getDuration()).toBe(12);
    expect(adapter.getTime()).toBe(3.5);
    expect(adapter.isPlaying()).toBe(true);
  });
});

describe("a display read asked while a gesture is held", () => {
  /** A frame whose agent is known, so each request leaves in its caller's step; returns the kinds in arrival order. */
  async function connectedFrame() {
    const { iframe, handed } = servedFrame((kind) =>
      kind === "draft" ? { drafts: {} } : { errors: [], truncated: false },
    );
    await previewRequest(iframe, "set-loop-start", { seconds: 0 });
    handed.mockClear();
    const arrived = () =>
      handed.mock.calls.map(([kind, params]) =>
        kind === "draft" ? "draft" : `read ${(params as { from: number }).from}`,
      );
    return { iframe, arrived };
  }
  const gestures: Array<{ held: boolean }> = [];
  afterEach(() => gestures.splice(0).forEach((gesture) => (gesture.held = false)));
  const holdFor = (gesture: { held: boolean }) => {
    gestures.push(gesture);
    holdRefreshReadsWhile(() => gesture.held);
  };
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  // fails without the fix: the refresh read went out first and the frame answered it before the draft.
  it("leaves just after the gesture's next draft", async () => {
    const { iframe, arrived } = await connectedFrame();
    holdFor({ held: true });
    const read = previewRequest(iframe, "console-errors", { from: 0 }, undefined, "behind-drafts");
    const draft = previewRequest(iframe, "draft", { drafts: [] });
    await Promise.all([read, draft]);
    expect(arrived()).toEqual(["draft", "read 0"]);
  });

  it("does not hold a read its caller did not mark: it leaves at once, ahead of a held one", async () => {
    const { iframe, arrived } = await connectedFrame();
    holdFor({ held: true });
    const held = previewRequest(iframe, "console-errors", { from: 1 }, undefined, "behind-drafts");
    const now = previewRequest(iframe, "console-errors", { from: 2 });
    await Promise.all([held, now]);
    expect(arrived()).toEqual(["read 2", "read 1"]);
  });

  it("still leaves on the next frame when no draft comes, so a panel never freezes", async () => {
    const { iframe, arrived } = await connectedFrame();
    holdFor({ held: true });
    const read = previewRequest(iframe, "console-errors", { from: 0 }, undefined, "behind-drafts");
    await nextFrame();
    await read;
    expect(arrived()).toEqual(["read 0"]);
  });

  it("leaves when its gesture ends, without waiting for a frame that a hidden tab never runs", async () => {
    const { iframe, arrived } = await connectedFrame();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const gesture = { held: true };
    holdFor(gesture);
    let sent = false;
    void previewRequest(iframe, "console-errors", { from: 0 }, undefined, "behind-drafts").then(
      () => (sent = true),
    );
    gesture.held = false;
    releaseEndedGestureHolds();
    await vi.waitFor(() => expect(sent).toBe(true), { timeout: 1000 });
    expect(arrived()).toEqual(["read 0"]);
    vi.mocked(window.requestAnimationFrame).mockRestore();
  });

  it("is not held once the gesture ends", async () => {
    const { iframe, arrived } = await connectedFrame();
    const gesture = { held: true };
    holdFor(gesture);
    gesture.held = false;
    const read = previewRequest(iframe, "console-errors", { from: 0 }, undefined, "behind-drafts");
    const draft = previewRequest(iframe, "draft", { drafts: [] });
    await Promise.all([read, draft]);
    expect(arrived()).toEqual(["read 0", "draft"]);
  });
});
