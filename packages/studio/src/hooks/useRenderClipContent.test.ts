// @vitest-environment happy-dom

import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CompositionThumbnail, VideoThumbnail } from "../player";
import { AudioWaveform } from "../player/components/AudioWaveform";
import type { TimelineElement } from "../player/store/playerStore";
import { normalizeCompositionSrc } from "./useRenderClipContent";
import { useRenderClipContent } from "./useRenderClipContent";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("normalizeCompositionSrc", () => {
  const origin = "http://localhost:5190";
  const pid = "my-project";

  it("strips absolute preview URL to relative path", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/my-project/preview/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe("compositions/intro.html");
  });

  it("preserves already-relative paths", () => {
    const result = normalizeCompositionSrc("compositions/intro.html", pid, origin);
    expect(result).toBe("compositions/intro.html");
  });

  it("preserves absolute URLs from different origins", () => {
    const result = normalizeCompositionSrc(
      "https://cdn.example.com/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe("https://cdn.example.com/compositions/intro.html");
  });

  it("preserves absolute URLs for different projects", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/other-project/preview/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe(
      "http://localhost:5190/api/projects/other-project/preview/compositions/intro.html",
    );
  });

  it("handles nested composition paths", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/my-project/preview/compositions/scenes/hero.html",
      pid,
      origin,
    );
    expect(result).toBe("compositions/scenes/hero.html");
  });
});

describe("useRenderClipContent", () => {
  function renderClipContent(
    el: TimelineElement,
    activePreviewUrl: string | null = "/api/projects/my-project/preview",
  ): ReactNode {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let content: ReactNode = null;

    function Harness() {
      const render = useRenderClipContent({
        projectIdRef: { current: "my-project" },
        compIdToSrc: new Map(),
        activePreviewUrl,
        effectiveTimelineDuration: 12,
      });
      content = render(el, { clip: "#222", label: "#fff" });
      return null;
    }

    act(() => {
      root.render(React.createElement(Harness));
    });
    act(() => root.unmount());
    return content;
  }

  it("renders audio clips as waveforms even when a composition preview URL is active", () => {
    const content = renderClipContent({
      id: "voiceover",
      tag: "audio",
      start: 1,
      duration: 4,
      track: 1,
      src: "assets/voiceover.mp3",
    });

    expect(isValidElement(content)).toBe(true);
    if (isValidElement(content)) expect(content.type).toBe(AudioWaveform);
  });

  it("passes empty labels to thumbnail content so TimelineClip owns clip names", () => {
    const cases: Array<{ content: ReactNode; type: unknown }> = [
      {
        content: renderClipContent({
          id: "voiceover",
          tag: "audio",
          start: 1,
          duration: 4,
          track: 1,
          src: "assets/voiceover.mp3",
        }),
        type: AudioWaveform,
      },
      {
        content: renderClipContent({
          id: "nested",
          tag: "div",
          start: 0,
          duration: 4,
          track: 0,
          compositionSrc: "compositions/nested.html",
        }),
        type: CompositionThumbnail,
      },
      {
        content: renderClipContent(
          {
            id: "clip-video",
            tag: "video",
            start: 0,
            duration: 4,
            track: 0,
            src: "assets/clip.mp4",
          },
          null,
        ),
        type: VideoThumbnail,
      },
      {
        content: renderClipContent(
          {
            id: "headline",
            tag: "div",
            start: 1,
            duration: 4,
            track: 0,
          },
          null,
        ),
        type: CompositionThumbnail,
      },
    ];

    for (const item of cases) {
      expect(isValidElement<{ label: string }>(item.content)).toBe(true);
      if (isValidElement<{ label: string }>(item.content)) {
        expect(item.content.type).toBe(item.type);
        expect(item.content.props.label).toBe("");
      }
    }
  });
});
