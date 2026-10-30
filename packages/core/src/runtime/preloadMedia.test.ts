import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import {
  isRenderFrameVideo,
  preloadMedia,
  prepareUpcomingMedia,
  releaseMedia,
} from "./preloadMedia";

function media(tagName = "VIDEO", networkState = 2, readyState = 0, id = "", renderId = "") {
  const getAttribute = (name: string) => (name === "data-hf-render-id" && renderId) || null;
  return {
    id,
    tagName,
    getAttribute,
    networkState,
    readyState,
    preload: "metadata",
    load: vi.fn(),
  };
}

describe("a video the render replaces with extracted frames", () => {
  const ids = window as Window & { __HF_RENDER_FRAME_VIDEO_IDS?: readonly string[] };
  afterEach(() => delete ids.__HF_RENDER_FRAME_VIDEO_IDS);

  it("is neither preloaded nor loaded", () => {
    ids.__HF_RENDER_FRAME_VIDEO_IDS = ["cut"];
    const video = media("VIDEO", 0, 0, "cut");
    video.preload = "none";
    preloadMedia(video);
    expect(video.preload).toBe("none");
    expect(video.load).not.toHaveBeenCalled();
    expect(isRenderFrameVideo(video)).toBe(true);
  });

  it("does not seek a replaced video's source offset", () => {
    ids.__HF_RENDER_FRAME_VIDEO_IDS = ["cut"];
    const video = document.createElement("video");
    video.id = "cut";
    video.setAttribute("data-media-start", "6");
    document.body.appendChild(video);

    prepareUpcomingMedia(video, () => true);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(0);
    video.remove();
  });

  it("leaves other videos and audio with the same id to the eager preload", () => {
    ids.__HF_RENDER_FRAME_VIDEO_IDS = ["cut"];
    const other = media("VIDEO", 0, 0, "live");
    const audio = media("AUDIO", 0, 0, "cut");
    preloadMedia(other);
    preloadMedia(audio);
    expect(other.preload).toBe("auto");
    expect(audio.preload).toBe("auto");
  });
});

describe("a video id shared by two scenes", () => {
  const ids = window as Window & { __HF_RENDER_FRAME_VIDEO_IDS?: readonly string[] };
  afterEach(() => delete ids.__HF_RENDER_FRAME_VIDEO_IDS);

  it("holds only the one whose render id is replaced", () => {
    ids.__HF_RENDER_FRAME_VIDEO_IDS = ["clip"];
    const replaced = media("VIDEO", 0, 0, "clip", "clip");
    const live = media("VIDEO", 0, 0, "clip", "clip__hf2");
    preloadMedia(replaced);
    preloadMedia(live);
    expect(isRenderFrameVideo(replaced)).toBe(true);
    expect(isRenderFrameVideo(live)).toBe(false);
    expect(live.preload).toBe("auto");
  });
});

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
    expect(element.currentTime).toBe(mediaElementTime(6));
    element.currentTime = 0;
    releaseMedia(element);

    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(mediaElementTime(6));
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
    expect(element.currentTime).toBe(mediaElementTime(8));
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
