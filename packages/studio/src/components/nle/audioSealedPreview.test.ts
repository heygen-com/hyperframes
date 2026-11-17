// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { usePlayerStore, type TimelineElement } from "../../player";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { useSetAudioGroupAttribute } from "../../hooks/timelineAudioGroupVolume";
import { AudioMeterStrip } from "./AudioMeterStrip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MeterWindow = Window & { __hf?: Record<string, unknown> };

const closers: Array<() => void> = [];
const roots: Root[] = [];
let frames: FrameRequestCallback[] = [];
const tick = () => {
  const run = frames;
  frames = [];
  act(() => run.forEach((cb) => cb(performance.now())));
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  useAudioMetersVisible.setState({ visible: true });
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  closers.splice(0).forEach((close) => close());
  delete (window as MeterWindow).__hf;
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

const member = (domId: string): TimelineElement => ({
  id: domId,
  key: `compositions/voices.html#${domId}`,
  domId,
  tag: "audio",
  start: 0,
  duration: 5,
  track: 0,
  audioGroup: "vo",
  audioGroupVolume: 1,
});

const VOICES = `<section data-composition-id="voices">
  <audio id="voice-1" data-audio-group="vo"></audio>
  <hf-audio-group id="vo" data-volume="1"></hf-audio-group>
</section>`;

function stubProjectFiles(files: Map<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const content = files.get(decodeURIComponent(url.slice(url.lastIndexOf("/") + 1)));
      return new Response(JSON.stringify({ content }), {
        status: content === undefined ? 404 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

it("meter moves + group volume sealed", async () => {
  document.body.innerHTML = `<main data-composition-id="root">
    <div id="voices-host" data-composition-id="voices-host" data-composition-file="compositions/voices.html">${VOICES}</div>
  </main>`;
  const groupEl = document.getElementById("vo")!;
  const meter = {
    start: vi.fn(),
    stop: vi.fn(),
    read: vi.fn(() => ({ master: { l: 1, r: 1 }, groups: { vo: { l: 1, r: 1 } } })),
  };
  (window as MeterWindow).__hf = { audioMeter: meter };
  usePlayerStore.getState().setElements([member("voice-1")]);
  const iframe = opaqueFrame();

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(AudioMeterStrip, { previewIframeRef: { current: iframe } })));
  const masks = [...host.querySelectorAll<HTMLElement>("[data-testid=meter-mask]")];
  expect(masks).toHaveLength(4);
  await vi.waitFor(() => {
    tick();
    expect(masks.map((mask) => mask.style.height)).toEqual(["0%", "0%", "0%", "0%"]);
  });
  expect(meter.start).toHaveBeenCalled();
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  await vi.waitFor(() => expect(meter.stop).toHaveBeenCalled());

  stubProjectFiles(new Map([["compositions/voices.html", VOICES]]));
  const writes = new Map<string, string>();
  const held: { setter: ReturnType<typeof useSetAudioGroupAttribute> | null } = { setter: null };
  function Probe() {
    held.setter = useSetAudioGroupAttribute({
      projectIdRef: { current: "project-1" },
      activeCompPath: "index.html",
      showToast: vi.fn(),
      writeProjectFile: async (path, content) => void writes.set(path, content),
      recordEdit: async () => {},
      pendingTimelineEditPathRef: { current: new Set() },
      previewIframeRef: { current: iframe },
    });
    return null;
  }
  const probeRoot = createRoot(document.createElement("div"));
  roots.push(probeRoot);
  act(() => probeRoot.render(createElement(Probe)));
  const setter = held.setter!;

  setter.setLive("vo", "data-volume", "0.5");
  setter.setLive("vo", "data-volume", "0.4");
  await vi.waitFor(() => expect(groupEl.getAttribute("data-volume")).toBe("0.4"));
  expect(usePlayerStore.getState().elements[0]?.audioGroupVolume).toBeCloseTo(0.4, 6);

  await expect(setter.setQuiet("vo", "data-volume", "0.25", "Set volume")).resolves.toEqual({
    status: "saved",
  });
  expect([...writes.keys()]).toEqual(["compositions/voices.html"]);
  expect(writes.get("compositions/voices.html")).toContain(
    '<hf-audio-group id="vo" data-volume="0.25">',
  );
  await vi.waitFor(() => expect(groupEl.getAttribute("data-volume")).toBe("0.25"));
});
