import { afterEach, describe, expect, it } from "vitest";
import {
  getSelectedTimelineTrack,
  resetTimelineTrackSelection,
  selectTimelineTrack,
  toggleTimelineTrack,
} from "./useTimelineTrackSelection";

afterEach(() => resetTimelineTrackSelection());

describe("the selected timeline track", () => {
  it("starts with nothing selected", () => {
    expect(getSelectedTimelineTrack()).toBeNull();
  });

  it("selects a lane", () => {
    selectTimelineTrack(2);
    expect(getSelectedTimelineTrack()).toBe(2);
  });

  // Lane 0 is a real lane, and must not read as "nothing selected".
  it("can select lane zero", () => {
    selectTimelineTrack(0);
    expect(getSelectedTimelineTrack()).toBe(0);
  });

  it("moves the selection rather than adding to it", () => {
    toggleTimelineTrack(1);
    toggleTimelineTrack(3);
    expect(getSelectedTimelineTrack()).toBe(3);
  });

  // Clicking the selected track again is how it is let go of.
  it("lets a track go when it is toggled twice", () => {
    toggleTimelineTrack(1);
    toggleTimelineTrack(1);
    expect(getSelectedTimelineTrack()).toBeNull();
  });

  it("is idempotent, so re-selecting the same track is not a toggle", () => {
    selectTimelineTrack(1);
    selectTimelineTrack(1);
    expect(getSelectedTimelineTrack()).toBe(1);
  });
});
