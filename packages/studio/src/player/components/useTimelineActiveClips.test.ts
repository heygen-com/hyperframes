// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { updateTimelineActiveClipClasses } from "./useTimelineActiveClips";

function appendClip(container: HTMLElement, id: string, start: string, end: string): HTMLElement {
  const clip = document.createElement("div");
  clip.dataset.clip = "true";
  clip.dataset.elId = id;
  clip.dataset.clipStart = start;
  clip.dataset.clipEnd = end;
  container.append(clip);
  return clip;
}

describe("updateTimelineActiveClipClasses", () => {
  it("toggles data-active only for clips containing the current time", () => {
    const container = document.createElement("div");
    const intro = appendClip(container, "intro", "0", "2");
    const hero = appendClip(container, "hero", "2", "5");
    const outro = appendClip(container, "outro", "5", "8");
    const previous = new Set<string>();

    updateTimelineActiveClipClasses(container, previous, 2.25);

    expect(intro.hasAttribute("data-active")).toBe(false);
    expect(hero.hasAttribute("data-active")).toBe(true);
    expect(outro.hasAttribute("data-active")).toBe(false);
    expect(previous).toEqual(new Set(["hero"]));
  });

  it("never marks hidden clips active inside their time window", () => {
    const container = document.createElement("div");
    const hidden = appendClip(container, "hidden", "0", "5");
    const visible = appendClip(container, "visible", "0", "5");
    hidden.dataset.clipHidden = "true";
    const previous = new Set<string>();

    updateTimelineActiveClipClasses(container, previous, 2);

    expect(hidden.hasAttribute("data-active")).toBe(false);
    expect(visible.hasAttribute("data-active")).toBe(true);
    expect(previous).toEqual(new Set(["visible"]));
  });

  it("diffs against the previous active set", () => {
    const container = document.createElement("div");
    const intro = appendClip(container, "intro", "0", "2");
    const hero = appendClip(container, "hero", "2", "5");
    const previous = new Set(["intro"]);
    intro.toggleAttribute("data-active", true);

    updateTimelineActiveClipClasses(container, previous, 2);

    expect(intro.hasAttribute("data-active")).toBe(true);
    expect(hero.hasAttribute("data-active")).toBe(true);
    expect(previous).toEqual(new Set(["intro", "hero"]));
  });

  it("keeps a clip active through its inclusive end boundary", () => {
    const container = document.createElement("div");
    const intro = appendClip(container, "intro", "0", "2");
    const previous = new Set<string>();

    updateTimelineActiveClipClasses(container, previous, 0);

    expect(intro.hasAttribute("data-active")).toBe(true);
    expect(previous).toEqual(new Set(["intro"]));

    updateTimelineActiveClipClasses(container, previous, 2);

    expect(intro.hasAttribute("data-active")).toBe(true);
    expect(previous).toEqual(new Set(["intro"]));

    updateTimelineActiveClipClasses(container, previous, 2.001);

    expect(intro.hasAttribute("data-active")).toBe(false);
    expect(previous).toEqual(new Set());
  });

  it("re-applies data-active to a fresh DOM node that stayed active across a re-render", () => {
    // A clip that moves lanes on a reorder remounts as a new element. It stays
    // in the previous active set, so the plain diff would skip it and leave the
    // new node without data-active. syncAll must force the attribute on.
    const container = document.createElement("div");
    appendClip(container, "hero", "0", "5");
    const previous = new Set<string>();
    updateTimelineActiveClipClasses(container, previous, 2);
    expect(previous).toEqual(new Set(["hero"]));

    // Simulate a remount: replace the hero clip's DOM node (no data-active).
    container.replaceChildren();
    const heroReborn = appendClip(container, "hero", "0", "5");
    expect(heroReborn.hasAttribute("data-active")).toBe(false);

    // Diff-only would skip it (still active → unchanged); syncAll re-applies.
    updateTimelineActiveClipClasses(container, previous, 2, true);
    expect(heroReborn.hasAttribute("data-active")).toBe(true);
  });

  it("ignores clips with invalid timing data", () => {
    const container = document.createElement("div");
    const missingId = appendClip(container, "", "0", "2");
    const missingTiming = appendClip(container, "bad", "", "2");
    const previous = new Set<string>();

    updateTimelineActiveClipClasses(container, previous, 1);

    expect(missingId.hasAttribute("data-active")).toBe(false);
    expect(missingTiming.hasAttribute("data-active")).toBe(false);
    expect(previous).toEqual(new Set());
  });
});
