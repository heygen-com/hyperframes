import { describe, expect, it, vi } from "vitest";
import { OwnedMediaRegistry } from "./owned-media-registry.js";

describe("OwnedMediaRegistry", () => {
  it("installs one abortable listener set and rebinds when the stable key changes", () => {
    const video = document.createElement("video");
    const onAction = vi.fn();
    const registry = new OwnedMediaRegistry(["play", "pause"] as const, onAction);

    registry.sync([{ key: "slide-a", el: video }]);
    registry.sync([{ key: "slide-a", el: video }]);
    video.dispatchEvent(new Event("play"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenLastCalledWith(video, "slide-a", "play");

    registry.sync([{ key: "slide-b", el: video }]);
    video.dispatchEvent(new Event("pause"));
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenLastCalledWith(video, "slide-b", "pause");

    registry.sync([]);
    video.dispatchEvent(new Event("play"));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("mutates and pauses only the currently owned media", () => {
    const owned = document.createElement("video");
    const unrelated = document.createElement("video");
    owned.pause = vi.fn();
    unrelated.pause = vi.fn();
    const registry = new OwnedMediaRegistry(["play"] as const, vi.fn());
    registry.sync([{ key: "owned", el: owned }]);

    registry.setMuted(true);
    registry.pauseAll();

    expect(owned.muted).toBe(true);
    expect(owned.pause).toHaveBeenCalledTimes(1);
    expect(unrelated.muted).toBe(false);
    expect(unrelated.pause).not.toHaveBeenCalled();
  });

  it("aborts every listener when the slideshow disconnects", () => {
    const audio = document.createElement("audio");
    const onAction = vi.fn();
    const registry = new OwnedMediaRegistry(["play"] as const, onAction);
    registry.sync([{ key: "audio", el: audio }]);

    registry.clear();
    audio.dispatchEvent(new Event("play"));

    expect(onAction).not.toHaveBeenCalled();
  });
});
