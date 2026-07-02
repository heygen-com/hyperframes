import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mockWatcher = new EventEmitter() as EventEmitter & { close: () => void };
mockWatcher.close = vi.fn();

vi.mock("node:fs", () => ({
  watch: vi.fn(() => mockWatcher),
}));

const { shouldWatchProjectFile, createProjectWatcher } = await import("./fileWatcher.js");

describe("shouldWatchProjectFile", () => {
  it("watches files that can affect the project signature", () => {
    expect(shouldWatchProjectFile("index.html")).toBe(true);
    expect(shouldWatchProjectFile("src/scene.tsx")).toBe(true);
    expect(shouldWatchProjectFile("assets/hero.png")).toBe(true);
    expect(shouldWatchProjectFile("Dockerfile")).toBe(true);
  });

  it("skips generated and dependency directories excluded from signatures", () => {
    expect(shouldWatchProjectFile("node_modules/pkg/index.js")).toBe(false);
    expect(shouldWatchProjectFile("renders/output.mp4")).toBe(false);
    expect(shouldWatchProjectFile("dist/index.html")).toBe(false);
    expect(shouldWatchProjectFile(".hyperframes/cache.json")).toBe(false);
  });
});

describe("createProjectWatcher", () => {
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
