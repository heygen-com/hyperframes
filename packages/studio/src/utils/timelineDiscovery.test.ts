import { describe, expect, it } from "vitest";
import {
  TIMELINE_TOGGLE_SHORTCUT_LABEL,
  getTimelineToggleTitle,
  shouldHandleTimelineToggleHotkey,
} from "./timelineDiscovery";

describe("shouldHandleTimelineToggleHotkey", () => {
  it("accepts Shift+T when focus is not inside an editor", () => {
    expect(
      shouldHandleTimelineToggleHotkey({
        key: "T",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: {
          tagName: "DIV",
          isContentEditable: false,
          closest: () => null,
        },
      } as KeyboardEvent),
    ).toBe(true);
  });

  it("ignores the shortcut inside text inputs", () => {
    expect(
      shouldHandleTimelineToggleHotkey({
        key: "t",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: {
          tagName: "TEXTAREA",
          isContentEditable: false,
          closest: () => null,
        },
      } as KeyboardEvent),
    ).toBe(false);
  });

  it("ignores the shortcut inside contenteditable editors", () => {
    expect(
      shouldHandleTimelineToggleHotkey({
        key: "t",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: {
          tagName: "DIV",
          isContentEditable: true,
          closest: () => null,
        },
      } as KeyboardEvent),
    ).toBe(false);
  });

  it("requires Shift without other modifiers", () => {
    expect(
      shouldHandleTimelineToggleHotkey({
        key: "t",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: null,
      } as KeyboardEvent),
    ).toBe(false);

    expect(
      shouldHandleTimelineToggleHotkey({
        key: "t",
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        target: null,
      } as KeyboardEvent),
    ).toBe(false);
  });
});

describe("getTimelineToggleTitle", () => {
  it("includes the shortcut in both show and hide titles", () => {
    expect(getTimelineToggleTitle(true)).toContain(TIMELINE_TOGGLE_SHORTCUT_LABEL);
    expect(getTimelineToggleTitle(false)).toContain(TIMELINE_TOGGLE_SHORTCUT_LABEL);
  });
});
