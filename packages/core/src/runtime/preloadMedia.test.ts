import { describe, expect, it, vi } from "vitest";
import { preloadMedia, releaseMedia } from "./preloadMedia";

function media(tagName = "VIDEO", networkState = 2, readyState = 0) {
  return { tagName, networkState, readyState, preload: "metadata", load: vi.fn() };
}

describe("initial media preload", () => {
  it.each([0, 1, 2])(
    "keeps an active video fetch at readyState %s while enabling eager preload",
    (readyState) => {
      const video = media("VIDEO", 2, readyState);
      preloadMedia(video);
      expect(video.preload).toBe("auto");
      expect(video.load).not.toHaveBeenCalled();
    },
  );
  it.each([0, 1, 3])("starts or retries incomplete video at networkState %s", (networkState) => {
    const video = media("VIDEO", networkState);
    preloadMedia(video);
    expect(video.preload).toBe("auto");
    expect(video.load).toHaveBeenCalledOnce();
  });
  it("preserves audio loading while a streaming source is still being fetched", () => {
    const audio = media("AUDIO");
    preloadMedia(audio);
    expect(audio.preload).toBe("auto");
    expect(audio.load).toHaveBeenCalledOnce();
  });
  it.each(["VIDEO", "AUDIO"])("does not reset ready %s media", (tagName) => {
    const element = media(tagName, 1, 3);
    preloadMedia(element);
    expect(element.preload).toBe("auto");
    expect(element.load).not.toHaveBeenCalled();
  });
});

describe("releasing a clip's download", () => {
  it("reloads with no src and no <source>, then puts both back in order", () => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    const sources = ["b.webm", "b.mp4"].map((src) =>
      Object.assign(document.createElement("source"), { src }),
    );
    video.append(...sources, document.createElement("track"));
    const atLoad: string[] = [];
    video.load = () =>
      atLoad.push(`${video.getAttribute("src")} ${video.querySelectorAll("source").length}`);

    releaseMedia(video);
    expect(atLoad).toEqual(["null 0"]);
    expect(video.getAttribute("src")).toBe("a.mp4");
    expect(Array.from(video.children)).toEqual([...sources, video.querySelector("track")]);
  });
});
