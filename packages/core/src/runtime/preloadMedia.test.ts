import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import { unproxiedSrc } from "./proxySrc";
import {
  deferMediaUntilDue,
  giveBackWhenDue,
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

  it("keeps a clip whose whole file is buffered", () => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    Object.defineProperty(video, "duration", { value: 6.67 });
    Object.defineProperty(video, "buffered", {
      value: { length: 1, start: () => 0, end: () => 6.67 },
    });
    video.load = vi.fn();

    releaseMedia(video);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.getAttribute("src")).toBe("a.mp4");
  });

  it("frees a clip whose whole file is buffered when asked to", () => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    Object.defineProperty(video, "duration", { value: 6.67 });
    Object.defineProperty(video, "buffered", {
      value: { length: 1, start: () => 0, end: () => 6.67 },
    });
    video.load = vi.fn();

    releaseMedia(video, true);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.getAttribute("src")).toBe("a.mp4");
  });

  it.each([
    [0, 15],
    [430, 2642],
  ])("releases a clip with only %s-%s s of a long file buffered", (from, to) => {
    const video = document.createElement("video");
    video.setAttribute("src", "a.mp4");
    Object.defineProperty(video, "duration", { value: 2642 });
    Object.defineProperty(video, "buffered", {
      value: { length: 1, start: () => from, end: () => to },
    });
    video.load = vi.fn();

    releaseMedia(video);
    expect(video.load).toHaveBeenCalledTimes(1);
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
  afterEach(() => vi.restoreAllMocks());
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

  it("does not prepare an audio clip's source offset outside WebKit", () => {
    const element = document.createElement("audio");
    element.setAttribute("data-media-start", "6");
    element.load = vi.fn();
    document.body.appendChild(element);

    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(0);
    element.remove();
  });

  it("prepares an upcoming audio clip's source offset in WebKit, so the cut has no seek to wait for", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    );
    const element = document.createElement("audio");
    element.setAttribute("data-media-start", "6");
    element.load = vi.fn();
    document.body.appendChild(element);

    prepareUpcomingMedia(element, () => true);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBeCloseTo(6, 3);
    element.remove();
  });
});

