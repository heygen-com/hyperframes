import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WatchCallback = (eventType: string, filename: string | Buffer | null) => void;

const mockWatcher = new EventEmitter() as EventEmitter & { close: () => void };
mockWatcher.close = vi.fn();

const fakeDirs = { children: [] as string[], unwatchable: "" };

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    watch: vi.fn((path: string, _options: unknown, onChange: WatchCallback) => {
      if (fakeDirs.unwatchable && path.endsWith(fakeDirs.unwatchable)) {
        throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      }
      mockWatcher.on("change", onChange);
      return mockWatcher;
    }),
    readdirSync: vi.fn((path: string) =>
      path === "/fake/project/dir"
        ? fakeDirs.children.map((name) => ({ name, isDirectory: () => true }))
        : [],
    ),
  };
});

const { shouldWatchProjectFile, createProjectWatcher } = await import("./fileWatcher.js");
const { watch } = await import("node:fs");

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
    fakeDirs.children = [];
    fakeDirs.unwatchable = "";
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
    vi.advanceTimersByTime(29);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(listener.mock.calls).toEqual([["scene-a.html"], ["scene-b.html"]]);
    projectWatcher.close();
  });

  it.runIf(process.platform === "linux")(
    "keeps watching the rest of the tree when one subdirectory cannot be watched",
    () => {
      fakeDirs.children = ["full", "compositions"];
      fakeDirs.unwatchable = "full";
      const projectWatcher = createProjectWatcher("/fake/project/dir");

      expect(vi.mocked(watch).mock.calls.map(([path]) => path)).toContain(
        "/fake/project/dir/compositions",
      );
      projectWatcher.close();
      expect(mockWatcher.close).toHaveBeenCalled();
    },
  );

  it("degrades to no live reload when the project root cannot be watched", () => {
    fakeDirs.unwatchable = "/fake/project/dir";
    let projectWatcher: ReturnType<typeof createProjectWatcher> | null = null;
    expect(() => {
      projectWatcher = createProjectWatcher("/fake/project/dir");
    }).not.toThrow();
    expect(() => projectWatcher?.close()).not.toThrow();
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
