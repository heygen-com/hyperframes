// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { ClipMenuAudioItems } from "./clipMenuAudioItems";
import type { TimelineElement } from "../store/timelineElement";

const showToast = vi.fn();
const setQuiet = vi.fn(async () => {});
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
});
