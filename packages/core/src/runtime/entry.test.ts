// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { HF_COLOR_GRADING_ATTR, serializeHfColorGrading } from "../colorGrading";
import { STUDIO_PREVIEW_LAZY_ATTR, STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import type { RuntimeTimelineLike } from "./types";

function pausedTimeline(duration: number): RuntimeTimelineLike {
  let time = 0;
  return {
    play: () => {},
    pause: () => {},
    seek: (t?: number) => (t === undefined ? time : (time = t)),
    totalTime: (t?: number) => (t === undefined ? time : (time = t)),
    time: () => time,
    duration: () => duration,
    add: () => {},
    paused: () => true,
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function timed<K extends keyof HTMLElementTagNameMap>(
  parent: Element,
  tag: K,
  start: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = "clip";
  el.setAttribute("data-start", start);
  el.setAttribute("data-duration", "2");
  el.setAttribute("data-track-index", "1");
  parent.appendChild(el);
  return el;
}

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", "main");
  root.setAttribute("data-root", "true");
  root.setAttribute("data-start", "0");
  root.setAttribute("data-width", "1920");
  root.setAttribute("data-height", "1080");
  document.body.appendChild(root);
  window.__timelines = { main: pausedTimeline(10) };
  return root;
}

async function evaluateRuntime(): Promise<void> {
  vi.resetModules();
  await import("./entry");
}

function resetRuntimeGlobals(): void {
  vi.useRealTimers();
  window.__hfRuntimeTeardown?.();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.__timelines = {};
  delete window.__player;
  delete window.__playerReady;
  delete window.__renderReady;
  delete window.__hfTimelinesBuilding;
  const win = window as {
    __hyperframeRuntimeBootstrapped?: boolean;
    __hfFirstPassHidden?: boolean;
  };
  delete win.__hyperframeRuntimeBootstrapped;
  delete win.__hfFirstPassHidden;
  delete (document as { readyState?: unknown }).readyState;
}

// The first evaluation transforms the whole runtime graph. Paying it while the file loads keeps
// that one-time cost out of the first test's timeout; every test still evaluates a fresh copy.
await evaluateRuntime();
resetRuntimeGlobals();

const visibility = (...els: HTMLElement[]) => els.map((el) => getComputedStyle(el).visibility);
const imageSkipped = (...clips: HTMLElement[]) =>
  clips.map((clip) => getComputedStyle(clip.querySelector("img")!).display === "none");
const withImage = <T extends HTMLElement>(clip: T): T => {
  clip.appendChild(document.createElement("img"));
  return clip;
};
// What Studio's preview route serves at the head start; render and player documents never carry it.
const servePreview = () =>
  document.head.appendChild(
    Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
  );
const neverDecodes = (clip: HTMLElement) => {
  withImage(clip).querySelector("img")!.decode = () => new Promise<void>(() => {});
  return clip;
};

describe("runtime entry", () => {
  afterEach(resetRuntimeGlobals);

  it("drives an async frame source without a GSAP timeline and waits before capture", async () => {
    const root = mountRoot();
    root.setAttribute("data-duration", "10");
    root.appendChild(document.createElement("div"));
    window.__timelines = {};
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    await evaluateRuntime();
    expect(window.__hyperframes!.createFilmBridge).toEqual(expect.any(Function));
    let finish!: () => void;
    const first = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const render = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    window.__hyperframes!.registerFrameSource({ element: root, render });
    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    window.__player!.seek(1.2);
    let captured = false;
    const capture = window.__hfWaitForSeekCompletion!().then(() => {
      captured = true;
    });
    await Promise.resolve();
    expect(captured).toBe(false);
    finish();
    await capture;
    expect(render).toHaveBeenLastCalledWith(1.2, expect.any(AbortSignal));
  });

  it("paints no timed clip, from script evaluation until the first visibility pass decides it", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = timed(root, "div", "5");
    const poster = timed(root, "img", "0");
    // Studio serves later scenes' images lazy; laid out, they would load before the first pass.
    const plate = later.appendChild(document.createElement("img"));
    plate.setAttribute("loading", "lazy");
    // A composition script may write visibility inline before the runtime runs.
    later.style.visibility = "visible";
    // Readiness, which runs the first pass, waits while GSAP batches timelines.
    window.__hfTimelinesBuilding = true;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });

    await evaluateRuntime();
    expect(window.__player).toBeUndefined();
    expect(visibility(current, later)).toEqual(["hidden", "hidden"]);
    expect(getComputedStyle(plate).display).toBe("none");

    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(window.__renderReady).toBe(false);
    expect(visibility(current, later, poster)).toEqual(["hidden", "hidden", "visible"]);

    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    expect(window.__renderReady).toBe(true);
    expect(visibility(current, later, poster)).toEqual(["visible", "hidden", "visible"]);
    expect(document.querySelector("style[data-hf-first-pass-hide]")).toBeNull();
  });

  it("gives a render document neither rule, no look-ahead marks and no held seeks", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = neverDecodes(timed(root, "div", "5"));
    const plate = later.querySelector("img")!;
    plate.setAttribute("loading", "lazy");
    window.__hfTimelinesBuilding = true;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });

    await evaluateRuntime();
    // A setup-time measure of an authored lazy image must see it laid out.
    expect(getComputedStyle(plate).display).not.toBe("none");
    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    window.__player?.seek(3.5);
    expect(imageSkipped(later)).toEqual([false]);
    expect(document.querySelector("[data-hf-upcoming]")).toBeNull();
    window.__player?.seek(5.5);
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
  });

  it("keys preview mode on the preview meta alone, not on the GSAP fallback script captures keep", async () => {
    document.head
      .appendChild(document.createElement("script"))
      .setAttribute("data-hf-gsap-fallback", "");
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = neverDecodes(timed(root, "div", "5"));
    const plate = later.querySelector("img")!;
    plate.setAttribute("loading", "lazy");
    window.__hfTimelinesBuilding = true;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });

    await evaluateRuntime();
    expect(getComputedStyle(plate).display).not.toBe("none");
    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    expect(document.querySelector("style[data-hf-skip-hidden-images]")).toBeNull();
    window.__player?.seek(3.5);
    expect(imageSkipped(later)).toEqual([false]);
    expect(document.querySelector("[data-hf-upcoming]")).toBeNull();
    expect(window.__player?.seek(5.5)).toBeUndefined();
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
  });

  it("skips the images of each hidden clip not due within the look-ahead, until something shows it", async () => {
    servePreview();
    const root = mountRoot();
    const current = withImage(timed(root, "div", "0"));
    const soon = withImage(timed(root, "div", "1.5"));
    const later = withImage(timed(root, "div", "5"));
    // Shorter than the look-ahead: due within it, though already over at its far end.
    const brief = withImage(timed(root, "div", "5"));
    brief.setAttribute("data-duration", "0.5");

    await evaluateRuntime();
    expect(imageSkipped(current, soon, later, brief)).toEqual([false, false, true, true]);
    window.__player?.seek(3.6);
    expect(imageSkipped(later, brief)).toEqual([false, false]);
    window.__player?.seek(0);
    // How Studio's layer reveal shows a hidden clip.
    later.style.visibility = "visible";
    expect(imageSkipped(later)).toEqual([false]);
  });

  it("loads the next scene's images within the look-ahead while its clip is still hidden", async () => {
    servePreview();
    const root = mountRoot();
    timed(root, "div", "0");
    const soon = timed(root, "div", "1.5");
    const later = timed(root, "div", "5");
    const lazyPlate = (clip: HTMLElement) => {
      const img = clip.appendChild(document.createElement("img"));
      img.setAttribute("loading", "lazy");
      img.setAttribute(STUDIO_PREVIEW_LAZY_ATTR, "");
      return img;
    };
    const plate = lazyPlate(soon);
    const farPlate = lazyPlate(later);
    // A clip nested in the coming one waits for its own look-ahead.
    const nestedPlate = lazyPlate(timed(soon, "div", "8"));
    const authored = soon.appendChild(document.createElement("img"));
    authored.setAttribute("loading", "lazy");

    await evaluateRuntime();
    expect(visibility(soon)).toEqual(["hidden"]);
    expect(
      [plate, farPlate, nestedPlate, authored].map((img) => img.getAttribute("loading")),
    ).toEqual(["eager", "lazy", "lazy", "lazy"]);
    window.__player?.seek(3.5);
    expect(farPlate.getAttribute("loading")).toBe("eager");
  });

  it("holds a paused jump on the previous picture until the next scene's image decodes", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = timed(root, "div", "5");
    const plate = later.appendChild(document.createElement("img"));
    plate.setAttribute("loading", "lazy");
    plate.setAttribute(STUDIO_PREVIEW_LAZY_ATTR, "");
    let decoded = () => {};
    plate.decode = () => new Promise<void>((resolve) => (decoded = resolve));
    const authored = later.appendChild(document.createElement("img"));
    authored.setAttribute("loading", "lazy");
    authored.decode = () => Promise.resolve();

    await evaluateRuntime();
    expect(window.__player?.seek(0.5)).toBeUndefined();
    const landed = window.__player?.seek(5.5);
    expect(landed).toBeInstanceOf(Promise);
    // Any frame painted now shows the previous scene, while the next one is unskipped so its image loads.
    expect(visibility(current, later)).toEqual(["visible", "hidden"]);
    expect(imageSkipped(later)).toEqual([false]);
    expect(window.__player?.getTime()).toBe(5.5);
    expect([plate, authored].map((img) => img.getAttribute("loading"))).toEqual(["eager", "lazy"]);
    decoded();
    await landed;
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
    await window.__hfWaitForSeekCompletion?.();
  });

  it("applies a held jump after the cap when an image never decodes", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = timed(root, "div", "5");
    later.appendChild(document.createElement("img")).decode = () => new Promise<void>(() => {});

    await evaluateRuntime();
    const swallowed: string[] = [];
    window.__hf = {
      ...window.__hf,
      onSwallowed: ({ label }: { label: string }) => swallowed.push(label),
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    window.__player?.seek(5.5);
    await vi.advanceTimersByTimeAsync(999);
    expect(visibility(current, later)).toEqual(["visible", "hidden"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
    expect(swallowed).toEqual(["runtime.init.seekHoldCap"]);
  });

  it("drops a held jump when a newer seek or a render seek lands first", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const mid = timed(root, "div", "1");
    const later = timed(root, "div", "5");
    const plate = later.appendChild(document.createElement("img"));
    let decoded = () => {};
    plate.decode = () => new Promise<void>((resolve) => (decoded = resolve));

    await evaluateRuntime();
    window.__player?.seek(5.5);
    window.__player?.seek(1);
    expect(visibility(current, mid, later)).toEqual(["visible", "visible", "hidden"]);
    decoded();
    await window.__hfWaitForSeekCompletion?.();
    expect(visibility(current, mid, later)).toEqual(["visible", "visible", "hidden"]);
    expect(window.__player?.getTime()).toBe(1);

    window.__player?.seek(0);
    window.__player?.seek(5.5);
    window.__player?.renderSeek(1);
    decoded();
    await window.__hfWaitForSeekCompletion?.();
    expect(visibility(current, mid, later)).toEqual(["visible", "visible", "hidden"]);
  });

  it("never holds a render seek", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = neverDecodes(timed(root, "div", "5"));

    await evaluateRuntime();
    window.__player?.renderSeek(5.5);
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
  });

  it("shows the jump target at once when play is pressed during the hold", async () => {
    servePreview();
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = timed(root, "div", "5");
    later.appendChild(document.createElement("img")).decode = () => new Promise<void>(() => {});

    await evaluateRuntime();
    window.__player?.seek(5.5);
    window.__player?.play();
    expect(visibility(current, later)).toEqual(["hidden", "visible"]);
  });

  it("leaves nothing hidden when the runtime is evaluated a second time", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");

    await evaluateRuntime();
    await evaluateRuntime();
    // Paused and never sought: no later pass would lift a rule the second copy added.
    expect(visibility(root, current)).toEqual(["visible", "visible"]);
    expect(document.querySelectorAll("style[data-hf-first-pass-hide]")).toHaveLength(0);
  });

  describe("media preload window", () => {
    const loads: HTMLMediaElement[] = [];
    const spyLoad = () => {
      loads.length = 0;
      vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
        function (this: HTMLMediaElement) {
          loads.push(this);
        },
      );
    };
    const loadsOf = (...els: HTMLMediaElement[]) =>
      els.map((el) => loads.filter((loaded) => loaded === el).length);
    const videos = (root: HTMLElement, ...starts: string[]) =>
      starts.map((start) => timed(root, "video", start));
    const armed = (...els: HTMLMediaElement[]) => els.map((el) => el.preload === "auto");
    afterEach(() => vi.restoreAllMocks());

    it("loads a preview's media only on screen or due within the look-ahead, and frees what the playhead left", async () => {
      spyLoad();
      servePreview();
      const [now, soon, later] = videos(mountRoot(), "0", "1.5", "9");

      await evaluateRuntime();
      expect(armed(now, soon, later)).toEqual([true, true, false]);
      expect(later.preload).toBe("none");
      expect(loadsOf(now, soon, later)).toEqual([1, 1, 0]);

      now.setAttribute("src", "now.mp4");
      const srcWrites = new MutationObserver(() => {});
      srcWrites.observe(now, { attributeFilter: ["src"] });
      window.__player?.seek(7.6);
      expect(armed(now, soon, later)).toEqual([false, false, true]);
      // The two that left are reloaded empty with src dropped for the reload, ending any fetch in flight.
      expect([now.preload, soon.preload]).toEqual(["none", "none"]);
      expect(loadsOf(now, soon, later)).toEqual([2, 2, 1]);
      expect(srcWrites.takeRecords()).toHaveLength(2);
      expect(now.getAttribute("src")).toBe("now.mp4");
    });

    it("loads a clip with no authored length as a render does, so no reload drops its duration", async () => {
      spyLoad();
      servePreview();
      const [untrimmed, later] = videos(mountRoot(), "0", "8");
      untrimmed.removeAttribute("data-duration");
      later.removeAttribute("data-duration");
      Object.defineProperty(untrimmed, "readyState", { value: 1 });
      Object.defineProperty(untrimmed, "duration", { value: 2 });

      await evaluateRuntime();
      window.__player?.seek(3.6);
      window.__player?.seek(0.5);
      window.__player?.seek(7.5);
      expect(armed(untrimmed, later)).toEqual([true, true]);
      expect(loadsOf(untrimmed, later)).toEqual([1, 1]);
    });

    it("arms a clip a far jump lands on without reloading it under the seek", async () => {
      spyLoad();
      servePreview();
      const [now, later] = videos(mountRoot(), "0", "8");

      await evaluateRuntime();
      const beforeJump = loadsOf(later)[0];
      window.__player?.seek(8.4);
      expect(armed(now, later)).toEqual([false, true]);
      expect(loadsOf(later)).toEqual([beforeJump]);
    });

    // jsdom's media elements cannot play; the runtime only needs play() to settle.
    const stubPlayback = () => {
      vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    };
    const tracks = (root: HTMLElement) => {
      stubPlayback();
      const [now, next, afterNext, otherTrack] = videos(root, "0", "4", "7", "3");
      otherTrack.setAttribute("data-track-index", "2");
      return { now, next, afterNext, otherTrack };
    };

    it("arms the next clip on a clip's track when it starts playing, and nothing else", async () => {
      spyLoad();
      servePreview();
      const { next, afterNext, otherTrack } = tracks(mountRoot());

      await evaluateRuntime();
      window.__player?.play();
      expect(armed(next, afterNext, otherTrack)).toEqual([true, false, false]);
      expect(loadsOf(next, afterNext, otherTrack)).toEqual([1, 0, 0]);
    });

    it("arms nothing ahead of a paused playhead, and keeps what it armed through a pause", async () => {
      spyLoad();
      servePreview();
      const { next, afterNext } = tracks(mountRoot());

      await evaluateRuntime();
      window.__player?.seek(0.5);
      expect(armed(next)).toEqual([false]);
      window.__player?.play();
      window.__player?.pause();
      expect(armed(next, afterNext)).toEqual([true, false]);
      expect(loadsOf(next)).toEqual([1]);
    });

    it("holds a clip past the look-ahead edge a scrub crosses, and frees it once well clear", async () => {
      spyLoad();
      servePreview();
      const [, later] = videos(mountRoot(), "0", "5");

      await evaluateRuntime();
      window.__player?.seek(3.5);
      window.__player?.seek(2.5);
      window.__player?.seek(3.5);
      expect(armed(later)).toEqual([true]);
      expect(loadsOf(later)).toEqual([1]);
      window.__player?.seek(0.5);
      expect(armed(later)).toEqual([false]);
    });

    it("keeps the clip a step back across a cut returns to loaded", async () => {
      spyLoad();
      servePreview();
      const [outgoing, incoming] = videos(mountRoot(), "0", "2");

      await evaluateRuntime();
      window.__player?.seek(2.1);
      expect(armed(outgoing, incoming)).toEqual([true, true]);
      window.__player?.seek(1.9);
      expect(armed(outgoing)).toEqual([true]);
      expect(loadsOf(outgoing)).toEqual([1]);
    });

    it("arms a clip behind a playhead shuttling back before the playhead reaches it", async () => {
      spyLoad();
      servePreview();
      const [earlier, current] = videos(mountRoot(), "0", "2");
      current.setAttribute("data-duration", "6");

      await evaluateRuntime();
      window.__player?.seek(6.5);
      expect(armed(earlier)).toEqual([false]);
      let armedAt: number | undefined;
      for (let tenths = 45; tenths >= 20 && armedAt === undefined; tenths--) {
        window.__player?.seek(tenths / 10);
        if (armed(earlier)[0]) armedAt = tenths / 10;
      }
      // Within the 2 s look-ahead of its end, as a clip ahead is armed within 2 s of its start.
      expect(armedAt).toBe(4);
    });

    it("still frees a clip that ended well behind the playhead", async () => {
      spyLoad();
      servePreview();
      const [earlier, current] = videos(mountRoot(), "0", "2");
      current.setAttribute("data-duration", "6");

      await evaluateRuntime();
      window.__player?.seek(2.1);
      window.__player?.seek(5.9);
      expect(armed(earlier)).toEqual([true]);
      expect(loadsOf(earlier)).toEqual([1]);
      window.__player?.seek(6.1);
      expect(armed(earlier)).toEqual([false]);
      expect(earlier.preload).toBe("none");
      expect(loadsOf(earlier)).toEqual([2]);
    });

    it("drops an arm once the clip that set it leaves the screen, as a jump while playing does", async () => {
      spyLoad();
      servePreview();
      const { next } = tracks(mountRoot());
      window.__timelines = { main: pausedTimeline(20) };

      await evaluateRuntime();
      window.__player?.play();
      window.__player?.seek(10.5, { keepPlaying: true });
      expect(armed(next)).toEqual([false]);
    });

    it("stops holding a clip it armed once that clip has played", async () => {
      spyLoad();
      servePreview();
      const { next } = tracks(mountRoot());
      window.__timelines = { main: pausedTimeline(20) };

      await evaluateRuntime();
      window.__player?.play();
      window.__player?.seek(4.5, { keepPlaying: true });
      window.__player?.seek(10.5, { keepPlaying: true });
      expect(armed(next)).toEqual([false]);
    });

    it("arms a clip that starts exactly where the playing one ends", async () => {
      spyLoad();
      servePreview();
      stubPlayback();
      // 1.1 + 2.2 is 3.3000000000000003: back to back only within the boundary tolerance.
      const [first, second] = videos(mountRoot(), "1.1", "3.3");
      first.setAttribute("data-duration", "2.2");

      await evaluateRuntime();
      window.__player?.seek(1.2);
      window.__player?.play();
      expect(armed(second)).toEqual([true]);
    });

    it("arms the next clip only in the same host and on an authored track", async () => {
      spyLoad();
      servePreview();
      stubPlayback();
      const root = mountRoot();
      const [now] = videos(root, "0");
      const host = timed(root, "div", "0");
      host.setAttribute("data-composition-id", "inner");
      host.setAttribute("data-duration", "10");
      const [otherHost] = videos(host, "4");
      const [untracked, untrackedNext] = videos(root, "0", "4");
      for (const el of [untracked, untrackedNext]) el.removeAttribute("data-track-index");
      now.setAttribute("data-track-index", "1");

      await evaluateRuntime();
      window.__player?.play();
      expect(armed(otherHost, untrackedNext)).toEqual([false, false]);
    });

    it("arms a short nested clip whose start is already root time before it is due", async () => {
      spyLoad();
      servePreview();
      const host = timed(mountRoot(), "div", "5");
      host.setAttribute("data-composition-id", "inner");
      host.setAttribute("data-duration", "5");
      const [clip] = videos(host, "6");
      clip.setAttribute("data-hf-media-start-basis", "global");
      clip.setAttribute("data-duration", "0.4");

      await evaluateRuntime();
      window.__player?.seek(4.5);
      expect(armed(clip)).toEqual([true]);
    });

    it("keeps the clips due at the loop start loaded while the loop plays", async () => {
      spyLoad();
      servePreview();
      const { now, next, afterNext } = tracks(mountRoot());
      window.__timelines = { main: pausedTimeline(20) };

      await evaluateRuntime();
      window.__hf?.setLoopStart?.(0);
      window.__player?.play();
      window.__player?.seek(19.5, { keepPlaying: true });
      expect(armed(now, next, afterNext)).toEqual([true, true, false]);
      expect(loadsOf(now, next)).toEqual([1, 1]);
      window.__hf?.setLoopStart?.(null);
      window.__player?.seek(19.6, { keepPlaying: true });
      expect(armed(now)).toEqual([false]);
    });

    it("holds the loop start only while playing, and for a loop start that is a time", async () => {
      spyLoad();
      servePreview();
      const { now } = tracks(mountRoot());

      await evaluateRuntime();
      window.__hf?.setLoopStart?.(0);
      window.__player?.play();
      window.__player?.seek(9.5, { keepPlaying: true });
      window.__player?.pause();
      expect(armed(now)).toEqual([false]);
      window.__hf?.setLoopStart?.(-1);
      window.__player?.play();
      expect(armed(now)).toEqual([false]);
    });

    it("never arms a next clip with no authored length, so it is not reloaded", async () => {
      spyLoad();
      servePreview();
      const { next } = tracks(mountRoot());
      next.removeAttribute("data-duration");

      await evaluateRuntime();
      const atBind = loadsOf(next)[0];
      window.__player?.play();
      expect(loadsOf(next)).toEqual([atBind]);
    });

    it("keeps an armed next clip through a window pass that finds it outside the look-ahead", async () => {
      spyLoad();
      servePreview();
      const { next } = tracks(mountRoot());

      await evaluateRuntime();
      window.__player?.play();
      window.__player?.seek(0.5, { keepPlaying: true });
      expect(armed(next)).toEqual([true]);
      expect(loadsOf(next)).toEqual([1]);
    });

    it("gives each parsed clip after the first frame preload none before it can fetch", async () => {
      servePreview();
      const root = mountRoot();
      timed(root, "div", "0");
      await evaluateRuntime();
      const [first, later] = videos(root, "0", "5");
      const untrimmed = timed(root, "audio", "5");
      untrimmed.removeAttribute("data-duration");
      await Promise.resolve();
      expect([first.preload, later.preload, untrimmed.preload]).toEqual(["", "none", ""]);
    });

    it("keeps a render loading every media element at bind", async () => {
      spyLoad();
      const [now, soon, later] = videos(mountRoot(), "0", "1.5", "5");

      await evaluateRuntime();
      window.__player?.seek(3.6);
      expect(armed(now, soon, later)).toEqual([true, true, true]);
      expect(loadsOf(now, soon, later)).toEqual([1, 1, 1]);
      const parsedLater = timed(document.body, "video", "5");
      await Promise.resolve();
      expect(parsedLater.preload).not.toBe("none");
      expect((window as { __hfMediaDeferral?: unknown }).__hfMediaDeferral).toBeUndefined();
    });
  });

  it("grades media inside a clip once the first pass shows the clip, with no seek", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const scene = timed(mountRoot(), "div", "0");
    // Untimed: the video inherits the scene's window, so no pass writes its visibility.
    const video = document.createElement("video");
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ adjust: { exposure: 0.5 } }),
    );
    Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "videoHeight", { value: 360 });
    scene.appendChild(video);

    await evaluateRuntime();

    expect(window.__renderReady).toBe(true);
    expect(getContext.mock.calls.some(([type]) => String(type).startsWith("webgl"))).toBe(true);
    getContext.mockRestore();
  });
});
