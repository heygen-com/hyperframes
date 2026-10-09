import { describe, expect, it, vi } from "vitest";
import { preloadMedia, prepareUpcomingMedia, releaseMedia } from "./preloadMedia";

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
  it("reloads a src clip with its src dropped, then puts the src back", () => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    const atLoad: (string | null)[] = [];
    video.load = () => atLoad.push(video.getAttribute("src"));

    releaseMedia(video);
    expect(atLoad).toEqual([null]);
    expect(video.getAttribute("src")).toBe("a.mp4");
  });

  it("leaves a clip on <source> children, their order and its markup untouched", () => {
    const video = document.createElement("video");
    video.innerHTML =
      '\n  <track kind="captions">\n  <source src="b.webm">\n  <source src="b.mp4">\n';
    const markup = video.innerHTML;
    video.load = vi.fn();

    releaseMedia(video);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.innerHTML).toBe(markup);
  });
});

describe("preparing upcoming video playback", () => {
  function video() {
    const element = document.createElement("video");
    element.setAttribute("data-media-start", "6");
    element.load = vi.fn();
    document.body.appendChild(element);
    return element;
  }

  it("does not overwrite an in-flight seek", () => {
    const element = video();
    Object.defineProperty(element, "readyState", { value: 1 });
    Object.defineProperty(element, "seeking", { value: true });
    element.currentTime = 7;

    prepareUpcomingMedia(element, () => true);
    expect(element.currentTime).toBe(7);
    element.remove();
  });

  it("prepares a clip again after its resource was released and reloaded", () => {
    const element = video();
    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(6);
    element.currentTime = 0;
    releaseMedia(element);

    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(6);
    element.remove();
  });

  it("cancels preparation when the clip leaves the preload window", () => {
    const element = video();
    prepareUpcomingMedia(element, () => true);
    releaseMedia(element);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(0);
    element.remove();
  });

  it("reads the current offset after metadata instead of an offset from an earlier edit", () => {
    const element = video();
    prepareUpcomingMedia(element, () => true);
    element.setAttribute("data-media-start", "8");
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(8);
    element.remove();
  });

  it("does not seek a detached clip when its metadata arrives", () => {
    const element = video();
    prepareUpcomingMedia(element, () => true);
    element.remove();
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(0);
  });

  it("does not prepare an audio clip's source offset", () => {
    const element = document.createElement("audio");
    element.setAttribute("data-media-start", "6");
    element.load = vi.fn();
    document.body.appendChild(element);

    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(0);
    element.remove();
  });
});
