import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockTimeline,
  installImmediateAnimationFrame,
  resetRuntimeFixtureDom,
  stubDuration,
} from "./runtimeSeekFixture.test-helpers";

const resolverSpy = vi.hoisted(() => ({ constructions: 0 }));
const mediaSpy = vi.hoisted(() => ({ beforeSync: null as null | (() => void) }));

vi.mock("./startResolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startResolver")>();
  return {
    ...actual,
    createRuntimeStartTimeResolver: (
      params: Parameters<typeof actual.createRuntimeStartTimeResolver>[0],
    ) => {
      resolverSpy.constructions += 1;
      return actual.createRuntimeStartTimeResolver(params);
    },
  };
});

vi.mock("./media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media")>();
  return {
    ...actual,
    syncRuntimeMedia: (params: Parameters<typeof actual.syncRuntimeMedia>[0]) => {
      mediaSpy.beforeSync?.();
      return actual.syncRuntimeMedia(params);
    },
  };
});

const { initSandboxRuntimeModular } = await import("./init");

describe("runtime timing resolver scoping", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    resetRuntimeFixtureDom();
    installImmediateAnimationFrame();
    resolverSpy.constructions = 0;
    mediaSpy.beforeSync = null;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    mediaSpy.beforeSync = null;
    delete window.__player;
    delete window.__playerReady;
  });

  /** One seek plus one transport tick: between them they drive all three
   *  scopes (media cache, visibility pass, media-window duration scan). */
  const passWithMediaCount = (count: number): number => {
    const frames: FrameRequestCallback[] = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    const flushFrame = () => frames.splice(0, frames.length).forEach((callback) => callback(0));

    const clips = Array.from(
      { length: count },
      (_, i) => `<video id="clip${i}" data-start="${i}" data-duration="1"></video>`,
    ).join("");
    document.body.innerHTML = `<div data-composition-id="main" data-root="true">${clips}</div>`;
    for (const video of document.querySelectorAll("video")) {
      stubDuration(video as HTMLVideoElement, 1);
    }
    window.__timelines = { main: createMockTimeline(count) };
    initSandboxRuntimeModular();
    // Let the runtime bind its timeline, so the tick below takes the
    // duration-resolution branch rather than short-circuiting.
    flushFrame();

    resolverSpy.constructions = 0;
    window.__player?.renderSeek(0.5);
    flushFrame();
    return resolverSpy.constructions;
  };

  // Non-vacuity: this is the whole point of the change. Every resolver carries
  // WeakMap caches, so building one per call means a seek re-walks the ancestor
  // chain of every element. Before the fix this count grew with media count
  // (~7 constructions per media element); after it, it is flat.
  it("builds a constant number of timing resolvers per seek, not one per element", () => {
    const few = passWithMediaCount(2);
    const many = passWithMediaCount(12);

    expect(many).toBe(few);
    // A ceiling, so a future caller that reintroduces per-element construction
    // inside a scope fails here even if it happens to be element-count-flat.
    expect(many).toBeLessThanOrEqual(6);
  });

  // The two scopes exist because `syncRuntimeMedia` can call `el.load()` on its
  // seek-past-buffered-range retry, which synchronously resets `el.duration`.
  // One scope spanning the media pass would serve the pre-`load()` duration to
  // the visibility pass that runs after it.
  it("resolves a post-load() duration in the visibility pass, not the cached pre-load() one", () => {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true">` +
      // `lead`'s duration is read (and cached) while the media cache is built,
      // because `follower`'s start is expressed relative to it.
      `<video id="lead" data-start="0"></video>` +
      `<audio id="follower" data-start="lead + 0" data-duration="1"></audio>` +
      `</div>`;
    const lead = document.querySelector<HTMLVideoElement>("#lead")!;
    const follower = document.querySelector<HTMLAudioElement>("#follower")!;
    const leadDuration = stubDuration(lead, 10);
    stubDuration(follower, 1);
    window.__timelines = {};
    initSandboxRuntimeModular();

    // Stands in for the `el.load()` the seek-retry performs: the source turns
    // out to be shorter than the metadata first reported.
    mediaSpy.beforeSync = () => leadDuration.set(2);

    window.__player?.renderSeek(2.5);

    // Fresh read => follower starts at 2 and is on screen at 2.5.
    // Stale cache => follower starts at 10 and is hidden.
    expect(follower.style.visibility).toBe("visible");
  });
});
