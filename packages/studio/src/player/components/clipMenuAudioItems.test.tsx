// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { ClipMenuAudioItems } from "./clipMenuAudioItems";
import type { TimelineElement } from "../store/timelineElement";

const showToast = vi.fn();
const setQuiet = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {});
const iframe = document.createElement("iframe");

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContextOptional: () => ({
    projectId: "p1",
    showToast,
    previewIframeRef: { current: iframe },
  }),
}));
vi.mock("../../contexts/TimelineEditContext", () => ({
  useTimelineEditContextOptional: () => ({ onSetElementAttributeQuiet: setQuiet }),
}));

const harness = createHappyDomRootHarness();

function render(element: TimelineElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() =>
    harness.mount(host).render(<ClipMenuAudioItems element={element} onClose={() => {}} />),
  );
  return host;
}

const base = { start: 0, duration: 4, track: 0 };
const plan = { targetLufs: -16, projectedLufs: -16, volume: 2, changeDb: 6, limitedBy: null };
const clickItem = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  await act(async () => button?.click());
};

beforeEach(() => {
  showToast.mockClear();
  setQuiet.mockReset();
  setQuiet.mockResolvedValue(undefined);
});

describe("ClipMenuAudioItems", () => {
  it("offers nothing on a muted video", () => {
    const host = render({ ...base, id: "b", tag: "video", hasAudio: true, muted: true });
    expect(host.textContent).toBe("");
  });

  it("normalizes a video with sound by writing data-volume as one edit", async () => {
    const plan = { targetLufs: -16, projectedLufs: -16, volume: 2, changeDb: 6, limitedBy: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ plan })),
    );
    const element: TimelineElement = {
      ...base,
      id: "a-roll",
      tag: "video",
      hasAudio: true,
      src: "talk.mp4",
    };
    const host = render(element);
    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Normalize loudness"),
    );
    await act(async () => button?.click());
    await vi.waitFor(() => expect(setQuiet).toHaveBeenCalled());
    expect(setQuiet).toHaveBeenCalledWith(element, "data-volume", "2", "Normalize loudness");
    expect(showToast).toHaveBeenCalledWith("Normalized to −16 LUFS (+6.0 dB)", "info");
    vi.unstubAllGlobals();
  });

  it("refuses to normalize a clip whose volume lane owns its gain", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ plan }));
    vi.stubGlobal("fetch", fetchSpy);
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 0.25 }] }],
    });
    const host = render({ ...base, id: "vo", tag: "audio", src: "vo.mp3", automation });
    await clickItem(host, "Normalize loudness");
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("volume is automated"), "error");
    expect(setQuiet).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports a failed save instead of claiming the clip was normalized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ plan })),
    );
    setQuiet.mockResolvedValue({ status: "failed", reason: "disk full" });
    const host = render({ ...base, id: "vo", tag: "audio", src: "vo.mp3" });
    await clickItem(host, "Normalize loudness");
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("disk full", "error"));
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("Normalized"), "info");
    vi.unstubAllGlobals();
  });

  it("stops ducking at the first refused save and says why", async () => {
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("fixture");
    doc.body.innerHTML = `<audio id="music" src="music.mp3" data-start="0" data-duration="10"></audio>
      <audio id="voiceover" src="vo.wav" data-start="1" data-duration="3"></audio>`;
    setQuiet.mockResolvedValue({
      status: "refused",
      reason: "Cannot edit timeline while recording",
    });
    const host = render({ ...base, id: "music", tag: "audio", src: "music.mp3" });
    await clickItem(host, "Duck under voice");
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Cannot edit timeline while recording", "error"),
    );
    expect(setQuiet).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("Ducks under"), "info");
    iframe.remove();
  });
});