describe("a clip of a long file opening at its in-point on Safari", () => {
  const SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
  let meta: HTMLMetaElement;
  let seq = 0;
  const stopWatching = () =>
    (window as Window & { __hfMediaDeferral?: MutationObserver }).__hfMediaDeferral?.disconnect();
  const inPlayer = (on: boolean) => {
    const frame = document.createElement("iframe");
    if (on) frame.setAttribute("data-hf-player-frame", "");
    Object.defineProperty(window, "frameElement", { value: frame, configurable: true });
  };
  const sizeOf = (bytes: number | "unreadable") =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (bytes === "unreadable") throw new TypeError("blocked");
        return new Response(null, {
          status: 206,
          headers: { "content-range": `bytes 0-0/${bytes}` },
        });
      }),
    );
  beforeEach(() => {
    meta = document.createElement("meta");
    meta.name = "hyperframes-studio-preview";
    document.head.appendChild(meta);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI);
    inPlayer(true);
    sizeOf(68_000_000);
    deferMediaUntilDue();
  });
  afterEach(() => {
    stopWatching();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "frameElement");
    meta.remove();
    document.body.replaceChildren();
  });

  // Each test names its own file: the size of a file is asked once per page.
  const clip = (attrs = 'data-media-start="30"', start = "0") =>
    `<video src="/m/film-${seq++}.mp4" data-start="${start}" data-duration="2" ${attrs}></video>`;
  const later = () => clip('data-media-start="30"', "4");
  async function added(html: string): Promise<HTMLVideoElement> {
    document.body.insertAdjacentHTML("beforeend", html);
    await Promise.resolve();
    return document.body.lastElementChild as HTMLVideoElement;
  }
  const opened = (v: HTMLVideoElement) => v.getAttribute("src")!.includes("#t=");

  it("gets a start fragment and keeps its authored src for everything that reads it", async () => {
    const v = await added(clip());
    const authored = v.getAttribute("src")!;
    await vi.waitFor(() => expect(v.getAttribute("src")).toBe(`${authored}#t=30`));
    expect(unproxiedSrc(v)).toBe(authored);
  });

  it("holds a later clip with no src, still naming its file, until it is due", async () => {
    const v = await added(later());
    const authored = v.getAttribute("src")!;
    await vi.waitFor(() => expect(v.getAttribute("src")).toBeNull());
    expect(unproxiedSrc(v)).toBe(authored);
    giveBackWhenDue(v);
    expect(v.getAttribute("src")).toBe(`${authored}#t=30`);
  });

  it("opens a later clip WebKit already began reading at its in-point, and gives its preload back", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "networkState", "get").mockReturnValue(2);
    const v = await added(later());
    await vi.waitFor(() => expect(opened(v)).toBe(true));
    expect(v.preload).not.toBe("none");
  });

  it("leaves the preload of a small file's clip parsed before the runtime as authored", async () => {
    sizeOf(5_600_000);
    stopWatching();
    document.body.insertAdjacentHTML("beforeend", later());
    const v = document.body.lastElementChild as HTMLVideoElement;
    const authored = v.preload;
    deferMediaUntilDue();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(v.preload).toBe(authored);
  });

  it("holds a later clip of a long file parsed before the runtime", async () => {
    stopWatching();
    document.body.insertAdjacentHTML("beforeend", later());
    const v = document.body.lastElementChild as HTMLVideoElement;
    deferMediaUntilDue();
    await vi.waitFor(() => expect(v.getAttribute("src")).toBeNull());
  });

  it.each([
    ["playing", "paused", false],
    ["seeking", "seeking", true],
  ])(
    "leaves the src of a later clip already %s when its file's size arrives",
    async (_n, prop, value) => {
      document.body.insertAdjacentHTML("beforeend", later());
      const v = document.body.lastElementChild as HTMLVideoElement;
      const authored = v.getAttribute("src");
      Object.defineProperty(v, prop, { value, configurable: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(v.getAttribute("src")).toBe(authored);
    },
  );

  it("holds a later clip again when it is released after playing", async () => {
    const v = await added(later());
    await vi.waitFor(() => expect(v.getAttribute("src")).toBeNull());
    giveBackWhenDue(v);
    releaseMedia(v, true);
    expect(v.getAttribute("src")).toBeNull();
  });

  it("does not hold a later clip a binding has given another src", async () => {
    const v = await added(later());
    v.setAttribute("src", "/m/bound.mp4");
    await new Promise((r) => setTimeout(r, 10));
    expect(v.getAttribute("src")).toBe("/m/bound.mp4");
  });

  it("does so for a clip already parsed when the runtime arrives", async () => {
    stopWatching();
    document.body.insertAdjacentHTML("beforeend", clip());
    deferMediaUntilDue();
    const v = document.body.lastElementChild as HTMLVideoElement;
    await vi.waitFor(() => expect(opened(v)).toBe(true));
  });

  it("stops reporting the authored src once something else sets the src", async () => {
    const v = await added(clip());
    await vi.waitFor(() => expect(opened(v)).toBe(true));
    v.setAttribute("src", "/m/other.mp4");
    expect(unproxiedSrc(v)).toBe("/m/other.mp4");
  });

  it("is left alone when its file is small, so a short film loads exactly as before", async () => {
    sizeOf(5_600_000);
    const v = await added(later());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(opened(v)).toBe(false);
    expect(v.preload).toBe("none");
  });

  it("is left alone when the size of its file cannot be read", async () => {
    sizeOf("unreadable");
    const v = await added(clip());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(opened(v)).toBe(false);
  });

  it.each([
    ["starts at the head of the file", 'data-media-start="0"'],
    ["loops", 'data-media-start="30" loop'],
  ])("is left alone when it %s", async (_name, attrs) => {
    const v = await added(clip(attrs));
    await new Promise((r) => setTimeout(r, 10));
    expect(opened(v)).toBe(false);
  });

  it("is left alone in Studio's preview, which copies and saves what it reads from the page", async () => {
    inPlayer(false);
    const v = await added(clip());
    await new Promise((r) => setTimeout(r, 10));
    expect(opened(v)).toBe(false);
  });

  it("is left alone off Safari", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME);
    const v = await added(clip());
    await new Promise((r) => setTimeout(r, 10));
    expect(opened(v)).toBe(false);
  });
});
