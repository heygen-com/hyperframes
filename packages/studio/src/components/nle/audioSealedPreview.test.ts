// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../../player";
import { ClipMenuAudioItems } from "../../player/components/clipMenuAudioItems";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import { createAudioGroupAndAssignMembers } from "../../hooks/timelineAudioGroupCreate";
import { mintGroupId } from "../editor/useFxCarveGrouping";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { useSetAudioGroupAttribute } from "../../hooks/timelineAudioGroupVolume";
import { previewDocumentCopy } from "../../player/lib/previewChannel";
import { AudioMeterStrip } from "./AudioMeterStrip";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MeterWindow = Window & { __hf?: Record<string, unknown> };

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
  delete (window as MeterWindow).__hf;
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
  usePreviewIframeStore.setState({ iframe: null });
  document.body.innerHTML = "";
});

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
  const iframe = sealedPreviewFrame().iframe;

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

it("groups clips in a sealed preview, and unwinds the preview when the save fails", async () => {
  document.body.innerHTML = `<main data-composition-id="root">
    <audio id="voice-1" data-audio-group="old"></audio><audio id="voice-2"></audio>
  </main>`;
  const iframe = sealedPreviewFrame().iframe;
  const files = new Map([["index.html", document.body.innerHTML]]);
  stubProjectFiles(files);
  const elements = ["voice-1", "voice-2"].map((domId) => ({
    ...member(domId),
    key: `index.html#${domId}`,
    audioGroup: undefined,
  }));
  const input = {
    projectId: "project-1",
    activeCompPath: "index.html",
    elements,
    groupId: "vo",
    groupLabel: "Voice",
    previewIframe: iframe,
    recordEdit: async () => {},
    pendingTimelineEditPathRef: { current: new Set<string>() },
  };
  const groupOf = (id: string) => document.getElementById(id)!.getAttribute("data-audio-group");

  await expect(
    createAudioGroupAndAssignMembers({
      ...input,
      writeProjectFile: async () => {
        expect([groupOf("voice-1"), groupOf("voice-2")]).toEqual(["vo", "vo"]);
        expect(document.querySelector("hf-audio-group#vo")?.getAttribute("data-label")).toBe(
          "Voice",
        );
        throw new Error("disk full");
      },
    }),
  ).rejects.toThrow("disk full");
  expect([groupOf("voice-1"), groupOf("voice-2")]).toEqual(["old", null]);
  expect(document.getElementById("vo")).toBeNull();

  await createAudioGroupAndAssignMembers({ ...input, writeProjectFile: async () => {} });
  expect([groupOf("voice-1"), groupOf("voice-2")]).toEqual(["vo", "vo"]);
  expect(document.querySelector("hf-audio-group#vo")).not.toBeNull();
});

it("ends a sealed group's undo cleanly when the frame's reply is not the shape it asked for", async () => {
  document.body.innerHTML = `<main data-composition-id="root">
    <audio id="voice-1"></audio><audio id="voice-2"></audio>
  </main>`;
  // Studio's end of the port, with the group reply's `previous` replaced as a broken frame might send it.
  const brokenReplies = (port: MessagePort) =>
    ({
      postMessage: (data: unknown) => port.postMessage(data),
      start: () => port.start(),
      close: () => port.close(),
      get onmessage() {
        return port.onmessage;
      },
      set onmessage(listener: ((event: MessageEvent) => void) | null) {
        port.onmessage =
          listener &&
          ((event) => {
            const result = (event.data as { result?: Record<string, unknown> }).result;
            if (result && "previous" in result) result.previous = null;
            listener(event);
          });
      },
    }) as unknown as MessagePort;
  const iframe = sealedPreviewFrame({ wrapHandedOverPort: brokenReplies }).iframe;
  stubProjectFiles(new Map([["index.html", document.body.innerHTML]]));
  const elements = ["voice-1", "voice-2"].map((domId) => ({
    ...member(domId),
    key: `index.html#${domId}`,
    audioGroup: undefined,
  }));
  await expect(
    createAudioGroupAndAssignMembers({
      projectId: "project-1",
      activeCompPath: "index.html",
      elements,
      groupId: "vo",
      groupLabel: "Voice",
      previewIframe: iframe,
      recordEdit: async () => {},
      pendingTimelineEditPathRef: { current: new Set<string>() },
      writeProjectFile: async () => {
        throw new Error("disk full");
      },
    }),
  ).rejects.toThrow("disk full");
});

it("reads a sealed preview's groups and ids off an inert copy", async () => {
  document.body.innerHTML = `<audio id="voiceover"></audio><audio id="music" src="bed.wav"></audio>`;
  const copy = await previewDocumentCopy(sealedPreviewFrame().iframe);
  expect(copy).not.toBeNull();
  expect(copy).not.toBe(document);
  expect(mintGroupId(copy!)).toBe("voiceover-2");
  expect(copy!.baseURI).toBe(document.baseURI);
});

it("offers Duck under voice for a bed in a sealed preview", async () => {
  document.body.innerHTML = `<main data-composition-id="root">
    <audio id="music" src="bed.wav" data-start="0" data-duration="10"></audio>
    <audio id="voiceover" src="vo.wav" data-start="1" data-duration="2"></audio>
  </main>`;
  const iframe = sealedPreviewFrame().iframe;
  usePreviewIframeStore.setState({ iframe });
  usePlayerStore.getState().beginTimelineSession("project-1");
  const bed: TimelineElement = {
    id: "music",
    domId: "music",
    tag: "audio",
    start: 0,
    duration: 10,
    track: 0,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const value = {
    onSetElementAttributeQuiet: vi.fn(async () => ({ status: "saved" as const })),
    onNotice: vi.fn(),
  };
  act(() =>
    root.render(
      createElement(
        TimelineEditProvider,
        { value },
        createElement(ClipMenuAudioItems, { part: "duck", element: bed, onClose: () => {} }),
      ),
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Duck under voice"));
});
