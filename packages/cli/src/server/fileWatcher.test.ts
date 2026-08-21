import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WatchCallback = (eventType: string, filename: string | Buffer | null) => void;

const mockWatcher = new EventEmitter() as EventEmitter & { close: () => void };
mockWatcher.close = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    watch: vi.fn((_path: string, _options: unknown, onChange: WatchCallback) => {
      mockWatcher.on("change", onChange);
      return mockWatcher;
    }),
  };
});

const { shouldWatchProjectFile, createProjectWatcher } = await import("./fileWatcher.js");

describe("shouldWatchProjectFile", () => {
  it("watches files that can affect the project signature", () => {
    expect(shouldWatchProjectFile("index.html")).toBe(true);
    expect(shouldWatchProjectFile("src/scene.tsx")).toBe(true);
    expect(shouldWatchProjectFile("assets/hero.png")).toBe(true);
    expect(shouldWatchProjectFile("Dockerfile")).toBe(true);
  });

  it("skips generated and dependency directories", () => {
    expect(shouldWatchProjectFile("node_modules/pkg/index.js")).toBe(false);
    expect(shouldWatchProjectFile("renders/output.mp4")).toBe(false);
    expect(shouldWatchProjectFile("dist/index.html")).toBe(false);
    expect(shouldWatchProjectFile(".hyperframes/cache.json")).toBe(false);
    expect(shouldWatchProjectFile(".transcode-cache/proxy.mp4")).toBe(false);
    expect(shouldWatchProjectFile(".thumbnails/frame.jpg")).toBe(false);
    expect(shouldWatchProjectFile(".waveform-cache/peaks.json")).toBe(false);
  });
});

describe("createProjectWatcher", () => {
  beforeEach(() => {
    mockWatcher.removeAllListeners();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("notifies once for every file changed in one debounce burst", () => {
    vi.useFakeTimers();
    const projectWatcher = createProjectWatcher("/fake/project/dir");
    const listener = vi.fn();
    projectWatcher.addListener(listener);

    mockWatcher.emit("change", "change", "scene-a.html");
    mockWatcher.emit("change", "change", "scene-b.html");
    mockWatcher.emit("change", "change", "scene-a.html");
    vi.advanceTimersByTime(300);

    expect(listener.mock.calls).toEqual([["scene-a.html"], ["scene-b.html"]]);
    projectWatcher.close();
  });

  // Regression: fs.watch can fail asynchronously (e.g. EMFILE from exhausted
  // OS watch handles) via an 'error' event, not a thrown exception. An
  // EventEmitter 'error' with no listener crashes the whole process — this
  // must degrade gracefully instead, per the sibling synchronous-failure path.
  it("does not crash the process when the underlying watcher emits 'error'", () => {
    createProjectWatcher("/fake/project/dir");
    expect(() => mockWatcher.emit("error", new Error("EMFILE"))).not.toThrow();
    expect(mockWatcher.close).toHaveBeenCalled();
  });
});
