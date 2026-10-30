import { afterEach, expect, it, vi } from "vitest";
import { registerSeekCompletion } from "./adapters/seek-dispatch";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

it("asks the on-screen video for the jump's frame before rendering the page there", () => {
  resetRuntimeFixtureDom();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="60"><video id="clip" data-start="30" data-duration="10" src="/movie.mp4"></video></div>';
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { value: 10, configurable: true });
  Object.defineProperty(video, "readyState", { value: 1, configurable: true });
  Object.defineProperty(video, "paused", { value: true, configurable: true });
  video.pause = vi.fn();
  video.load = vi.fn();
  const order: string[] = [];
  vi.spyOn(video, "currentTime", "set").mockImplementation(() => order.push("video"));
  const main = createMockTimeline(60);
  const seekMain = main.totalTime;
  main.totalTime = (time?: number) => {
    if (time !== undefined) order.push("page");
    return seekMain(time);
  };
  window.__timelines = { main };
  initSandboxRuntimeModular();
  order.length = 0;
  window.__player!.seek(35);
  expect(order[0]).toBe("video");
  expect(order).toContain("page");
});

function mountTimingFilm() {
  resetRuntimeFixtureDom();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  const step = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      for (const callback of frames.splice(0)) callback(performance.now());
      vi.advanceTimersByTime(20);
    }
  };
  const posts: string[] = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === "timeline") posts.push(type);
  });
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="60"><div id="clip" data-start="30" data-duration="10"></div></div>';
  window.__timelines = { main: createMockTimeline(60) };
  initSandboxRuntimeModular();
  step(40);
  let land = () => {};
  registerSeekCompletion(new Promise<void>((resolve) => (land = resolve)));
  posts.length = 0;
  const editTiming = async () => {
    document.getElementById("clip")!.setAttribute("data-duration", "12");
    await Promise.resolve();
    step(40);
  };
  return { step, posts, land: () => land(), editTiming };
}

it("posts the clip list once a jump has landed, not while it lands", async () => {
  const film = mountTimingFilm();
  window.__player!.seek(35);
  await film.editTiming();
  expect(film.posts).toHaveLength(0);
  film.land();
  await vi.waitFor(() => {
    film.step();
    expect(film.posts).toHaveLength(1);
  });
  vi.useRealTimers();
});

it("posts at once when nothing was jumped to, so readers at load see the clip list", async () => {
  const film = mountTimingFilm();
  await film.editTiming();
  expect(film.posts.length).toBeGreaterThanOrEqual(1);
  film.land();
  vi.useRealTimers();
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
