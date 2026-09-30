// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { ClipMenuAudioItems } from "./clipMenuAudioItems";
import { usePlayerStore } from "../store/playerStore";
import { usePreviewIframeStore } from "../store/previewIframeStore";
import type { TimelineElement } from "../store/timelineElement";

const onNotice = vi.fn();
const setQuiet = vi.fn(async () => {});

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContextOptional: () => null,
}));
vi.mock("../../contexts/TimelineEditContext", () => ({
  useTimelineEditContextOptional: () => ({ onSetElementAttributeQuiet: setQuiet, onNotice }),
}));

const harness = createHappyDomRootHarness();
const tour: TimelineElement = {
  id: "tour",
  tag: "video",
  start: 0,
  duration: 4,
  track: 0,
  hasAudio: true,
  src: "tour.mp4",
};

function mountPreview(): void {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("iframe has no document");
  doc.body.innerHTML =
    '<video id="tour" src="tour.mp4" data-has-audio="true" data-start="0" data-duration="4"></video>';
  usePreviewIframeStore.getState().setIframe(iframe);
}

function render(part: "normalize" | "duck") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() =>
    harness
      .mount(host)
      .render(<ClipMenuAudioItems part={part} element={tour} onClose={() => {}} />),
  );
  return host;
}

afterEach(() => {
  usePreviewIframeStore.getState().setIframe(null);
  vi.unstubAllGlobals();
});

describe("ClipMenuAudioItems in a host without Studio's shell", () => {
  it("offers Normalize and Duck from the timeline session and the live preview", () => {
    usePlayerStore.getState().beginTimelineSession("p1");
    mountPreview();
    expect(render("normalize").textContent).toContain("Normalize loudness");
    expect(render("duck").textContent).toContain("Duck under voice");
  });

  it("normalizes through the session's project and reports through onNotice", async () => {
    usePlayerStore.getState().beginTimelineSession("p1");
    mountPreview();
    const plan = { targetLufs: -16, projectedLufs: -16, volume: 2, changeDb: 6, limitedBy: null };
    const fetchSpy = vi.fn(async (_url: string) => Response.json({ plan }));
    vi.stubGlobal("fetch", fetchSpy);
    const button = render("normalize").querySelector("button");
    await act(async () => button?.click());
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/projects/p1/loudness/normalize");
    expect(setQuiet).toHaveBeenCalledWith(tour, "data-volume", "2", "Normalize loudness");
    expect(onNotice).toHaveBeenCalledWith("Normalized to −16 LUFS (+6.0 dB)", "info");
  });
});
